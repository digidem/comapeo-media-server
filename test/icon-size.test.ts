import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { nearestStoredVariant, parseIconSize } from '../src/lib/icon-size.ts'

describe('parseIconSize', () => {
	const accepted: Array<[string, number, number, number]> = [
		// input, dp, density, width
		['8', 8, 1, 8],
		['24', 24, 1, 24],
		['128', 128, 1, 128],
		['24@1x', 24, 1, 24],
		['24@1.5x', 24, 1.5, 36],
		['25@1.5x', 25, 1.5, 38],
		['24@2x', 24, 2, 48],
		['24@3x', 24, 3, 72],
		['24@4x', 24, 4, 96],
		['128@4x', 128, 4, 512],
		['small', 16, 1, 16],
		['medium', 24, 1, 24],
		['large', 32, 1, 32],
		['small@2x', 16, 2, 32],
		['medium@1.5x', 24, 1.5, 36],
		['large@3x', 32, 3, 96],
	]
	for (const [input, dp, density, width] of accepted) {
		test(`accepts ${input}`, () => {
			assert.deepEqual(parseIconSize(input), { dp, density, width })
		})
	}

	const rejected = [
		'',
		'7',
		'129',
		'0',
		'024',
		'+24',
		'-24',
		'24.5',
		'1e2',
		'24@',
		'24@x',
		'24@0x',
		'24@2.5x',
		'24@5x',
		'24@01x',
		'24@1.50x',
		'24@2X',
		'24x',
		'@2x',
		'huge',
		'Small',
		'small@',
		' 24',
		'24 ',
	]
	for (const input of rejected) {
		test(`rejects ${JSON.stringify(input)}`, () => {
			assert.throws(() => parseIconSize(input), {
				code: 'INVALID_ICON_SIZE',
				status: 400,
			})
		})
	}
})

test('nearestStoredVariant', () => {
	const cases: Array<[string, string, number]> = [
		['8', 'small', 1],
		['16', 'small', 1],
		['20', 'small', 1],
		['21', 'medium', 1],
		['24', 'medium', 1],
		['28', 'medium', 1],
		['29', 'large', 1],
		['128', 'large', 1],
		['24@1.5x', 'medium', 2],
		['24@2x', 'medium', 2],
		['24@3x', 'medium', 3],
		['24@4x', 'medium', 3],
	]
	for (const [input, size, pixelDensity] of cases) {
		assert.deepEqual(
			nearestStoredVariant(parseIconSize(input)),
			{ size, pixelDensity },
			input,
		)
	}
})
