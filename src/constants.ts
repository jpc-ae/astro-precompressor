import { availableParallelism } from 'node:os'

import type { CompressionAlgorithm, ZopfliOptions } from './types.js'

export const PLUGIN_NAME = 'astro-precompressor'

export const CACHE_VERSION = 3

export const DEFAULT_FILE_TYPES = [
	'.html',
	'.css',
	'.js',
	'.cjs',
	'.mjs',
	'.svg',
	'.json',
	'.txt',
	'.xml',
]

export const DEFAULT_ALGORITHMS: CompressionAlgorithm[] = ['brotli', 'gzip']

export const DEFAULT_ZOPFLI_OPTIONS: ZopfliOptions = {
	numiterations: 5,
	blocksplitting: false,
}

export const DEFAULT_CONCURRENCY = Math.max(1, Math.floor(availableParallelism() / 2))
