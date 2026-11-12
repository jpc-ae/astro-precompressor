import { readdir, stat } from 'node:fs/promises'

import { extname, join, resolve } from 'node:path'

import { createHash } from 'node:crypto'

import { performance } from 'node:perf_hooks'

import { PLUGIN_NAME } from './constants.js'

import { loadCache, saveCache, pruneCache, removeDisabledArtifacts } from './cache.js'

import { compressFile } from './compression.js'

import { formatBytes, formatDuration, hashFile, toCacheKey } from './utils.js'

import type {
	BuildStats,
	CompressionAlgorithm,
	IntegrationLogger,
	ResolvedOptions,
	ZopfliModule,
} from './types.js'

import { styleText } from 'node:util'

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

function log(
	logger: IntegrationLogger,
	options: ResolvedOptions,
	level: 1 | 2,
	message: string,
): void {
	if (options.logLevel < level) {
		return
	}

	if (level === 2) {
		logger.debug(message)
	} else {
		logger.info(message)
	}
}

function logError(logger: IntegrationLogger, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error)
	logger.error(message)
}

function logHeader(title: string): void {
	const header = styleText(['bgGreen', 'black'], ` ${title} `)
	console.log(`\n${header}`)
}

// -----------------------------------------------------------------------------
// File discovery
// -----------------------------------------------------------------------------

async function findFiles(directory: string, fileTypes: string[]): Promise<string[]> {
	const files: string[] = []
	const supportedExtensions = new Set(fileTypes)

	async function walk(currentDirectory: string): Promise<void> {
		const entries = await readdir(currentDirectory, {
			withFileTypes: true,
		})

		for (const entry of entries) {
			const fullPath = join(currentDirectory, entry.name)

			// Do not follow symbolic links.
			if (entry.isSymbolicLink()) {
				continue
			}

			if (entry.isDirectory()) {
				await walk(fullPath)
				continue
			}

			if (!entry.isFile()) {
				continue
			}

			const extension = extname(entry.name).toLowerCase()

			if (supportedExtensions.has(extension)) {
				files.push(fullPath)
			}
		}
	}

	await walk(directory)

	return files.sort()
}

// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------

function createBuildStats(files: number): BuildStats {
	return {
		files,
		reusedFiles: 0,
		regeneratedFiles: 0,
		sourceBytes: 0,
		workerElapsed: 0,
		algorithms: {
			brotli: {
				generated: 0,
				bytes: 0,
				elapsed: 0,
			},
			gzip: {
				generated: 0,
				bytes: 0,
				elapsed: 0,
			},
		},
		errors: [],
	}
}

function logFileResult(
	logger: IntegrationLogger,
	options: ResolvedOptions,
	filePath: string,
	sourceSize: number,
	compressions: {
		algorithm: CompressionAlgorithm
		elapsed: number
		generated: boolean
		size: number
	}[],
): void {
	for (const result of compressions) {
		const fileExtension = (
			{
				brotli: 'br',
				gzip: 'gz',
			} as const
		)[result.algorithm]
		const savings = sourceSize > 0 ? ((1 - result.size / sourceSize) * 100).toFixed(1) : '0.0'

		const status = result.generated
			? `${formatBytes(sourceSize)} → ${formatBytes(result.size)} (-${savings}%) in ${formatDuration(result.elapsed)}`
			: `(reused cache entry) (${formatBytes(result.size)})`

		log(
			logger.fork(''),
			options,
			1,
			`  ${styleText('green', '▶')} ${filePath}.${fileExtension} ${styleText('dim', status)}`,
		)
	}
}

function logStatistics(logger: IntegrationLogger, stats: BuildStats): void {
	for (const algorithm of ['brotli', 'gzip'] as const) {
		const result = stats.algorithms[algorithm]

		if (result.generated === 0 && result.bytes === 0) {
			continue
		}

		const savings =
			stats.sourceBytes > 0 ? ((1 - result.bytes / stats.sourceBytes) * 100).toFixed(1) : '0.0'

		logger.info(
			`${algorithm === 'brotli' ? 'Brotli' : 'Gzip'}: ${result.generated} generated | ${formatBytes(result.bytes)} (-${savings}%) | ${formatDuration(result.elapsed)} combined processing time`,
		)
	}

	if (stats.errors.length) {
		logger.error(`Errors: ${stats.errors.length}`)
	} else {
		logger.info(`Errors: ${stats.errors.length}`)
	}
}

// -----------------------------------------------------------------------------
// Main build operation
// -----------------------------------------------------------------------------

