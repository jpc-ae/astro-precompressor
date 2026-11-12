import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
	createTestEnvironment,
	createTestFile,
	readTestFile,
	removeTestDirectory,
	runIntegration,
} from './helpers'

import type { TestEnvironment } from './helpers'

const TEST_CONTENT = [
	'This is a test document.',
	'It contains enough text to produce compressed output.',
	'The compression integration should preserve its contents.',
	'Brotli and Gzip should both produce valid results.',
].join('\n')

describe('compression', () => {
	let environment: TestEnvironment

	beforeEach(async () => {
		environment = await createTestEnvironment()
	})

	afterEach(async () => {
		await removeTestDirectory(environment.root)
	})

	it('generates Brotli and Gzip files by default', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		await runIntegration(environment)

		const br = await readTestFile(`${environment.outputDirectory}/index.html.br`)

		const gz = await readTestFile(`${environment.outputDirectory}/index.html.gz`)

		expect(brotliDecompressSync(br).toString()).toBe(TEST_CONTENT)

		expect(gunzipSync(gz).toString()).toBe(TEST_CONTENT)
	})

	it('generates Brotli only when configured', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		await runIntegration(environment, {
			algorithms: ['brotli'],
		})

		const br = await readTestFile(`${environment.outputDirectory}/index.html.br`)

		expect(brotliDecompressSync(br).toString()).toBe(TEST_CONTENT)

		await expect(readTestFile(`${environment.outputDirectory}/index.html.gz`)).rejects.toThrow()
	})

	it('generates Gzip only when configured', async () => {
		await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		await runIntegration(environment, {
			algorithms: ['gzip'],
		})

		const gz = await readTestFile(`${environment.outputDirectory}/index.html.gz`)

		expect(gunzipSync(gz).toString()).toBe(TEST_CONTENT)

		await expect(readTestFile(`${environment.outputDirectory}/index.html.br`)).rejects.toThrow()
	})

	it('generates valid output for multiple files', async () => {
		const files = ['index.html', 'styles.css', 'script.js', 'data.json']

		for (const file of files) {
			await createTestFile(environment.outputDirectory, file, `${file}: ${TEST_CONTENT}`)
		}

		await runIntegration(environment)

		for (const file of files) {
			const source = await readTestFile(`${environment.outputDirectory}/${file}`)

			const br = await readTestFile(`${environment.outputDirectory}/${file}.br`)

			const gz = await readTestFile(`${environment.outputDirectory}/${file}.gz`)

			expect(brotliDecompressSync(br)).toEqual(source)

			expect(gunzipSync(gz)).toEqual(source)
		}
	})

	it('preserves the original source file', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		await runIntegration(environment)

		expect((await readTestFile(sourcePath)).toString()).toBe(TEST_CONTENT)
	})

	it('preserves source modification time', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		const originalStats = await import('node:fs/promises').then(({ stat }) => stat(sourcePath))

		await runIntegration(environment)

		const updatedStats = await import('node:fs/promises').then(({ stat }) => stat(sourcePath))

		expect(updatedStats.mtimeMs).toBe(originalStats.mtimeMs)
	})

	it('preserves source contents across repeated builds', async () => {
		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', TEST_CONTENT)

		await runIntegration(environment)
		await runIntegration(environment)

		expect((await readTestFile(sourcePath)).toString()).toBe(TEST_CONTENT)
	})

	it('does not create compressed files for unconfigured extensions', async () => {
		await createTestFile(environment.outputDirectory, 'image.png', 'Not actually an image')

		await runIntegration(environment)

		await expect(readTestFile(`${environment.outputDirectory}/image.png.br`)).rejects.toThrow()

		await expect(readTestFile(`${environment.outputDirectory}/image.png.gz`)).rejects.toThrow()
	})
})
