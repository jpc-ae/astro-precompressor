import { constants, createBrotliCompress, createGzip } from 'node:zlib'

import { createReadStream, createWriteStream } from 'node:fs'

import { mkdir, rename, rm, stat, utimes } from 'node:fs/promises'

import { randomUUID } from 'node:crypto'

import { dirname } from 'node:path'

import { pipeline } from 'node:stream/promises'

import { performance } from 'node:perf_hooks'

// import { BROTLI_QUALITY, GZIP_LEVEL } from './constants'

import { copyPreservingTimestamps, fileExists, getArtifactPath } from './cache.js'

import { formatDuration } from './utils.js'

import type {
	CompressionAlgorithm,
	CompressionResult,
	IntegrationLogger,
	ResolvedOptions,
	ZopfliOptions,
	ZopfliModule,
} from './types.js'

// -----------------------------------------------------------------------------
// Compressor factory
// -----------------------------------------------------------------------------

function createCompressor(
	algorithm: CompressionAlgorithm,
	useZopfli: false | ZopfliOptions,
	zopfli: ZopfliModule | undefined,
) {
	if (algorithm === 'brotli') {
		return createBrotliCompress({
			params: {
				[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
			},
		})
	}

	if (algorithm === 'gzip') {
		if (useZopfli) {
			if (!zopfli) {
				throw new Error('Zopfli module has not been initialized.')
			}

			return zopfli.createGzip(useZopfli)
		}

		return createGzip({
			level: constants.Z_BEST_COMPRESSION,
		})
	}

	throw new Error('Invalid compression context.')
}

// -----------------------------------------------------------------------------
// Atomic replacement
// -----------------------------------------------------------------------------

async function replaceFile(temporaryPath: string, destination: string): Promise<void> {
	await rm(destination, { force: true })
	await rename(temporaryPath, destination)
}

// -----------------------------------------------------------------------------
// Generate compressed artifact
// -----------------------------------------------------------------------------

async function generateCompression(
	sourcePath: string,
	destination: string,
	algorithm: CompressionAlgorithm,
	useZopfli: false | ZopfliOptions,
	zopfli: ZopfliModule | undefined,
): Promise<void> {
	await mkdir(dirname(destination), {
		recursive: true,
	})

	const temporaryPath = `${destination}.${randomUUID()}.tmp`

	try {
		const compressor = createCompressor(algorithm, useZopfli, zopfli)

		await pipeline(
			createReadStream(sourcePath),
			compressor,
			createWriteStream(temporaryPath, {
				flags: 'wx',
			}),
		)

		await replaceFile(temporaryPath, destination)
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => {})
		throw error
	}
}

// -----------------------------------------------------------------------------
// Process one algorithm
// -----------------------------------------------------------------------------

async function processAlgorithm(
	sourcePath: string,
	artifactDirectory: string,
	relativePath: string,
	algorithm: CompressionAlgorithm,
	currentHash: string,
	cachedHash: string | undefined,
	forceRecompress: boolean,
	options: ResolvedOptions,
	logger: IntegrationLogger,
	zopfli: ZopfliModule | undefined,
): Promise<CompressionResult> {
	const start = performance.now()

	const extensions = new Map<string, 'br' | 'gz'>([
		['brotli', 'br'],
		['gzip', 'gz'],
	])

	const extension = extensions.get(algorithm) || 'gz'

	const cachePath = getArtifactPath(artifactDirectory, relativePath, extension)

	const outputPath = `${sourcePath}.${extension}`

	const hashMatches = !forceRecompress && currentHash === cachedHash

	const cached = hashMatches && (await fileExists(cachePath))

	logger.debug(`${relativePath}: ${algorithm} cache ${cached ? 'hit' : 'miss'}`)

	if (!cached) {
		logger.debug(`${relativePath}: Starting ${algorithm} compression`)

		await generateCompression(sourcePath, cachePath, algorithm, options.useZopfli, zopfli)

		logger.debug(`${relativePath}: ${algorithm} compression complete`)
	}

	const sourceStats = await stat(sourcePath)

	await utimes(cachePath, sourceStats.atime, sourceStats.mtime)

	await copyPreservingTimestamps(cachePath, outputPath)

	const compressedStats = await stat(cachePath)

	const elapsed = performance.now() - start

	logger.debug(`${relativePath}: ${algorithm} processed in ${formatDuration(elapsed)}`)

	return {
		algorithm,
		elapsed,
		generated: !cached,
		size: compressedStats.size,
	}
}

// -----------------------------------------------------------------------------
// Process one source file using all configured algorithms
// -----------------------------------------------------------------------------

export async function compressFile(
	sourcePath: string,
	artifactDirectory: string,
	relativePath: string,
	currentHash: string,
	cachedHash: string | undefined,
	forceRecompress: boolean,
	options: ResolvedOptions,
	logger: IntegrationLogger,
	zopfli: ZopfliModule | undefined,
): Promise<{
	elapsed: number
	compressions: CompressionResult[]
}> {
	const start = performance.now()

	// Each algorithm has its own independent input stream.
	// Promise.allSettled ensures that one failed algorithm does not
	// prevent the other algorithms from completing.
	const results = await Promise.allSettled(
		options.algorithms.map(algorithm =>
			processAlgorithm(
				sourcePath,
				artifactDirectory,
				relativePath,
				algorithm,
				currentHash,
				cachedHash,
				forceRecompress,
				options,
				logger,
				zopfli,
			),
		),
	)

	const failures = results.filter(
		(result): result is PromiseRejectedResult => result.status === 'rejected',
	)

	if (failures.length > 0) {
		throw new AggregateError(
			failures.map(result => result.reason),
			`One or more compression algorithms failed for ${relativePath}.`,
		)
	}

	return {
		elapsed: performance.now() - start,
		compressions: results.map(result => {
			if (result.status !== 'fulfilled') {
				throw result.reason
			}

			return result.value
		}),
	}
}
