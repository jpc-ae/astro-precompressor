import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, vi } from 'vitest'

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

type TestOptionsOverrides = Omit<
	Partial<ResolvedOptions>,
	'algorithms' | 'performance' | 'filters'
> & {
	algorithms?: Partial<ResolvedOptions['algorithms']>
	performance?: Partial<ResolvedOptions['performance']>
	filters?: Partial<ResolvedOptions['filters']>
}

export function createOptions(overrides: TestOptionsOverrides = {}): ResolvedOptions {
	const defaults: ResolvedOptions = {
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
	}

	return {
		...defaults,
		...overrides,
		algorithms: { ...defaults.algorithms, ...overrides.algorithms },
		performance: { ...defaults.performance, ...overrides.performance },
		filters: { ...defaults.filters, ...overrides.filters },
	}
}

export async function createTempDirectory(prefix = 'astro-precompressor-test-'): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix))
}

/** Creates a temporary directory and registers automatic cleanup after each test. */
export function useTempDirectory(prefix?: string) {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	return {
		create: async (): Promise<string> => {
			if (directory) {
				throw new Error('Temporary directory already created for this test.')
			}
			directory = await createTempDirectory(prefix)
			return directory
		},
	}
}

export async function createFile(
	directory: string,
	relativePath: string,
	contents = 'test content',
): Promise<string> {
	const filePath = join(directory, relativePath)

	await mkdir(dirname(filePath), { recursive: true })
	await writeFile(filePath, contents)

	return filePath
}

export async function removeTempDirectory(directory: string): Promise<void> {
	await rm(directory, { recursive: true, force: true })
}
