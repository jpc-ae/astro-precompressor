import { copyFile, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'

import { randomUUID } from 'node:crypto'

import { dirname } from 'node:path'

import { CACHE_VERSION } from './constants.js'

import { resolveInsideDirectory } from './utils.js'

import type { CacheManifest } from './types.js'

// -----------------------------------------------------------------------------
// Manifest
// -----------------------------------------------------------------------------

export function emptyCache(): CacheManifest {
	return {
		version: CACHE_VERSION,
		configHash: null,
		entries: {},
	}
}

export async function loadCache(manifestPath: string): Promise<CacheManifest> {
	try {
		const contents = await readFile(manifestPath, 'utf8')

		const parsed = JSON.parse(contents) as Partial<CacheManifest>

		if (
			parsed.version !== CACHE_VERSION ||
			typeof parsed.entries !== 'object' ||
			parsed.entries === null
		) {
			return emptyCache()
		}

		const entries: Record<string, string> = {}

		for (const [key, value] of Object.entries(parsed.entries)) {
			if (typeof value === 'string') {
				entries[key] = value
			}
		}

		return {
			version: CACHE_VERSION,
			configHash: typeof parsed.configHash === 'string' ? parsed.configHash : null,
			entries,
		}
	} catch {
		return emptyCache()
	}
}

export async function saveCache(manifestPath: string, cache: CacheManifest): Promise<void> {
	await mkdir(dirname(manifestPath), {
		recursive: true,
	})

	const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`

	try {
		await writeFile(temporaryPath, JSON.stringify(cache, null, 2), 'utf8')

		await rename(temporaryPath, manifestPath)
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => {})
		throw error
	}
}

// -----------------------------------------------------------------------------
// Artifact paths
// -----------------------------------------------------------------------------

export function getArtifactPath(
	artifactDirectory: string,
	relativePath: string,
	extension: 'br' | 'gz',
): string {
	const target = resolveInsideDirectory(artifactDirectory, relativePath)

	return `${target}.${extension}`
}

// -----------------------------------------------------------------------------
// File utilities
// -----------------------------------------------------------------------------

export async function fileExists(path: string): Promise<boolean> {
	try {
		const info = await stat(path)
		return info.isFile()
	} catch {
		return false
	}
}

export async function copyPreservingTimestamps(source: string, destination: string): Promise<void> {
	const sourceStats = await stat(source)

	try {
		await mkdir(dirname(destination), {
			recursive: true,
		})

		await copyFile(source, destination)

		await utimes(destination, sourceStats.atime, sourceStats.mtime)
	} finally {
		await utimes(source, sourceStats.atime, sourceStats.mtime).catch(() => {})
	}
}

// -----------------------------------------------------------------------------
// Pruning
// -----------------------------------------------------------------------------

export async function pruneCache(
	cache: CacheManifest,
	artifactDirectory: string,
	outputDirectory: string,
	currentKeys: Set<string>,
): Promise<number> {
	const retainedEntries: Record<string, string> = {}

	let removed = 0

	for (const [key, hash] of Object.entries(cache.entries)) {
		if (currentKeys.has(key)) {
			retainedEntries[key] = hash
			continue
		}

		const brCachePath = getArtifactPath(artifactDirectory, key, 'br')

		const gzCachePath = getArtifactPath(artifactDirectory, key, 'gz')

		const sourcePath = resolveInsideDirectory(outputDirectory, key)

		await rm(brCachePath, { force: true })
		await rm(gzCachePath, { force: true })

		await rm(`${sourcePath}.br`, { force: true })
		await rm(`${sourcePath}.gz`, { force: true })

		removed++
	}

	cache.entries = retainedEntries

	return removed
}

// -----------------------------------------------------------------------------
// Remove disabled algorithms
// -----------------------------------------------------------------------------

export async function removeDisabledArtifacts(
	relativePath: string,
	artifactDirectory: string,
	sourcePath: string,
	algorithms: Set<'brotli' | 'gzip'>,
): Promise<void> {
	if (!algorithms.has('brotli')) {
		await rm(getArtifactPath(artifactDirectory, relativePath, 'br'), { force: true })

		await rm(`${sourcePath}.br`, { force: true })
	}

	if (!algorithms.has('gzip')) {
		await rm(getArtifactPath(artifactDirectory, relativePath, 'gz'), { force: true })

		await rm(`${sourcePath}.gz`, { force: true })
	}
}
