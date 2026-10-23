# @comapeo/media-server

Serves CoMapeo project blobs and category icons over HTTP, rendering icon SVGs to PNG

## Commands

```sh
npm test            # types, lint, unused (knip), unit tests
npm run coverage    # unit tests with lcov + text coverage
npm run check:pkg   # publint + attw on the packed tarball
npm run format      # prettier
```

## Conventions

TypeScript with erasable syntax only (no enums, namespaces or parameter properties): Node runs `src/` and `test/` directly by stripping types. Relative imports use `.ts` extensions; `tsc -p tsconfig.build.json` rewrites them to `.js` in `dist/`.
ESM only. No default exports (enforced by ESLint). `#private` class fields.
Errors are custom-error-creator classes in `src/errors.ts`, exported as `./errors.js`; response bodies are `{ status, code, message }`, and any thrown error with an HTTP `status` and `code` is passed through to the response. `src/urls.ts` is imported by browser and React Native code and must not import anything from Node. Only `src/core.ts` (the `./core.js` export) imports `@comapeo/core`, an optional peer dependency; the server and its public types never do, so hosts without core can use it. Prettier with
tabs, no semicolons, single quotes. Conventional Commits, `!` for breaking changes.
Every user-facing change gets a changeset (`npx changeset`); never run
`changeset version` on a branch.

## Settled decisions

These were weighed during the initial design; reopen them deliberately rather than as a side effect of another change.

- `@comapeo/resvg` is imported statically with no wasm fallback, so a missing binding fails at startup. A fallback around 200 times slower would hide packaging mistakes.
- No render cache. A render costs about 0.3ms and clients cache by URL. PNG responses carry `ETag: "<blobVersionId>-<width>"` and `Cache-Control: no-cache`, and a matching `If-None-Match` gets a 304 before any render. If a low-end phone ever shows renders matter, a cache keyed on blob version id and width wraps `renderPng` and nothing else.
- Icon sizes are density-independent pixels (8 to 128) with an optional `@1x`, `@1.5x`, `@2x`, `@3x` or `@4x`, matching MapLibre and React Native. `small`, `medium` and `large` are aliases for 16, 24 and 32. Rendered width is at most 512. The grammar rejects leading zeros and signs, which would only add URLs for the same image.
- The PNG route asks the host for the SVG first. On `NO_VARIANTS_FOR_MIME_TYPE_ERROR` it serves the nearest stored PNG unscaled, for projects imported before core stored SVGs. `<text>` renders nothing because `@comapeo/resvg` has no text support; rejecting text belongs in comapeocat's writer and core's import.
