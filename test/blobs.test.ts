import assert from 'node:assert/strict'
import { describe, mock, test } from 'node:test'

import { BlobNotFound, ProjectNotFound } from '../src/errors.ts'
import type { StoredBlob } from '../src/types.ts'
import {
	blobUrl,
	codeError,
	DRIVE_ID,
	endlessBlob,
	PNG_SIGNATURE,
	PROJECT_ID,
	stubBlob,
	stubServer,
	errorBody,
} from './helpers.ts'

const DATA = Buffer.from('0123456789abcdefghij')

const INTERNAL_ERROR_BODY = {
	status: 500,
	code: 'INTERNAL_SERVER_ERROR',
	message: 'Internal error',
}

function serverWith(blob: StoredBlob = stubBlob(DATA).blob) {
	return stubServer({ getBlob: async () => blob })
}

describe('params', () => {
	const cases = {
		'invalid project id': `http://localhost/blobs/invalid/${DRIVE_ID}/photo/original/a.jpg`,
		'invalid drive id': `http://localhost/blobs/${PROJECT_ID}/invalid/photo/original/a.jpg`,
		'unknown type': blobUrl('document/original/a.jpg'),
		'unknown variant': blobUrl('photo/invalid/a.jpg'),
		'variant not valid for type': blobUrl('audio/thumbnail/a.mp3'),
		'name containing a slash': blobUrl(
			'photo/thumbnail/..%2F..%2Fvideo%2Foriginal%2Fa.mp4',
		),
		'malformed URL encoding': blobUrl('photo/original/%E0%A4%A'),
	}
	for (const [name, url] of Object.entries(cases)) {
		test(`${name} is a 400`, async () => {
			const getBlob = mock.fn(async () => stubBlob(DATA).blob)
			const res = await stubServer({ getBlob }).fetch(new Request(url))
			assert.equal(res.status, 400)
			const body = await errorBody(res)
			assert.equal(body.code, 'INVALID_REQUEST')
			assert.equal(body.status, 400)
			assert.equal(typeof body.message, 'string')
			assert.equal(getBlob.mock.callCount(), 0)
		})
	}

	test('every supported type and variant', async () => {
		for (const path of [
			'photo/original',
			'photo/preview',
			'photo/thumbnail',
			'audio/original',
			'video/original',
		]) {
			const res = await serverWith().fetch(new Request(blobUrl(`${path}/x`)))
			assert.equal(res.status, 200, path)
			await res.arrayBuffer()
		}
	})

	test('are URL-decoded before reaching the host', async () => {
		const getBlob = mock.fn(async () => stubBlob(DATA).blob)
		const res = await stubServer({ getBlob }).fetch(
			new Request(blobUrl('photo/original/a%20b')),
		)
		assert.equal(res.status, 200)
		await res.arrayBuffer()
		assert.deepEqual(getBlob.mock.calls[0]!.arguments, [
			PROJECT_ID,
			{ driveId: DRIVE_ID, type: 'photo', variant: 'original', name: 'a b' },
		])
	})

	test('unknown route is a 404', async () => {
		const res = await serverWith().fetch(new Request('http://localhost/nope'))
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'NOT_FOUND')
	})
})

describe('host errors', () => {
	const cases = {
		'ProjectNotFound is a 404 PROJECT_NOT_FOUND': [
			new ProjectNotFound(),
			404,
			'PROJECT_NOT_FOUND',
		],
		'BlobNotFound is a 404 BLOB_NOT_FOUND': [
			new BlobNotFound(),
			404,
			'BLOB_NOT_FOUND',
		],
		'other errors with a status are passed through': [
			Object.assign(codeError('NOT_FOUND_ERROR'), { status: 404 }),
			404,
			'NOT_FOUND_ERROR',
		],
	} as const
	for (const [name, [err, status, code]] of Object.entries(cases)) {
		test(name, async () => {
			const server = stubServer({
				getBlob: async () => {
					throw err
				},
			})
			const res = await server.fetch(new Request(blobUrl()))
			assert.equal(res.status, status)
			assert.deepEqual(await res.json(), { status, code, message: err.message })
		})
	}

	test('errors without a status are a 500 without host details', async () => {
		const server = stubServer({
			getBlob: async () => {
				throw codeError('EIO', 'secret host detail')
			},
		})
		const res = await server.fetch(new Request(blobUrl()))
		assert.equal(res.status, 500)
		assert.deepEqual(await res.json(), INTERNAL_ERROR_BODY)
	})

	test('a non-Error rejection is a 500 JSON response', async () => {
		const server = stubServer({ getBlob: () => Promise.reject('boom') })
		const res = await server.fetch(new Request(blobUrl()))
		assert.equal(res.status, 500)
		assert.equal(res.headers.get('access-control-allow-origin'), '*')
		assert.deepEqual(await res.json(), INTERNAL_ERROR_BODY)
	})

	test('read() failing before any data is sent is an error response', async () => {
		for (const [error, status] of [
			[new BlobNotFound(), 404],
			[codeError('EIO'), 500],
		] as const) {
			const { blob, streams } = stubBlob(DATA, { error })
			const res = await serverWith(blob).fetch(new Request(blobUrl()))
			assert.equal(res.status, status)
			await res.arrayBuffer()
			assert(streams.every((s) => s.destroyed))
		}
	})
})

