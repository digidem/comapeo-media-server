import { createRequire } from 'node:module'

import { Reader } from 'comapeocat/reader.js'

const require = createRequire(import.meta.url)

export const DEFAULT_CONFIG_PATH = require.resolve('@mapeo/default-config')

export const SIZES = ['small', 'medium', 'large'] as const
export const DENSITIES = [1, 1.5, 2, 3, 4] as const

/** The default config's icons, read from the archive so they aren't committed here (they are CC-BY-NC) */
export async function readDefaultIcons() {
	const reader = new Reader(DEFAULT_CONFIG_PATH)
	try {
		const icons = new Map<string, Buffer>()
		for await (const { name, iconXml } of reader.icons()) {
			icons.set(name, Buffer.from(iconXml))
		}
		return new Map([...icons].sort(([a], [b]) => a.localeCompare(b)))
	} finally {
		await reader.close()
	}
}
