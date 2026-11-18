import { createBrotliCompress, constants } from 'node:zlib'
import type { BrotliOptions } from 'node:zlib'

import type { AlgorithmOptions, ResolvedAlgorithmOptions, CompressorFactory } from './types.js'

export const DEFAULT_BROTLI_OPTIONS: BrotliOptions = {
	params: {
		[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
	},
}

export function resolveBrotliOptions(
	value: AlgorithmOptions['brotli'],
): ResolvedAlgorithmOptions['brotli'] {
	if (!value) {
		return false
	}

	return {
		...DEFAULT_BROTLI_OPTIONS,
		...(typeof value === 'object' ? value : {}),
		params: {
			...DEFAULT_BROTLI_OPTIONS.params,
			...(typeof value === 'object' ? value.params : {}),
		},
	}
}

export function createBrotliCompressorFactory(options?: BrotliOptions): CompressorFactory {
	return () => createBrotliCompress(options)
}
