import { constants, gunzipSync, brotliDecompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ZLIB_OPTIONS, DEFAULT_ZOPFLI_OPTIONS, resolveGzipOptions, resolveZopfliOptions, createGzipCompressorFactory } from '../src/gzip.js'
import { DEFAULT_BROTLI_OPTIONS, resolveBrotliOptions, createBrotliCompressorFactory } from '../src/brotli.js'
import { resolveZstdOptions, toZstdNapiOptions, createZstdCompressorFactory } from '../src/zstd.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CompressorFactory } from '../src/types.js'

async function compress(factory: CompressorFactory) {
  const chunks: Buffer[] = []
  const sink = new (await import('node:stream')).Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
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
    expect(resolveZopfliOptions({ numiterations: 2 })).toEqual({ ...DEFAULT_ZOPFLI_OPTIONS, numiterations: 2 })
    expect(resolveZopfliOptions(false)).toBe(false)
    expect(resolveGzipOptions({ zopfli: false })).toEqual(DEFAULT_ZLIB_OPTIONS)
  })
  it('creates valid gzip streams with zlib when Zopfli is not requested', async () => {
    const factory = await createGzipCompressorFactory(DEFAULT_ZLIB_OPTIONS, false, false)
    expect(gunzipSync(await compress(factory)).toString()).toBe('test payload')
  })
})
describe('brotli options and compressor', () => {
  it('merges Brotli defaults and custom parameters', () => {
    expect(resolveBrotliOptions(false)).toBe(false)
    expect(resolveBrotliOptions(true)).toEqual(DEFAULT_BROTLI_OPTIONS)
    expect(resolveBrotliOptions({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).toEqual({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
  })
  it('creates valid Brotli streams', async () => {
    const compressed = await compress(createBrotliCompressorFactory())
    expect(brotliDecompressSync(compressed).toString()).toBe('test payload')
  })
})
describe('zstandard option conversion', () => {
  it('merges the default compression level', () => {
    expect(resolveZstdOptions(false)).toBe(false)
    expect(resolveZstdOptions(true)).toEqual({ params: { 100: 19 } })
    expect(resolveZstdOptions({ params: { 100: 5, 201: 1 } })).toEqual({ params: { 100: 5, 201: 1 } })
  })
  it('maps numeric parameters, strategies and booleans', () => {
    expect(toZstdNapiOptions({ params: { 100: 7, 107: 3, 160: 1, 201: 0 } })).toEqual({ compressionLevel: 7, strategy: 'greedy', enableLongDistanceMatching: true, checksumFlag: false })
  })
  it('rejects unsupported parameters, invalid strategies and booleans', () => {
    expect(() => toZstdNapiOptions({ params: { 999: 1 } })).toThrow('Unsupported Zstandard parameter')
    expect(() => toZstdNapiOptions({ params: { 107: 0 } })).toThrow('Invalid Zstandard strategy')
    expect(() => toZstdNapiOptions({ params: { 160: 2 } })).toThrow('Invalid boolean')
  })
  it('rejects unsupported zstd-napi flush and chunk options when native zstd is unavailable', async () => {
    const zlib = await import('node:zlib')
    if (typeof zlib.createZstdCompress === 'function') return
    await expect(createZstdCompressorFactory({ flush: 1 })).rejects.toThrow('flush modes')
    await expect(createZstdCompressorFactory({ finishFlush: 1 })).rejects.toThrow('finish flush modes')
    await expect(createZstdCompressorFactory({ chunkSize: 1024 })).rejects.toThrow('chunkSize')
  })
})

describe('gzip option edge cases', () => {
  it('accepts explicit false and merges custom Zopfli settings', () => {
    expect(resolveGzipOptions(false)).toBe(false)
    expect(resolveGzipOptions({ zopfli: { numiterations: 9 } })).toEqual({
      zopfli: { ...DEFAULT_ZOPFLI_OPTIONS, numiterations: 9 },
    })
    expect(resolveGzipOptions({ level: 0, memLevel: 1 })).toEqual({
      ...DEFAULT_ZLIB_OPTIONS, level: 0, memLevel: 1,
    })
  })
})

describe('complete Zstandard parameter mapping', () => {
  it('maps every supported numeric parameter to its napi property', () => {
    expect(toZstdNapiOptions({ params: {
      100: 4, 101: 10, 102: 11, 103: 12, 104: 13, 105: 3, 106: 64,
      107: 8, 160: 1, 161: 15, 162: 6, 163: 7, 164: 8,
      200: 1, 201: 0, 202: 1, 400: 2, 401: 1024, 402: 3,
    } })).toEqual({
      compressionLevel: 4, windowLog: 10, hashLog: 11, chainLog: 12,
      searchLog: 13, minMatch: 3, targetLength: 64, strategy: 'btultra',
      enableLongDistanceMatching: true, ldmHashLog: 15, ldmMinMatch: 6,
      ldmBucketSizeLog: 7, ldmHashRateLog: 8, contentSizeFlag: true,
      checksumFlag: false, dictIDFlag: true, nbWorkers: 2, jobSize: 1024,
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
