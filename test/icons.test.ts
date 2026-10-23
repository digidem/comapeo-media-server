import assert from 'node:assert/strict'
import { describe, mock, test } from 'node:test'

import { IconNotFound } from '../src/errors.ts'
import type { IconVariantQuery, IconVariantResult } from '../src/types.ts'
import {
	codeError,
	ICON_DOC_ID,
	iconUrl,
	PNG_SIGNATURE,
	PROJECT_ID,
	pngWidth,
	stubServer,
	SVG,
	errorBody,
} from './helpers.ts'

const BLOB_VERSION_ID = 'abc123/0'

// As core's IconApi throws it
function noVariantsError() {
	return Object.assign(codeError('NO_VARIANTS_FOR_MIME_TYPE_ERROR'), {
		status: 404,
	})
}
const STORED_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('stored')])

function svgIcon() {
	return mock.fn(async (_p: string, _i: string, query: IconVariantQuery) => {
		assert.equal(query.mimeType, 'image/svg+xml')
		return {
			blob: SVG,
			blobVersionId: BLOB_VERSION_ID,
			mimeType: query.mimeType,
		}
	})
}

/** An icon imported before core stored SVGs: PNG variants only */
function pngOnlyIcon() {
	return mock.fn(async (_p: string, _i: string, query: IconVariantQuery) => {
		if (query.mimeType === 'image/svg+xml') {
			throw noVariantsError()
		}
		return { blob: STORED_PNG, blobVersionId: 'png/1', mimeType: 'image/png' }
	})
}

async function get(
	getIcon: (
		projectPublicId: string,
		iconDocId: string,
		query: IconVariantQuery,
	) => Promise<IconVariantResult>,
	filename: string,
	headers: Record<string, string> = {},
) {
	const server = stubServer({ getIcon })
	return server.fetch(new Request(iconUrl(filename), { headers }))
}

describe('params', () => {
	const cases: Array<[string, string, string]> = [
		[
			'invalid project id',
			`http://localhost/icons/invalid/${ICON_DOC_ID}/24.png`,
			'INVALID_REQUEST',
		],
		[
			'invalid icon doc id',
			`http://localhost/icons/${PROJECT_ID}/invalid/24.png`,
			'INVALID_REQUEST',
		],
		['unsupported extension', iconUrl('medium.jpg'), 'INVALID_REQUEST'],
		['no extension', iconUrl('medium'), 'INVALID_REQUEST'],
		['invalid size word', iconUrl('invalid.png'), 'INVALID_ICON_SIZE'],
		['size too small', iconUrl('4.png'), 'INVALID_ICON_SIZE'],
		['size too large', iconUrl('256.png'), 'INVALID_ICON_SIZE'],
		['invalid density', iconUrl('24@5x.png'), 'INVALID_ICON_SIZE'],
		['invalid svg size', iconUrl('huge.svg'), 'INVALID_ICON_SIZE'],
	]
	for (const [name, url, code] of cases) {
		test(`${name} is a 400 ${code}`, async () => {
			const getIcon = svgIcon()
			const res = await stubServer({ getIcon }).fetch(new Request(url))
			assert.equal(res.status, 400)
			const body = await errorBody(res)
			assert.equal(body.code, code)
			assert.equal(body.status, 400)
			assert.equal(getIcon.mock.callCount(), 0)
		})
	}
})

describe('svg', () => {
	for (const size of ['small', 'medium', 'large', '24']) {
		test(`${size}.svg serves the stored svg`, async () => {
			const getIcon = svgIcon()
			const res = await get(getIcon, `${size}.svg`)
			assert.equal(res.status, 200)
			assert.equal(res.headers.get('content-type'), 'image/svg+xml')
			assert.equal(res.headers.get('etag'), `"${BLOB_VERSION_ID}"`)
			assert.equal(res.headers.get('cache-control'), 'no-cache')
			assert.deepEqual(Buffer.from(await res.arrayBuffer()), SVG)
			assert.deepEqual(getIcon.mock.calls[0]!.arguments, [
				PROJECT_ID,
				ICON_DOC_ID,
				{ mimeType: 'image/svg+xml' },
			])
		})
	}

	test('IconNotFound is a 404 ICON_NOT_FOUND', async () => {
		const getIcon = mock.fn(async () => {
			throw new IconNotFound()
		})
		const res = await stubServer({ getIcon }).fetch(
			new Request(iconUrl('medium.svg')),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'ICON_NOT_FOUND')
	})
})

