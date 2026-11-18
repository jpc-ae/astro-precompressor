import * as zlib from 'node:zlib'

import { INTEGRATION_NAME } from './constants.js'

import type {
	AlgorithmOptions,
	CompressorFactory,
	ResolvedAlgorithmOptions,
	ZstdNapiOptions,
} from './types.js'

const ZSTD_C_COMPRESSION_LEVEL = 100

const DEFAULT_ZSTD_OPTIONS: zlib.ZstdOptions = {
	params: {
		[ZSTD_C_COMPRESSION_LEVEL]: 19,
	},
}

// -----------------------------------------------------------------------------
// Zstandard parameter IDs
// -----------------------------------------------------------------------------

const ZSTD_PARAMETER_MAP = {
	100: 'compressionLevel',
	101: 'windowLog',
	102: 'hashLog',
	103: 'chainLog',
	104: 'searchLog',
	105: 'minMatch',
	106: 'targetLength',
	107: 'strategy',
	160: 'enableLongDistanceMatching',
	161: 'ldmHashLog',
	162: 'ldmMinMatch',
	163: 'ldmBucketSizeLog',
	164: 'ldmHashRateLog',
	200: 'contentSizeFlag',
	201: 'checksumFlag',
	202: 'dictIDFlag',
	400: 'nbWorkers',
	401: 'jobSize',
	402: 'overlapLog',
} as const satisfies Record<number, keyof ZstdNapiOptions>

const ZSTD_STRATEGIES = [
	undefined,
	'fast',
	'dfast',
	'greedy',
	'lazy',
	'lazy2',
	'btlazy2',
	'btopt',
	'btultra',
	'btultra2',
] as const

const ZSTD_BOOLEAN_PARAMETERS = new Set([160, 200, 201, 202])

const DEFAULT_ZSTD_CHUNK_SIZE = 16 * 1024

const ZSTD_E_CONTINUE = 0
const ZSTD_E_END = 2

// -----------------------------------------------------------------------------
// Option resolution
// -----------------------------------------------------------------------------

export function resolveZstdOptions(
	value: AlgorithmOptions['zstd'],
): ResolvedAlgorithmOptions['zstd'] {
	if (!value) {
		return false
	}

	return {
		...DEFAULT_ZSTD_OPTIONS,
		...(typeof value === 'object' ? value : {}),
		params: {
			...DEFAULT_ZSTD_OPTIONS.params,
			...(typeof value === 'object' ? value.params : {}),
		},
	}
}

// -----------------------------------------------------------------------------
// zstd-napi compatibility
// -----------------------------------------------------------------------------

function checkZstdNapiCompatibility(options: zlib.ZstdOptions): void {
	if (options.flush !== undefined && options.flush !== ZSTD_E_CONTINUE) {
		throw new Error(
			`[${INTEGRATION_NAME}] The zstd-napi backend does not support custom Zstandard flush modes.`,
		)
	}

	if (options.finishFlush !== undefined && options.finishFlush !== ZSTD_E_END) {
		throw new Error(
			`[${INTEGRATION_NAME}] The zstd-napi backend does not support custom Zstandard finish flush modes.`,
		)
	}

	if (options.chunkSize !== undefined && options.chunkSize !== DEFAULT_ZSTD_CHUNK_SIZE) {
		throw new Error(
			`[${INTEGRATION_NAME}] The zstd-napi backend does not support a custom Zstandard chunkSize.`,
		)
	}
}

// -----------------------------------------------------------------------------
// Convert Node ZstdOptions to zstd-napi CompressParameters
// -----------------------------------------------------------------------------

export function toZstdNapiOptions(options: zlib.ZstdOptions): ZstdNapiOptions {
	const result: ZstdNapiOptions = {}

	for (const [key, value] of Object.entries(options.params ?? {})) {
		const id = Number(key)
		const property = ZSTD_PARAMETER_MAP[id as keyof typeof ZSTD_PARAMETER_MAP]

		if (!property) {
			throw new Error(`[${INTEGRATION_NAME}] Unsupported Zstandard parameter: ${key}`)
		}

		if (id === 107) {
			const strategy = ZSTD_STRATEGIES[Number(value)]

			if (!strategy) {
				throw new RangeError(`[${INTEGRATION_NAME}] Invalid Zstandard strategy: ${value}`)
			}

			result.strategy = strategy
		} else if (ZSTD_BOOLEAN_PARAMETERS.has(id)) {
			if (value !== 0 && value !== 1) {
				throw new RangeError(
					`[${INTEGRATION_NAME}] Invalid boolean Zstandard parameter value: ${value}`,
				)
			}

			Object.assign(result, { [property]: value === 1 })
		} else {
			Object.assign(result, { [property]: value })
		}
	}

	return result
}

// -----------------------------------------------------------------------------
// Backend factories
// -----------------------------------------------------------------------------

async function createZstdNapiFactory(options: zlib.ZstdOptions): Promise<CompressorFactory> {
	checkZstdNapiCompatibility(options)

	let zstdNapi: typeof import('zstd-napi')

	try {
		zstdNapi = await import('zstd-napi')
	} catch (error) {
		if (
			error instanceof Error &&
			(error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' &&
			error.message.includes("'zstd-napi'")
		) {
			throw new Error(
				`[${INTEGRATION_NAME}] Zstandard compression requires Node.js 22.15.0 or later, or the optional zstd-napi dependency.`,
				{ cause: error },
			)
		}

		throw error
	}

	const parameters = toZstdNapiOptions(options)

	return () => new zstdNapi.CompressStream(parameters)
}

// -----------------------------------------------------------------------------
// Public compressor factory
// -----------------------------------------------------------------------------

export async function createZstdCompressorFactory(
	options?: zlib.ZstdOptions,
): Promise<CompressorFactory> {
	const resolvedOptions = options ?? DEFAULT_ZSTD_OPTIONS

	if (typeof zlib.createZstdCompress === 'function') {
		return () => zlib.createZstdCompress(resolvedOptions)
	}

	return createZstdNapiFactory(resolvedOptions)
}
