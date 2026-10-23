// Declared structurally rather than imported from @comapeo/core, so consumers
// don't need core installed to type-check against this package.

export type BlobId =
	| {
			driveId: string
			type: 'photo'
			variant: 'original' | 'preview' | 'thumbnail'
			name: string
	  }
	| { driveId: string; type: 'audio'; variant: 'original'; name: string }
	| { driveId: string; type: 'video'; variant: 'original'; name: string }

export type StoredBlob = {
	/** Length in bytes */
	size: number
	/** Guessed from the first bytes if missing */
	mimeType?: string | undefined
	/**
	 * Read the whole blob, or `length` bytes from `start`. The server stops
	 * iterating early when a client disconnects, which must release the read.
	 */
	read(range?: { start: number; length: number }): AsyncIterable<Uint8Array>
}

export type IconVariantQuery =
	| { mimeType: 'image/svg+xml' }
	| {
			mimeType: 'image/png'
			size: 'small' | 'medium' | 'large'
			pixelDensity: 1 | 2 | 3
	  }

export type IconVariantResult = {
	blob: Uint8Array
	blobVersionId: string
	mimeType: string
}

export type MediaServerOptions = {
	/**
	 * Throw `ProjectNotFound` or `BlobNotFound` (or any error with an HTTP
	 * `status` and a `code`) for a missing project or blob. `read()` should
	 * throw `BlobNotFound` if the blob's data is not available locally.
	 */
	getBlob(projectPublicId: string, blobId: BlobId): Promise<StoredBlob>
	/**
	 * Return the best stored variant for the mime type. Throw `IconNotFound`
	 * (or any error with an HTTP `status` and a `code`) for a missing icon, and
	 * an error with `code: 'NO_VARIANTS_FOR_MIME_TYPE_ERROR'` if the icon has
	 * no variant of that type, as core's `IconApi` does.
	 */
	getIcon(
		projectPublicId: string,
		iconDocId: string,
		query: IconVariantQuery,
	): Promise<IconVariantResult>
	/**
	 * Called with the error behind every 500 response, whose body only has a
	 * generic message. Rendering failures carry the resvg error as `cause`.
	 */
	onError?(err: unknown, request: Request): void
}
