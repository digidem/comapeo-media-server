// Runs in browsers and React Native: no Node imports.

export type BlobUrlParams = {
	serverOrigin: string
	projectId: string
	blobId: {
		driveId: string
		type: 'photo' | 'audio' | 'video'
		variant: 'original' | 'preview' | 'thumbnail'
		name: string
	}
}

export function getBlobUrl({
	serverOrigin,
	projectId,
	blobId,
}: BlobUrlParams): string {
	const { driveId, type, variant, name } = blobId
	const path = [projectId, driveId, type, variant, name]
		.map(encodeURIComponent)
		.join('/')
	return `${trimSlash(serverOrigin)}/blobs/${path}`
}

export type IconUrlParams = {
	serverOrigin: string
	projectId: string
	iconDocId: string
} & (
	| {
			/** Density-independent pixels, 8 to 128 */
			dp: number
			/** Defaults to 1 */
			density?: 1 | 1.5 | 2 | 3 | 4
			/** Defaults to `png` */
			format?: 'png' | 'svg'
	  }
	| {
			/** The options core's `IconApi.getIconUrl()` takes */
			mimeBasedOpts:
				| { mimeType: 'image/svg+xml'; size: 'small' | 'medium' | 'large' }
				| {
						mimeType: 'image/png'
						size: 'small' | 'medium' | 'large'
						pixelDensity: 1 | 2 | 3
				  }
	  }
)

export function getIconUrl(params: IconUrlParams): string {
	const { serverOrigin, projectId, iconDocId } = params
	let size: string
	let density: number | undefined
	let ext: 'png' | 'svg'
	if ('dp' in params) {
		size = String(params.dp)
		density = params.density
		ext = params.format ?? 'png'
	} else {
		const opts = params.mimeBasedOpts
		size = opts.size
		density = opts.mimeType === 'image/png' ? opts.pixelDensity : undefined
		ext = opts.mimeType === 'image/png' ? 'png' : 'svg'
	}
	// The server assumes 1x when the suffix is absent and ignores density for
	// SVGs, so leave it out to keep one URL (and client cache entry) per image.
	const suffix = ext === 'png' && density && density !== 1 ? `@${density}x` : ''
	const path = [projectId, iconDocId].map(encodeURIComponent).join('/')
	return `${trimSlash(serverOrigin)}/icons/${path}/${size}${suffix}.${ext}`
}

function trimSlash(origin: string): string {
	return origin.endsWith('/') ? origin.slice(0, -1) : origin
}
