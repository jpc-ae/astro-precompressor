import { readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
	copyPreservingTimestamps,
	emptyCache,
	fileExists,
	getArtifactPath,
	loadCache,
	pruneCache,
	removeDisabledArtifacts,
	saveCache,
} from '../src/cache.js'

import { ALGORITHM_EXTENSIONS, CACHE_VERSION } from '../src/constants.js'
import { createFile, createTempDirectory, removeTempDirectory } from './helpers.js'

describe('cache manifest', () => {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	it('creates an empty cache', () => {
		expect(emptyCache()).toEqual({
			version: CACHE_VERSION,
			configHash: null,
			entries: {},
		})
	})

	it('loads a valid manifest', async () => {
		directory = await createTempDirectory()

		const manifestPath = join(directory, 'cache.json')

		await writeFile(
			manifestPath,
			JSON.stringify({
				version: CACHE_VERSION,
				configHash: 'config-hash',
				entries: {
					'index.html': 'file-hash',
				},
			}),
		)

		await expect(loadCache(manifestPath)).resolves.toEqual({
			version: CACHE_VERSION,
			configHash: 'config-hash',
			entries: {
				'index.html': 'file-hash',
			},
		})
	})

	it('ignores entries with non-string values', async () => {
		directory = await createTempDirectory()

		const manifestPath = join(directory, 'cache.json')

		await writeFile(
			manifestPath,
			JSON.stringify({
				version: CACHE_VERSION,
				configHash: null,
				entries: {
					valid: 'hash',
					invalid: 123,
				},
			}),
		)

		const cache = await loadCache(manifestPath)

		expect(cache.entries).toEqual({
			valid: 'hash',
		})
	})

	it('returns an empty cache for an unsupported version', async () => {
		directory = await createTempDirectory()

		const manifestPath = join(directory, 'cache.json')

		await writeFile(
			manifestPath,
			JSON.stringify({
				version: CACHE_VERSION + 1,
				entries: {},
			}),
		)

		expect(await loadCache(manifestPath)).toEqual(emptyCache())
	})

	it('returns an empty cache for malformed JSON', async () => {
		directory = await createTempDirectory()

		const manifestPath = join(directory, 'cache.json')
		await writeFile(manifestPath, '{invalid json')

		expect(await loadCache(manifestPath)).toEqual(emptyCache())
	})

	it('returns an empty cache when the manifest does not exist', async () => {
		directory = await createTempDirectory()

		expect(await loadCache(join(directory, 'missing.json'))).toEqual(emptyCache())
	})

	it('saves and reloads a manifest', async () => {
		directory = await createTempDirectory()

		const manifestPath = join(directory, 'nested', 'cache.json')

		const cache = {
			version: CACHE_VERSION,
			configHash: 'config-hash',
			entries: {
				'index.html': 'file-hash',
			},
		}

		await saveCache(manifestPath, cache)

		expect(await loadCache(manifestPath)).toEqual(cache)
		expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(cache)
	})
})

describe('artifact paths', () => {
	it('creates an artifact path with the algorithm extension', () => {
		expect(getArtifactPath('/cache/artifacts', 'assets/index.html', '.gz')).toBe(
			join('/cache/artifacts', 'assets', 'index.html.gz'),
		)
	})

	it('rejects paths outside the artifact directory', () => {
		expect(() => getArtifactPath('/cache/artifacts', '../outside.html', '.gz')).toThrow(
			'Invalid cache path',
		)
	})

	it('checks whether a file exists', async () => {
		const directory = await createTempDirectory()

		try {
			const filePath = await createFile(directory, 'artifact.gz')

			expect(await fileExists(filePath)).toBe(true)
			expect(await fileExists(join(directory, 'missing.gz'))).toBe(false)
		} finally {
			await removeTempDirectory(directory)
		}
	})

	it('returns false for a directory', async () => {
		const directory = await createTempDirectory()

		try {
			expect(await fileExists(directory)).toBe(false)
		} finally {
			await removeTempDirectory(directory)
		}
	})
})

