import { InvalidIconSize } from '../errors.ts'

const SIZE_ALIASES = { small: 16, medium: 24, large: 32 } as const
export type SizeAlias = keyof typeof SIZE_ALIASES

type Density = 1 | 1.5 | 2 | 3 | 4

const MIN_DP = 8
const MAX_DP = 128
const MAX_WIDTH = 512

export type IconSize = {
	/** Density-independent pixels */
	dp: number
	density: Density
	/** Rendered width in physical pixels */
	width: number
}

// No leading zeros or signs, which would only add URLs for the same image.
const SIZE_REGEX = /^(small|medium|large|[1-9][0-9]*)(?:@(1|1\.5|2|3|4)x)?$/

/**
 * Parse the size part of an icon filename, e.g. `24`, `24@2x`, `medium@1.5x`.
 * Throws `INVALID_ICON_SIZE` for anything else.
 */
export function parseIconSize(input: string): IconSize {
	const match = SIZE_REGEX.exec(input)
	if (!match) {
		throw new InvalidIconSize(`Invalid icon size "${input}"`)
	}
	const [, sizeStr, densityStr] = match as unknown as [string, string, string?]
	const dp =
		sizeStr in SIZE_ALIASES
			? SIZE_ALIASES[sizeStr as SizeAlias]
			: Number.parseInt(sizeStr, 10)
	const density = (densityStr ? Number(densityStr) : 1) as Density
	if (dp < MIN_DP || dp > MAX_DP) {
		throw new InvalidIconSize(
			`Icon size must be between ${MIN_DP} and ${MAX_DP}, got ${dp}`,
		)
	}
	const width = Math.round(dp * density)
	if (width > MAX_WIDTH) {
		throw new InvalidIconSize(
			`Rendered icon width must not exceed ${MAX_WIDTH}px, got ${width}px`,
		)
	}
	return { dp, density, width }
}

/**
 * The stored PNG variant closest to a requested size, for projects that have
 * no SVG variant. Ties go to the smaller size, as in core's variant matching.
 */
export function nearestStoredVariant({ dp, density }: IconSize): {
	size: SizeAlias
	pixelDensity: 1 | 2 | 3
} {
	const size: SizeAlias = dp <= 20 ? 'small' : dp <= 28 ? 'medium' : 'large'
	const pixelDensity = Math.min(3, Math.round(density)) as 1 | 2 | 3
	return { size, pixelDensity }
}
