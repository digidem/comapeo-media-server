import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { MapeoManager } from '@comapeo/core'
import { KeyManager } from '@comapeo/crypto'
import Fastify from 'fastify'

import { BlobNotFound, IconNotFound, ProjectNotFound } from '../src/errors.ts'
import { createServer } from '../src/index.ts'
import { getErrorCode } from '../src/lib/error-response.ts'
import type { BlobId, IconVariantQuery, StoredBlob } from '../src/types.ts'
import { getBlobUrl, getIconUrl } from '../src/urls.ts'
import { DEFAULT_CONFIG_PATH } from './default-icons.ts'
import { pngWidth, errorBody } from './helpers.ts'

const require = createRequire(import.meta.url)
// Resolves to src/index.js
const coreRoot = path.join(path.dirname(require.resolve('@comapeo/core')), '..')

type Project = Awaited<ReturnType<MapeoManager['getProject']>>

// Core does not yet expose these publicly (phase 1 of the plan), so reach the
// symbol-keyed internals by description.
function getSymbol(obj: object, description: string): symbol {
	let proto = obj
	while (proto) {
		const sym = Object.getOwnPropertySymbols(proto).find(
			(s) => s.description === description,
		)
		if (sym) return sym
		proto = Object.getPrototypeOf(proto)
	}
	throw new Error(`No symbol ${description}`)
}

type CoreBlobEntry = {
	value: { blob: { byteLength: number }; metadata?: { mimeType?: string } }
}
type CoreBlobStore = {
	entry(blobId: BlobId, opts: { wait: false }): Promise<CoreBlobEntry | null>
	createReadStreamFromEntry(
		driveId: string,
		entry: CoreBlobEntry,
		opts: { wait: false; start?: number; length?: number },
	): Promise<AsyncIterable<Uint8Array> & { destroyed: boolean }>
}

/** What core would expose publicly in phase 1 */
async function getBlob(
	project: Project,
	blobId: BlobId,
	onStream: (stream: { destroyed: boolean }) => void,
): Promise<StoredBlob> {
	const internals = project as unknown as Record<symbol, CoreBlobStore>
	const store = internals[getSymbol(project, 'blobStore')]!
	let entry
	try {
		entry = await store.entry(blobId, { wait: false })
	} catch (err) {
		throw new BlobNotFound('Blob not found', { cause: err })
	}
	if (!entry) throw new BlobNotFound()
	const found = entry
	return {
		size: found.value.blob.byteLength,
		mimeType: found.value.metadata?.mimeType,
		async *read(range) {
			const stream = await store.createReadStreamFromEntry(
				blobId.driveId,
				found,
				{ wait: false, ...range },
			)
			onStream(stream)
			try {
				yield* stream
			} catch (err) {
				// How Hyperblobs reports data that has not synced yet
				if (err instanceof Error && err.message === 'Block not available') {
					throw new BlobNotFound('Blob not available', { cause: err })
				}
				throw err
			}
		},
	}
}

async function getIcon(
	project: Project,
	iconDocId: string,
	query: IconVariantQuery,
) {
	type GetIconBlob = (id: string, opts: object) => Promise<Buffer>
	const internals = project.$icons as unknown as Record<symbol, GetIconBlob>
	const getIconBlob = internals[getSymbol(project.$icons, 'getIcon')]!
	const blob = await getIconBlob
		.call(project.$icons, iconDocId, { size: 'medium', ...query })
		.catch((err) => {
			if (getErrorCode(err) === 'NOT_FOUND_ERROR') {
				throw new IconNotFound('Icon not found', { cause: err })
			}
			throw err
		})
	// Stands in for the blob version id until core returns it
	const blobVersionId = createHash('sha256').update(blob).digest('hex')
	return { blob, blobVersionId, mimeType: query.mimeType }
}

async function setup(t: TestContext) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-server-e2e-'))
	await fs.mkdir(path.join(dir, 'db'))
	const manager = new MapeoManager({
		rootKey: KeyManager.generateRootKey(),
		projectMigrationsFolder: path.join(coreRoot, 'drizzle/project'),
		clientMigrationsFolder: path.join(coreRoot, 'drizzle/client'),
		dbFolder: path.join(dir, 'db'),
		coreStorage: path.join(dir, 'core'),
		fastify: Fastify(),
		defaultConfigPath: DEFAULT_CONFIG_PATH,
	})
	const projectId = await manager.createProject()
	const project = await manager.getProject(projectId)

	const blobStreams: Array<{ destroyed: boolean }> = []
	const getProject = async (projectPublicId: string) => {
		try {
			return await manager.getProject(projectPublicId)
		} catch (err) {
			throw new ProjectNotFound('Project not found', { cause: err })
		}
	}
	const server = createServer({
		getBlob: async (projectPublicId, blobId) =>
			getBlob(await getProject(projectPublicId), blobId, (stream) =>
				blobStreams.push(stream),
			),
		getIcon: async (projectPublicId, iconDocId, query) =>
			getIcon(await getProject(projectPublicId), iconDocId, query),
	})
	const address = await server.listen()
	assert('port' in address)
	const serverOrigin = `http://${address.host}:${address.port}`

	t.after(async () => {
		await server.close()
		await project.close()
		await fs.rm(dir, { recursive: true, force: true })
	})
	return { project, projectId, serverOrigin, dir, blobStreams }
}

