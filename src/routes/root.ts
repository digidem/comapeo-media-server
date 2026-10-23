import { cors, Router, type IRequestStrict } from 'itty-router'

import { NotFound } from '../errors.ts'
import { errorResponse } from '../lib/error-response.ts'
import type { MediaServerOptions } from '../types.ts'
import { BLOB_ROUTE, blobHandler, withBlobParams } from './blobs.ts'
import { ICON_ROUTE, iconHandler, withIconParams } from './icons.ts'

const EXPOSE_HEADERS = 'Content-Range, Content-Length, Accept-Ranges, ETag'

const { preflight } = cors({
	origin: '*',
	allowMethods: ['GET', 'HEAD', 'OPTIONS'],
	allowHeaders: ['Range', 'If-None-Match'],
})

// itty-router's corsify clones the response, which breaks abort propagation
// on streamed blob bodies.
function corsify(response: Response): Response {
	if (response.headers.has('access-control-allow-origin')) return response
	const headers = new Headers(response.headers)
	headers.set('access-control-allow-origin', '*')
	headers.set('access-control-expose-headers', EXPOSE_HEADERS)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

export function RootRouter(options: MediaServerOptions) {
	const blob = blobHandler(options)
	const icon = iconHandler(options)

	return Router<IRequestStrict>({
		before: [preflight],
		catch: (err, request) => {
			const response = errorResponse(err)
			if (response.status >= 500) {
				try {
					options.onError?.(err, request)
				} catch {
					// A failing error handler must not replace the error response
				}
			}
			return response
		},
		finally: [(response) => response ?? errorResponse(new NotFound()), corsify],
	})
		.get(BLOB_ROUTE, withBlobParams, blob)
		.head(BLOB_ROUTE, withBlobParams, blob)
		.get(ICON_ROUTE, withIconParams, icon)
		.head(ICON_ROUTE, withIconParams, icon)
}
