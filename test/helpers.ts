import { Readable } from 'streamx'

import { IconNotFound, ProjectNotFound } from '../src/errors.ts'
import { createServer } from '../src/index.ts'
import type {
	IconVariantQuery,
	IconVariantResult,
	MediaServerOptions,
	StoredBlob,
} from '../src/types.ts'

export const PROJECT_ID = 'yb6fj1bjdp3f61ca1tr8cxtbp5f3n9jdc1ptawjew8qu4rcy4chx'
export const DRIVE_ID =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const ICON_DOC_ID =
	'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

export const SVG = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>',
)

export const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

export function blobUrl(path = 'photo/original/test.jpg') {
	return `http://localhost/blobs/${PROJECT_ID}/${DRIVE_ID}/${path}`
}

export function iconUrl(filename: string) {
	return `http://localhost/icons/${PROJECT_ID}/${ICON_DOC_ID}/${filename}`
}

export function pngWidth(png: Uint8Array) {
	return Buffer.from(png).readUInt32BE(16)
}

/**
 * A stored blob, recording the streams `read()` returns. They are streamx
 * streams, as core's are: they behave differently from Node streams.
 */
export function stubBlob(
	data: Buffer,
	{
		mimeType = 'image/jpeg',
		error,
	}: { mimeType?: string | null; error?: Error } = {},
) {
	const streams: Readable[] = []
	const blob: StoredBlob = {
		size: data.length,
		mimeType: mimeType ?? undefined,
		read(range) {
			const start = range?.start ?? 0
			const length = range?.length ?? data.length - start
			const chunk = data.subarray(start, start + length)
			const stream = new Readable(
				error
					? {
							read(cb) {
								cb(error)
							},
						}
					: undefined,
			)
			if (!error) {
				if (chunk.length > 0) stream.push(chunk)
				stream.push(null)
			}
			streams.push(stream)
			// streamx's types yield `unknown` from async iteration
			return stream as AsyncIterable<Uint8Array>
		},
	}
	return { blob, streams }
}

/** A blob that never ends, so only an abort or close can end its response */
export function endlessBlob() {
	const streams: Readable[] = []
	const blob: StoredBlob = {
		size: Number.MAX_SAFE_INTEGER,
		mimeType: 'video/mp4',
		read() {
			const stream = new Readable({
				read(cb) {
					this.push(Buffer.alloc(16 * 1024))
					cb(null)
				},
			})
			streams.push(stream)
			return stream as AsyncIterable<Uint8Array>
		},
	}
	return { blob, streams }
}

type GetIcon = (
	projectPublicId: string,
	iconDocId: string,
	query: IconVariantQuery,
) => Promise<IconVariantResult>

export function stubServer({
	getBlob = async () => {
		throw new ProjectNotFound()
	},
	getIcon = async () => {
		throw new IconNotFound()
	},
	onError,
}: {
	getBlob?: MediaServerOptions['getBlob']
	getIcon?: GetIcon
	onError?: MediaServerOptions['onError']
} = {}) {
	return createServer({
		getBlob,
		getIcon,
		...(onError ? { onError } : {}),
	})
}

export function codeError(code: string, message = code) {
	return Object.assign(new Error(message), { code })
}

export async function errorBody(res: Response) {
	return (await res.json()) as { status: number; code: string; message: string }
}
