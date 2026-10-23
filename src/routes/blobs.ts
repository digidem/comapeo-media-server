import type { IRequestStrict } from 'itty-router'
import { filetypemime } from 'magic-bytes.js'
import parseRange from 'range-parser'

import { InvalidRequest } from '../errors.ts'
import {
	HEX_32_BYTES,
	Z_BASE_32_32_BYTES,
	withParams,
} from '../lib/validation.ts'
import type { BlobId, MediaServerOptions, StoredBlob } from '../types.ts'

export const BLOB_ROUTE =
	'/blobs/:projectPublicId/:driveId/:type/:variant/:name'

const SUPPORTED_BLOB_VARIANTS = {
	photo: ['original', 'preview', 'thumbnail'],
	audio: ['original'],
	video: ['original'],
} as const satisfies { [T in BlobId['type']]: readonly BlobId['variant'][] }

export const withBlobParams = withParams({
	projectPublicId: Z_BASE_32_32_BYTES,
	driveId: HEX_32_BYTES,
	// Core joins the name into a drive path, so `/` or a dot segment would
	// reach blobs of another type or variant.
	name: /^(?!\.\.?$)[^/]+$/,
})

type BlobRequest = IRequestStrict & {
	params: {
		projectPublicId: string
		driveId: string
		type: string
		variant: string
		name: string
	}
}

export function blobHandler({ getBlob }: Pick<MediaServerOptions, 'getBlob'>) {
	return async (request: BlobRequest) => {
		const { projectPublicId, ...blobId } = request.params
		if (!isValidBlobId(blobId)) {
			throw new InvalidRequest(
				`Unsupported blob type and variant "${blobId.type}/${blobId.variant}"`,
			)
		}

		const blob = await getBlob(projectPublicId, blobId)
		const headers = new Headers({
			'Accept-Ranges': 'bytes',
			'Content-Length': String(blob.size),
		})
		if (blob.size === 0) {
			headers.set('Content-Type', blob.mimeType ?? 'application/octet-stream')
			return new Response(null, { headers })
		}

		let status = 200
		let range: { start: number; length: number } | undefined
		const rangeHeader = request.headers.get('range')
		if (rangeHeader) {
			const ranges = parseRange(blob.size, rangeHeader, { combine: true })
			if (ranges === -1) {
				return new Response(null, {
					status: 416,
					headers: {
						'Content-Range': `bytes */${blob.size}`,
						'Content-Length': '0',
					},
				})
			}
			// -2 is a malformed header, and multipart ranges are not supported:
			// both fall through to a full 200 response.
			if (ranges !== -2 && ranges.type === 'bytes' && ranges.length === 1) {
				const { start, end } = ranges[0]!
				range = { start, length: end - start + 1 }
				status = 206
				headers.set('Content-Range', `bytes ${start}-${end}/${blob.size}`)
				headers.set('Content-Length', String(range.length))
			}
		}

		headers.set('Content-Type', blob.mimeType ?? (await sniffMimeType(blob)))

		// Read the first chunk before sending headers, so that a blob whose data
		// is not available locally is still an error response.
		const iterator = blob.read(range)[Symbol.asyncIterator]()
		const first = await iterator.next()

		if (request.method === 'HEAD') {
			await iterator.return?.()
			return new Response(null, { status, headers })
		}
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				if (first.done) controller.close()
				else controller.enqueue(first.value)
			},
			async pull(controller) {
				const next = await iterator.next()
				if (next.done) controller.close()
				else controller.enqueue(next.value)
			},
			// Called when the client disconnects
			async cancel() {
				await iterator.return?.()
			},
		})
		return new Response(body, { status, headers })
	}
}

function isValidBlobId(maybeBlobId: {
	type: string
	variant: string
}): maybeBlobId is BlobId {
	const { type, variant } = maybeBlobId
	if (!Object.hasOwn(SUPPORTED_BLOB_VARIANTS, type)) return false
	const validVariants: readonly string[] =
		SUPPORTED_BLOB_VARIANTS[type as BlobId['type']]
	return validVariants.includes(variant)
}

const SNIFF_LENGTH = 20

async function sniffMimeType(blob: StoredBlob) {
	const chunks: Uint8Array[] = []
	let length = 0
	for await (const chunk of blob.read({
		start: 0,
		length: Math.min(SNIFF_LENGTH, blob.size),
	})) {
		chunks.push(chunk)
		length += chunk.length
		if (length >= SNIFF_LENGTH) break
	}
	const [guessedMime] = filetypemime(Buffer.concat(chunks))
	return guessedMime || 'application/octet-stream'
}