export async function runBuild(
	outputDirectory: string,
	cacheDirectory: string,
	configHash: string,
	options: ResolvedOptions,
	logger: IntegrationLogger,
	zopfli: ZopfliModule | undefined,
): Promise<void> {
	const buildStart = performance.now()

	const outputDirectoryHash = createHash('sha256').update(resolve(outputDirectory)).digest('hex')

	const pluginCacheDirectory = join(cacheDirectory, PLUGIN_NAME)

	const manifestPath = join(pluginCacheDirectory, `${outputDirectoryHash}.json`)

	const artifactDirectory = join(pluginCacheDirectory, 'artifacts', outputDirectoryHash)

	// -------------------------------------------------------------------------
	// Load cache
	// -------------------------------------------------------------------------

	const cache = await loadCache(manifestPath)

	const configChanged = options.recompressOnConfigChange && cache.configHash !== configHash

	const forceRecompress = !options.incremental || configChanged

	// -------------------------------------------------------------------------
	// Discover eligible files
	// -------------------------------------------------------------------------

	const files = await findFiles(outputDirectory, options.fileTypes)

	const eligibleFiles: Array<{
		path: string
		key: string
		size: number
	}> = []

	const currentKeys = new Set<string>()

	for (const filePath of files) {
		const fileStats = await stat(filePath)

		if (fileStats.size < options.minSize) {
			continue
		}

		const key = toCacheKey(outputDirectory, filePath)

		eligibleFiles.push({
			path: filePath,
			key,
			size: fileStats.size,
		})

		currentKeys.add(key)
	}

	log(logger, options, 2, `Processing ${eligibleFiles.length} build files`)
	log(logger, options, 2, `Output directory: ${outputDirectory}`)
	log(logger, options, 2, `Manifest: ${manifestPath}`)
	log(logger, options, 2, `Artifact cache: ${artifactDirectory}`)
	log(logger, options, 2, `Algorithms: ${options.algorithms.join(', ')}`)
	log(logger, options, 2, `File types: ${options.fileTypes.join(' ') || '(none)'}`)
	log(logger, options, 2, `Incremental: ${options.incremental}`)
	log(logger, options, 2, `Configuration changed: ${configChanged}`)
	log(logger, options, 2, `Force recompression: ${forceRecompress}`)

	// -------------------------------------------------------------------------
	// Initialize statistics
	// -------------------------------------------------------------------------

	const stats = createBuildStats(eligibleFiles.length)

	// -------------------------------------------------------------------------
	// Prune cache
	// -------------------------------------------------------------------------

	if (options.prune) {
		try {
			const removed = await pruneCache(cache, artifactDirectory, outputDirectory, currentKeys)

			if (removed > 0) {
				logger.info(`Pruned ${removed} stale cache entr${removed === 1 ? 'y' : 'ies'}.`)
			}

			const algorithms = new Set(options.algorithms)

			// Remove sidecars belonging to algorithms that are no
			// longer configured.
			for (const file of eligibleFiles) {
				await removeDisabledArtifacts(file.key, artifactDirectory, file.path, algorithms)
			}
		} catch (error) {
			stats.errors.push(error instanceof Error ? error : new Error(String(error)))
		}
	}

	// -------------------------------------------------------------------------
	// Worker pool
	// -------------------------------------------------------------------------

	let nextIndex = 0

	async function worker(): Promise<void> {
		while (true) {
			const index = nextIndex++

			if (index >= eligibleFiles.length) {
				return
			}

			const file = eligibleFiles[index]

			try {
				log(logger, options, 2, `${file.key}: Calculating source hash`)

				const currentHash = await hashFile(file.path)
				const cachedHash = cache.entries[file.key]

				const result = await compressFile(
					file.path,
					artifactDirectory,
					file.key,
					currentHash,
					cachedHash,
					forceRecompress,
					options,
					logger,
					zopfli,
				)

				logFileResult(logger, options, file.key, file.size, result.compressions)

				// Only update the manifest after all configured
				// compression algorithms have succeeded.
				cache.entries[file.key] = currentHash

				stats.sourceBytes += file.size
				stats.workerElapsed += result.elapsed

				const generated = result.compressions.some(compression => compression.generated)

				if (generated) {
					stats.regeneratedFiles++
				} else {
					stats.reusedFiles++
				}

				for (const compression of result.compressions) {
					const algorithmStats = stats.algorithms[compression.algorithm]

					algorithmStats.bytes += compression.size
					algorithmStats.elapsed += compression.elapsed

					if (compression.generated) {
						algorithmStats.generated++
					}
				}
			} catch (error) {
				const normalizedError = error instanceof Error ? error : new Error(String(error))

				stats.errors.push(
					new Error(`Failed to process ${file.key}: ${normalizedError.message}`, {
						cause: normalizedError,
					}),
				)
			}
		}
	}

	const workerCount = Math.min(options.concurrency, eligibleFiles.length)

	if (options.logLevel > 0) {
		logHeader('generating precompressed files')
	}
	await Promise.all(Array.from({ length: workerCount }, () => worker()))

	// -------------------------------------------------------------------------
	// Save cache
	// -------------------------------------------------------------------------

	if (stats.errors.length === 0) {
		cache.configHash = configHash
	}

	try {
		await saveCache(manifestPath, cache)
	} catch (error) {
		stats.errors.push(error instanceof Error ? error : new Error(String(error)))
	}

	// -------------------------------------------------------------------------
	// Build summary
	// -------------------------------------------------------------------------

	const elapsed = performance.now() - buildStart

	if (options.logLevel >= 1) {
		logger.fork('').info(styleText('green', `✓ Completed in ${formatDuration(elapsed)}\n`))
	} else {
		logger.info(styleText('green', `✓ Completed in ${formatDuration(elapsed)}`))
	}

	logger.info(
		`Processed ${stats.files} source files using ${formatDuration(stats.workerElapsed)} of combined worker time.`,
	)

	const totalGenerated = Object.values(stats.algorithms).reduce(
		(total, algorithm) => total + algorithm.generated,
		0,
	)

	logger.info(
		`Reused: ${stats.reusedFiles} | Generated: ${totalGenerated} | Updated: ${stats.regeneratedFiles}`,
	)

	if (options.logLevel >= 1) {
		logStatistics(logger, stats)
	}

	for (const error of stats.errors) {
		logError(logger, error)
	}

	if (stats.errors.length > 0 && options.failOnError) {
		throw new Error(`[${PLUGIN_NAME}] Compression failed for ${stats.errors.length} operation(s).`)
	}

	logger.info(styleText('bold', 'Done!'))
}
