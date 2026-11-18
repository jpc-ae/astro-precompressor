import type { AstroIntegration } from 'astro'

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import type {
	CompressionOptions,
	ResolvedOptions,
	ZopfliOptions,
	ZopfliModule,
	AlgorithmOptions,
	ResolvedAlgorithmOptions,
} from './types.js'

import {
	DEFAULT_CONCURRENCY,
	DEFAULT_FILE_TYPES,
	DEFAULT_ZLIB_OPTIONS,
	DEFAULT_BROTLI_OPTIONS,
	DEFAULT_ZSTD_OPTIONS,
	DEFAULT_ZOPFLI_OPTIONS,
	INTEGRATION_NAME,
	DEFAULT_MIN_SIZE,
	SILLY_FILE_TYPES,
	DEFAULT_ALGORITHMS,
	DEFAULT_LOG_LEVEL,
} from './constants.js'

import { createConfigHash, normalizeExtensions, log } from './utils.js'
import { runBuild } from './build.js'
import { loadOptionalZopfli, loadZopfli } from './zopfli.js'
import { checkForZstd } from './zstd.js'

// -----------------------------------------------------------------------------
// Option resolution
// -----------------------------------------------------------------------------

function mergeOptions<T extends { params?: object }>(defaultOptions: T, userOptions: true | T): T {
	if (userOptions === true) {
		return { ...defaultOptions }
	}

	return {
		...defaultOptions,
		...userOptions,
		params: {
			...defaultOptions.params,
			...userOptions.params,
		},
	}
}

function resolveZopfliOptions(value?: boolean | ZopfliOptions): false | ZopfliOptions {
	if (!value) {
		return false
	}

	const options: ZopfliOptions = {
		...DEFAULT_ZOPFLI_OPTIONS,
		...(typeof value === 'object' ? value : {}),
	}

	return options
}

function resolveGzipOptions(value: AlgorithmOptions['gzip']): ResolvedAlgorithmOptions['gzip'] {
	if (!value) {
		return false
	}

	if (typeof value === 'object' && 'zopfli' in value) {
		const zopfliOptions = resolveZopfliOptions(value.zopfli)

		if (!zopfliOptions) {
			return DEFAULT_ZLIB_OPTIONS
		}

		return { zopfli: zopfliOptions }
	}

	return {
		...DEFAULT_ZLIB_OPTIONS,
		...(typeof value === 'object' ? value : {}),
	}
}

function resolveBrotliOptions(
	value: AlgorithmOptions['brotli'],
): ResolvedAlgorithmOptions['brotli'] {
	if (!value) {
		return false
	}

	return mergeOptions(DEFAULT_BROTLI_OPTIONS, value)
}

function resolveZstdOptions(value: AlgorithmOptions['zstd']): ResolvedAlgorithmOptions['zstd'] {
	if (!value) {
		return false
	}

	return mergeOptions(DEFAULT_ZSTD_OPTIONS, value)
}

function resolveOptions(userOptions: CompressionOptions): ResolvedOptions {
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
		filters: {
			minSize: userOptions.filters?.minSize ?? DEFAULT_MIN_SIZE,
			fileTypes: normalizeExtensions(userOptions.filters?.fileTypes ?? DEFAULT_FILE_TYPES),
			include: userOptions.filters?.include,
			exclude: userOptions.filters?.exclude,
			pruneCache: userOptions.filters?.pruneCache ?? true,
		},
		logLevel: userOptions.logLevel ?? DEFAULT_LOG_LEVEL,
		failOnError: userOptions.failOnError ?? false,
		recompressOnConfigChange: userOptions.recompressOnConfigChange ?? false,
	}

	if (!(options.algorithms.gzip || options.algorithms.brotli || options.algorithms.zstd)) {
		throw new Error(`[${INTEGRATION_NAME}] At least one compression algorithm must be enabled.`)
	}

	if (options.algorithms.zstd) {
		checkForZstd()
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

	// Start zopfli import while vite is still available
	let zopfliPromise: Promise<ZopfliModule | undefined> | undefined
	let zopfli: ZopfliModule | undefined
	const gzipOption = userOptions.algorithms?.gzip
	const explicitZopfli =
		typeof gzipOption === 'object' &&
		gzipOption !== null &&
		'zopfli' in gzipOption &&
		Boolean(gzipOption.zopfli)
	const optionalZopfli =
		gzipOption === true || (Boolean(options.algorithms.gzip) && typeof gzipOption === 'undefined')
	if (explicitZopfli) {
		zopfliPromise = loadZopfli()
	} else if (optionalZopfli) {
		zopfliPromise = loadOptionalZopfli()
	}

	// Attach a rejection handler immediately to prevent unhandled rejections.
	// The original promise still rejects when awaited below.
	void zopfliPromise?.catch(() => {})

	let cacheDirectory: string | undefined
	let configHash: string | undefined

	return {
		name: INTEGRATION_NAME,

		hooks: {
			'astro:config:setup': async ({ config, logger }) => {
				// Finish loading Zopfli only if needed
				if (explicitZopfli) {
					log(logger, options, 2, 'Loading Zopfli')
					zopfli = await zopfliPromise
				} else if (optionalZopfli) {
					zopfli = await zopfliPromise

					if (zopfli) {
						options.algorithms.gzip = {
							zopfli: DEFAULT_ZOPFLI_OPTIONS,
						}

						log(logger, options, 1, 'Zopfli detected; using Zopfli for Gzip compression')
					}
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

				await runBuild(fileURLToPath(dir), cacheDirectory, configHash, options, logger, zopfli)
			},
		},
	}
}
