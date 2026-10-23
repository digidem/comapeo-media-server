import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { PNG } from 'pngjs'

import { DENSITIES, readDefaultIcons, SIZES } from './default-icons.ts'
import { iconUrl, stubServer } from './helpers.ts'

const execFileAsync = promisify(execFile)

// resvg builds for different platforms differ by a few anti-aliased edge pixels
// (a mean of about 0.1 levels at worst); a different icon differs by about 90.
const MAX_MEAN_CHANNEL_DIFF = 1

test('default icons render like the committed macOS renders', async () => {
	const icons = await readDefaultIcons()
	assert.equal(icons.size, 26)
	let svg: Buffer
	const server = stubServer({
		getIcon: async () => ({
			blob: svg,
			blobVersionId: 'v/0',
			mimeType: 'image/svg+xml',
		}),
	})
	const mismatches: string[] = []
	for (const [name, iconSvg] of icons) {
		svg = iconSvg
		for (const size of SIZES) {
			for (const density of DENSITIES) {
				const key = `${name}/${size}@${density}x`
				const res = await server.fetch(
					new Request(iconUrl(`${size}@${density}x.png`)),
				)
				assert.equal(res.status, 200, key)
				const actual = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
				const expected = PNG.sync.read(
					await fs.readFile(
						new URL(`./fixtures/renders/${key}.png`, import.meta.url),
					),
				)
				const diff = meanChannelDiff(actual, expected)
				if (diff > MAX_MEAN_CHANNEL_DIFF) {
					mismatches.push(`${key} (mean diff ${diff.toFixed(2)})`)
				}
			}
		}
	}
	assert.deepEqual(mismatches, [])
})

function meanChannelDiff(a: PNG, b: PNG) {
	if (a.width !== b.width || a.height !== b.height) return Infinity
	let sum = 0
	for (let i = 0; i < a.data.length; i++) {
		sum += Math.abs(a.data[i] - b.data[i])
	}
	return sum / a.data.length
}

test('the server fails to load when the resvg binding is missing', async (t) => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-server-'))
	t.after(() => fs.rm(dir, { recursive: true }))
	const brokenBinding = path.join(dir, 'binding.cjs')
	await fs.writeFile(brokenBinding, 'throw new Error("binding missing")')
	const indexUrl = new URL('../src/index.ts', import.meta.url).href
	// Replaces the prebuild loader, which is what fails when no prebuilt binary
	// matches.
	const script = `
		import { registerHooks } from 'node:module'
		import { pathToFileURL } from 'node:url'
		registerHooks({
			resolve(specifier, context, next) {
				if (specifier === 'node-gyp-build' && context.parentURL?.includes('@comapeo/resvg')) {
					return { url: pathToFileURL(${JSON.stringify(brokenBinding)}).href, shortCircuit: true }
				}
				return next(specifier, context)
			},
		})
		await import(${JSON.stringify(indexUrl)})
	`
	await assert.rejects(
		execFileAsync(process.execPath, ['--input-type=module', '-e', script]),
		(err: { stderr: string }) => {
			assert.match(err.stderr, /binding missing/)
			return true
		},
	)
})
