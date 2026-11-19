import { PassThrough } from 'node:stream'
import { vi } from 'vitest'
import type { CompressorFactory, Compressors } from '../../src/types.js'

export function createPassThroughCompressor(): ReturnType<CompressorFactory> {
	return new PassThrough()
}

export function createMockCompressors(
	overrides: Partial<Compressors> = {},
): Compressors {
	return {
		gzip: vi.fn<CompressorFactory>(createPassThroughCompressor),
		brotli: vi.fn<CompressorFactory>(createPassThroughCompressor),
		zstd: vi.fn<CompressorFactory>(createPassThroughCompressor),
		...overrides,
	}
}

export function createFailingCompressorFactory(message = 'compression failed'): CompressorFactory {
	return () => {
		throw new Error(message)
	}
}