describe('copyPreservingTimestamps', () => {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	it('copies the file and preserves its timestamps', async () => {
		directory = await createTempDirectory()

		const source = await createFile(directory, 'cache/file.gz', 'compressed data')
		const destination = join(directory, 'output/file.gz')

		const timestamp = new Date('2020-01-01T12:00:00.000Z')

		await utimes(source, timestamp, timestamp)

		await copyPreservingTimestamps(source, destination)

		const sourceStats = await stat(source)
		const destinationStats = await stat(destination)

		expect(await readFile(destination, 'utf8')).toBe('compressed data')
		expect(destinationStats.mtimeMs).toBe(sourceStats.mtimeMs)
	})

	it('does not change the source artifact timestamp', async () => {
		directory = await createTempDirectory()

		const source = await createFile(directory, 'cache/file.gz')
		const destination = join(directory, 'output/file.gz')

		const timestamp = new Date('2020-01-01T12:00:00.000Z')
		await utimes(source, timestamp, timestamp)

		await copyPreservingTimestamps(source, destination)

		expect((await stat(source)).mtimeMs).toBe(timestamp.getTime())
	})

	it('rejects when the source file does not exist', async () => {
		directory = await createTempDirectory()

		await expect(
			copyPreservingTimestamps(join(directory, 'missing.gz'), join(directory, 'output.gz')),
		).rejects.toThrow()
	})
})

describe('pruneCache', () => {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	it('removes stale artifacts and their manifest entries', async () => {
		directory = await createTempDirectory()

		const artifactDirectory = join(directory, 'artifacts')

		const retainedKey = 'retained/index.html'
		const staleKey = 'removed/index.html'

		for (const extension of Object.values(ALGORITHM_EXTENSIONS)) {
			await createFile(artifactDirectory, `${retainedKey}${extension}`)
			await createFile(artifactDirectory, `${staleKey}${extension}`)
		}

		const cache = {
			version: CACHE_VERSION,
			configHash: null,
			entries: {
				[retainedKey]: 'retained-hash',
				[staleKey]: 'stale-hash',
			},
		}

		const removed = await pruneCache(cache, artifactDirectory, new Set([retainedKey]))

		expect(removed).toBe(1)
		expect(cache.entries).toEqual({
			[retainedKey]: 'retained-hash',
		})

		for (const extension of Object.values(ALGORITHM_EXTENSIONS)) {
			expect(await fileExists(getArtifactPath(artifactDirectory, retainedKey, extension))).toBe(
				true,
			)

			expect(await fileExists(getArtifactPath(artifactDirectory, staleKey, extension))).toBe(false)
		}
	})

	it('does not remove entries that are still current', async () => {
		directory = await createTempDirectory()

		const key = 'index.html'

		const cache = {
			version: CACHE_VERSION,
			configHash: null,
			entries: {
				[key]: 'hash',
			},
		}

		expect(await pruneCache(cache, join(directory, 'artifacts'), new Set([key]))).toBe(0)

		expect(cache.entries[key]).toBe('hash')
	})
})

describe('removeDisabledArtifacts', () => {
	let directory = ''

	afterEach(async () => {
		if (directory) {
			await removeTempDirectory(directory)
			directory = ''
		}
	})

	it('removes artifacts for disabled algorithms only', async () => {
		directory = await createTempDirectory()

		const artifactDirectory = join(directory, 'artifacts')
		const key = 'index.html'

		for (const extension of Object.values(ALGORITHM_EXTENSIONS)) {
			await createFile(artifactDirectory, `${key}${extension}`)
		}

		await removeDisabledArtifacts(key, artifactDirectory, {
			gzip: {},
			brotli: false,
			zstd: false,
		})

		expect(await fileExists(getArtifactPath(artifactDirectory, key, '.gz'))).toBe(true)

		expect(await fileExists(getArtifactPath(artifactDirectory, key, '.br'))).toBe(false)

		expect(await fileExists(getArtifactPath(artifactDirectory, key, '.zst'))).toBe(false)
	})
})
