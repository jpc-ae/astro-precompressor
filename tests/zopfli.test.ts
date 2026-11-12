import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
	createTestEnvironment,
	createTestFile,
	readTestFile,
	removeTestDirectory,
	runIntegration,
	type TestEnvironment,
} from './helpers'

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

describe('Zopfli compression', () => {
	let environment: TestEnvironment

	beforeEach(async () => {
		environment = await createTestEnvironment()
	})

	afterEach(async () => {
		await removeTestDirectory(environment.root)
	})

	// ---------------------------------------------------------------------------
	// Integration
	// ---------------------------------------------------------------------------

	it('loads Zopfli during integration initialization', async () => {
		const contents = '<html><body>Hello, Zopfli!</body></html>'

		await createTestFile(environment.outputDirectory, 'index.html', contents)

		// runIntegration invokes the integration factory first, then its
		// config:setup and build:done hooks.
		await runIntegration(environment, {
			algorithms: ['gzip'],
			useZopfli: true,
		})

		const compressed = await readTestFile(join(environment.outputDirectory, 'index.html.gz'))

		expect(gunzipSync(compressed).toString()).toBe(contents)
	})

	it('generates valid Gzip output with custom Zopfli options', async () => {
		const contents =
			'<html><body>' + 'Zopfli compression test content. '.repeat(1000) + '</body></html>'

		await createTestFile(environment.outputDirectory, 'index.html', contents)

		await runIntegration(environment, {
			algorithms: ['gzip'],
			useZopfli: {
				numiterations: 30,
			},
		})

		const compressed = await readTestFile(join(environment.outputDirectory, 'index.html.gz'))

		expect(compressed.length).toBeGreaterThan(0)
		expect(gunzipSync(compressed).toString()).toBe(contents)
	})

	it('does not require Zopfli when only Brotli is enabled', async () => {
		const contents = '<html><body>Brotli only</body></html>'

		await createTestFile(environment.outputDirectory, 'index.html', contents)

		await runIntegration(environment, {
			algorithms: ['brotli'],
			useZopfli: true,
		})

		const compressed = await readTestFile(join(environment.outputDirectory, 'index.html.br'))

		expect(compressed.length).toBeGreaterThan(0)
	})
})
