# @comapeo/media-server

[![npm version](https://img.shields.io/npm/v/@comapeo/media-server.svg)](https://www.npmjs.com/package/@comapeo/media-server)
[![CI](https://github.com/digidem/comapeo-media-server/actions/workflows/test.yml/badge.svg)](https://github.com/digidem/comapeo-media-server/actions/workflows/test.yml)
[![codecov](https://codecov.io/github/digidem/comapeo-media-server/graph/badge.svg)](https://codecov.io/github/digidem/comapeo-media-server)

Serves CoMapeo project blobs (photos, audio, video) and category icons over HTTP, and renders icon SVGs to PNG at any requested size and pixel density using [resvg](https://github.com/linebender/resvg) through [`@comapeo/resvg`](https://www.npmjs.com/package/@comapeo/resvg).

> [!NOTE]
> This is an unpublished prototype. It isn't on npm yet, and its API may change before the first release. The rollout plan is in [#1](https://github.com/digidem/comapeo-media-server/issues/1).

## Installation

```sh
npm install @comapeo/media-server
```

`@comapeo/resvg` is a native addon with prebuilds for desktop and nodejs-mobile. If its binary cannot load, importing this package throws, so a packaging mistake shows up at startup rather than on the first icon request.

## Usage

```js
import { createServer } from '@comapeo/media-server'
import { BlobNotFound, ProjectNotFound } from '@comapeo/media-server/errors.js'

const mediaServer = createServer({
  async getBlob(projectPublicId, blobId) {
    // Throw ProjectNotFound or BlobNotFound, or return
    // { size, mimeType, read({ start, length }) }
  },
  async getIcon(projectPublicId, iconDocId, query) {
    // The best stored variant for `query.mimeType`:
    // { blob, blobVersionId, mimeType }
  },
})

const { port } = await mediaServer.listen({ port: 0 })
```

In the client, build URLs with the browser-safe helpers:

```js
import { getIconUrl } from '@comapeo/media-server/urls.js'

getIconUrl({ serverOrigin, projectId, iconDocId, dp: 24, density: 2 })
// => `${serverOrigin}/icons/${projectId}/${iconDocId}/24@2x.png`
```

## Routes

`GET /blobs/:projectPublicId/:driveId/:type/:variant/:name` serves a blob with `Content-Type` from its metadata (or guessed from its first bytes), and supports single `Range` requests (206 and 416) and `HEAD`.

`GET /icons/:projectPublicId/:iconDocId/:size.svg` serves the stored SVG. Icon routes also answer `HEAD`.

`GET /icons/:projectPublicId/:iconDocId/:size[@:densityx].png` renders the SVG to a PNG. `size` is an integer number of density-independent pixels from 8 to 128, or `small`, `medium` or `large` (16, 24 and 32). `density` is 1, 1.5, 2, 3 or 4 and defaults to 1. The rendered width is `round(size * density)`, unless that would make the PNG taller than 512px, in which case it is rendered 512px high. If the icon has no SVG variant, the nearest stored PNG is served unscaled.

Icon responses carry an `ETag` derived from the blob version id (and width, for rendered PNGs) and `Cache-Control: no-cache`, so clients revalidate, and a matching `If-None-Match` gets a 304 without rendering.

## API

### `createServer(options)`

- `options.getBlob(projectPublicId, blobId)`: resolves with `{ size, mimeType?, read(range?) }`, where `read` returns an async iterable of `Uint8Array` chunks for the whole blob or for `{ start, length }`. The server stops iterating early when a client disconnects, which must release the read. Throw `ProjectNotFound` or `BlobNotFound` for a missing project or blob, and throw `BlobNotFound` from `read()` if the data has not synced. If `mimeType` is missing it is guessed from the first bytes.
- `options.getIcon(projectPublicId, iconDocId, query)`: resolves with `{ blob, blobVersionId, mimeType }`. `query` is `{ mimeType: 'image/svg+xml' }` or `{ mimeType: 'image/png', size, pixelDensity }`. Throw `IconNotFound` for a missing icon, and an error with `code: 'NO_VARIANTS_FOR_MIME_TYPE_ERROR'` when the icon has no variant of that type.
- `options.onError(err, request)` (optional): called with the error behind every 500 response, since the response itself only has a generic message. For `RENDER_FAILED` the resvg error is `err.cause`.

Returns `{ fetch, listen, close }`:

- `fetch(request)`: handles a `Request` directly and resolves with a `Response`.
- `listen({ port, host } | { path })`: listens on a TCP port (default host `127.0.0.1`, default port random) or a unix socket path. Resolves with `{ port, host }` or `{ path }`.
- `close()`: stops listening and destroys open connections.

### `getBlobUrl({ serverOrigin, projectId, blobId })` and `getIconUrl(params)`

From `@comapeo/media-server/urls.js`, with no Node dependencies. `getIconUrl` takes `{ serverOrigin, projectId, iconDocId }` plus either `{ dp, density?, format? }` or the `{ mimeBasedOpts }` that core's `IconApi.getIconUrl()` takes.

## Errors

Error responses have a JSON body `{ status, code, message }`. The server's own codes are `NOT_FOUND` (unknown route), `INVALID_ICON_SIZE`, `INVALID_REQUEST` (400) and `RENDER_FAILED` (500). `PROJECT_NOT_FOUND`, `BLOB_NOT_FOUND` and `ICON_NOT_FOUND` (404) are for the host callbacks to throw.

The error classes are made with [custom-error-creator](https://github.com/digidem/custom-error-creator) and exported by name (`ProjectNotFound`, `BlobNotFound` and so on) from `@comapeo/media-server/errors.js`. Any error from a host callback with a numeric HTTP `status` and a string `code`, such as core's own errors, is passed through as it is. Anything else is a 500 `INTERNAL_SERVER_ERROR` with a generic message, so host internals don't reach the client; pass `onError` to log them.

## License

MIT

The reference renders in `test/fixtures/renders/` are of the icons in [comapeo-default-categories](https://github.com/digidem/comapeo-default-categories), licensed CC BY-NC 4.0. They are not included in the npm package.
