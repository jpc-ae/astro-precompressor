import * as zlib from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
	DEFAULT_ZLIB_OPTIONS,
	DEFAULT_ZOPFLI_OPTIONS,
	resolveGzipOptions,
	resolveZopfliOptions,
	createGzipCompressorFactory,
	importZopfli,
} from '../src/gzip.js'
import {
	DEFAULT_BROTLI_OPTIONS,
	resolveBrotliOptions,
	createBrotliCompressorFactory,
} from '../src/brotli.js'
import {
	resolveZstdOptions,
	toZstdNapiOptions,
	createZstdCompressorFactory,
	DEFAULT_ZSTD_OPTIONS,
} from '../src/zstd.js'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CompressorFactory } from '../src/types.js'
import { createNodeError } from './helpers/errors.js'
import { fastGzip, fastZstd } from './helpers/options.js'

const { constants, gunzipSync, brotliDecompressSync, zstdDecompressSync } = zlib

async function compress(factory: CompressorFactory) {
	const chunks: Buffer[] = []

	const sink = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(Buffer.from(chunk))
			callback()
		},
	})

	await pipeline(Readable.from(['test payload']), await factory(), sink)

	return Buffer.concat(chunks)
}

describe('gzip options and compressor', () => {
	it('uses maximum-compression zlib defaults and merges overrides', () => {
		expect(DEFAULT_ZLIB_OPTIONS.level).toBe(constants.Z_BEST_COMPRESSION)
		expect(resolveGzipOptions(true)).toEqual(DEFAULT_ZLIB_OPTIONS)
		expect(resolveGzipOptions({ level: 1 })).toEqual({ ...DEFAULT_ZLIB_OPTIONS, level: 1 })
		expect(resolveGzipOptions(false)).toBe(false)
	})

	it('resolves Zopfli defaults and custom options', () => {
		expect(resolveZopfliOptions(true)).toEqual(DEFAULT_ZOPFLI_OPTIONS)
		expect(resolveZopfliOptions({ numiterations: 2 })).toEqual({
			...DEFAULT_ZOPFLI_OPTIONS,
			numiterations: 2,
		})
		expect(resolveZopfliOptions(false)).toBe(false)
		expect(resolveGzipOptions({ zopfli: false })).toEqual(DEFAULT_ZLIB_OPTIONS)
	})

	it('creates valid gzip streams with zlib when Zopfli is not requested', async () => {
		const factory = await createGzipCompressorFactory(
			fastGzip,
			false,
			false,
		)
		const stream = await factory()
		expect(stream).toBeInstanceOf(zlib.Gzip)
		stream.destroy()
		
		expect(gunzipSync(await compress(factory)).toString()).toBe('test payload')
	})

	it('creates valid gzip streams with zopfli when not disabled', async () => {
		const zopfliImporter = vi.fn(importZopfli)
		const factory = await createGzipCompressorFactory({}, false, true, zopfliImporter)
		expect(gunzipSync(await compress(factory)).toString()).toBe('test payload')
		expect(zopfliImporter).toHaveBeenCalled()
	})

	it('falls back to native gzip when optional Zopfli is missing', async () => {
		const missingPackage = createNodeError("'node-zopfli-es'", 'ERR_MODULE_NOT_FOUND')
		const zopfliImporter = vi.fn(async () => {
			throw missingPackage
		})

		const factory = await createGzipCompressorFactory({}, false, true, zopfliImporter)
		expect(zopfliImporter).toHaveBeenCalledOnce()

		const stream = await factory()
		expect(stream).toBeInstanceOf(zlib.Gzip)
		stream.destroy()

		const compressed = await compress(factory)
		expect(gunzipSync(compressed).toString()).toBe('test payload')
	})

	it('throws when Zopfli is explicitly requested but not available', async () => {
		const nodeError = createNodeError("'node-zopfli-es'", 'ERR_MODULE_NOT_FOUND')
		const zopfliImporter = async () => {
			throw nodeError
		}
		const factoryPromise = createGzipCompressorFactory({ zopfli: DEFAULT_ZOPFLI_OPTIONS }, true, false, zopfliImporter)
		await expect(factoryPromise).rejects.toThrow(
			'The "node-zopfli-es" package is required when Zopfli is explicitly enabled. Install it with: pnpm add -D node-zopfli-es',
		)
	})

	it('throws when zopfli is optionally imported but broken', async () => {
		const nodeError = createNodeError("'node-zopfli-es'", 'ERR_INVALID_PACKAGE_CONFIG')
		const zopfliImporter = async () => {
			throw nodeError
		}
		const factoryPromise = createGzipCompressorFactory({}, false, true, zopfliImporter)
		await expect(factoryPromise).rejects.toThrow(
			nodeError,
		)
	})
})

