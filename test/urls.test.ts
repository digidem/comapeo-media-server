import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getBlobUrl, getIconUrl } from '../src/urls.ts'
import { DRIVE_ID, ICON_DOC_ID, PROJECT_ID, stubServer } from './helpers.ts'

const serverOrigin = 'http://127.0.0.1:1234'
const icons = `${serverOrigin}/icons/${PROJECT_ID}/${ICON_DOC_ID}`

test('getBlobUrl', () => {
	const blobId = {
		driveId: DRIVE_ID,
		type: 'photo',
		variant: 'thumbnail',
		name: 'a b',
	} as const
	const expected = `${serverOrigin}/blobs/${PROJECT_ID}/${DRIVE_ID}/photo/thumbnail/a%20b`
	assert.equal(
		getBlobUrl({ serverOrigin, projectId: PROJECT_ID, blobId }),
		expected,
	)
	assert.equal(
		getBlobUrl({
			serverOrigin: serverOrigin + '/',
			projectId: PROJECT_ID,
			blobId,
		}),
		expected,
	)
})

test('getIconUrl with dp', () => {
	const base = { serverOrigin, projectId: PROJECT_ID, iconDocId: ICON_DOC_ID }
	assert.equal(getIconUrl({ ...base, dp: 24 }), `${icons}/24.png`)
	assert.equal(getIconUrl({ ...base, dp: 24, density: 1 }), `${icons}/24.png`)
	assert.equal(
		getIconUrl({ ...base, dp: 24, density: 1.5 }),
		`${icons}/24@1.5x.png`,
	)
	assert.equal(
		getIconUrl({ ...base, dp: 24, density: 3 }),
		`${icons}/24@3x.png`,
	)
	assert.equal(
		getIconUrl({ ...base, dp: 24, density: 3, format: 'svg' }),
		`${icons}/24.svg`,
	)
})

test('getIconUrl with core icon options', () => {
	const base = { serverOrigin, projectId: PROJECT_ID, iconDocId: ICON_DOC_ID }
	assert.equal(
		getIconUrl({
			...base,
			mimeBasedOpts: { mimeType: 'image/png', size: 'small', pixelDensity: 1 },
		}),
		`${icons}/small.png`,
	)
	assert.equal(
		getIconUrl({
			...base,
			mimeBasedOpts: { mimeType: 'image/png', size: 'large', pixelDensity: 2 },
		}),
		`${icons}/large@2x.png`,
	)
	assert.equal(
		getIconUrl({
			...base,
			mimeBasedOpts: { mimeType: 'image/svg+xml', size: 'medium' },
		}),
		`${icons}/medium.svg`,
	)
})

test('the server routes every URL getIconUrl builds', async () => {
	const server = stubServer({
		getIcon: async () => ({
			blob: Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
			),
			blobVersionId: 'v/0',
			mimeType: 'image/svg+xml',
		}),
	})
	const base = { serverOrigin, projectId: PROJECT_ID, iconDocId: ICON_DOC_ID }
	for (const density of [1, 1.5, 2, 3, 4] as const) {
		for (const dp of [8, 24, 128]) {
			for (const format of ['png', 'svg'] as const) {
				const url = getIconUrl({ ...base, dp, density, format })
				const res = await server.fetch(new Request(url))
				assert.equal(res.status, 200, url)
				await res.arrayBuffer()
			}
		}
	}
})
