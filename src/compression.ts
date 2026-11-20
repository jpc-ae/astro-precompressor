import { createReadStream, createWriteStream } from 'node:fs'

import { mkdir, rename, rm, stat } from 'node:fs/promises'

import { randomUUID } from 'node:crypto'

import { dirname } from 'node:path'

import { pipeline } from 'node:stream/promises'

import { performance } from 'node:perf_hooks'

import { copyPreservingTimestamps, fileExists, getArtifactPath } from './cache.js'

import { formatDuration, log } from './utils.js'

import type { Semaphore } from './semaphore.js'

import type {
	CompressionAlgorithm,
	CompressionResult,
	CompressorFactory,
	Compressors,
	Logger,
	ResolvedOptions,
} from './types.js'

import { ALGORITHM_EXTENSIONS, INTEGRATION_NAME } from './constants.js'
import type { Transform } from 'node:stream'

// -----------------------------------------------------------------------------
// Generate compressed output
// -----------------------------------------------------------------------------

async function generateCompressedFile(
	sourcePath: string,
	destination: string,
	compressor: Transform,
): Promise<number> {
	const start = performance.now()

	await mkdir(dirname(destination), {
		recursive: true,
	})

	const temporaryPath = `${destination}.${randomUUID()}.tmp`

	try {
		await pipeline(
			createReadStream(sourcePath),
			compressor,
			createWriteStream(temporaryPath, {
				flags: 'wx',
			}),
		)

		await rename(temporaryPath, destination)

		return performance.now() - start
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
	logger: Logger,
	compressorFactory: CompressorFactory,
	semaphore: Semaphore,
): Promise<CompressionResult> {
	const extension = ALGORITHM_EXTENSIONS[algorithm]

	const cachePath = getArtifactPath(artifactDirectory, relativePath, extension)

	const outputPath = `${sourcePath}${extension}`

	const hashMatches = !forceRecompress && currentHash === cachedHash

	const cached = hashMatches && (await fileExists(cachePath))

	log(logger, options, 2, `${relativePath}: ${algorithm} cache ${cached ? 'hit' : 'miss'}`)

	let elapsed = 0

	if (!cached) {
		log(logger, options, 2, `${relativePath}: Starting ${algorithm} compression`)

		elapsed = await semaphore.run(async () => {
			const compressor = await compressorFactory()
			return generateCompressedFile(sourcePath, cachePath, compressor)
		})

		log(logger, options, 2, `${relativePath}: ${algorithm} compression complete`)
	}

	const sourceStats = await stat(sourcePath)
	const compressedStats = await stat(cachePath)

	const discarded =
		options.performance.discardCompressionIfLarger && compressedStats.size >= sourceStats.size

	if (discarded) {
		log(
			logger,
			options,
			2,
			`${relativePath}: Skipping ${algorithm} because compressed size is not smaller`,
		)
	} else {
		await copyPreservingTimestamps(cachePath, outputPath)
	}

	log(logger, options, 2, `${relativePath}: ${algorithm} processed in ${formatDuration(elapsed)}`)

	return {
		algorithm,
		elapsed,
		generated: !cached,
		size: compressedStats.size,
		discarded,
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
	logger: Logger,
	compressors: Compressors,
	semaphore: Semaphore,
): Promise<{
	compressions: CompressionResult[]
}> {
	const enabledAlgorithms = Object.entries(options.algorithms)
		.filter(([, enabled]) => enabled)
		.map(([algorithm]) => algorithm as keyof typeof options.algorithms)

	// Validate everything before starting any asynchronous work.
	for (const algorithm of enabledAlgorithms) {
		if (!compressors[algorithm]) {
			throw new Error(`[${INTEGRATION_NAME}] Error: the ${algorithm} compressor could not be found`)
		}
	}

	const processors: Promise<CompressionResult>[] = []

	for (const algorithm of enabledAlgorithms) {
		processors.push(
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
				compressors[algorithm] as CompressorFactory,
				semaphore,
			),
		)
	}
	const results = await Promise.allSettled(processors)

	const failures = results.filter(
		(result): result is PromiseRejectedResult => result.status === 'rejected',
	)

	if (failures.length === 1) {
		throw failures[0].reason
	}

	if (failures.length > 1) {
		throw new AggregateError(
			failures.map(failure => failure.reason),
			`One or more compression algorithms failed for ${relativePath}.`,
		)
	}

	return {
		compressions: results.map(result => {
			if (result.status !== 'fulfilled') {
				throw result.reason
			}

			return result.value
		}),
	}
}
