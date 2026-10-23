import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'

import { createServer } from '../src/index.ts'
import {
	blobUrl,
	endlessBlob,
	iconUrl,
	stubBlob,
	stubServer,
} from './helpers.ts'

test('createServer validates options', () => {
	// @ts-expect-error - testing invalid options
	assert.throws(() => createServer({}), TypeError)
	assert.throws(
		// @ts-expect-error - testing invalid options
		() => createServer({ getBlob: async () => stubBlob(Buffer.alloc(0)).blob }),
		TypeError,
	)
	assert.throws(
		() =>
			createServer({
				getBlob: async () => {
					throw new Error()
				},
				getIcon: async () => {
					throw new Error()
				},
				// @ts-expect-error - testing invalid options
				onError: 'log',
			}),
		TypeError,
	)
})

test('onError gets the error behind a 500', async () => {
	const hostError = new Error('secret host detail')
	const onError = mock.fn()
	const server = stubServer({
		getBlob: () => Promise.reject(hostError),
		onError,
	})
	const request = new Request(blobUrl())
	const res = await server.fetch(request)
	assert.equal(res.status, 500)
	assert.doesNotMatch(await res.text(), /secret/)
	assert.equal(onError.mock.callCount(), 1)
	assert.equal(onError.mock.calls[0]!.arguments[0], hostError)
	assert.equal(onError.mock.calls[0]!.arguments[1].url, request.url)
})

test('onError gets render failures with the resvg error as cause', async () => {
	const onError = mock.fn()
	const server = stubServer({
		getIcon: async () => ({
			blob: Buffer.from('not an svg'),
			blobVersionId: 'bad/0',
			mimeType: 'image/svg+xml',
		}),
		onError,
	})
	const res = await server.fetch(new Request(iconUrl('24.png')))
	assert.equal(res.status, 500)
	const [err] = onError.mock.calls[0]!.arguments
	assert.equal(err.code, 'RENDER_FAILED')
	assert(err.cause instanceof Error)
})

test('onError is not called for 4xx responses', async () => {
	const onError = mock.fn()
	const server = stubServer({ onError })
	for (const url of [blobUrl(), iconUrl('24.svg'), 'http://localhost/nope']) {
		const res = await server.fetch(new Request(url))
		assert.equal(res.status, 404)
	}
	assert.equal(onError.mock.callCount(), 0)
})

test('a throwing onError still sends the 500', async () => {
	const res = await stubServer({
		getIcon: async () => ({
			blob: Buffer.from('not an svg'),
			blobVersionId: 'bad/0',
			mimeType: 'image/svg+xml',
		}),
		onError: () => {
			throw new Error('logger broke')
		},
	}).fetch(new Request(iconUrl('24.png')))
	assert.equal(res.status, 500)
	assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('listen on a TCP port and close', async () => {
	const server = stubServer()
	const address = await server.listen()
	assert('port' in address)
	assert.equal(address.host, '127.0.0.1')
	const res = await fetch(`http://127.0.0.1:${address.port}/nope`)
	assert.equal(res.status, 404)
	assert.equal(res.headers.get('access-control-allow-origin'), '*')
	await res.arrayBuffer()
	await assert.rejects(server.listen(), /already listening/)
	await server.close()
	await server.close()
	await assert.rejects(fetch(`http://127.0.0.1:${address.port}/nope`))
})

test('listen twice at once rejects the second', async () => {
	const server = stubServer()
	const first = server.listen()
	await assert.rejects(server.listen(), /already listening/)
	await first
	await server.close()
})

test('close while listen is pending leaves the server closed', async () => {
	const server = stubServer()
	const listening = server.listen()
	await server.close()
	const address = await listening
	assert('port' in address)
	await assert.rejects(fetch(`http://127.0.0.1:${address.port}/nope`))
})

test('close ends responses that are still streaming', async () => {
	const { blob } = endlessBlob()
	const server = stubServer({ getBlob: async () => blob })
	const address = await server.listen()
	assert('port' in address)
	const res = await fetch(
		`http://127.0.0.1:${address.port}${new URL(blobUrl()).pathname}`,
	)
	const reader = res.body!.getReader()
	await reader.read()
	// Without destroying open connections, close() would wait for this forever
	await server.close()
	await (async () => {
		while (!(await reader.read()).done);
	})().catch(() => {})
})

test(
	'listen on a unix socket',
	{ skip: process.platform === 'win32' },
	async (t) => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-server-'))
		t.after(() => fs.rm(dir, { recursive: true, force: true }))
		const socketPath = path.join(dir, 'media.sock')
		const server = stubServer()
		assert.deepEqual(await server.listen({ path: socketPath }), {
			path: socketPath,
		})
		t.after(() => server.close())
		const status = await new Promise<number | undefined>((resolve, reject) => {
			http
				.get({ socketPath, path: '/nope' }, (res) => {
					res.resume()
					resolve(res.statusCode)
				})
				.on('error', reject)
		})
		assert.equal(status, 404)
	},
)

test('CORS preflight', async () => {
	const res = await stubServer().fetch(
		new Request('http://localhost/blobs/x', {
			method: 'OPTIONS',
			headers: {
				origin: 'http://example.com',
				'access-control-request-method': 'GET',
				'access-control-request-headers': 'range',
			},
		}),
	)
	assert.equal(res.status, 204)
	assert.equal(res.headers.get('access-control-allow-origin'), '*')
	assert.match(res.headers.get('access-control-allow-headers') ?? '', /Range/i)
})
