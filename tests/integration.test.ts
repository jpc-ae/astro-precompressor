import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import precompressor from '../src/integration.js'
import { INTEGRATION_NAME } from '../src/constants.js'

describe('Astro integration', () => {
  it('exposes the expected integration name and lifecycle hooks', () => {
    const integration = precompressor({ algorithms: { gzip: true, brotli: false } })
    expect(integration.name).toBe(INTEGRATION_NAME)
    expect(integration.hooks).toHaveProperty('astro:config:setup')
    expect(integration.hooks).toHaveProperty('astro:build:done')
  })
  it('applies defaults and accepts valid overrides', () => {
    expect(() => precompressor()).not.toThrow()
    expect(() => precompressor({ algorithms: { gzip: false, brotli: true } })).not.toThrow()
    expect(() => precompressor({ performance: { concurrency: 2 }, filters: { minSize: 0, fileTypes: ['.HTML'] }, logLevel: 1 })).not.toThrow()
  })
  it('requires at least one enabled compression algorithm', () => {
    expect(() => precompressor({ algorithms: { gzip: false, brotli: false, zstd: false } })).toThrow('At least one compression algorithm')
  })
  it.each([0, -1, 1.5, Number.NaN])('validates concurrency %s', concurrency => {
    expect(() => precompressor({ performance: { concurrency } })).toThrow('concurrency must be a positive integer')
  })
  it('validates file types and minimum size', () => {
    expect(() => precompressor({ filters: { fileTypes: [] } })).toThrow('At least one file type')
    expect(() => precompressor({ filters: { fileTypes: ['bad/ext'] } })).toThrow('Invalid file extension')
    expect(() => precompressor({ filters: { minSize: -1 } })).toThrow('minSize must be a non-negative')
    expect(() => precompressor({ filters: { minSize: Number.NaN } })).toThrow('minSize must be a non-negative')
  })
  it.each([-1, 3, 1.5])('validates log level %s', logLevel => {
    expect(() => precompressor({ logLevel: logLevel as never })).toThrow('logLevel must be 0, 1, or 2')
  })
  it('initializes compressors and runs the build lifecycle', async () => {
    const integration = precompressor({ algorithms: { gzip: true, brotli: false } })
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), fork: () => ({ info: vi.fn() }) } as never
    const root = await mkdtemp(join(tmpdir(), 'astro-precompressor-integration-'))
    const cachePath = join(root, '.astro')
    const outputPath = join(root, 'dist')
    await mkdir(cachePath)
    await mkdir(outputPath)
    try {
      await integration.hooks['astro:config:setup']?.({ config: { cacheDir: pathToFileURL(`${cachePath}/`) }, logger } as never)
      await expect(integration.hooks['astro:build:done']?.({ dir: pathToFileURL(`${outputPath}/`), logger } as never)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('fails clearly if build completes before config setup', async () => {
    const integration = precompressor({ algorithms: { gzip: false, brotli: true } })
    const logger = { info: vi.fn(), error: vi.fn(), fork: () => logger } as never
    await expect(integration.hooks['astro:build:done']?.({ dir: new URL('../dist/', import.meta.url), logger } as never)).rejects.toThrow('not initialized correctly')
  })
})
