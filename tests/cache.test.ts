import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	emptyCache,
	loadCache,
	saveCache,
	getArtifactPath,
	fileExists,
	copyPreservingTimestamps,
	pruneCache,
	removeDisabledArtifacts,
	hasCacheHit,
	removeDisabledOutputSidecars,
} from '../src/cache.js'
import type { ResolvedAlgorithmOptions } from '../src/types.js'
import { createTempDir } from './helpers/filesystem.js'

describe('cache helpers', () => {
	let cleanup: (() => Promise<void>) | undefined

	afterEach(async () => {
		await cleanup?.()
		cleanup = undefined
	})

	async function setup() {
		const temp = await createTempDir()
		cleanup = temp.cleanup
		return temp.path
	}

	it('creates the expected empty manifest', () => {
		expect(emptyCache()).toEqual({ version: 1, configHash: null, entries: {} })
	})

	it('loads valid manifests and filters invalid entry values', async () => {
		const root = await setup()
		const path = join(root, 'cache.json')
		await writeFile(
			path,
			JSON.stringify({ version: 1, configHash: 'abc', entries: { 'a.html': 'hash', bad: 3 } }),
		)
		expect(await loadCache(path)).toEqual({
			version: 1,
			configHash: 'abc',
			entries: { 'a.html': 'hash' },
		})
	})

	it.each([
		'{broken',
		JSON.stringify({ version: 99, entries: {} }),
		JSON.stringify({ version: 1, entries: [] }),
	])('falls back to an empty cache for invalid manifest %s', async contents => {
		const root = await setup()
		const path = join(root, 'cache.json')
		await writeFile(path, contents)
		expect(await loadCache(path)).toEqual(emptyCache())
	})

	it('returns an empty cache when the manifest is missing', async () => {
		const root = await setup()
		expect(await loadCache(join(root, 'missing.json'))).toEqual(emptyCache())
	})

	it('saves manifests atomically and creates parent directories', async () => {
		const root = await setup()
		const path = join(root, 'nested', 'cache.json')
		const cache = { ...emptyCache(), entries: { 'index.html': 'abc' } }
		await saveCache(path, cache)
		expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(cache)
		expect((await stat(join(root, 'nested'))).isDirectory()).toBe(true)
	})

	it('builds artifact paths and rejects traversal', async () => {
		const root = await setup()
		expect(getArtifactPath(root, 'nested/index.html', '.gz')).toBe(
			join(root, 'nested', 'index.html.gz'),
		)
		expect(() => getArtifactPath(root, '../outside', '.br')).toThrow('Invalid cache path')
	})

	it('checks file existence and copies while preserving timestamps', async () => {
		const root = await setup()
		const source = join(root, 'source.txt')
		const destination = join(root, 'nested', 'copy.txt')
		await writeFile(source, 'payload')
		const timestamp = new Date('2020-01-02T03:04:05Z')
		const { utimes } = await import('node:fs/promises')
		await utimes(source, timestamp, timestamp)
		expect(await fileExists(source)).toBe(true)
		expect(await fileExists(join(root, 'missing'))).toBe(false)
		await copyPreservingTimestamps(source, destination)
		expect(await readFile(destination, 'utf8')).toBe('payload')
		expect((await stat(destination)).mtime.getTime()).toBe((await stat(source)).mtime.getTime())
	})

	it('prunes stale entries and their compressed artifacts', async () => {
		const root = await setup()
		const artifacts = join(root, 'artifacts')
		await mkdir(artifacts, { recursive: true })
		await writeFile(join(artifacts, 'keep.html.gz'), 'keep')
		await writeFile(join(artifacts, 'old.html.gz'), 'old')
		const cache = { ...emptyCache(), entries: { 'keep.html': 'a', 'old.html': 'b' } }
		expect(await pruneCache(cache, artifacts, new Set(['keep.html']))).toBe(1)
		expect(cache.entries).toEqual({ 'keep.html': 'a' })
		expect(await fileExists(join(artifacts, 'old.html.gz'))).toBe(false)
	})

	it('removes artifacts for disabled algorithms only', async () => {
		const root = await setup()
		for (const extension of ['.gz', '.br', '.zst']) {
			await writeFile(join(root, `page.html${extension}`), extension)
		}
		const algorithms: ResolvedAlgorithmOptions = {
			gzip: false,
			brotli: {},
			zstd: false,
		}

		await removeDisabledArtifacts('page.html', root, algorithms)
		await removeDisabledArtifacts('page.html', root, {
			gzip: false,
			brotli: {},
			zstd: false,
		})
		expect(await fileExists(join(root, 'page.html.gz'))).toBe(false)
		expect(await fileExists(join(root, 'page.html.br'))).toBe(true)
		expect(await fileExists(join(root, 'page.html.zst'))).toBe(false)
	})

	describe('disabled output sidecar cleanup', () => {
		it('removes sidecars for disabled algorithms on a cache miss', async () => {
			const root = await setup()
			const output = join(root, 'dist', 'page.html')
			const cacheDirectory = join(root, 'cache')

			await mkdir(join(root, 'dist'), { recursive: true })
			await mkdir(cacheDirectory, { recursive: true })

			await writeFile(`${output}.gz`, 'gzip')
			await writeFile(`${output}.br`, 'brotli')
			await writeFile(`${output}.zst`, 'zstd')

			await removeDisabledOutputSidecars(output, ['brotli'], false)

			expect(await fileExists(`${output}.gz`)).toBe(false)
			expect(await fileExists(`${output}.br`)).toBe(true)
			expect(await fileExists(`${output}.zst`)).toBe(false)
		})

		it('preserves output sidecars on a cache hit', async () => {
			const root = await setup()
			const output = join(root, 'dist', 'page.html')

			await mkdir(join(root, 'dist'), { recursive: true })

			await writeFile(`${output}.gz`, 'gzip')
			await writeFile(`${output}.br`, 'stale-brotli')
			await writeFile(`${output}.zst`, 'stale-zstd')

			await removeDisabledOutputSidecars(output, ['gzip'], false)

			expect(await fileExists(`${output}.gz`)).toBe(true)
			expect(await readFile(`${output}.br`, 'utf8')).toBe('stale-brotli')
			expect(await readFile(`${output}.zst`, 'utf8')).toBe('stale-zstd')
		})

		it('does not remove enabled sidecars', async () => {
			const root = await setup()
			const output = join(root, 'dist', 'page.html')

			await mkdir(join(root, 'dist'), { recursive: true })

			await writeFile(`${output}.gz`, 'gzip')
			await writeFile(`${output}.br`, 'brotli')
			await writeFile(`${output}.zst`, 'zstd')

			await removeDisabledOutputSidecars(output, ['gzip', 'brotli'], false)

			expect(await readFile(`${output}.gz`, 'utf8')).toBe('gzip')
			expect(await readFile(`${output}.br`, 'utf8')).toBe('brotli')
			expect(await fileExists(`${output}.zst`)).toBe(false)
		})

		it('removes sidecars for algorithms excluded from the file on a cache miss', async () => {
			const root = await setup()
			const output = join(root, 'dist', 'page.html')

			await mkdir(join(root, 'dist'), { recursive: true })

			await writeFile(`${output}.gz`, 'gzip')
			await writeFile(`${output}.br`, 'brotli')
			await writeFile(`${output}.zst`, 'zstd')

			await removeDisabledOutputSidecars(output, ['brotli'], false)

			expect(await fileExists(`${output}.gz`)).toBe(false)
			expect(await fileExists(`${output}.br`)).toBe(true)
			expect(await fileExists(`${output}.zst`)).toBe(false)
		})
	})

	describe('hasCacheHit', () => {
		it('returns true when the source hash matches and all enabled artifacts exist', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')
			await writeFile(join(root, 'page.html.br'), 'brotli')

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', false, ['gzip', 'brotli']),
			).resolves.toBe(true)
		})

		it('returns false when a required cache artifact is missing', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', false, ['gzip', 'brotli']),
			).resolves.toBe(false)
		})

		it('returns false when the source hash differs', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')

			await expect(
				hasCacheHit(root, 'page.html', 'new-hash', 'old-hash', false, ['gzip']),
			).resolves.toBe(false)
		})

		it('returns false when recompression is forced', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', true, ['gzip']),
			).resolves.toBe(false)
		})

		it('checks only the algorithms selected for the file', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', false, ['gzip']),
			).resolves.toBe(true)
		})

		it('returns false when a selected algorithm artifact is missing', async () => {
			const root = await setup()

			await writeFile(join(root, 'page.html.gz'), 'gzip')

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', false, ['gzip', 'brotli']),
			).resolves.toBe(false)
		})

		it('returns false for an empty algorithm selection', async () => {
			const root = await setup()

			await expect(
				hasCacheHit(root, 'page.html', 'same-hash', 'same-hash', false, []),
			).resolves.toBe(false)
		})
	})
})
