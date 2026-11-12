import { rm } from 'node:fs/promises'

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
	createTestEnvironment,
	createTestFile,
	createTestLogger,
	removeTestDirectory,
	runIntegration,
} from './helpers'

import type { TestEnvironment } from './helpers'

const CONTENT = 'A document used to test incremental compression caching.'

describe('compression cache', () => {
	const forkedLogger = createTestLogger()
	let environment: TestEnvironment

	beforeEach(async () => {
		environment = await createTestEnvironment()
		environment.logger.fork.mockReturnValue(forkedLogger)
	})

	afterEach(async () => {
		await removeTestDirectory(environment.root)
	})

	it('creates a cache manifest', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment)

		const { readdir } = await import('node:fs/promises')

		const pluginDirectory = `${environment.cacheDirectory}/astro-precompressor`

		const files = await readdir(pluginDirectory)

		expect(files.some(file => file.endsWith('.json'))).toBe(true)
	})

	it('reuses cached compression on subsequent builds', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment)

		await runIntegration(environment, {
			logLevel: 1,
		})

		expect(
			forkedLogger.info.mock.calls.some(([message]) =>
				String(message).includes('reused cache entry'),
			),
		).toBe(true)
	})

	it('regenerates compression when source contents change', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment)

		await createTestFile(environment.outputDirectory, 'index.html', `${CONTENT} Updated.`)

		await runIntegration(environment, {
			logLevel: 1,
		})

		expect(forkedLogger.info.mock.calls.some(([message]) => String(message).includes('→'))).toBe(
			true,
		)

		expect(sourcePath).toContain('index.html')
	})

	it('recompresses when configuration changes and recompressOnConfigChange is enabled', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment, {
			recompressOnConfigChange: true,
			minSize: 0,
		})

		await runIntegration(environment, {
			recompressOnConfigChange: true,
			minSize: 1,
			logLevel: 1,
		})

		expect(forkedLogger.info.mock.calls.some(([message]) => String(message).includes('→'))).toBe(
			true,
		)
	})

	it('does not force recompression when configuration changes and the option is disabled', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment)

		await runIntegration(environment, {
			minSize: 1,
			logLevel: 1,
		})

		expect(
			forkedLogger.info.mock.calls.some(([message]) =>
				String(message).includes('reused cache entry'),
			),
		).toBe(true)
	})

	it('prunes cache entries for deleted source files', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment, {
			prune: true,
		})

		await rm(sourcePath)

		const logger = await runIntegration(environment, {
			prune: true,
		})

		expect(
			logger.info.mock.calls.some(([message]) =>
				String(message).includes('Pruned 1 stale cache entry'),
			),
		).toBe(true)

		await expect(
			import('node:fs/promises').then(({ access }) => access(`${sourcePath}.br`)),
		).rejects.toThrow()

		await expect(
			import('node:fs/promises').then(({ access }) => access(`${sourcePath}.gz`)),
		).rejects.toThrow()
	})

	it('removes disabled algorithm artifacts when pruning is enabled', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment, {
			prune: true,
			algorithms: ['brotli', 'gzip'],
		})

		await runIntegration(environment, {
			prune: true,
			algorithms: ['brotli'],
		})

		await expect(
			import('node:fs/promises').then(({ access }) => access(`${sourcePath}.br`)),
		).resolves.toBeUndefined()

		await expect(
			import('node:fs/promises').then(({ access }) => access(`${sourcePath}.gz`)),
		).rejects.toThrow()
	})

	it('preserves disabled algorithm artifacts when pruning is disabled', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', CONTENT)

		await runIntegration(environment, {
			algorithms: ['brotli', 'gzip'],
		})

		await runIntegration(environment, {
			algorithms: ['brotli'],
		})

		await expect(
			import('node:fs/promises').then(({ access }) => access(`${sourcePath}.gz`)),
		).resolves.toBeUndefined()
	})
})
