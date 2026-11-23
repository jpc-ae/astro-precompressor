// Astro
import type { AstroIntegrationLogger } from 'astro'
export type Logger = AstroIntegrationLogger
export type LogLevel = 0 | 1 | 2

// Algorithms
import type { SUPPORTED_ALGORITHMS } from './constants.js'
import type { Transform } from 'node:stream'
export type CompressionAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number]

// Zlib
import type { BrotliOptions, ZlibOptions, ZstdOptions } from 'node:zlib'

// Zopfli
export type ZopfliModule = typeof import('node-zopfli-es')
export type ZopfliOptions = import('node-zopfli-es').Options

// Algorithms
export interface AlgorithmOptions {
	gzip?: boolean | ZlibOptions | { zopfli: boolean | ZopfliOptions }
	brotli?: boolean | BrotliOptions
	zstd?: boolean | ZstdOptions
}

export interface ResolvedAlgorithmOptions {
	gzip: false | ZlibOptions | { zopfli: ZopfliOptions }
	brotli: false | BrotliOptions
	zstd: false | ZstdOptions
}

// Performance
export interface PerformanceOptions {
	concurrency: number
	incremental: boolean
	discardCompressionIfLarger: boolean
}

// Cache
export interface CacheOptions {
	prune: boolean
}

// Filters
export type GlobFilter =
	| string
	| {
			pattern: string
			algorithms: CompressionAlgorithm[]
	  }

export interface ResolvedGlobFilter {
	pattern: string
	match: (path: string) => boolean
	algorithms?: CompressionAlgorithm[]
}

export interface FilterOptions {
	minSize: number
	fileTypes: string[]
	include?: GlobFilter[]
	exclude?: GlobFilter[]
}

// Integration options
export interface CompressionOptions {
	algorithms?: AlgorithmOptions
	performance?: Partial<PerformanceOptions>
	cache?: Partial<CacheOptions>
	filters?: Partial<FilterOptions>
	failOnError?: boolean
	logLevel?: LogLevel
	recompressOnConfigChange?: boolean
}

export interface ResolvedOptions {
	algorithms: ResolvedAlgorithmOptions
	performance: PerformanceOptions
	cache: CacheOptions
	filters: FilterOptions
	filterWarnings: string[]
	failOnError: boolean
	logLevel: LogLevel
	recompressOnConfigChange: boolean
}

// Compression
export type CompressorFactory = () => Transform | Promise<Transform>

export interface Compressors {
	gzip?: CompressorFactory
	brotli?: CompressorFactory
	zstd?: CompressorFactory
}

export interface CacheManifest {
	version: number
	configHash: string | null
	entries: Record<string, string>
}

export interface CompressionResult {
	algorithm: CompressionAlgorithm
	elapsed: number
	size: number
	generated: boolean
	discarded: boolean
}

export interface FileResult {
	elapsed: number
	compressions: CompressionResult[]
}

export interface AlgorithmStats {
	generated: number
	bytes: number
	elapsed: number
	discarded: number
}

export interface BuildStats {
	files: number
	reusedFiles: number
	regeneratedFiles: number
	sourceBytes: number
	algorithms: Record<CompressionAlgorithm, AlgorithmStats>
	elapsed: number
	errors: Error[]
}