test('blobs and icons from a real project', async (t) => {
	const { project, projectId, serverOrigin, dir, blobStreams } = await setup(t)

	// Large enough that the response is still streaming when aborted
	const photo = randomBytes(4 * 1024 * 1024)
	const photoPath = path.join(dir, 'photo.jpg')
	await fs.writeFile(photoPath, photo)
	const { driveId, name } = await project.$blobs.create(
		{ original: photoPath },
		{ mimeType: 'image/jpeg' },
	)

	await t.test('photo', async () => {
		const url = getBlobUrl({
			serverOrigin,
			projectId,
			blobId: { driveId, type: 'photo', variant: 'original', name },
		})
		const res = await fetch(url)
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'image/jpeg')
		assert.deepEqual(Buffer.from(await res.arrayBuffer()), photo)

		const ranged = await fetch(url, { headers: { range: 'bytes=0-1' } })
		assert.equal(ranged.status, 206)
		assert.deepEqual(
			Buffer.from(await ranged.arrayBuffer()),
			photo.subarray(0, 2),
		)
	})

	await t.test(
		'aborting a download destroys the hyperblobs stream',
		async () => {
			const url = getBlobUrl({
				serverOrigin,
				projectId,
				blobId: { driveId, type: 'photo', variant: 'original', name },
			})
			const controller = new AbortController()
			const res = await fetch(url, { signal: controller.signal })
			const reader = res.body!.getReader()
			await reader.read()
			const stream = blobStreams.at(-1)!
			assert(!stream.destroyed)
			controller.abort()
			const deadline = Date.now() + 2000
			while (!stream.destroyed && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
			assert(stream.destroyed)
		},
	)

	await t.test('empty blob', async () => {
		const emptyPath = path.join(dir, 'empty.jpg')
		await fs.writeFile(emptyPath, '')
		const empty = await project.$blobs.create(
			{ original: emptyPath },
			{ mimeType: 'image/jpeg' },
		)
		const res = await fetch(
			getBlobUrl({
				serverOrigin,
				projectId,
				blobId: { ...empty, type: 'photo', variant: 'original' },
			}),
			{ signal: AbortSignal.timeout(2000) },
		)
		assert.equal(res.status, 200)
		assert.equal((await res.arrayBuffer()).byteLength, 0)
	})

	await t.test('missing blob is a 404', async () => {
		const res = await fetch(
			getBlobUrl({
				serverOrigin,
				projectId,
				blobId: { driveId, type: 'photo', variant: 'preview', name },
			}),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'BLOB_NOT_FOUND')
	})

	await t.test('unknown project is a 404', async () => {
		const res = await fetch(
			getBlobUrl({
				serverOrigin,
				projectId: 'y'.repeat(52),
				blobId: { driveId, type: 'photo', variant: 'original', name },
			}),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'PROJECT_NOT_FOUND')
	})

	const presets = await project.preset.getMany()
	const iconDocId = presets.find((p) => p.iconRef)?.iconRef?.docId
	assert(iconDocId, 'default config has icons')

	await t.test('svg', async () => {
		const res = await fetch(
			getIconUrl({ serverOrigin, projectId, iconDocId, dp: 24, format: 'svg' }),
		)
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'image/svg+xml')
		assert.match(await res.text(), /<svg/)
	})

	await t.test('png at each alias', async () => {
		for (const [size, width] of [
			['small', 32],
			['medium', 48],
			['large', 64],
		] as const) {
			const res: Response = await fetch(
				getIconUrl({
					serverOrigin,
					projectId,
					iconDocId,
					mimeBasedOpts: { mimeType: 'image/png', size, pixelDensity: 2 },
				}),
			)
			assert.equal(res.status, 200, size)
			assert.equal(pngWidth(new Uint8Array(await res.arrayBuffer())), width)
		}
	})

	await t.test('304 on revalidation', async () => {
		const url = getIconUrl({ serverOrigin, projectId, iconDocId, dp: 24 })
		const first = await fetch(url)
		await first.arrayBuffer()
		const etag = first.headers.get('etag')
		assert(etag)
		const second = await fetch(url, { headers: { 'if-none-match': etag } })
		assert.equal(second.status, 304)
	})

	await t.test('invalid size is a 400', async () => {
		const res = await fetch(
			getIconUrl({ serverOrigin, projectId, iconDocId, dp: 1000 }),
		)
		assert.equal(res.status, 400)
		assert.equal((await errorBody(res)).code, 'INVALID_ICON_SIZE')
	})

	await t.test('unknown icon is a 404', async () => {
		const res = await fetch(
			getIconUrl({
				serverOrigin,
				projectId,
				iconDocId: 'a'.repeat(64),
				dp: 24,
			}),
		)
		assert.equal(res.status, 404)
		assert.equal((await errorBody(res)).code, 'ICON_NOT_FOUND')
	})
})