describe('png', () => {
	const widths: Array<[string, number]> = [
		['24', 24],
		['small', 16],
		['medium', 24],
		['large', 32],
		['24@1.5x', 36],
		['24@2x', 48],
		['medium@3x', 72],
		['128@4x', 512],
	]
	for (const [size, width] of widths) {
		test(`${size}.png renders ${width}px wide`, async () => {
			const getIcon = svgIcon()
			const res = await get(getIcon, `${size}.png`)
			assert.equal(res.status, 200)
			assert.equal(res.headers.get('content-type'), 'image/png')
			assert.equal(res.headers.get('etag'), `"${BLOB_VERSION_ID}-${width}"`)
			assert.equal(res.headers.get('cache-control'), 'no-cache')
			const png = Buffer.from(await res.arrayBuffer())
			assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE)
			assert.equal(pngWidth(png), width)
			assert.equal(res.headers.get('content-length'), String(png.length))
		})
	}

	test('matching If-None-Match is a 304 without rendering', async () => {
		const getIcon = svgIcon()
		for (const ifNoneMatch of [
			`"${BLOB_VERSION_ID}-48"`,
			`W/"${BLOB_VERSION_ID}-48"`,
			`"other", "${BLOB_VERSION_ID}-48"`,
			'*',
		]) {
			const res = await get(getIcon, '24@2x.png', {
				'if-none-match': ifNoneMatch,
			})
			assert.equal(res.status, 304, ifNoneMatch)
			assert.equal(res.headers.get('etag'), `"${BLOB_VERSION_ID}-48"`)
			assert.equal(res.headers.get('cache-control'), 'no-cache')
			assert.equal(res.body, null)
		}
	})

	test('HEAD sends headers only', async () => {
		const server = stubServer({ getIcon: svgIcon() })
		const res = await server.fetch(
			new Request(iconUrl('24@2x.png'), { method: 'HEAD' }),
		)
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'image/png')
		assert.equal(res.headers.get('etag'), `"${BLOB_VERSION_ID}-48"`)
		assert(Number(res.headers.get('content-length')) > 0)
		assert.equal(res.body, null)
	})

	test('a tall svg is rendered no more than 512px high', async () => {
		const tall = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10000"><rect width="100" height="10000"/></svg>',
		)
		const getIcon = mock.fn(async () => ({
			blob: tall,
			blobVersionId: 'tall/0',
			mimeType: 'image/svg+xml',
		}))
		const res = await stubServer({ getIcon }).fetch(
			new Request(iconUrl('128@4x.png')),
		)
		assert.equal(res.status, 200)
		const png = Buffer.from(await res.arrayBuffer())
		assert.equal(png.readUInt32BE(20), 512)
		assert(pngWidth(png) < 512)
	})

	test('If-None-Match for another width renders', async () => {
		const res = await get(svgIcon(), '24@2x.png', {
			'if-none-match': `"${BLOB_VERSION_ID}-24"`,
		})
		assert.equal(res.status, 200)
		assert.equal(pngWidth(new Uint8Array(await res.arrayBuffer())), 48)
	})

	test('falls back to the nearest stored png when there is no svg', async () => {
		const getIcon = pngOnlyIcon()
		const res = await get(getIcon, '22@1.5x.png')
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'image/png')
		assert.equal(res.headers.get('etag'), '"png/1"')
		assert.deepEqual(Buffer.from(await res.arrayBuffer()), STORED_PNG)
		assert.deepEqual(
			getIcon.mock.calls.map((c) => c.arguments[2]),
			[
				{ mimeType: 'image/svg+xml' },
				{ mimeType: 'image/png', size: 'medium', pixelDensity: 2 },
			],
		)
	})

	test('stored png fallback honours If-None-Match', async () => {
		const res = await get(pngOnlyIcon(), '24.png', {
			'if-none-match': '"png/1"',
		})
		assert.equal(res.status, 304)
	})

	test('other host errors are passed through without fallback', async () => {
		const getIcon = mock.fn(async () => {
			throw new IconNotFound()
		})
		const res = await stubServer({ getIcon }).fetch(
			new Request(iconUrl('24.png')),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'ICON_NOT_FOUND')
		assert.equal(getIcon.mock.callCount(), 1)
	})

	test('missing png fallback is a 404 from the host', async () => {
		const getIcon = mock.fn(async () => {
			throw noVariantsError()
		})
		const res = await stubServer({ getIcon }).fetch(
			new Request(iconUrl('24.png')),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'NO_VARIANTS_FOR_MIME_TYPE_ERROR')
	})

	test('an svg that cannot be parsed is a 500 RENDER_FAILED', async () => {
		const getIcon = mock.fn(async () => ({
			blob: Buffer.from('not an svg'),
			blobVersionId: 'bad/0',
			mimeType: 'image/svg+xml',
		}))
		const res = await stubServer({ getIcon }).fetch(
			new Request(iconUrl('24.png')),
		)
		assert.equal(res.status, 500)
		assert.equal((await errorBody(res)).code, 'RENDER_FAILED')
	})
})
