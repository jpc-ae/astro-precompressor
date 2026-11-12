import { createHash } from 'node:crypto'
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { compressFile } from '../src/compression'

import { DEFAULT_FILE_TYPES, DEFAULT_ZOPFLI_OPTIONS } from '../src/constants'

import { normalizeExtensions } from '../src/utils'

import type { CompressionAlgorithm, ResolvedOptions } from '../src/types'

import {
	createTestEnvironment,
	createTestFile,
	readTestFile,
	removeTestDirectory,
	type TestEnvironment,
} from './helpers'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function createOptions(algorithms: CompressionAlgorithm[]): ResolvedOptions {
	return {
		concurrency: 1,
		incremental: false,
		minSize: 0,
		failOnError: true,
		prune: false,
		useZopfli: DEFAULT_ZOPFLI_OPTIONS,
		recompressOnConfigChange: false,
		logLevel: 0,
		fileTypes: normalizeExtensions(DEFAULT_FILE_TYPES),
		algorithms,
	}
}

function hashContents(contents: string): string {
	return createHash('sha256').update(contents).digest('hex')
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Compression errors', () => {
	let environment: TestEnvironment

	beforeEach(async () => {
		environment = await createTestEnvironment()
	})

	afterEach(async () => {
		await removeTestDirectory(environment.root)
	})

	it('wraps a missing Zopfli module in an AggregateError', async () => {
		const contents = '<html><body>Missing Zopfli</body></html>'

		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', contents)

		const artifactDirectory = join(environment.cacheDirectory, 'artifacts')

		await expect(
			compressFile(
				sourcePath,
				artifactDirectory,
				'index.html',
				hashContents(contents),
				undefined,
				true,
				createOptions(['gzip']),
				environment.logger,
				undefined,
			),
		).rejects.toMatchObject({
			name: 'AggregateError',
			message: 'One or more compression algorithms failed for index.html.',
			errors: [
				expect.objectContaining({
					message: 'Zopfli module has not been initialized.',
				}),
			],
		})
	})

	it('preserves individual algorithm failures', async () => {
		const contents = '<html><body>Multiple failures</body></html>'

		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', contents)

		// Use a missing source file to make both compression algorithms fail.
		const missingSourcePath = `${sourcePath}.missing`

		const artifactDirectory = join(environment.cacheDirectory, 'artifacts')

		let error: unknown

		try {
			await compressFile(
				missingSourcePath,
				artifactDirectory,
				'index.html',
				hashContents(contents),
				undefined,
				true,
				{
					...createOptions(['brotli', 'gzip']),
					useZopfli: false,
				},
				environment.logger,
				undefined,
			)
		} catch (caught) {
			error = caught
		}

		expect(error).toBeInstanceOf(AggregateError)

		const aggregate = error as AggregateError

		expect(aggregate.message).toBe('One or more compression algorithms failed for index.html.')
		expect(aggregate.errors).toHaveLength(2)

		for (const failure of aggregate.errors) {
			expect(failure).toBeInstanceOf(Error)
		}
	})

	it('allows Brotli to complete when Gzip fails', async () => {
		const contents =
			'<html><body>' + 'Independent compression test. '.repeat(100) + '</body></html>'

		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', contents)

		const artifactDirectory = join(environment.cacheDirectory, 'artifacts')

		let error: unknown

		try {
			await compressFile(
				sourcePath,
				artifactDirectory,
				'index.html',
				hashContents(contents),
				undefined,
				true,
				createOptions(['brotli', 'gzip']),
				environment.logger,
				undefined,
			)
		} catch (caught) {
			error = caught
		}

		expect(error).toBeInstanceOf(AggregateError)

		const aggregate = error as AggregateError

		expect(aggregate.errors).toHaveLength(1)
		expect(aggregate.errors[0]).toMatchObject({
			message: 'Zopfli module has not been initialized.',
		})

		const brotliPath = `${sourcePath}.br`
		const gzipPath = `${sourcePath}.gz`

		expect(await pathExists(brotliPath)).toBe(true)
		expect(await pathExists(gzipPath)).toBe(false)

		const compressed = await readTestFile(brotliPath)

		expect(brotliDecompressSync(compressed).toString()).toBe(contents)
	})

	it('does not leave temporary files when compression fails', async () => {
		const contents = '<html><body>Temporary file cleanup</body></html>'

		const sourcePath = await createTestFile(environment.outputDirectory, 'index.html', contents)

		const artifactDirectory = join(environment.cacheDirectory, 'artifacts')

		await expect(
			compressFile(
				sourcePath,
				artifactDirectory,
				'index.html',
				hashContents(contents),
				undefined,
				true,
				createOptions(['gzip']),
				environment.logger,
				undefined,
			),
		).rejects.toBeInstanceOf(AggregateError)

		const files = await readdir(artifactDirectory, {
			recursive: true,
		}).catch(() => [])

		expect(files.some(file => String(file).endsWith('.tmp'))).toBe(false)
	})
})
