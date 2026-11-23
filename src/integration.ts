import type { AstroIntegration } from 'astro'

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import picomatch from 'picomatch'

import type {
	CompressionOptions,
	ResolvedOptions,
	Compressors,
	GlobFilter,
	CompressionAlgorithm,
} from './types.js'

import {
	DEFAULT_CONCURRENCY,
	DEFAULT_FILE_TYPES,
	INTEGRATION_NAME,
	DEFAULT_MIN_SIZE,
	SILLY_FILE_TYPES,
	DEFAULT_ALGORITHMS,
	DEFAULT_LOG_LEVEL,
	SUPPORTED_ALGORITHMS,
} from './constants.js'

import { createConfigHash, normalizeExtensions } from './utils.js'
import { runBuild } from './build.js'
import { createGzipCompressorFactory, resolveGzipOptions } from './gzip.js'
import { createZstdCompressorFactory, resolveZstdOptions } from './zstd.js'
import { createBrotliCompressorFactory, resolveBrotliOptions } from './brotli.js'

// -----------------------------------------------------------------------------
// Filter helpers
// -----------------------------------------------------------------------------

function validateGlobFilters(
	filters: GlobFilter[] | undefined,
	name: 'include' | 'exclude',
	failOnError: boolean,
	warnings: string[],
): GlobFilter[] | undefined {
	if (!filters) {
		return undefined
	}

	const validFilters: GlobFilter[] = []

	for (const filter of filters) {
		const pattern = typeof filter === 'string' ? filter : filter.pattern

		if (typeof pattern !== 'string' || pattern.length === 0) {
			throw new Error(`[${INTEGRATION_NAME}] ${name} filters must have a non-empty pattern.`)
		}

		// Compile here so invalid glob syntax fails during configuration,
		// rather than unexpectedly failing during the build.
		try {
			picomatch(pattern, { strictBrackets: true })
		} catch (error) {
			throw new Error(`[${INTEGRATION_NAME}] Invalid ${name} glob pattern "${pattern}".`, {
				cause: error,
			})
		}

		if (typeof filter === 'string') {
			validFilters.push(filter)
			continue
		}

		if (!Array.isArray(filter.algorithms) || filter.algorithms.length === 0) {
			const message =
				`[${INTEGRATION_NAME}] Ignoring ${name} filter "${pattern}" ` +
				'because it does not specify any algorithms.'

			if (failOnError) {
				throw new Error(message)
			}

			warnings.push(message)
			continue
		}

		const algorithms = [...new Set(filter.algorithms)]

		for (const algorithm of algorithms) {
			if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
				throw new Error(
					`[${INTEGRATION_NAME}] Unsupported algorithm "${algorithm}" in ${name} filter "${pattern}".`,
				)
			}
		}

		validFilters.push({
			pattern,
			algorithms: algorithms as CompressionAlgorithm[],
		})
	}

	return validFilters
}

// -----------------------------------------------------------------------------
// Option resolution
// -----------------------------------------------------------------------------

