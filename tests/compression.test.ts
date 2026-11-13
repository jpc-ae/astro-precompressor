import { readFile, readdir, stat, utimes } from 'node:fs/promises'
import { gunzipSync, brotliDecompressSync } from 'node:zlib'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compressFile } from '../src/compression.js'
import { getArtifactPath } from '../src/cache.js'

import {
	createFile,
	createLogger,
	createOptions,
	createTempDirectory,
	removeTempDirectory,
} from './helpers.js'

import { DEFAULT_ZLIB_OPTIONS } from '../src/constants.js'

function createCompressibleContent(label: string): string {
	return `<html><body>${label}</body></html>\n`.repeat(100)
}

describe('compressFile', () => {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	it('generates a gzip artifact and output sidecar', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, World!')
		const source = await createFile(directory, 'output/index.html', content)

		const artifactDirectory = join(directory, 'cache')
		const options = createOptions()
		const logger = createLogger()

		const result = await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'source-hash',
			undefined,
			false,
			options,
			logger,
			undefined,
		)

		const artifact = getArtifactPath(artifactDirectory, 'index.html', '.gz')
		const output = `${source}.gz`

		expect(result.compressions).toHaveLength(1)
		expect(result.compressions[0]).toMatchObject({
			algorithm: 'gzip',
			generated: true,
		})

		expect(gunzipSync(await readFile(output, null)).toString()).toBe(content)

		expect(await readFile(artifact)).toEqual(await readFile(output))
	})

	it('generates gzip and Brotli artifacts independently', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, World!')
		const source = await createFile(directory, 'output/index.html', content)

		const options = createOptions({
			algorithms: {
				gzip: {},
				brotli: {},
				zstd: false,
			},
		})

		const result = await compressFile(
			source,
			join(directory, 'cache'),
			'index.html',
			'source-hash',
			undefined,
			false,
			options,
			createLogger(),
			undefined,
		)

		expect(result.compressions.map(item => item.algorithm).sort()).toEqual(['brotli', 'gzip'])

		expect(gunzipSync(await readFile(`${source}.gz`)).toString()).toBe(content)

		expect(brotliDecompressSync(await readFile(`${source}.br`)).toString()).toBe(content)
	})

	it('reuses cached artifacts when the source hash matches', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, Cache!')
		const source = await createFile(directory, 'output/index.html', content)

		const artifactDirectory = join(directory, 'cache')
		const artifact = getArtifactPath(artifactDirectory, 'index.html', '.gz')

		const first = await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'source-hash',
			undefined,
			false,
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(first.compressions[0].generated).toBe(true)

		const timestamp = new Date('2020-01-01T12:00:00.000Z')
		await utimes(artifact, timestamp, timestamp)

		const second = await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'source-hash',
			'source-hash',
			false,
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(second.compressions[0]).toMatchObject({
			generated: false,
			discarded: false,
		})

		const artifactStats = await stat(artifact)
		const outputStats = await stat(`${source}.gz`)

		expect(outputStats.mtimeMs).toBe(artifactStats.mtimeMs)
		expect(outputStats.mtimeMs).toBe(timestamp.getTime())
	})

	it('regenerates when the source hash changes', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, Cache!')
		const source = await createFile(directory, 'output/index.html', content)

		const artifactDirectory = join(directory, 'cache')

		const result = await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'new-hash',
			'old-hash',
			false,
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(result.compressions[0].generated).toBe(true)
		expect(gunzipSync(await readFile(`${source}.gz`)).toString()).toBe(content)
	})

	it('regenerates when forceRecompress is true', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, Darkness!')
		const source = await createFile(directory, 'output/index.html', content)

		const artifactDirectory = join(directory, 'cache')

		await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'source-hash',
			'source-hash',
			false,
			createOptions(),
			createLogger(),
			undefined,
		)

		const result = await compressFile(
			source,
			artifactDirectory,
			'index.html',
			'source-hash',
			'source-hash',
			true,
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(result.compressions[0].generated).toBe(true)
	})

	it('rejects when Zopfli is enabled but not initialized', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, Darkness!')
		const source = await createFile(directory, 'output/index.html', content)

		const options = createOptions({
			algorithms: {
				gzip: {
					zopfli: {},
				},
				brotli: false,
				zstd: false,
			},
		})

		await expect(
			compressFile(
				source,
				join(directory, 'cache'),
				'index.html',
				'source-hash',
				undefined,
				false,
				options,
				createLogger(),
				undefined,
			),
		).rejects.toThrow('Zopfli module has not been initialized.')
	})

	it('does not leave temporary files after a compression failure', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, Failure!')
		const source = await createFile(directory, 'output/index.html', content)

		const artifactDirectory = join(directory, 'cache')

		const options = createOptions({
			algorithms: {
				gzip: {
					zopfli: {},
				},
				brotli: false,
				zstd: false,
			},
		})

		await expect(
			compressFile(
				source,
				artifactDirectory,
				'index.html',
				'source-hash',
				undefined,
				false,
				options,
				createLogger(),
				undefined,
			),
		).rejects.toThrow()

		const files = await readdir(artifactDirectory).catch(() => [])

		expect(files.some(file => file.endsWith('.tmp'))).toBe(false)
		expect(await readFile(source, 'utf8')).toBe(content)
	})

	it('does not overwrite the source file', async () => {
		directory = await createTempDirectory()

		const content = createCompressibleContent('Hello, World!')
		const source = await createFile(directory, 'output/index.html', content)

		await compressFile(
			source,
			join(directory, 'cache'),
			'index.html',
			'source-hash',
			undefined,
			false,
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(await readFile(source, 'utf8')).toBe(content)
	})

	it('discards compressed output when it is larger than the source', async () => {
		directory = await createTempDirectory()

		const source = await createFile(directory, 'output/tiny.txt', 'x')
		const artifactDirectory = join(directory, 'cache')

		const result = await compressFile(
			source,
			artifactDirectory,
			'tiny.txt',
			'source-hash',
			undefined,
			false,
			createOptions({
				algorithms: {
					gzip: DEFAULT_ZLIB_OPTIONS,
					brotli: false,
					zstd: false,
				},
				performance: {
					concurrency: 2,
					incremental: true,
					discardCompressionIfLarger: true,
				},
			}),
			createLogger(),
			undefined,
		)

		const artifact = getArtifactPath(artifactDirectory, 'tiny.txt', '.gz')

		expect(result.compressions[0]).toMatchObject({
			algorithm: 'gzip',
			generated: true,
			discarded: true,
		})

		expect(await stat(artifact)).toBeDefined()
		expect(await stat(artifact).then(stats => stats.size)).toBeGreaterThan(
			(await stat(source)).size,
		)

		await expect(stat(`${source}.gz`)).rejects.toThrow()
	})

	it('discards oversized cached artifacts without recompressing', async () => {
		directory = await createTempDirectory()

		const source = await createFile(directory, 'output/tiny.txt', 'x')
		const artifactDirectory = join(directory, 'cache')
		const options = createOptions({
			algorithms: {
				gzip: DEFAULT_ZLIB_OPTIONS,
				brotli: false,
				zstd: false,
			},
		})

		const first = await compressFile(
			source,
			artifactDirectory,
			'tiny.txt',
			'source-hash',
			undefined,
			false,
			options,
			createLogger(),
			undefined,
		)

		const artifact = getArtifactPath(artifactDirectory, 'tiny.txt', '.gz')

		expect(first.compressions[0].generated).toBe(true)

		const second = await compressFile(
			source,
			artifactDirectory,
			'tiny.txt',
			'source-hash',
			'source-hash',
			false,
			createOptions({
				...options,
				performance: {
					...options.performance,
					discardCompressionIfLarger: true,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(second.compressions[0]).toMatchObject({
			generated: false,
			discarded: true,
		})

		expect(await stat(artifact)).toBeDefined()
		await expect(stat(`${source}.gz`)).rejects.toThrow()
	})

	it('copies larger compressed output when discardCompressionIfLarger is disabled', async () => {
		directory = await createTempDirectory()

		const source = await createFile(directory, 'output/tiny.txt', 'x')

		const result = await compressFile(
			source,
			join(directory, 'cache'),
			'tiny.txt',
			'source-hash',
			undefined,
			false,
			createOptions({
				algorithms: {
					gzip: DEFAULT_ZLIB_OPTIONS,
					brotli: false,
					zstd: false,
				},
				performance: {
					concurrency: 2,
					incremental: true,
					discardCompressionIfLarger: false,
				},
			}),
			createLogger(),
			undefined,
		)

		const output = `${source}.gz`

		expect(result.compressions[0]).toMatchObject({
			generated: true,
			discarded: false,
		})

		expect(await stat(output)).toBeDefined()
		expect((await stat(output)).size).toBeGreaterThan((await stat(source)).size)
	})
})
