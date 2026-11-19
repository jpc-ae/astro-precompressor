import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyCache, loadCache, saveCache, getArtifactPath, fileExists, copyPreservingTimestamps, pruneCache, removeDisabledArtifacts } from '../src/cache.js'

describe('cache helpers', () => {
  let root = ''
  afterEach(async () => { if (root) { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); root = '' } })
  it('creates the expected empty manifest', () => {
    expect(emptyCache()).toEqual({ version: 1, configHash: null, entries: {} })
  })
  it('loads valid manifests and filters invalid entry values', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const path = join(root, 'cache.json')
    await writeFile(path, JSON.stringify({ version: 1, configHash: 'abc', entries: { 'a.html': 'hash', bad: 3 } }))
    expect(await loadCache(path)).toEqual({ version: 1, configHash: 'abc', entries: { 'a.html': 'hash' } })
  })
  it.each(['{broken', JSON.stringify({ version: 99, entries: {} }), JSON.stringify({ version: 1, entries: [] })])('falls back to an empty cache for invalid manifest %s', async contents => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const path = join(root, 'cache.json')
    await writeFile(path, contents)
    expect(await loadCache(path)).toEqual(emptyCache())
  })
  it('returns an empty cache when the manifest is missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    expect(await loadCache(join(root, 'missing.json'))).toEqual(emptyCache())
  })
  it('saves manifests atomically and creates parent directories', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const path = join(root, 'nested', 'cache.json')
    const cache = { ...emptyCache(), entries: { 'index.html': 'abc' } }
    await saveCache(path, cache)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(cache)
    expect((await stat(join(root, 'nested'))).isDirectory()).toBe(true)
  })
  it('builds artifact paths and rejects traversal', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    expect(getArtifactPath(root, 'nested/index.html', '.gz')).toBe(join(root, 'nested', 'index.html.gz'))
    expect(() => getArtifactPath(root, '../outside', '.br')).toThrow('Invalid cache path')
  })
  it('checks file existence and copies while preserving timestamps', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const source = join(root, 'source.txt')
    const destination = join(root, 'nested', 'copy.txt')
    await writeFile(source, 'payload')
    const timestamp = new Date('2020-01-02T03:04:05Z')
    const { utimes } = await import('node:fs/promises')
    await utimes(source, timestamp, timestamp)
    expect(await fileExists(source)).toBe(true)
    expect(await fileExists(join(root, 'missing'))).toBe(false)
    await copyPreservingTimestamps(source, destination)
    expect(await readFile(destination, 'utf8')).toBe('payload')
    expect((await stat(destination)).mtime.getTime()).toBe((await stat(source)).mtime.getTime())
  })
  it('prunes stale entries and their compressed artifacts', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    const artifacts = join(root, 'artifacts')
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'keep.html.gz'), 'keep')
    await writeFile(join(artifacts, 'old.html.gz'), 'old')
    const cache = { ...emptyCache(), entries: { 'keep.html': 'a', 'old.html': 'b' } }
    expect(await pruneCache(cache, artifacts, new Set(['keep.html']))).toBe(1)
    expect(cache.entries).toEqual({ 'keep.html': 'a' })
    expect(await fileExists(join(artifacts, 'old.html.gz'))).toBe(false)
  })
  it('removes artifacts for disabled algorithms only', async () => {
    root = await mkdtemp(join(tmpdir(), 'precompressor-'))
    for (const extension of ['.gz', '.br', '.zst']) await writeFile(join(root, `page.html${extension}`), extension)
    await removeDisabledArtifacts('page.html', root, { gzip: false, brotli: {}, zstd: false } as never)
    expect(await fileExists(join(root, 'page.html.gz'))).toBe(false)
    expect(await fileExists(join(root, 'page.html.br'))).toBe(true)
    expect(await fileExists(join(root, 'page.html.zst'))).toBe(false)
  })
})
