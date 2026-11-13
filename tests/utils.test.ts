import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
	formatBytes,
	formatDuration,
	hashFile,
	isInsideDirectory,
	normalizeExtensions,
	resolveInsideDirectory,
	sha256,
	toCacheKey,
	createConfigHash,
} from '../src/utils.js'

import { createOptions } from './helpers.js'

describe('normalizeExtensions', () => {
	it('normalizes extensions', () => {
		expect(normalizeExtensions(['html', '.CSS', ' Js '])).toEqual(['.html', '.css', '.js'])
	})

	it('removes duplicate extensions', () => {
		expect(normalizeExtensions(['html', '.HTML', 'html'])).toEqual(['.html'])
	})

	it.each(['', '.', '../html', 'html/css', 'html css', 'html.'])(
		'rejects invalid extension %j',
		extension => {
			expect(() => normalizeExtensions([extension])).toThrow(
				`Invalid file extension: "${extension}".`,
			)
		},
	)
})

describe('path utilities', () => {
	const directory = resolve('/tmp/precompressor')

	it('identifies files inside a directory', () => {
		expect(isInsideDirectory(directory, join(directory, 'index.html'))).toBe(true)
	})

	it('allows child paths beginning with two dots', () => {
		expect(isInsideDirectory(directory, join(directory, '..hidden', 'file.html'))).toBe(true)
	})

	it('rejects the directory itself', () => {
		expect(isInsideDirectory(directory, directory)).toBe(false)
	})

	it('rejects parent paths', () => {
		expect(isInsideDirectory(directory, resolve(directory, '..', 'outside.html'))).toBe(false)
	})

	it('rejects paths outside the directory', () => {
		expect(isInsideDirectory(directory, '/tmp/other/file.html')).toBe(false)
	})

	it('resolves a relative cache path', () => {
		expect(resolveInsideDirectory(directory, 'assets/index.html')).toBe(
			join(directory, 'assets/index.html'),
		)
	})

	it('rejects path traversal', () => {
		expect(() => resolveInsideDirectory(directory, '../outside.html')).toThrow('Invalid cache path')
	})

	it('rejects absolute paths', () => {
		expect(() => resolveInsideDirectory(directory, '/tmp/outside.html')).toThrow(
			'Invalid cache path',
		)
	})

	it('creates normalized cache keys', () => {
		expect(toCacheKey('/output', join('/output', 'assets', 'index.html'))).toBe('assets/index.html')
	})
})

describe('hashing', () => {
	let directory: string

	afterEach(async () => {
		if (directory) {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it('creates a SHA-256 hash', () => {
		expect(sha256('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
	})

	it('hashes file contents', async () => {
		directory = await mkdtemp(join(tmpdir(), 'precompressor-utils-'))

		const filePath = join(directory, 'file.txt')
		await writeFile(filePath, 'test')

		expect(await hashFile(filePath)).toBe(sha256('test'))
	})

	it('rejects when the file cannot be read', async () => {
		directory = await mkdtemp(join(tmpdir(), 'precompressor-utils-'))

		await expect(hashFile(join(directory, 'missing.txt'))).rejects.toThrow()
	})
})

describe('formatters', () => {
	it.each([
		[0, '0 B'],
		[512, '512 B'],
		[1024, '1.00 KiB'],
		[1024 * 1024, '1.00 MiB'],
	])('formats %i bytes', (bytes, expected) => {
		expect(formatBytes(bytes)).toBe(expected)
	})

	it.each([
		[0, '0ms'],
		[999, '999ms'],
		[1000, '1.00s'],
		[2500, '2.50s'],
	])('formats %i milliseconds', (duration, expected) => {
		expect(formatDuration(duration)).toBe(expected)
	})
})

describe('createConfigHash', () => {
	it('returns the same hash for equivalent configuration objects', () => {
		const options = createOptions()

		const first = createConfigHash({ output: 'dist', build: { format: 'directory' } }, options)

		const second = createConfigHash({ build: { format: 'directory' }, output: 'dist' }, options)

		expect(first).toBe(second)
	})

	it('changes when the Astro configuration changes', () => {
		const options = createOptions()

		const first = createConfigHash({ output: 'dist' }, options)
		const second = createConfigHash({ output: 'build' }, options)

		expect(first).not.toBe(second)
	})

	it('changes when compression options change', () => {
		const first = createConfigHash({}, createOptions())

		const second = createConfigHash(
			{},
			createOptions({
				algorithms: {
					gzip: { level: 1 },
					brotli: false,
					zstd: false,
				},
			}),
		)

		expect(first).not.toBe(second)
	})
})
