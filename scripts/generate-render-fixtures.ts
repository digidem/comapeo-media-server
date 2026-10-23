// Regenerates test/fixtures/renders/. Run on macOS: the tests allow the small
// anti-aliasing differences between resvg builds for other platforms.
import fs from 'node:fs/promises'

import { parseIconSize } from '../src/lib/icon-size.ts'
import { renderPng } from '../src/lib/render.ts'
import { DENSITIES, readDefaultIcons, SIZES } from '../test/default-icons.ts'

const dir = new URL('../test/fixtures/renders/', import.meta.url)
await fs.rm(dir, { recursive: true, force: true })
let count = 0
for (const [name, svg] of await readDefaultIcons()) {
	await fs.mkdir(new URL(`${name}/`, dir), { recursive: true })
	for (const size of SIZES) {
		for (const density of DENSITIES) {
			const { width } = parseIconSize(`${size}@${density}x`)
			const png = await renderPng(svg, width)
			await fs.writeFile(new URL(`${name}/${size}@${density}x.png`, dir), png)
			count++
		}
	}
}
console.log(`Wrote ${count} renders`)
