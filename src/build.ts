import { readdir, stat } from 'node:fs/promises'

import { extname, join, relative, resolve, sep } from 'node:path'

import { createHash } from 'node:crypto'

import { performance } from 'node:perf_hooks'

import picomatch from 'picomatch'

import { ALGORITHM_EXTENSIONS, INTEGRATION_NAME, SUPPORTED_ALGORITHMS } from './constants.js'

import { runWorkerPool } from './worker-pool.js'

import {
	loadCache,
	saveCache,
	pruneCache,
	removeDisabledArtifacts,
	hasCacheHit,
	removeDisabledOutputSidecars,
} from './cache.js'

import { compressFile } from './compression.js'

import { Semaphore } from './semaphore.js'

import {
	formatBytes,
	formatDuration,
	hashFile,
	log,
	logError,
	logHeader,
	dim,
	green,
	bold,
	toCacheKey,
	getEnabledAlgorithms,
} from './utils.js'

import type {
	BuildStats,
	CompressionAlgorithm,
	Compressors,
	FilterOptions,
	Logger,
	ResolvedGlobFilter,
	ResolvedOptions,
} from './types.js'

// -----------------------------------------------------------------------------
// File discovery
// -----------------------------------------------------------------------------

function resolveGlobFilters(filters: FilterOptions): {
	include: ResolvedGlobFilter[]
	exclude: ResolvedGlobFilter[]
} {
	function resolve(filters: FilterOptions['include']): ResolvedGlobFilter[] {
		return (filters ?? []).map(filter => {
			const pattern = typeof filter === 'string' ? filter : filter.pattern

			return {
				pattern,
				match: picomatch(pattern, { strictBrackets: true }),
				algorithms: typeof filter === 'string' ? undefined : filter.algorithms,
			}
		})
	}

	return {
		include: resolve(filters.include),
		exclude: resolve(filters.exclude),
	}
}

function getFileAlgorithms(
	relativePath: string,
	filters: ReturnType<typeof resolveGlobFilters>,
	enabledAlgorithms: CompressionAlgorithm[],
): CompressionAlgorithm[] {
	const selected = new Set<CompressionAlgorithm>()

	// No include rules means all globally enabled algorithms are eligible.
	if (filters.include.length === 0) {
		for (const algorithm of enabledAlgorithms) {
			selected.add(algorithm)
		}
	} else {
		// Include rules are OR-based. Matching rules contribute algorithms.
		for (const filter of filters.include) {
			if (!filter.match(relativePath)) {
				continue
			}

			if (!filter.algorithms) {
				// A plain string selects every globally enabled algorithm.
				for (const algorithm of enabledAlgorithms) {
					selected.add(algorithm)
				}
			} else {
				for (const algorithm of filter.algorithms) {
					if (enabledAlgorithms.includes(algorithm)) {
						selected.add(algorithm)
					}
				}
			}
		}
	}

	// Exclude rules are also OR-based: any matching rule removes its
	// algorithms. A plain string excludes the entire file.
	for (const filter of filters.exclude) {
		if (!filter.match(relativePath)) {
			continue
		}

		if (!filter.algorithms) {
			selected.clear()
			break
		}

		for (const algorithm of filter.algorithms) {
			selected.delete(algorithm)
		}
	}

	// Return in stable supported-algorithm order.
	return SUPPORTED_ALGORITHMS.filter(algorithm => selected.has(algorithm))
}

async function findFiles(
	directory: string,
	{ fileTypes, exclude }: FilterOptions,
): Promise<string[]> {
	const files: string[] = []
	const supportedExtensions = new Set(fileTypes.map(extension => extension.toLowerCase()))

	// Only plain-string excludes exclude whole files or directories.
	// Algorithm-scoped excludes are handled later per file.
	const globalExcludes = (exclude ?? [])
		.filter((filter): filter is string => typeof filter === 'string')
		.map(pattern => picomatch(pattern, { strictBrackets: true }))

	function isGloballyExcluded(relativePath: string): boolean {
		return globalExcludes.some(match => match(relativePath))
	}

	function isExcludedDirectory(relativePath: string): boolean {
		return (
			isGloballyExcluded(relativePath) ||
			isGloballyExcluded(`${relativePath}/`) ||
			isGloballyExcluded(`${relativePath}/__astro_precompressor_probe__`)
		)
	}

	async function walk(currentDirectory: string): Promise<void> {
		const entries = await readdir(currentDirectory, {
			withFileTypes: true,
		})

		for (const entry of entries) {
			const absolutePath = join(currentDirectory, entry.name)
			const relativePath = relative(directory, absolutePath).split(sep).join('/')

			// Do not follow symbolic links.
			if (entry.isSymbolicLink()) {
				continue
			}

			if (entry.isDirectory()) {
				if (isExcludedDirectory(relativePath)) {
					continue
				}

				await walk(absolutePath)
				continue
			}

			if (!entry.isFile()) {
				continue
			}

			const extension = extname(entry.name).toLowerCase()

			if (!supportedExtensions.has(extension)) {
				continue
			}

			if (isGloballyExcluded(relativePath)) {
				continue
			}

			files.push(absolutePath)
		}
	}

	await walk(directory)

	return files.sort()
}

// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------

function createBuildStats(eligibleFileCount: number): BuildStats {
	return {
		files: eligibleFileCount,
		reusedFiles: 0,
		regeneratedFiles: 0,
		sourceBytes: 0,
		algorithms: {
			brotli: {
				generated: 0,
				bytes: 0,
				elapsed: 0,
				discarded: 0,
			},
			gzip: {
				generated: 0,
				bytes: 0,
				elapsed: 0,
				discarded: 0,
			},
			zstd: {
				generated: 0,
				bytes: 0,
				elapsed: 0,
				discarded: 0,
			},
		},
		elapsed: 0,
		errors: [],
	}
}

function logFileResult(
	logger: Logger,
	options: ResolvedOptions,
	filePath: string,
	sourceSize: number,
	compressions: {
		algorithm: CompressionAlgorithm
		elapsed: number
		generated: boolean
		size: number
		discarded: boolean
	}[],
): void {
	for (const result of compressions) {
		const extension = ALGORITHM_EXTENSIONS[result.algorithm]

		const savings = sourceSize > 0 ? ((1 - result.size / sourceSize) * 100).toFixed(1) : '0.0'

		const status = result.discarded
			? `${formatBytes(sourceSize)} → ${formatBytes(result.size)} (-${savings}%) (discarded)`
			: result.generated
				? `${formatBytes(sourceSize)} → ${formatBytes(result.size)} (-${savings}%) in ${formatDuration(result.elapsed)}`
				: `(reused cache entry) (${formatBytes(result.size)})`

		log(logger.fork(''), options, 1, `  ${green('▶')} ${filePath}${extension} ${dim(status)}`)
	}
}

