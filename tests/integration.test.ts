import { afterEach, describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import precompressor from '../src/integration.js'
import { INTEGRATION_NAME } from '../src/constants.js'
import { createMockLogger } from './helpers/logger.js'
import type { AstroIntegration } from 'astro'
import { createTempDir } from './helpers/filesystem.js'
import { fastBrotli } from './helpers/options.js'

type ConfigSetupHook = NonNullable<AstroIntegration['hooks']['astro:config:setup']>
type BuildDoneHook = NonNullable<AstroIntegration['hooks']['astro:build:done']>
type ConfigSetupContext = Parameters<ConfigSetupHook>[0]
type BuildDoneContext = Parameters<BuildDoneHook>[0]

describe('Astro integration', () => {
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

	it('exposes the expected integration name and lifecycle hooks', () => {
		const integration = precompressor({ algorithms: { gzip: true, brotli: false } })
		expect(integration.name).toBe(INTEGRATION_NAME)
		expect(integration.hooks).toHaveProperty('astro:config:setup')
		expect(integration.hooks).toHaveProperty('astro:build:done')
	})

	it('applies defaults and accepts valid overrides', () => {
		expect(() => precompressor()).not.toThrow()
		expect(() => precompressor({ algorithms: { gzip: false, brotli: true } })).not.toThrow()
		expect(() =>
			precompressor({
				performance: { concurrency: 2 },
				filters: { minSize: 0, fileTypes: ['.HTML'] },
				logLevel: 1,
			}),
		).not.toThrow()
	})

	it('requires at least one enabled compression algorithm', () => {
		expect(() =>
			precompressor({ algorithms: { gzip: false, brotli: false, zstd: false } }),
		).toThrow('At least one compression algorithm')
	})

	it.each([0, -1, 1.5, Number.NaN])('validates concurrency %s', concurrency => {
		expect(() => precompressor({ performance: { concurrency } })).toThrow(
			'concurrency must be a positive integer',
		)
	})

	it('validates file types and minimum size', () => {
		expect(() => precompressor({ filters: { fileTypes: [] } })).toThrow('At least one file type')
		expect(() => precompressor({ filters: { fileTypes: ['bad/ext'] } })).toThrow(
			'Invalid file extension',
		)
		expect(() => precompressor({ filters: { minSize: -1 } })).toThrow(
			'minSize must be a non-negative',
		)
		expect(() => precompressor({ filters: { minSize: Number.NaN } })).toThrow(
			'minSize must be a non-negative',
		)
	})

	it('initializes Brotli-only configuration and warns for silly file types', async () => {
		const root = await setup()
		const cachePath = join(root, '.astro')
		const logger = createMockLogger()

		await mkdir(cachePath, { recursive: true })

		const integration = precompressor({
			algorithms: {
				gzip: false,
				brotli: fastBrotli,
			},
			filters: {
				fileTypes: ['.bin'],
			},
		})

		await integration.hooks['astro:config:setup']?.({
			config: { cacheDir: pathToFileURL(`${cachePath}/`) },
			logger,
		} as ConfigSetupContext)

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Compressing .bin files is silly'),
		)
	})

	it.each([-1, 3, 1.5])('validates log level %s', logLevel => {
		// @ts-expect-error Deliberately pass invalid values to test runtime validation
		expect(() => precompressor({ logLevel })).toThrow('logLevel must be 0, 1, or 2')
	})

	it('initializes compressors and runs the build lifecycle', async () => {
		const integration = precompressor({
			algorithms: { gzip: true, brotli: false },
		})
		const logger = createMockLogger()
		const root = await setup()
		const cachePath = join(root, '.astro')
		const outputPath = join(root, 'dist')

		await mkdir(cachePath)
		await mkdir(outputPath)

		await integration.hooks['astro:config:setup']?.({
			config: { cacheDir: pathToFileURL(`${cachePath}/`) },
			logger,
		} as ConfigSetupContext)

		await expect(
			integration.hooks['astro:build:done']?.({
				dir: pathToFileURL(`${outputPath}/`),
				logger,
			} as BuildDoneContext),
		).resolves.toBeUndefined()
	})

	it('fails clearly if build completes before config setup', async () => {
		const integration = precompressor({ algorithms: { gzip: false, brotli: true } })
		const logger = createMockLogger()
		await expect(
			integration.hooks['astro:build:done']?.({
				dir: new URL('../dist/', import.meta.url),
				logger,
			} as BuildDoneContext),
		).rejects.toThrow('not initialized correctly')
	})
})
