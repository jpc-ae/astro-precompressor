import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
	createTestEnvironment,
	createTestFile,
	createTestLogger,
	readTestFile,
	removeTestDirectory,
	runIntegration,
} from './helpers'

import type { TestEnvironment } from './helpers'

describe('build operation', () => {
	let environment: TestEnvironment

	beforeEach(async () => {
		environment = await createTestEnvironment()
	})

	afterEach(async () => {
		await removeTestDirectory(environment.root)
	})

	describe('file discovery', () => {
		it('compresses only the configured extensions', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'HTML content')

			await createTestFile(environment.outputDirectory, 'styles.css', 'CSS content')

			await createTestFile(environment.outputDirectory, 'image.png', 'PNG content')

			await runIntegration(environment, {
				fileTypes: ['html'],
			})

			await expect(
				readTestFile(`${environment.outputDirectory}/index.html.br`),
			).resolves.toBeInstanceOf(Buffer)

			await expect(readTestFile(`${environment.outputDirectory}/styles.css.br`)).rejects.toThrow()

			await expect(readTestFile(`${environment.outputDirectory}/image.png.br`)).rejects.toThrow()
		})

		it('normalizes file extensions without dots', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'HTML content')

			await createTestFile(environment.outputDirectory, 'styles.css', 'CSS content')

			await runIntegration(environment, {
				fileTypes: ['HTML'],
			})

			await expect(
				readTestFile(`${environment.outputDirectory}/index.html.br`),
			).resolves.toBeInstanceOf(Buffer)

			await expect(readTestFile(`${environment.outputDirectory}/styles.css.br`)).rejects.toThrow()
		})

		it('discovers files in nested directories', async () => {
			await createTestFile(
				environment.outputDirectory,
				'assets/css/styles.css',
				'Nested CSS content',
			)

			await runIntegration(environment)

			const compressed = await readTestFile(
				`${environment.outputDirectory}/assets/css/styles.css.br`,
			)

			expect(brotliDecompressSync(compressed).toString()).toBe('Nested CSS content')
		})

		it('does not compress files when fileTypes is empty', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'HTML content')

			const logger = await runIntegration(environment, {
				fileTypes: [],
				logLevel: 1,
			})

			await expect(readTestFile(`${environment.outputDirectory}/index.html.br`)).rejects.toThrow()

			expect(
				logger.info.mock.calls.some(([message]) => String(message).includes('Reused: 0')),
			).toBe(true)
		})
	})

	describe('minimum file size', () => {
		it('compresses files meeting the minimum size', async () => {
			await createTestFile(environment.outputDirectory, 'large.html', '1234567890')

			await runIntegration(environment, {
				minSize: 10,
			})

			await expect(
				readTestFile(`${environment.outputDirectory}/large.html.br`),
			).resolves.toBeInstanceOf(Buffer)
		})

		it('skips files smaller than the minimum size', async () => {
			await createTestFile(environment.outputDirectory, 'small.html', '123456789')

			await runIntegration(environment, {
				minSize: 10,
			})

			await expect(readTestFile(`${environment.outputDirectory}/small.html.br`)).rejects.toThrow()
		})
	})

	describe('concurrency', () => {
		it('processes multiple files successfully', async () => {
			const files = Array.from({ length: 20 }, (_, index) => `file-${index}.html`)

			for (const file of files) {
				await createTestFile(environment.outputDirectory, file, `Contents of ${file}`)
			}

			await runIntegration(environment, {
				concurrency: 2,
			})

			for (const file of files) {
				const source = await readTestFile(`${environment.outputDirectory}/${file}`)

				const br = await readTestFile(`${environment.outputDirectory}/${file}.br`)

				const gz = await readTestFile(`${environment.outputDirectory}/${file}.gz`)

				expect(brotliDecompressSync(br)).toEqual(source)

				expect(gunzipSync(gz)).toEqual(source)
			}
		})

		it('works with concurrency greater than the file count', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'Test content')

			await expect(
				runIntegration(environment, {
					concurrency: 10,
				}),
			).resolves.toBeDefined()
		})
	})

	describe('logging', () => {
		it('logs a summary at log level 0', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'Test content')

			const logger = await runIntegration(environment, {
				logLevel: 0,
			})

			expect(logger.info).toHaveBeenCalled()
		})

		it('logs per-file statistics at log level 1', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'Test content')

			const forkedLogger = createTestLogger()
			environment.logger.fork.mockReturnValue(forkedLogger)

			await runIntegration(environment, {
				logLevel: 1,
			})

			expect(
				forkedLogger.info.mock.calls.some(([message]) => String(message).includes('index.html.br')),
			).toBe(true)
		})

		it('logs processing details at log level 2', async () => {
			await createTestFile(environment.outputDirectory, 'index.html', 'Test content')

			const logger = await runIntegration(environment, {
				logLevel: 2,
			})

			expect(logger.debug).toHaveBeenCalled()
		})
	})
})