function logStatistics(logger: Logger, stats: BuildStats): void {
	for (const algorithm of SUPPORTED_ALGORITHMS) {
		const result = stats.algorithms[algorithm]

		if (result.generated === 0 && result.bytes === 0 && result.discarded === 0) {
			continue
		}

		const savings =
			stats.sourceBytes > 0 ? ((1 - result.bytes / stats.sourceBytes) * 100).toFixed(1) : '0.0'

		logger.info(
			`${algorithm}: ${result.generated} generated | ${formatBytes(result.bytes)} emitted (-${savings}%) | ${result.discarded} discarded | ${formatDuration(result.elapsed)} combined processing time`,
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
	logger: Logger,
	compressors: Compressors,
): Promise<void> {
	const buildStart = performance.now()

	const outputDirectoryHash = createHash('sha256').update(resolve(outputDirectory)).digest('hex')

	const pluginCacheDirectory = join(cacheDirectory, INTEGRATION_NAME)

	const manifestPath = join(pluginCacheDirectory, `${outputDirectoryHash}.json`)

	const artifactDirectory = join(pluginCacheDirectory, 'artifacts', outputDirectoryHash)

	// -------------------------------------------------------------------------
	// Load cache
	// -------------------------------------------------------------------------

	const cache = await loadCache(manifestPath)

	const configChanged = options.recompressOnConfigChange && cache.configHash !== configHash

	const forceRecompress = !options.performance.incremental || configChanged

	// -------------------------------------------------------------------------
	// Discover eligible files
	// -------------------------------------------------------------------------

	const files = await findFiles(outputDirectory, options.filters)
	const resolvedFilters = resolveGlobFilters(options.filters)

	const enabledAlgorithms = getEnabledAlgorithms(options.algorithms)
	if (enabledAlgorithms.length === 0) {
		throw new Error(`[${INTEGRATION_NAME}] No algorithms are enabled.`)
	}

	const eligibleFiles: Array<{
		path: string
		key: string
		size: number
		algorithms: CompressionAlgorithm[]
	}> = []

	const currentKeys = new Set<string>()

	const fileStats = await runWorkerPool(files, 16, async filePath => ({
		path: filePath,
		stats: await stat(filePath),
	}))

	for (const { path: filePath, stats: fileStat } of fileStats) {
		if (fileStat.size < options.filters.minSize) {
			continue
		}

		const key = toCacheKey(outputDirectory, filePath)
		const relativePath = relative(outputDirectory, filePath).split(sep).join('/')

		const algorithms = getFileAlgorithms(relativePath, resolvedFilters, enabledAlgorithms)

		// No selected algorithms means the file is not part of this build.
		if (algorithms.length === 0) {
			continue
		}

		eligibleFiles.push({
			path: filePath,
			key,
			size: fileStat.size,
			algorithms,
		})

		currentKeys.add(key)
	}

	if (options.logLevel === 0) {
		logger.info(`Processing ${eligibleFiles.length} eligible files`)
	} else {
		log(logger, options, 2, `Processing ${eligibleFiles.length} eligible files`)
	}
	log(logger, options, 2, `Output directory: ${outputDirectory}`)
	log(logger, options, 2, `Manifest: ${manifestPath}`)
	log(logger, options, 2, `Artifact cache: ${artifactDirectory}`)
	log(logger, options, 2, `Algorithms: ${enabledAlgorithms.join(', ')}`)
	log(logger, options, 2, `File types: ${options.filters.fileTypes.join(' ')}`)
	log(logger, options, 2, `Incremental: ${options.performance.incremental}`)
	log(logger, options, 2, `Configuration changed: ${configChanged}`)
	log(logger, options, 2, `Force recompression: ${forceRecompress}`)

	// -------------------------------------------------------------------------
	// Initialize statistics
	// -------------------------------------------------------------------------

	const stats = createBuildStats(eligibleFiles.length)

	// -------------------------------------------------------------------------
	// Prune cache
	// -------------------------------------------------------------------------

	if (options.cache.prune) {
		try {
			const removed = await pruneCache(cache, artifactDirectory, currentKeys)

			if (removed > 0) {
				logger.info(`Pruned ${removed} stale cache entr${removed === 1 ? 'y' : 'ies'}.`)
			}
		} catch (error) {
			stats.errors.push(error instanceof Error ? error : new Error(String(error)))
		}
	}

	// Remove sidecars belonging to algorithms that are no
	// longer configured.
	for (const file of eligibleFiles) {
		try {
			await removeDisabledArtifacts(file.key, artifactDirectory, options.algorithms)
		} catch (error) {
			stats.errors.push(
				new Error(`Failed to remove disabled artifacts for ${file.key}`, {
					cause: error,
				}),
			)
		}
	}

	// -------------------------------------------------------------------------
	// Worker pool
	// -------------------------------------------------------------------------

	const semaphore = new Semaphore(options.performance.concurrency)

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
				const cacheHit = await hasCacheHit(
					artifactDirectory,
					file.key,
					currentHash,
					cachedHash,
					forceRecompress,
					file.algorithms,
				)
				await removeDisabledOutputSidecars(file.path, file.algorithms, cacheHit)

				const result = await compressFile(
					file.path,
					artifactDirectory,
					file.key,
					currentHash,
					cachedHash,
					forceRecompress,
					options,
					logger,
					compressors,
					semaphore,
					file.algorithms,
				)

				logFileResult(logger, options, file.key, file.size, result.compressions)

				// Only update the manifest after all configured
				// compression algorithms have succeeded.
				cache.entries[file.key] = currentHash

				stats.sourceBytes += file.size

				const generated = result.compressions.some(compression => compression.generated)

				if (generated) {
					stats.regeneratedFiles++
				} else {
					stats.reusedFiles++
				}

				for (const compression of result.compressions) {
					const algorithmStats = stats.algorithms[compression.algorithm]

					// Only count files actually emitted into the build output.
					if (!compression.discarded) {
						algorithmStats.bytes += compression.size
					}

					algorithmStats.elapsed += compression.elapsed

					// Also add up the combined processing time.
					stats.elapsed += compression.elapsed

					if (compression.generated) {
						algorithmStats.generated++
					}

					if (compression.discarded) {
						algorithmStats.discarded++
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

	const workerCount = Math.min(eligibleFiles.length, options.performance.concurrency)

	if (options.logLevel > 0) {
		logHeader('generating precompressed files')
	}
	await Promise.all(Array.from({ length: workerCount }, () => worker()))

	// -------------------------------------------------------------------------
	// Save cache
	// -------------------------------------------------------------------------

	if (stats.errors.length === 0 && options.recompressOnConfigChange) {
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
		logger.fork('').info(green(`✓ Completed in ${formatDuration(elapsed)}\n`))
	} else {
		logger.info(green(`✓ Completed in ${formatDuration(elapsed)}`))
	}

	logger.info(
		`Processed ${stats.files} source files using ${formatDuration(stats.elapsed)} of combined processing time.`,
	)

	const totalGenerated = Object.values(stats.algorithms).reduce(
		(total, algorithm) => total + algorithm.generated,
		0,
	)

	const totalDiscarded = Object.values(stats.algorithms).reduce(
		(total, algorithm) => total + algorithm.discarded,
		0,
	)

	logger.info(
		`Reused: ${stats.reusedFiles} | Updated: ${stats.regeneratedFiles} | Generated: ${totalGenerated} (${totalDiscarded} discarded)`,
	)

	if (options.logLevel >= 1) {
		logStatistics(logger, stats)
	}

	for (const error of stats.errors) {
		logError(logger, error)
	}

	if (stats.errors.length > 0 && options.failOnError) {
		throw new Error(
			`[${INTEGRATION_NAME}] Compression failed for ${stats.errors.length} operation(s).`,
		)
	}

	logger.info(bold('Done!'))
}
