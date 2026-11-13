import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompressionAlgorithm, CompressionResult } from '../src/types.js'

import { compressFile } from '../src/compression.js'
import { runBuild } from '../src/build.js'

import {
	createFile,
	createLogger,
	createOptions,
	createTempDirectory,
	removeTempDirectory,
} from './helpers.js'

vi.mock('../src/compression.js', () => ({
	compressFile: vi.fn(),
}))

const mockedCompressFile = vi.mocked(compressFile)

describe('runBuild', () => {
	let directory = ''
	let outputDirectory = ''
	let cacheDirectory = ''

	beforeEach(() => {
		mockedCompressFile.mockReset()

		mockedCompressFile.mockImplementation(async (...args) => {
			const options = args[6]

			const compressions: CompressionResult[] = []

			for (const [algorithm, enabled] of Object.entries(options.algorithms)) {
				if (!enabled) {
					continue
				}

				compressions.push({
					algorithm: algorithm as CompressionAlgorithm,
					elapsed: 1,
					generated: true,
					size: 10,
					discarded: false,
				})
			}

			return {
				elapsed: 1,
				compressions,
			}
		})
	})

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	async function setup(): Promise<void> {
		directory = await createTempDirectory()

		outputDirectory = join(directory, 'dist')
		cacheDirectory = join(directory, 'cache')

		await mkdir(outputDirectory, { recursive: true })
	}

	it('processes eligible files', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html', 'index content')
		await createFile(outputDirectory, 'about.html', 'about content')

		const logger = createLogger()

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions(),
			logger,
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(2)
		expect(logger.info).toHaveBeenCalled()
	})

	it('ignores unsupported file extensions', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')
		await createFile(outputDirectory, 'image.png')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(1)
		expect(mockedCompressFile.mock.calls[0][0]).toContain('index.html')
	})

	it('respects the minimum file size', async () => {
		await setup()

		await createFile(outputDirectory, 'small.html', 'x')
		await createFile(outputDirectory, 'large.html', 'this is large enough')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				filters: {
					minSize: 5,
					fileTypes: ['.html'],
					include: undefined,
					exclude: undefined,
					pruneCache: true,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(1)
		expect(mockedCompressFile.mock.calls[0][0]).toContain('large.html')
	})

	it('respects include patterns', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')
		await createFile(outputDirectory, 'pages/about.html')
		await createFile(outputDirectory, 'pages/contact.html')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				filters: {
					minSize: 1,
					fileTypes: ['.html'],
					include: ['pages/**'],
					exclude: undefined,
					pruneCache: true,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(2)
		expect(mockedCompressFile.mock.calls.map(call => call[2]).sort()).toEqual([
			'pages/about.html',
			'pages/contact.html',
		])
	})

	it('excludes matching files', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')
		await createFile(outputDirectory, 'private.html')
		await createFile(outputDirectory, 'pages/about.html')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				filters: {
					minSize: 1,
					fileTypes: ['.html'],
					include: undefined,
					exclude: ['private.html'],
					pruneCache: true,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(2)
		expect(mockedCompressFile.mock.calls.map(call => call[2])).not.toContain('private.html')
	})

	it('skips excluded directories using directory glob patterns', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')
		await createFile(outputDirectory, 'ignored/one.html')
		await createFile(outputDirectory, 'nested/ignored/two.html')
		await createFile(outputDirectory, 'pages/about.html')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				filters: {
					minSize: 1,
					fileTypes: ['.html'],
					include: undefined,
					exclude: ['**/ignored/**'],
					pruneCache: true,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile.mock.calls.map(call => call[2]).sort()).toEqual([
			'index.html',
			'pages/about.html',
		])
	})

	it('does not follow symbolic links', async () => {
		await setup()

		const outsideDirectory = join(directory, 'outside')
		await mkdir(outsideDirectory)

		await createFile(outsideDirectory, 'linked.html')
		await createFile(outputDirectory, 'index.html')

		const { symlink } = await import('node:fs/promises')

		await symlink(outsideDirectory, join(outputDirectory, 'linked-directory'), 'dir')

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions(),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(1)
	})

	it('reuses cached files on an incremental build', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')

		const logger = createLogger()
		const options = createOptions()

		await runBuild(outputDirectory, cacheDirectory, 'config-hash', options, logger, undefined)

		mockedCompressFile.mockClear()

		await runBuild(outputDirectory, cacheDirectory, 'config-hash', options, logger, undefined)

		expect(mockedCompressFile).toHaveBeenCalledTimes(1)

		const call = mockedCompressFile.mock.calls[0]

		expect(call[4]).toBeDefined()
		expect(call[5]).toBe(false)
	})

	it('forces recompression when incremental mode is disabled', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')

		const options = createOptions({
			performance: {
				concurrency: 2,
				incremental: false,
				discardCompressionIfLarger: false,
			},
		})

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			options,
			createLogger(),
			undefined,
		)

		mockedCompressFile.mockClear()

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			options,
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile.mock.calls[0][5]).toBe(true)
	})

	it('forces recompression when the configuration hash changes and the option is enabled', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')

		const options = createOptions({
			recompressOnConfigChange: true,
		})

		await runBuild(outputDirectory, cacheDirectory, 'config-a', options, createLogger(), undefined)

		mockedCompressFile.mockClear()

		await runBuild(outputDirectory, cacheDirectory, 'config-b', options, createLogger(), undefined)

		expect(mockedCompressFile.mock.calls[0][5]).toBe(true)
	})

	it('does not update the cache entry when compression fails', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')

		mockedCompressFile.mockRejectedValueOnce(new Error('compression failed'))

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions(),
			createLogger(),
			undefined,
		)

		const manifests = await readFile(
			join(
				cacheDirectory,
				'astro-precompressor',
				`${(await import('node:crypto')).createHash('sha256').update(outputDirectory).digest('hex')}.json`,
			),
			'utf8',
		)

		expect(JSON.parse(manifests).entries).toEqual({})
	})

	it('throws after processing errors when failOnError is enabled', async () => {
		await setup()

		await createFile(outputDirectory, 'index.html')

		mockedCompressFile.mockRejectedValueOnce(new Error('compression failed'))

		await expect(
			runBuild(
				outputDirectory,
				cacheDirectory,
				'config-hash',
				createOptions({
					failOnError: true,
				}),
				createLogger(),
				undefined,
			),
		).rejects.toThrow('Compression failed for 1 operation(s).')
	})

	it('continues processing other files after one file fails', async () => {
		await setup()

		await createFile(outputDirectory, 'one.html')
		await createFile(outputDirectory, 'two.html')

		mockedCompressFile.mockRejectedValueOnce(new Error('first file failed')).mockResolvedValueOnce({
			elapsed: 1,
			compressions: [
				{
					algorithm: 'gzip',
					elapsed: 1,
					generated: true,
					size: 10,
					discarded: false,
				},
			],
		})

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				performance: {
					concurrency: 1,
					incremental: true,
					discardCompressionIfLarger: false,
				},
			}),
			createLogger(),
			undefined,
		)

		expect(mockedCompressFile).toHaveBeenCalledTimes(2)
	})

	it('limits concurrent file workers according to configured concurrency and algorithm count', async () => {
		await setup()

		for (let index = 0; index < 8; index++) {
			await createFile(outputDirectory, `${index}.html`)
		}

		let active = 0
		let peak = 0

		mockedCompressFile.mockImplementation(async () => {
			active++
			peak = Math.max(peak, active)

			await new Promise(resolve => setTimeout(resolve, 10))

			active--

			return {
				elapsed: 1,
				compressions: [
					{
						algorithm: 'gzip',
						elapsed: 1,
						generated: true,
						size: 10,
						discarded: false,
					},
					{
						algorithm: 'brotli',
						elapsed: 1,
						generated: true,
						size: 8,
						discarded: false,
					},
				],
			}
		})

		await runBuild(
			outputDirectory,
			cacheDirectory,
			'config-hash',
			createOptions({
				algorithms: {
					gzip: {},
					brotli: {},
					zstd: false,
				},
				performance: {
					concurrency: 4,
					incremental: true,
					discardCompressionIfLarger: false,
				},
			}),
			createLogger(),
			undefined,
		)

		// 4 total compression slots / 2 algorithms = 2 file workers.
		expect(peak).toBe(2)
	})

	it('handles an empty output directory', async () => {
		await setup()

		await expect(
			runBuild(
				outputDirectory,
				cacheDirectory,
				'config-hash',
				createOptions(),
				createLogger(),
				undefined,
			),
		).resolves.toBeUndefined()

		expect(mockedCompressFile).not.toHaveBeenCalled()
	})
})
