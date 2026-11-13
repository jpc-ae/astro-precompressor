import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { styleText } from 'node:util';
import picomatch from 'picomatch';
import { ALGORITHM_EXTENSIONS, PLUGIN_NAME, SUPPORTED_ALGORITHMS } from './constants.js';
import { loadCache, saveCache, pruneCache, removeDisabledArtifacts } from './cache.js';
import { compressFile } from './compression.js';
import { formatBytes, formatDuration, hashFile, log, logError, logHeader, toCacheKey, } from './utils.js';
// -----------------------------------------------------------------------------
// File discovery
// -----------------------------------------------------------------------------
async function findFiles(directory, { fileTypes, include, exclude }) {
    const files = [];
    const supportedExtensions = new Set(fileTypes.map(extension => extension.toLowerCase()));
    const isIncluded = include?.length ? picomatch(include) : () => true;
    const isExcluded = exclude?.length ? picomatch(exclude) : () => false;
    function isExcludedDirectory(relativePath) {
        return (isExcluded(relativePath) ||
            isExcluded(`${relativePath}/`) ||
            isExcluded(`${relativePath}/__astro_precompressor_probe__`));
    }
    async function walk(currentDirectory) {
        const entries = await readdir(currentDirectory, {
            withFileTypes: true,
        });
        for (const entry of entries) {
            const absolutePath = join(currentDirectory, entry.name);
            const relativePath = relative(directory, absolutePath).split(sep).join('/');
            // Do not follow symbolic links.
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                if (isExcludedDirectory(relativePath)) {
                    continue;
                }
                await walk(absolutePath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const extension = extname(entry.name).toLowerCase();
            if (!supportedExtensions.has(extension)) {
                continue;
            }
            if (isExcluded(relativePath) || !isIncluded(relativePath)) {
                continue;
            }
            files.push(absolutePath);
        }
    }
    await walk(directory);
    return files.sort();
}
// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------
function createBuildStats(eligibleFileCount) {
    return {
        files: eligibleFileCount,
        reusedFiles: 0,
        regeneratedFiles: 0,
        sourceBytes: 0,
        workerElapsed: 0,
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
        errors: [],
    };
}
function logFileResult(logger, options, filePath, sourceSize, compressions) {
    for (const result of compressions) {
        const extension = ALGORITHM_EXTENSIONS[result.algorithm];
        const savings = sourceSize > 0 ? ((1 - result.size / sourceSize) * 100).toFixed(1) : '0.0';
        const status = result.generated
            ? `${formatBytes(sourceSize)} → ${formatBytes(result.size)} (-${savings}%) in ${formatDuration(result.elapsed)}`
            : `(reused cache entry) (${formatBytes(result.size)})`;
        log(logger.fork(''), options, 1, `  ${styleText('green', '▶')} ${filePath}${extension} ${styleText('dim', status)}`);
    }
}
function logStatistics(logger, stats) {
    for (const algorithm of SUPPORTED_ALGORITHMS) {
        const result = stats.algorithms[algorithm];
        if (result.generated === 0 && result.bytes === 0) {
            continue;
        }
        const savings = stats.sourceBytes > 0 ? ((1 - result.bytes / stats.sourceBytes) * 100).toFixed(1) : '0.0';
        logger.info(`${algorithm}: ${result.generated} generated | ${formatBytes(result.bytes)} (-${savings}%) | ${formatDuration(result.elapsed)} combined processing time`);
    }
    if (stats.errors.length) {
        logger.error(`Errors: ${stats.errors.length}`);
    }
    else {
        logger.info(`Errors: ${stats.errors.length}`);
    }
}
// -----------------------------------------------------------------------------
// Main build operation
// -----------------------------------------------------------------------------
export async function runBuild(outputDirectory, cacheDirectory, configHash, options, logger, zopfli) {
    const buildStart = performance.now();
    const outputDirectoryHash = createHash('sha256').update(resolve(outputDirectory)).digest('hex');
    const pluginCacheDirectory = join(cacheDirectory, PLUGIN_NAME);
    const manifestPath = join(pluginCacheDirectory, `${outputDirectoryHash}.json`);
    const artifactDirectory = join(pluginCacheDirectory, 'artifacts', outputDirectoryHash);
    // -------------------------------------------------------------------------
    // Load cache
    // -------------------------------------------------------------------------
    const cache = await loadCache(manifestPath);
    const configChanged = options.recompressOnConfigChange && cache.configHash !== configHash;
    const forceRecompress = !options.performance.incremental || configChanged;
    // -------------------------------------------------------------------------
    // Discover eligible files
    // -------------------------------------------------------------------------
    const files = await findFiles(outputDirectory, options.filters);
    const eligibleFiles = [];
    const currentKeys = new Set();
    for (const filePath of files) {
        const fileStats = await stat(filePath);
        if (fileStats.size < options.filters.minSize) {
            continue;
        }
        const key = toCacheKey(outputDirectory, filePath);
        eligibleFiles.push({
            path: filePath,
            key,
            size: fileStats.size,
        });
        currentKeys.add(key);
    }
    const enabledAlgorithms = Object.entries(options.algorithms)
        .filter(([, value]) => value)
        .map(([algorithm]) => algorithm);
    if (options.logLevel === 0) {
        logger.info(`Processing ${eligibleFiles.length} eligible files`);
    }
    else {
        log(logger, options, 2, `Processing ${eligibleFiles.length} eligible files`);
    }
    log(logger, options, 2, `Output directory: ${outputDirectory}`);
    log(logger, options, 2, `Manifest: ${manifestPath}`);
    log(logger, options, 2, `Artifact cache: ${artifactDirectory}`);
    log(logger, options, 2, `Algorithms: ${enabledAlgorithms.join(', ')}`);
    log(logger, options, 2, `File types: ${options.filters.fileTypes.join(' ')}`);
    log(logger, options, 2, `Incremental: ${options.performance.incremental}`);
    log(logger, options, 2, `Configuration changed: ${configChanged}`);
    log(logger, options, 2, `Force recompression: ${forceRecompress}`);
    // -------------------------------------------------------------------------
    // Initialize statistics
    // -------------------------------------------------------------------------
    const stats = createBuildStats(eligibleFiles.length);
    // -------------------------------------------------------------------------
    // Prune cache
    // -------------------------------------------------------------------------
    if (options.filters.pruneCache) {
        try {
            const removed = await pruneCache(cache, artifactDirectory, currentKeys);
            if (removed > 0) {
                logger.info(`Pruned ${removed} stale cache entr${removed === 1 ? 'y' : 'ies'}.`);
            }
        }
        catch (error) {
            stats.errors.push(error instanceof Error ? error : new Error(String(error)));
        }
    }
    // Remove sidecars belonging to algorithms that are no
    // longer configured.
    for (const file of eligibleFiles) {
        await removeDisabledArtifacts(file.key, artifactDirectory, options.algorithms);
    }
    // -------------------------------------------------------------------------
    // Worker pool
    // -------------------------------------------------------------------------
    let nextIndex = 0;
    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= eligibleFiles.length) {
                return;
            }
            const file = eligibleFiles[index];
            try {
                log(logger, options, 2, `${file.key}: Calculating source hash`);
                const currentHash = await hashFile(file.path);
                const cachedHash = cache.entries[file.key];
                const result = await compressFile(file.path, artifactDirectory, file.key, currentHash, cachedHash, forceRecompress, options, logger, zopfli);
                logFileResult(logger, options, file.key, file.size, result.compressions);
                // Only update the manifest after all configured
                // compression algorithms have succeeded.
                cache.entries[file.key] = currentHash;
                stats.sourceBytes += file.size;
                stats.workerElapsed += result.elapsed;
                const generated = result.compressions.some(compression => compression.generated);
                if (generated) {
                    stats.regeneratedFiles++;
                }
                else {
                    stats.reusedFiles++;
                }
                for (const compression of result.compressions) {
                    const algorithmStats = stats.algorithms[compression.algorithm];
                    algorithmStats.bytes += compression.size;
                    algorithmStats.elapsed += compression.elapsed;
                    if (compression.generated) {
                        algorithmStats.generated++;
                    }
                    if (compression.discarded) {
                        algorithmStats.discarded++;
                    }
                }
            }
            catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                stats.errors.push(new Error(`Failed to process ${file.key}: ${normalizedError.message}`, {
                    cause: normalizedError,
                }));
            }
        }
    }
    // Set concurrency based on available threads and number of algorithms
    const algorithmCount = enabledAlgorithms.length;
    if (!algorithmCount) {
        throw new Error('There are no eligible algorithms selected.');
    }
    const workerCount = Math.min(eligibleFiles.length, Math.max(1, Math.floor(options.performance.concurrency / algorithmCount)));
    if (options.logLevel > 0) {
        logHeader('generating precompressed files');
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    // -------------------------------------------------------------------------
    // Save cache
    // -------------------------------------------------------------------------
    if (stats.errors.length === 0 && options.recompressOnConfigChange) {
        cache.configHash = configHash;
    }
    try {
        await saveCache(manifestPath, cache);
    }
    catch (error) {
        stats.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    // -------------------------------------------------------------------------
    // Build summary
    // -------------------------------------------------------------------------
    const elapsed = performance.now() - buildStart;
    if (options.logLevel >= 1) {
        logger.fork('').info(styleText('green', `✓ Completed in ${formatDuration(elapsed)}\n`));
    }
    else {
        logger.info(styleText('green', `✓ Completed in ${formatDuration(elapsed)}`));
    }
    logger.info(`Processed ${stats.files} source files using ${formatDuration(stats.workerElapsed)} of combined worker time.`);
    const totalGenerated = Object.values(stats.algorithms).reduce((total, algorithm) => total + algorithm.generated, 0);
    const totalDiscarded = Object.values(stats.algorithms).reduce((total, algorithm) => total + algorithm.discarded, 0);
    logger.info(`Reused: ${stats.reusedFiles} | Updated: ${stats.regeneratedFiles} | Generated: ${totalGenerated} (${totalDiscarded} discarded)`);
    if (options.logLevel >= 1) {
        logStatistics(logger, stats);
    }
    for (const error of stats.errors) {
        logError(logger, error);
    }
    if (stats.errors.length > 0 && options.failOnError) {
        throw new Error(`[${PLUGIN_NAME}] Compression failed for ${stats.errors.length} operation(s).`);
    }
    logger.info(styleText('bold', 'Done!'));
}
//# sourceMappingURL=build.js.map