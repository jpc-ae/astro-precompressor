import { readFile, rm, writeFile, stat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { compressFile } from '../src/compression.js'
import { Semaphore } from '../src/semaphore.js'
import { createGzipCompressorFactory, resolveGzipOptions } from '../src/gzip.js'
import { createResolvedOptions } from './helpers/options.js'
import { createMockLogger } from './helpers/logger.js'
import {
	createTrackingCompressorFactory,
	createFailingCompressorFactory,
	createFailingStreamCompressorFactory,
} from './helpers/compressors.js'
import { createTempDir } from './helpers/filesystem.js'

describe('compressFile', () => {
	let root = ''

	afterEach(async () => {
		if (root) {
			await rm(root, { recursive: true, force: true })
		}
		root = ''
	})

	async function setup() {
		const temp = await createTempDir('precompressor-')
		root = temp.path

		const output = join(temp.path, 'dist')
		const artifacts = join(temp.path, 'cache')
		const source = join(output, 'nested', 'index.html')

		await mkdir(join(output, 'nested'), { recursive: true })
		await writeFile(source, `<html>${'hello '.repeat(200)}</html>`)

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: false,
				zstd: false,
			},
			performance: {
				discardCompressionIfLarger: true,
			},
		})

		const logger = createMockLogger()
		const gzipOptions = resolveGzipOptions(true)
		if (!gzipOptions) {
			throw new Error('Expected gzip options to be enabled')
		}
		const factory = await createGzipCompressorFactory(gzipOptions, false, false)

		return {
			source,
			artifacts,
			options,
			logger,
			compressors: { gzip: factory },
		}
	}

	it('generates a valid sidecar and reports generation metadata', async () => {
		const context = await setup()
		const result = await compressFile(
			context.source,
			context.artifacts,
			'nested/index.html',
			'hash-a',
			undefined,
			false,
			context.options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)
		expect(result.compressions).toHaveLength(1)
		expect(result.compressions[0]).toMatchObject({
			algorithm: 'gzip',
			generated: true,
			discarded: false,
		})
		expect(gunzipSync(await readFile(`${context.source}.gz`)).toString()).toContain('hello')
		expect((await stat(`${context.source}.gz`)).mtime.getTime()).toBe(
			(await stat(join(context.artifacts, 'nested/index.html.gz'))).mtime.getTime(),
		)
	})

	it('reuses cached artifacts when hashes match', async () => {
		const context = await setup()
		const first = await compressFile(
			context.source,
			context.artifacts,
			'nested/index.html',
			'same-hash',
			undefined,
			false,
			context.options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)
		const second = await compressFile(
			context.source,
			context.artifacts,
			'nested/index.html',
			'same-hash',
			'same-hash',
			false,
			context.options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)
		expect(first.compressions[0].generated).toBe(true)
		expect(second.compressions[0]).toMatchObject({ generated: false, elapsed: 0 })
	})

	it('forces recompression when requested', async () => {
		const context = await setup()
		await compressFile(
			context.source,
			context.artifacts,
			'nested/index.html',
			'same',
			undefined,
			false,
			context.options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)
		const result = await compressFile(
			context.source,
			context.artifacts,
			'nested/index.html',
			'same',
			'same',
			true,
			context.options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)
		expect(result.compressions[0].generated).toBe(true)
	})

	it('rejects when a configured compressor is missing', async () => {
		const context = await setup()
		await expect(
			compressFile(
				context.source,
				context.artifacts,
				'nested/index.html',
				'hash',
				undefined,
				false,
				context.options,
				context.logger,
				{},
				new Semaphore(1),
			),
		).rejects.toThrow('compressor could not be found')
	})

	it('rejects failed compressors without leaving temporary files', async () => {
		const context = await setup()
		const broken = {
			gzip: createFailingCompressorFactory('compressor broke'),
		}
		await expect(
			compressFile(
				context.source,
				context.artifacts,
				'nested/index.html',
				'hash',
				undefined,
				false,
				context.options,
				context.logger,
				broken,
				new Semaphore(1),
			),
		).rejects.toThrow('compressor broke')
	})

	it('removes temporary and partial cache files when a compression stream fails', async () => {
		const context = await setup()

		await writeFile(context.source, 'FAIL_STREAM')

		const compressors = {
			gzip: createFailingStreamCompressorFactory(),
		}

		await expect(
			compressFile(
				context.source,
				context.artifacts,
				'nested/index.html',
				'hash-failure',
				undefined,
				false,
				context.options,
				context.logger,
				compressors,
				new Semaphore(1),
			),
		).rejects.toThrow('stream compression failed')

		const cacheDirectory = join(context.artifacts, 'nested')

		// The failed temporary artifact should have been removed.
		expect(await readdir(cacheDirectory)).toEqual([])

		// Neither the cache artifact nor the emitted output should exist.
		await expect(stat(join(cacheDirectory, 'index.html.gz'))).rejects.toMatchObject({
			code: 'ENOENT',
		})

		await expect(stat(`${context.source}.gz`)).rejects.toMatchObject({
			code: 'ENOENT',
		})
	})

	it('throws AggregateError when multiple algorithms fail', async () => {
		const context = await setup()

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: {},
				zstd: false,
			},
		})

		const compressors = {
			gzip: createFailingCompressorFactory('gzip failed'),
			brotli: createFailingCompressorFactory('brotli failed'),
		}

		await expect(
			compressFile(
				context.source,
				context.artifacts,
				'nested/index.html',
				'hash-multiple-failures',
				undefined,
				false,
				options,
				context.logger,
				compressors,
				new Semaphore(2),
			),
		).rejects.toMatchObject({
			name: 'AggregateError',
			message: expect.stringContaining('One or more compression algorithms failed'),
			errors: expect.arrayContaining([
				expect.objectContaining({ message: 'gzip failed' }),
				expect.objectContaining({ message: 'brotli failed' }),
			]),
		})
	})

	it('discards compressed output when it is larger than the source', async () => {
		const context = await setup()

		const source = join(root, 'dist', 'tiny.txt')
		await writeFile(source, 'x')

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: false,
				zstd: false,
			},
			performance: {
				discardCompressionIfLarger: true,
			},
		})

		const result = await compressFile(
			source,
			context.artifacts,
			'tiny.txt',
			'hash-tiny',
			undefined,
			false,
			options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)

		const artifact = join(context.artifacts, 'tiny.txt.gz')
		const output = `${source}.gz`

		expect(result.compressions[0]).toMatchObject({
			algorithm: 'gzip',
			generated: true,
			discarded: true,
		})

		// The cached compressed artifact is retained even though it is not emitted.
		expect(await stat(artifact)).toBeDefined()
		expect((await stat(artifact)).size).toBeGreaterThan((await stat(source)).size)

		// Larger-than-source compression must not be emitted beside the source.
		await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('discards oversized cached artifacts without recompressing', async () => {
		const context = await setup()

		const source = join(root, 'dist', 'tiny.txt')
		await writeFile(source, 'x')

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: false,
				zstd: false,
			},
			performance: {
				discardCompressionIfLarger: true,
			},
		})

		const first = await compressFile(
			source,
			context.artifacts,
			'tiny.txt',
			'same-hash',
			undefined,
			false,
			options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)

		expect(first.compressions[0].generated).toBe(true)

		const artifact = join(context.artifacts, 'tiny.txt.gz')
		const artifactStatsBefore = await stat(artifact)

		const second = await compressFile(
			source,
			context.artifacts,
			'tiny.txt',
			'same-hash',
			'same-hash',
			false,
			options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)

		const artifactStatsAfter = await stat(artifact)

		expect(second.compressions[0]).toMatchObject({
			generated: false,
			discarded: true,
			elapsed: 0,
		})

		// Cache is reused; it is not regenerated.
		expect(artifactStatsAfter.mtimeMs).toBe(artifactStatsBefore.mtimeMs)

		await expect(stat(`${source}.gz`)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('copies larger compressed output when discardCompressionIfLarger is disabled', async () => {
		const context = await setup()

		const source = join(root, 'dist', 'tiny.txt')
		await writeFile(source, 'x')

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: false,
				zstd: false,
			},
			performance: {
				discardCompressionIfLarger: false,
			},
		})

		const result = await compressFile(
			source,
			context.artifacts,
			'tiny.txt',
			'hash-tiny',
			undefined,
			false,
			options,
			context.logger,
			context.compressors,
			new Semaphore(1),
		)

		const output = `${source}.gz`

		expect(result.compressions[0]).toMatchObject({
			generated: true,
			discarded: false,
		})

		expect(await stat(output)).toBeDefined()
		expect((await stat(output)).size).toBeGreaterThan((await stat(source)).size)
	})

	it('shares one concurrency limit across files and enabled algorithms', async () => {
		const context = await setup()

		const sourceA = join(root, 'dist', 'a.html')
		const sourceB = join(root, 'dist', 'b.html')

		await writeFile(sourceA, '<html>' + 'shared semaphore '.repeat(100) + '</html>')
		await writeFile(sourceB, '<html>' + 'shared semaphore '.repeat(100) + '</html>')

		const options = createResolvedOptions({
			algorithms: {
				gzip: resolveGzipOptions(true),
				brotli: {},
				zstd: false,
			},
			performance: {
				discardCompressionIfLarger: false,
				concurrency: 1,
			},
		})

		const tracker = {
			active: 0,
			maximumActive: 0,
			total: 0,
		}

		const compressors = {
			gzip: createTrackingCompressorFactory(tracker),
			brotli: createTrackingCompressorFactory(tracker),
		}

		const semaphore = new Semaphore(1)

		const results = await Promise.all([
			compressFile(
				sourceA,
				context.artifacts,
				'a.html',
				'hash-a',
				undefined,
				false,
				options,
				context.logger,
				compressors,
				semaphore,
			),
			compressFile(
				sourceB,
				context.artifacts,
				'b.html',
				'hash-b',
				undefined,
				false,
				options,
				context.logger,
				compressors,
				semaphore,
			),
		])

		expect(results).toHaveLength(2)
		expect(results.every(result => result.compressions.length === 2)).toBe(true)

		// Both files and both algorithms share the same semaphore.
		expect(tracker.maximumActive).toBe(1)
		expect(tracker.active).toBe(0)
		expect(tracker.total).toBe(4)

		// All four cache artifacts were generated.
		for (const artifact of [
			join(context.artifacts, 'a.html.gz'),
			join(context.artifacts, 'a.html.br'),
			join(context.artifacts, 'b.html.gz'),
			join(context.artifacts, 'b.html.br'),
		]) {
			expect(await stat(artifact)).toBeDefined()
		}
	})
})
