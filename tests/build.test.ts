import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuild } from '../src/build.js'
import { createBrotliCompressorFactory } from '../src/brotli.js'
import type { Logger, ResolvedOptions } from '../src/types.js'

const options = (overrides: Partial<ResolvedOptions> = {}): ResolvedOptions => ({
  algorithms: { gzip: false, brotli: { params: {} }, zstd: false },
  performance: { concurrency: 2, incremental: true, discardCompressionIfLarger: false },
  filters: { minSize: 0, fileTypes: ['.html'], pruneCache: true },
  failOnError: false,
  logLevel: 0,
  recompressOnConfigChange: false,
  ...overrides,
})

function createLogger(): Logger {
  return {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fork: vi.fn(() => createLogger()),
  } as unknown as Logger
}

describe('runBuild', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(join(tmpdir(), 'precompressor-build-'))
    const output = join(root, 'dist')
    const cache = join(root, 'cache')
    await mkdir(join(output, 'nested'), { recursive: true })
    return { output, cache }
  }

  it('compresses eligible files, skips unsupported and undersized files, and respects include/exclude filters', async () => {
    const { output, cache } = await setup()
    await writeFile(join(output, 'index.html'), '<html>home page content</html>')
    await writeFile(join(output, 'nested', 'about.html'), '<html>about page content</html>')
    await writeFile(join(output, 'nested', 'skip.html'), '<html>excluded page content</html>')
    await writeFile(join(output, 'asset.css'), 'body{}')
    await writeFile(join(output, 'tiny.html'), 'x')
    const logger = createLogger()
    await runBuild(output, cache, 'config-a', options({
      filters: { minSize: 5, fileTypes: ['.html'], include: ['**/*.html'], exclude: ['nested/skip.html'], pruneCache: true },
    }), logger, { brotli: createBrotliCompressorFactory() })

    expect(brotliDecompressSync(await readFile(join(output, 'index.html.br'))).toString()).toContain('home page')
    expect(brotliDecompressSync(await readFile(join(output, 'nested', 'about.html.br'))).toString()).toContain('about page')
    await expect(readFile(join(output, 'nested', 'skip.html.br'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(output, 'asset.css.br'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(output, 'tiny.html.br'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not follow symbolic links during discovery', async () => {
    const { output, cache } = await setup()
    const outside = join(root, 'outside.html')
    await writeFile(outside, '<html>outside target</html>')
    await symlink(outside, join(output, 'linked.html'))
    await runBuild(output, cache, 'config-a', options(), createLogger(), { brotli: createBrotliCompressorFactory() })
    await expect(readFile(join(output, 'linked.html.br'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses cached artifacts on a subsequent incremental build', async () => {
    const { output, cache } = await setup()
    await writeFile(join(output, 'index.html'), '<html>cache reuse test</html>')
    const logger = createLogger()
    const compressors = { brotli: createBrotliCompressorFactory() }
    await runBuild(output, cache, 'config-a', options(), logger, compressors)
    await rm(join(output, 'index.html.br'))
    await runBuild(output, cache, 'config-a', options(), logger, compressors)
    expect(brotliDecompressSync(await readFile(join(output, 'index.html.br'))).toString()).toContain('cache reuse')
  })

  it('throws a summarized error when failOnError is enabled and a compressor is missing', async () => {
    const { output, cache } = await setup()
    await writeFile(join(output, 'index.html'), '<html>failure path</html>')
    await expect(runBuild(output, cache, 'config-a', options({ failOnError: true }), createLogger(), {}))
      .rejects.toThrow('Compression failed for 1 operation')
  })

  it('rejects a build with no enabled algorithms', async () => {
    const { output, cache } = await setup()
    await expect(runBuild(output, cache, 'config-a', options({ algorithms: { gzip: false, brotli: false, zstd: false } }), createLogger(), {}))
      .rejects.toThrow('no eligible algorithms')
  })
})