function resolveOptions(userOptions: CompressionOptions): ResolvedOptions {
	const failOnError = userOptions.failOnError ?? false
	const filterWarnings: string[] = []

	const algorithms = {
		...DEFAULT_ALGORITHMS,
		...userOptions.algorithms,
	}

	const options: ResolvedOptions = {
		algorithms: {
			gzip: resolveGzipOptions(algorithms.gzip),
			brotli: resolveBrotliOptions(algorithms.brotli),
			zstd: resolveZstdOptions(algorithms.zstd),
		},
		performance: {
			concurrency: userOptions.performance?.concurrency ?? DEFAULT_CONCURRENCY,
			incremental: userOptions.performance?.incremental ?? true,
			discardCompressionIfLarger: userOptions.performance?.discardCompressionIfLarger ?? true,
		},
		cache: {
			prune: userOptions.cache?.prune ?? true,
		},
		filters: {
			minSize: userOptions.filters?.minSize ?? DEFAULT_MIN_SIZE,
			fileTypes: normalizeExtensions(userOptions.filters?.fileTypes ?? DEFAULT_FILE_TYPES),
			include: validateGlobFilters(
				userOptions.filters?.include,
				'include',
				failOnError,
				filterWarnings,
			),
			exclude: validateGlobFilters(
				userOptions.filters?.exclude,
				'exclude',
				failOnError,
				filterWarnings,
			),
		},
		filterWarnings,
		logLevel: userOptions.logLevel ?? DEFAULT_LOG_LEVEL,
		failOnError,
		recompressOnConfigChange: userOptions.recompressOnConfigChange ?? false,
	}

	if (!(options.algorithms.gzip || options.algorithms.brotli || options.algorithms.zstd)) {
		throw new Error(`[${INTEGRATION_NAME}] At least one compression algorithm must be enabled.`)
	}

	if (!Number.isInteger(options.performance.concurrency) || options.performance.concurrency < 1) {
		throw new Error(`[${INTEGRATION_NAME}] concurrency must be a positive integer.`)
	}

	if (!options.filters.fileTypes.length) {
		throw new Error(`[${INTEGRATION_NAME}] At least one file type must be provided.`)
	}

	if (!Number.isFinite(options.filters.minSize) || options.filters.minSize < 0) {
		throw new Error(`[${INTEGRATION_NAME}] minSize must be a non-negative number.`)
	}

	if (![0, 1, 2].includes(options.logLevel)) {
		throw new Error(`[${INTEGRATION_NAME}] logLevel must be 0, 1, or 2.`)
	}

	return options
}

// -----------------------------------------------------------------------------
// Astro integration
// -----------------------------------------------------------------------------

export default function precompressor(userOptions: CompressionOptions = {}): AstroIntegration {
	const options = resolveOptions(userOptions)
	const compressors: Compressors = {}

	// Start optional imports while vite is still available
	// gzip
	const userGzipOptions = userOptions.algorithms?.gzip
	const explicitZopfli =
		typeof userGzipOptions === 'object' &&
		'zopfli' in userGzipOptions &&
		Boolean(userGzipOptions.zopfli)
	const optionalZopfli = typeof userGzipOptions === 'undefined' || userGzipOptions === true
	const gzipPromise =
		options.algorithms.gzip &&
		createGzipCompressorFactory(options.algorithms.gzip, explicitZopfli, optionalZopfli)
	// zstd
	const zstdPromise =
		options.algorithms.zstd && createZstdCompressorFactory(options.algorithms.zstd)

	// Attach rejection handlers immediately to prevent unhandled rejections.
	// The original promises still reject when awaited below.
	if (zstdPromise) {
		void zstdPromise.catch(() => {})
	}
	if (gzipPromise) {
		void gzipPromise.catch(() => {})
	}

	let cacheDirectory: string | undefined
	let configHash: string | undefined

	return {
		name: INTEGRATION_NAME,

		hooks: {
			'astro:config:setup': async ({ config, logger }) => {
				// Finish loading compressor factories only if needed
				if (zstdPromise) {
					compressors.zstd = await zstdPromise
				}

				if (gzipPromise) {
					compressors.gzip = await gzipPromise
				}

				if (options.algorithms.brotli) {
					compressors.brotli = createBrotliCompressorFactory(options.algorithms.brotli)
				}

				// Emit any warnings
				for (const warning of options.filterWarnings) {
					logger.warn(warning)
				}

				cacheDirectory = resolve(fileURLToPath(config.cacheDir))
				configHash = createConfigHash(config, options)

				for (const fileType of options.filters.fileTypes) {
					if (SILLY_FILE_TYPES.includes(fileType)) {
						logger.warn(`Compressing ${fileType} files is silly, but since you asked...`)
					}
				}
			},

			'astro:build:done': async ({ dir, logger }) => {
				if (!cacheDirectory || !configHash) {
					throw new Error(`[${INTEGRATION_NAME}] Integration was not initialized correctly.`)
				}

				await runBuild(fileURLToPath(dir), cacheDirectory, configHash, options, logger, compressors)
			},
		},
	}
}
