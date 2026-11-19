import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	getPackageManager,
	sha256,
	hashFile,
	normalizeExtensions,
	toCacheKey,
	isInsideDirectory,
	resolveInsideDirectory,
	formatBytes,
	formatDuration,
	createConfigHash,
	log,
	logError,
} from '../src/utils.js'
import type { Logger } from '../src/types.js'

describe('utility functions', () => {
	let directory = ''
	afterEach(async () => {
		if (directory) await rm(directory, { recursive: true, force: true })
		directory = ''
	})
	it('reads the package manager from the user agent', () => {
		vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0 node/v20')
		expect(getPackageManager()).toBe('pnpm')
		vi.stubEnv('npm_config_user_agent', '')
		expect(getPackageManager()).toBe('')
		vi.unstubAllEnvs()
	})
	it('hashes strings and file contents with SHA-256', async () => {
		expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
		directory = await mkdtemp(join(tmpdir(), 'precompressor-'))
		const file = join(directory, 'data.txt')
		await writeFile(file, 'hello')
		expect(await hashFile(file)).toBe(sha256('hello'))
	})
	it('normalizes, trims, lowercases and de-duplicates extensions', () => {
		expect(normalizeExtensions([' HTML ', '.Css', 'html', 'x-y', 'x_y'])).toEqual([
			'.html',
			'.css',
			'.x-y',
			'.x_y',
		])
	})
	it.each(['', '.', '..', 'a/b', 'a\\b'])('rejects invalid extension %j', extension => {
		expect(() => normalizeExtensions([extension])).toThrow('Invalid file extension')
	})
	it('accepts whitespace around an extension', () => {
		expect(normalizeExtensions([' space '])).toEqual(['.space'])
	})
	it('creates portable cache keys', () => {
		expect(toCacheKey(resolve('/site/dist'), resolve('/site/dist/nested/index.html'))).toBe(
			'nested/index.html',
		)
	})
	it('checks containment and rejects traversal paths', () => {
		const root = resolve('/tmp/cache')
		expect(isInsideDirectory(root, join(root, 'a.txt'))).toBe(true)
		expect(isInsideDirectory(root, root)).toBe(false)
		expect(isInsideDirectory(root, resolve('/tmp/cache-other/a'))).toBe(false)
		expect(resolveInsideDirectory(root, 'nested/a.txt')).toBe(join(root, 'nested/a.txt'))
		expect(() => resolveInsideDirectory(root, '../escape')).toThrow('Invalid cache path')
		expect(() => resolveInsideDirectory(root, resolve('/etc/passwd'))).toThrow('Invalid cache path')
	})
	it('formats byte counts and durations', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(1023)).toBe('1023 B')
		expect(formatBytes(1024)).toBe('1.00 KiB')
		expect(formatBytes(1024 ** 2)).toBe('1.00 MiB')
		expect(formatBytes(1024 ** 3)).toBe('1.00 GiB')
		expect(formatDuration(12.4)).toBe('12ms')
		expect(formatDuration(1000)).toBe('1.00s')
	})
	it('creates stable configuration hashes independent of object key order', () => {
		const options = { algorithms: { gzip: true, brotli: false, zstd: false } } as never
		expect(createConfigHash({ a: 1, b: 2 }, options)).toBe(
			createConfigHash({ b: 2, a: 1 }, options),
		)
		expect(createConfigHash({ a: 1 }, options)).not.toBe(createConfigHash({ a: 2 }, options))
	})
	it('honors log levels and converts unknown errors to strings', () => {
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			error: vi.fn(),
		} as unknown as Logger
		log(logger, { logLevel: 1 } as never, 2, 'hidden')
		log(logger, { logLevel: 1 } as never, 1, 'shown')
		logError(logger, new Error('broken'))
		logError(logger, 'unknown')
		expect(logger.info).toHaveBeenCalledWith('shown')
		expect(logger.debug).not.toHaveBeenCalled()
		expect(logger.error).toHaveBeenNthCalledWith(1, 'broken')
		expect(logger.error).toHaveBeenNthCalledWith(2, 'unknown')
	})
})

describe('additional utility edge cases', () => {
	it('formats values across all byte and duration unit boundaries', () => {
		expect(formatBytes(1024 ** 2 - 1)).toBe('1024.00 KiB')
		expect(formatBytes(1024 ** 4)).toBe('1024.00 GiB')
		expect(formatDuration(999.6)).toBe('1000ms')
		expect(formatDuration(1500)).toBe('1.50s')
	})

	it('rejects paths that resolve to the directory itself or escape via traversal', () => {
		const root = resolve('/tmp/precompressor-cache')
		expect(() => resolveInsideDirectory(root, '.')).toThrow('Invalid cache path')
		expect(() => resolveInsideDirectory(root, 'nested/../../outside')).toThrow('Invalid cache path')
		expect(isInsideDirectory(root, resolve(root, 'nested/file'))).toBe(true)
		expect(isInsideDirectory(root, resolve(root, '..'))).toBe(false)
	})

	it('hashes missing files by rejecting with the filesystem error', async () => {
		await expect(
			hashFile(join(tmpdir(), 'precompressor-file-that-does-not-exist')),
		).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('includes algorithm options in configuration fingerprints', () => {
		const base = { algorithms: { gzip: true, brotli: false, zstd: false } } as never
		const changed = { algorithms: { gzip: { level: 1 }, brotli: false, zstd: false } } as never
		expect(createConfigHash({}, base)).not.toBe(createConfigHash({}, changed))
	})

	it('serializes dates, URLs, regular expressions, buffers, maps, sets, bigints and circular references', () => {
		const circular: Record<string, unknown> = { date: new Date('2020-01-01T00:00:00.000Z') }
		circular.self = circular
		const config = {
			url: new URL('https://example.com/path'),
			regexp: /hello/gi,
			buffer: Buffer.from('data'),
			map: new Map([
				['b', 2],
				['a', 1],
			]),
			set: new Set([3, 1, 2]),
			bigint: 123n,
			circular,
			throwing: Object.defineProperty({}, 'value', {
				enumerable: true,
				get() {
					throw new Error('no access')
				},
			}),
		}
		const options = { algorithms: { gzip: true } } as never
		expect(() => createConfigHash(config, options)).not.toThrow()
		expect(createConfigHash(config, options)).toMatch(/^[a-f0-9]{64}$/)
	})

	it('routes log levels to the correct logger method and writes headers', async () => {
		const { logHeader } = await import('../src/utils.js')
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			error: vi.fn(),
		} as unknown as Logger
		log(logger, { logLevel: 2 } as never, 2, 'debug message')
		log(logger, { logLevel: 0 } as never, 1, 'suppressed')
		expect(logger.debug).toHaveBeenCalledWith('debug message')
		expect(logger.info).not.toHaveBeenCalled()
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		logHeader('test header')
		expect(spy).toHaveBeenCalledOnce()
		spy.mockRestore()
	})
})
