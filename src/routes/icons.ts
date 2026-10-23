import type { IRequestStrict } from 'itty-router'

import { RenderFailed } from '../errors.ts'
import { getErrorCode, getErrorMessage } from '../lib/error-response.ts'
import { nearestStoredVariant, parseIconSize } from '../lib/icon-size.ts'
import { renderPng } from '../lib/render.ts'
import {
	HEX_32_BYTES,
	Z_BASE_32_32_BYTES,
	withParams,
} from '../lib/validation.ts'
import type {
	IconVariantQuery,
	IconVariantResult,
	MediaServerOptions,
} from '../types.ts'

export const ICON_ROUTE = '/icons/:projectPublicId/:iconDocId/:filename'

export const withIconParams = withParams({
	projectPublicId: Z_BASE_32_32_BYTES,
	iconDocId: HEX_32_BYTES,
	filename: /^.+\.(svg|png)$/,
})

type IconRequest = IRequestStrict & {
	params: { projectPublicId: string; iconDocId: string; filename: string }
}

// The URL names the icon doc, which can point at a new blob after an edit, so
// clients must revalidate rather than cache for a fixed time.
const CACHE_CONTROL = 'no-cache'

export function iconHandler({ getIcon }: Pick<MediaServerOptions, 'getIcon'>) {
	return async (request: IconRequest) => {
		const { projectPublicId, iconDocId, filename } = request.params
		const extIndex = filename.lastIndexOf('.')
		const ext = filename.slice(extIndex + 1)
		// Parsed for both extensions so that one size grammar covers every URL,
		// but an SVG is served as stored whatever size is asked for.
		const size = parseIconSize(filename.slice(0, extIndex))
		const fetchIcon = (query: IconVariantQuery) =>
			getIcon(projectPublicId, iconDocId, query)

		const svg = await fetchIcon({ mimeType: 'image/svg+xml' }).catch((err) => {
			if (
				ext === 'png' &&
				getErrorCode(err) === 'NO_VARIANTS_FOR_MIME_TYPE_ERROR'
			) {
				return null
			}
			throw err
		})

		if (!svg) {
			// Projects imported before core stored SVGs only have PNG variants:
			// serve the nearest one as stored, unscaled.
			const png = await fetchIcon({
				mimeType: 'image/png',
				...nearestStoredVariant(size),
			})
			return storedIconResponse(request, png)
		}
		if (ext === 'svg') return storedIconResponse(request, svg)

		const etag = `"${svg.blobVersionId}-${size.width}"`
		const cached = notModified(request, etag)
		if (cached) return cached
		const png = await renderPng(svg.blob, size.width).catch((err) => {
			throw new RenderFailed(getErrorMessage(err), { cause: err })
		})
		return iconResponse(request, png, etag, 'image/png')
	}
}

function storedIconResponse(request: Request, icon: IconVariantResult) {
	const etag = `"${icon.blobVersionId}"`
	return (
		notModified(request, etag) ??
		iconResponse(request, icon.blob, etag, icon.mimeType)
	)
}

function cacheHeaders(etag: string) {
	return { ETag: etag, 'Cache-Control': CACHE_CONTROL }
}

function notModified(request: Request, etag: string): Response | undefined {
	if (!matchesEtag(request.headers.get('if-none-match'), etag)) return
	return new Response(null, { status: 304, headers: cacheHeaders(etag) })
}

function iconResponse(
	request: Request,
	bytes: Uint8Array,
	etag: string,
	contentType: string,
) {
	const body = request.method === 'HEAD' ? null : bytes
	return new Response(body as Uint8Array<ArrayBuffer> | null, {
		headers: {
			...cacheHeaders(etag),
			'Content-Type': contentType,
			'Content-Length': String(bytes.byteLength),
		},
	})
}

/** Weak comparison, as RFC 9110 requires for If-None-Match */
function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
	if (!ifNoneMatch) return false
	if (ifNoneMatch.trim() === '*') return true
	return ifNoneMatch
		.split(',')
		.some((candidate) => candidate.trim().replace(/^W\//, '') === etag)
}
