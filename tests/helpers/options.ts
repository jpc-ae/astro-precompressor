import { constants } from 'node:zlib'
import type { BrotliOptions, ZlibOptions, ZstdOptions } from 'node:zlib'
import type { ResolvedOptions } from '../../src/types.js'

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends readonly unknown[]
		? T[K]
		: T[K] extends object
			? DeepPartial<T[K]>
			: T[K]
}

// Fast algorithm options for quick testing
export const fastGzip = {
	level: 1,
} as const satisfies ZlibOptions

export const fastBrotli = {
	params: {
		[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MIN_QUALITY,
	},
} as const satisfies BrotliOptions

export const fastZstd = {
	params: {
		[constants.ZSTD_c_compressionLevel]: 1,
	},
} as const satisfies ZstdOptions

const defaultOptions = {
	algorithms: {
		gzip: false,
		brotli: fastBrotli,
		zstd: false,
	},
	performance: {
		concurrency: 2,
		incremental: true,
		discardCompressionIfLarger: false,
	},
	cache: {
		prune: false,
	},
	filters: {
		minSize: 0,
		fileTypes: ['.html'],
		include: undefined,
		exclude: undefined,
	},
	filterWarnings: [],
	failOnError: false,
	logLevel: 2,
	recompressOnConfigChange: false,
} as const satisfies ResolvedOptions

/**
 * Creates a complete resolved-options fixture. Each nested section is merged
 * independently so tests only need to override the values relevant to them.
 */
export function createResolvedOptions(
	overrides: DeepPartial<ResolvedOptions> = {},
): ResolvedOptions {
	return {
		...defaultOptions,
		...overrides,
		algorithms: {
			...defaultOptions.algorithms,
			...overrides.algorithms,
		},
		performance: {
			...defaultOptions.performance,
			...overrides.performance,
		},
		cache: {
			...defaultOptions.cache,
			...overrides.cache,
		},
		filters: {
			...defaultOptions.filters,
			...overrides.filters,
		},
	}
}
