import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Logger } from '../src/types.js'

import precompressor from '../src/integration.js'
import { runBuild } from '../src/build.js'

import { createLogger } from './helpers.js'

vi.mock('../src/build.js', () => ({
	runBuild: vi.fn(),
}))

const mockedRunBuild = vi.mocked(runBuild)

describe('precompressor integration', () => {
	let directory = ''

	afterEach(async () => {
		vi.clearAllMocks()

		if (directory) {
			await rm(directory, { recursive: true, force: true })
			directory = ''
		}
	})

	async function createIntegration(options: Parameters<typeof precompressor>[0] = {}) {
		directory = await mkdtemp(join(tmpdir(), 'precompressor-integration-'))

		const integration = precompressor(options)
		const logger = createLogger()

		const setup = integration.hooks['astro:config:setup'] as unknown as (args: {
			config: { cacheDir: URL }
			logger: Logger
		}) => Promise<void>

		const buildDone = integration.hooks['astro:build:done'] as unknown as (args: {
			dir: URL
			logger: Logger
		}) => Promise<void>

		await setup({
			config: {
				cacheDir: pathToFileURL(`${directory}/cache/`),
			},
			logger,
		})

		return {
			integration,
			logger,
			buildDone,
		}
	}

	it('uses the expected integration name', () => {
		const integration = precompressor()

		expect(integration.name).toBe('astro-precompressor')
	})

	it('enables gzip and Brotli by default', async () => {
		const { buildDone } = await createIntegration()

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.algorithms.gzip).toBeTruthy()
		expect(options.algorithms.brotli).toBeTruthy()
		expect(options.algorithms.zstd).toBe(false)
	})

	it('supports disabling individual algorithms', async () => {
		const { buildDone } = await createIntegration({
			algorithms: {
				gzip: false,
				brotli: true,
				zstd: false,
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.algorithms.gzip).toBe(false)
		expect(options.algorithms.brotli).toBeTruthy()
		expect(options.algorithms.zstd).toBe(false)
	})

	it('resolves explicitly configured gzip engines', async () => {
		const { buildDone } = await createIntegration({
			algorithms: {
				gzip: {
					level: 1,
				},
				brotli: false,
				zstd: false,
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.algorithms.gzip).toMatchObject({
			level: 1,
		})
	})

	it('passes algorithm options through', async () => {
		const { buildDone } = await createIntegration({
			algorithms: {
				zstd: {},
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.algorithms).toMatchObject({
			zstd: {},
		})
	})

	it('falls back to zlib when zopfli is set to false', async () => {
		const { buildDone } = await createIntegration({
			algorithms: {
				gzip: {
					zopfli: false,
				},
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.algorithms).toMatchObject({
			gzip: {},
		})
	})

	it('passes filter options through', async () => {
		const { buildDone } = await createIntegration({
			filters: {
				minSize: 500,
				fileTypes: ['html', '.CSS'],
				include: ['pages/**'],
				exclude: ['private/**'],
				pruneCache: false,
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.filters).toMatchObject({
			minSize: 500,
			fileTypes: ['.html', '.css'],
			include: ['pages/**'],
			exclude: ['private/**'],
			pruneCache: false,
		})
	})

	it('passes performance options through', async () => {
		const { buildDone } = await createIntegration({
			performance: {
				concurrency: 3,
				incremental: false,
				discardCompressionIfLarger: false,
			},
		})

		await buildDone({
			dir: pathToFileURL(`${directory}/dist/`),
			logger: createLogger(),
		})

		const options = mockedRunBuild.mock.calls[0][3]

		expect(options.performance).toEqual({
			concurrency: 3,
			incremental: false,
			discardCompressionIfLarger: false,
		})
	})

	it('warns when a disabled file type is explicitly selected', async () => {
		const logger = createLogger()

		const integration = precompressor({
			filters: {
				fileTypes: ['html', 'png'],
			},
		})

		const setup = integration.hooks['astro:config:setup'] as unknown as (args: {
			config: { cacheDir: URL }
			logger: Logger
		}) => Promise<void>

		directory = await mkdtemp(join(tmpdir(), 'precompressor-integration-'))

		await setup({
			config: {
				cacheDir: pathToFileURL(`${directory}/cache/`),
			},
			logger,
		})

		expect(logger.warn).toHaveBeenCalledWith(
			'Compressing .png files is silly, but since you asked...',
		)
	})

	it.each([
		[
			'no algorithms',
			{
				algorithms: {
					gzip: false,
					brotli: false,
					zstd: false,
				},
			},
			'At least one compression algorithm must be enabled.',
		],
		[
			'zero concurrency',
			{
				performance: {
					concurrency: 0,
				},
			},
			'concurrency must be a positive integer.',
		],
		[
			'fractional concurrency',
			{
				performance: {
					concurrency: 1.5,
				},
			},
			'concurrency must be a positive integer.',
		],
		[
			'no file types',
			{
				filters: {
					fileTypes: [],
				},
			},
			'At least one file type must be provided.',
		],
		[
			'negative minimum size',
			{
				filters: {
					minSize: -1,
				},
			},
			'minSize must be a non-negative number.',
		],
		[
			'invalid log level',
			{
				logLevel: 3,
			},
			'logLevel must be 0, 1, or 2.',
		],
	])('rejects invalid options: %s', (_name, options, message) => {
		expect(() => precompressor(options as never)).toThrow(message)
	})

	it('rejects build completion before setup', async () => {
		const integration = precompressor()

		const buildDone = integration.hooks['astro:build:done'] as unknown as (args: {
			dir: URL
			logger: Logger
		}) => Promise<void>

		await expect(
			buildDone({
				dir: pathToFileURL('/tmp/dist/'),
				logger: createLogger(),
			}),
		).rejects.toThrow('Integration was not initialized correctly.')
	})

	it('passes the output directory and initialized cache directory to runBuild', async () => {
		const { buildDone, logger } = await createIntegration()

		const outputDirectory = join(directory, 'dist')

		await buildDone({
			dir: pathToFileURL(outputDirectory),
			logger,
		})

		const [output, cache, configHash, , passedLogger] = mockedRunBuild.mock.calls[0]

		expect(output).toBe(outputDirectory)
		expect(cache).toBe(join(directory, 'cache'))
		expect(configHash).toEqual(expect.any(String))
		expect(passedLogger).toBe(logger)
	})
})
