// Regenerates test/fixtures/render-hashes.json. Run on macOS: the mobile
// prebuilds are checked against it.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

import { parseIconSize } from '../src/lib/icon-size.ts'
import { renderPng } from '../src/lib/render.ts'
import { DENSITIES, readDefaultIcons, SIZES } from '../test/default-icons.ts'

const hashes: Record<string, string> = {}
for (const [name, svg] of await readDefaultIcons()) {
	for (const size of SIZES) {
		for (const density of DENSITIES) {
			const key = `${name}/${size}@${density}x`
			const { width } = parseIconSize(`${size}@${density}x`)
			const png = await renderPng(svg, width)
			hashes[key] = createHash('sha256').update(png).digest('hex')
		}
	}
}
await fs.writeFile(
	new URL('../test/fixtures/render-hashes.json', import.meta.url),
	JSON.stringify(hashes, null, '\t') + '\n',
)
console.log(`Wrote ${Object.keys(hashes).length} hashes`)
