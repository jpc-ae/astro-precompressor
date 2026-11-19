import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressFile } from '../src/compression.js'
import { Semaphore } from '../src/semaphore.js'
import { resolveGzipOptions } from '../src/gzip.js'
import type { ResolvedOptions } from '../src/types.js'

describe('compressFile', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })
  async function setup() {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const output = join(root, 'dist')
    const artifacts = join(root, 'cache')
    const source = join(output, 'nested', 'index.html')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(output, 'nested'), { recursive: true })
    await writeFile(source, '<html>' + 'hello '.repeat(200) + '</html>')
    const options = {
      algorithms: { gzip: resolveGzipOptions(true), brotli: false, zstd: false },
      performance: { concurrency: 2, incremental: true, discardCompressionIfLarger: true },
      filters: { minSize: 0, fileTypes: ['.html'], pruneCache: true },
      logLevel: 0, failOnError: false, recompressOnConfigChange: false,
    } as ResolvedOptions
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() } as never
    const { createGzipCompressorFactory } = await import('../src/gzip.js')
    const factory = await createGzipCompressorFactory(resolveGzipOptions(true) as never, false, false)
    return { source, artifacts, options, logger, compressors: { gzip: factory } }
  }
  it('generates a valid sidecar and reports generation metadata', async () => {
    const context = await setup()
    const result = await compressFile(context.source, context.artifacts, 'nested/index.html', 'hash-a', undefined, false, context.options, context.logger, context.compressors, new Semaphore(1))
    expect(result.compressions).toHaveLength(1)
    expect(result.compressions[0]).toMatchObject({ algorithm: 'gzip', generated: true, discarded: false })
    expect(gunzipSync(await readFile(context.source + '.gz')).toString()).toContain('hello')
    expect((await stat(context.source + '.gz')).mtime.getTime()).toBe(
    (await stat(join(context.artifacts, 'nested/index.html.gz'))).mtime.getTime(),
  )
  })
  it('reuses cached artifacts when hashes match', async () => {
    const context = await setup()
    const first = await compressFile(context.source, context.artifacts, 'nested/index.html', 'same-hash', undefined, false, context.options, context.logger, context.compressors, new Semaphore(1))
    const second = await compressFile(context.source, context.artifacts, 'nested/index.html', 'same-hash', 'same-hash', false, context.options, context.logger, context.compressors, new Semaphore(1))
    expect(first.compressions[0].generated).toBe(true)
    expect(second.compressions[0]).toMatchObject({ generated: false, elapsed: 0 })
  })
  it('forces recompression when requested', async () => {
    const context = await setup()
    await compressFile(context.source, context.artifacts, 'nested/index.html', 'same', undefined, false, context.options, context.logger, context.compressors, new Semaphore(1))
    const result = await compressFile(context.source, context.artifacts, 'nested/index.html', 'same', 'same', true, context.options, context.logger, context.compressors, new Semaphore(1))
    expect(result.compressions[0].generated).toBe(true)
  })
  it('rejects when a configured compressor is missing', async () => {
    const context = await setup()
    await expect(compressFile(context.source, context.artifacts, 'nested/index.html', 'hash', undefined, false, context.options, context.logger, {}, new Semaphore(1))).rejects.toThrow('compressor could not be found')
  })
  it('rejects failed compressors without leaving temporary files', async () => {
    const context = await setup()
    const broken = { gzip: () => { throw new Error('compressor broke') } }
    await expect(compressFile(context.source, context.artifacts, 'nested/index.html', 'hash', undefined, false, context.options, context.logger, broken, new Semaphore(1))).rejects.toThrow('compressor broke')
  })
})
