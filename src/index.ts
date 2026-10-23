import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { createAdapter } from '@comapeo/node-server'

import { RootRouter } from './routes/root.ts'
import type { MediaServerOptions } from './types.ts'

export type {
	BlobId,
	StoredBlob,
	IconVariantQuery,
	IconVariantResult,
	MediaServerOptions,
} from './types.ts'

export type ListenOptions = { port?: number; host?: string } | { path: string }
export type ListenResult = { port: number; host: string } | { path: string }

export type MediaServer = ReturnType<typeof createServer>

export function createServer(options: MediaServerOptions) {
	if (typeof options?.getBlob !== 'function') {
		throw new TypeError('getBlob must be a function')
	}
	if (typeof options.getIcon !== 'function') {
		throw new TypeError('getIcon must be a function')
	}
	if (options.onError !== undefined && typeof options.onError !== 'function') {
		throw new TypeError('onError must be a function')
	}

	const router = RootRouter(options)
	const fetch = (request: Request): Promise<Response> => router.fetch(request)
	const httpServer = http.createServer(createAdapter(fetch))

	let listening: Promise<ListenResult> | undefined
	let closing: Promise<void> | undefined

	async function bind(opts: ListenOptions): Promise<ListenResult> {
		if ('path' in opts) {
			httpServer.listen(opts.path)
			await once(httpServer, 'listening')
			return { path: opts.path }
		}
		httpServer.listen(opts.port ?? 0, opts.host ?? '127.0.0.1')
		await once(httpServer, 'listening')
		const { port, address } = httpServer.address() as AddressInfo
		return { port, host: address }
	}

	async function unbind(pendingListen: Promise<unknown>): Promise<void> {
		await pendingListen.catch(() => {})
		if (!httpServer.listening) return
		const closed = once(httpServer, 'close')
		httpServer.close()
		httpServer.closeAllConnections()
		await closed
	}

	return {
		/** Handle a request without going through the network */
		fetch,
		/**
		 * Listen on a TCP port (default host `127.0.0.1`, default port random)
		 * or a unix domain socket path. Resolves with the bound address.
		 */
		async listen(opts: ListenOptions = {}): Promise<ListenResult> {
			if (closing) await closing
			if (listening) throw new Error('Server is already listening')
			const pending = bind(opts)
			listening = pending
			try {
				return await pending
			} catch (err) {
				if (listening === pending) listening = undefined
				throw err
			}
		},
		/** Stop listening and destroy open connections. A no-op if not listening. */
		close(): Promise<void> {
			if (!closing && listening) {
				const pending = listening
				listening = undefined
				closing = unbind(pending).finally(() => {
					closing = undefined
				})
			}
			return closing ?? Promise.resolve()
		},
	}
}
