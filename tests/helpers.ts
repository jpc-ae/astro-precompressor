import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

import type { Logger, ResolvedOptions } from '../src/types.js'
import { DEFAULT_ZLIB_OPTIONS } from '../src/constants.js'

export function createLogger(): Logger {
	const logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fork: vi.fn(),
	}

	logger.fork.mockReturnValue(logger)

	return logger as unknown as Logger
}

export function createOptions(overrides: Partial<ResolvedOptions> = {}): ResolvedOptions {
	return {
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
		filters: {
			minSize: 1,
			fileTypes: ['.html'],
			include: undefined,
			exclude: undefined,
			pruneCache: true,
		},
		logLevel: 0,
		failOnError: false,
		recompressOnConfigChange: false,
		...overrides,
	}
}

export async function createTempDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'astro-precompressor-test-'))
}

export async function createFile(
	directory: string,
	relativePath: string,
	contents = 'test content',
): Promise<string> {
	const filePath = join(directory, relativePath)

	await mkdir(join(filePath, '..'), { recursive: true })
	await writeFile(filePath, contents)

	return filePath
}

export async function removeTempDirectory(directory: string): Promise<void> {
	await rm(directory, { recursive: true, force: true })
}
