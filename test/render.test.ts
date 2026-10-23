import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { DENSITIES, readDefaultIcons, SIZES } from './default-icons.ts'
import { iconUrl, stubServer } from './helpers.ts'

const execFileAsync = promisify(execFile)

const expectedHashes: Record<string, string> = JSON.parse(
	await fs.readFile(
		new URL('./fixtures/render-hashes.json', import.meta.url),
		'utf8',
	),
)

test('default icons render to the committed hashes', async () => {
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
	let count = 0
	for (const [name, iconSvg] of icons) {
		svg = iconSvg
		for (const size of SIZES) {
			for (const density of DENSITIES) {
				const key = `${name}/${size}@${density}x`
				const res = await server.fetch(
					new Request(iconUrl(`${size}@${density}x.png`)),
				)
				assert.equal(res.status, 200, key)
				const hash = createHash('sha256')
					.update(new Uint8Array(await res.arrayBuffer()))
					.digest('hex')
				if (hash !== expectedHashes[key]) mismatches.push(key)
				count++
			}
		}
	}
	assert.equal(count, Object.keys(expectedHashes).length)
	assert.deepEqual(mismatches, [])
})

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
