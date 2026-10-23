// Static import so a missing or broken native binding fails at startup, not
// on the first icon request, and so bundlers can see the dependency.
import { render } from '@comapeo/resvg'

// Width is bounded by the size grammar; height follows the SVG's aspect ratio,
// which comes from synced data and could otherwise exhaust memory.
const MAX_HEIGHT = 512

/**
 * Render an SVG to a PNG `width` pixels wide, keeping its aspect ratio, or
 * narrower if it would be taller than 512px.
 */
export async function renderPng(svg: Uint8Array, width: number) {
	return render(svg, { width, height: MAX_HEIGHT })
}