describe('brotli options and compressor', () => {
	it('uses maximum-quality brotli defaults and merges nested overrides', () => {
		expect(DEFAULT_BROTLI_OPTIONS.params[constants.BROTLI_PARAM_QUALITY]).toBe(
			constants.BROTLI_MAX_QUALITY,
		)
		expect(resolveBrotliOptions(false)).toBe(false)
		expect(resolveBrotliOptions(true)).toEqual(DEFAULT_BROTLI_OPTIONS)
		expect(resolveBrotliOptions({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).toEqual({
			params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
		})
	})

	it('creates valid Brotli streams', async () => {
		const compressed = await compress(createBrotliCompressorFactory())
		expect(brotliDecompressSync(compressed).toString()).toBe('test payload')
	})
})

describe('zstandard option conversion', () => {
	it('merges the default compression level', () => {
		expect(DEFAULT_ZSTD_OPTIONS.params[constants.ZSTD_c_compressionLevel]).toBe(19)
		expect(resolveZstdOptions(false)).toBe(false)
		expect(resolveZstdOptions(true)).toEqual(DEFAULT_ZSTD_OPTIONS)
		expect(resolveZstdOptions({ params: { [constants.ZSTD_c_checksumFlag]: 1 } })).toEqual({
			params: {
				...DEFAULT_ZSTD_OPTIONS.params,
				[constants.ZSTD_c_checksumFlag]: 1,
			},
		})
	})

	it('maps numeric parameters, strategies and booleans to fallback engine', () => {
		expect(
			toZstdNapiOptions({
				params: {
					[constants.ZSTD_c_compressionLevel]: 7,
					[constants.ZSTD_c_strategy]: constants.ZSTD_greedy,
					[constants.ZSTD_c_enableLongDistanceMatching]: 1,
					[constants.ZSTD_c_checksumFlag]: 0,
				},
			}),
		).toEqual({
			compressionLevel: 7,
			strategy: 'greedy',
			enableLongDistanceMatching: true,
			checksumFlag: false,
		})
	})

	it('rejects unsupported parameters, invalid strategies and booleans', () => {
		expect(() => toZstdNapiOptions({ params: { 999: 1 } })).toThrow(
			'Unsupported Zstandard parameter',
		)
		expect(() =>
			toZstdNapiOptions({
				params: {
					[constants.ZSTD_c_strategy]: 0,
				},
			}),
		).toThrow('Invalid Zstandard strategy')
		expect(() =>
			toZstdNapiOptions({
				params: {
					[constants.ZSTD_c_enableLongDistanceMatching]: 2,
				},
			}),
		).toThrow('Invalid boolean')
	})

	it('rejects unsupported zstd-napi flush and chunk options when native zstd is unavailable', async () => {
		await expect(
			createZstdCompressorFactory(
				{
					flush: 1,
				},
				null,
			),
		).rejects.toThrow('flush modes')
		await expect(
			createZstdCompressorFactory(
				{
					finishFlush: 1,
				},
				null,
			),
		).rejects.toThrow('finish flush modes')
		await expect(
			createZstdCompressorFactory(
				{
					chunkSize: 1024,
				},
				null,
			),
		).rejects.toThrow('chunkSize')
	})

	it('creates a valid Zstandard stream through the zstd-napi fallback', async () => {
		// Passing null disables Node's native factory and forces the fallback.
		const factory = await createZstdCompressorFactory(fastZstd, null)

		const compressed = await compress(factory)

		expect(zstdDecompressSync(compressed).toString()).toBe('test payload')
	})
})

describe('gzip option edge cases', () => {
	it('accepts explicit false and merges custom Zopfli settings', () => {
		expect(resolveGzipOptions(false)).toBe(false)
		expect(resolveGzipOptions({ zopfli: { numiterations: 9 } })).toEqual({
			zopfli: { ...DEFAULT_ZOPFLI_OPTIONS, numiterations: 9 },
		})
		expect(resolveGzipOptions({ level: 0, memLevel: 1 })).toEqual({
			...DEFAULT_ZLIB_OPTIONS,
			level: 0,
			memLevel: 1,
		})
	})
})

describe('complete Zstandard parameter mapping', () => {
	it('maps every supported numeric parameter to its napi property', () => {
		expect(
			toZstdNapiOptions({
				params: {
					100: 4,
					101: 10,
					102: 11,
					103: 12,
					104: 13,
					105: 3,
					106: 64,
					107: 8,
					160: 1,
					161: 15,
					162: 6,
					163: 7,
					164: 8,
					200: 1,
					201: 0,
					202: 1,
					400: 2,
					401: 1024,
					402: 3,
				},
			}),
		).toEqual({
			compressionLevel: 4,
			windowLog: 10,
			hashLog: 11,
			chainLog: 12,
			searchLog: 13,
			minMatch: 3,
			targetLength: 64,
			strategy: 'btultra',
			enableLongDistanceMatching: true,
			ldmHashLog: 15,
			ldmMinMatch: 6,
			ldmBucketSizeLog: 7,
			ldmHashRateLog: 8,
			contentSizeFlag: true,
			checksumFlag: false,
			dictIDFlag: true,
			nbWorkers: 2,
			jobSize: 1024,
			overlapLog: 3,
		})
	})

	it.each([160, 200, 201, 202])('rejects non-boolean values for boolean parameter %i', id => {
		expect(() => toZstdNapiOptions({ params: { [id]: 2 } })).toThrow('Invalid boolean')
	})

	it('rejects a strategy outside the supported range', () => {
		expect(() => toZstdNapiOptions({ params: { 107: 10 } })).toThrow('Invalid Zstandard strategy')
	})

	it('merges user parameters over the default compression level', () => {
		expect(resolveZstdOptions({ params: { 201: 1 } })).toEqual({ params: { 100: 19, 201: 1 } })
	})
})