test('serves the blob', async () => {
	const res = await serverWith().fetch(new Request(blobUrl()))
	assert.equal(res.status, 200)
	assert.equal(res.headers.get('content-type'), 'image/jpeg')
	assert.equal(res.headers.get('content-length'), String(DATA.length))
	assert.equal(res.headers.get('accept-ranges'), 'bytes')
	assert.equal(res.headers.get('access-control-allow-origin'), '*')
	assert.match(
		res.headers.get('access-control-expose-headers') ?? '',
		/Content-Range/,
	)
	assert.deepEqual(Buffer.from(await res.arrayBuffer()), DATA)
})

test('guesses the mime type from the first bytes if missing', async () => {
	const data = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(20)])
	const { blob } = stubBlob(data, { mimeType: null })
	const res = await serverWith(blob).fetch(new Request(blobUrl()))
	assert.equal(res.headers.get('content-type'), 'image/png')
	assert.deepEqual(Buffer.from(await res.arrayBuffer()), data)
})

test('falls back to application/octet-stream', async () => {
	const { blob } = stubBlob(DATA, { mimeType: null })
	const res = await serverWith(blob).fetch(new Request(blobUrl()))
	assert.equal(res.headers.get('content-type'), 'application/octet-stream')
	await res.arrayBuffer()
})

// A regression here hangs rather than fails
test('an empty blob is an empty 200', { timeout: 5000 }, async () => {
	for (const range of [undefined, 'bytes=0-1']) {
		const { blob } = stubBlob(Buffer.alloc(0))
		const res = await serverWith(blob).fetch(
			new Request(blobUrl(), { headers: range ? { range } : {} }),
		)
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-length'), '0')
		assert.equal(res.headers.get('content-type'), 'image/jpeg')
		assert.equal((await res.arrayBuffer()).byteLength, 0)
	}
})

test('HEAD sends headers only and releases the read', async () => {
	const { blob, streams } = stubBlob(DATA)
	const res = await serverWith(blob).fetch(
		new Request(blobUrl(), { method: 'HEAD' }),
	)
	assert.equal(res.status, 200)
	assert.equal(res.headers.get('content-length'), String(DATA.length))
	assert.equal(res.body, null)
	assert(streams.every((s) => s.destroyed))
})

describe('Range', () => {
	async function get(range: string, method = 'GET') {
		const res = await serverWith().fetch(
			new Request(blobUrl(), { method, headers: { range } }),
		)
		return { res, body: Buffer.from(await res.arrayBuffer()) }
	}

	test('bytes=0-1 sends only the first two bytes', async () => {
		const { res, body } = await get('bytes=0-1')
		assert.equal(res.status, 206)
		assert.equal(res.headers.get('content-range'), `bytes 0-1/${DATA.length}`)
		assert.equal(res.headers.get('content-length'), '2')
		assert.equal(body.toString(), '01')
	})

	test('middle range', async () => {
		const { res, body } = await get('bytes=5-9')
		assert.equal(res.status, 206)
		assert.equal(res.headers.get('content-range'), `bytes 5-9/${DATA.length}`)
		assert.equal(body.toString(), '56789')
	})

	test('open-ended and suffix ranges', async () => {
		const open = await get('bytes=15-')
		assert.equal(open.res.status, 206)
		assert.equal(open.body.toString(), 'fghij')
		const suffix = await get('bytes=-3')
		assert.equal(suffix.res.status, 206)
		assert.equal(suffix.body.toString(), 'hij')
	})

	test('overlapping ranges are combined', async () => {
		const { res, body } = await get('bytes=0-1, 1-2')
		assert.equal(res.status, 206)
		assert.equal(body.toString(), '012')
	})

	test('HEAD with a range', async () => {
		const { res } = await get('bytes=0-1', 'HEAD')
		assert.equal(res.status, 206)
		assert.equal(res.headers.get('content-length'), '2')
	})

	test('unsatisfiable range is a 416', async () => {
		const { res, body } = await get('bytes=100-200')
		assert.equal(res.status, 416)
		assert.equal(res.headers.get('content-range'), `bytes */${DATA.length}`)
		assert.equal(res.headers.get('content-length'), '0')
		assert.equal(body.length, 0)
	})

	test('malformed range is ignored', async () => {
		const { res, body } = await get('pages=1-2')
		assert.equal(res.status, 200)
		assert.deepEqual(body, DATA)
	})

	test('multiple ranges fall back to the whole blob', async () => {
		const { res, body } = await get('bytes=0-1, 5-6')
		assert.equal(res.status, 200)
		assert.deepEqual(body, DATA)
	})
})

test('aborting a request releases the read', async (t) => {
	const { blob, streams } = endlessBlob()
	const server = serverWith(blob)
	const address = await server.listen()
	t.after(() => server.close())
	assert('port' in address)

	const controller = new AbortController()
	const res = await fetch(
		`http://127.0.0.1:${address.port}${new URL(blobUrl()).pathname}`,
		{ signal: controller.signal },
	)
	const reader = res.body!.getReader()
	await reader.read()
	const [stream] = streams
	const closed = new Promise((resolve) =>
		stream!.once('close', () => resolve(null)),
	)
	controller.abort()
	await closed
	assert(stream!.destroyed)
})
