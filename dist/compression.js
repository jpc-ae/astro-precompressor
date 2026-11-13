import { createGzip, createBrotliCompress, createZstdCompress } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { copyPreservingTimestamps, fileExists, getArtifactPath } from './cache.js';
import { formatDuration, log } from './utils.js';
import { ALGORITHM_EXTENSIONS } from './constants.js';
// -----------------------------------------------------------------------------
// Compressor factory
// -----------------------------------------------------------------------------
function createCompressor(algorithm, options, zopfli) {
    if (algorithm === 'gzip' && options.gzip) {
        if ('zopfli' in options.gzip) {
            if (!zopfli) {
                throw new Error('Zopfli module has not been initialized.');
            }
            return zopfli.createGzip(options.gzip.zopfli);
        }
        return createGzip(options.gzip);
    }
    if (algorithm === 'brotli' && options.brotli) {
        return createBrotliCompress(options.brotli);
    }
    if (algorithm === 'zstd' && options.zstd) {
        return createZstdCompress(options.zstd);
    }
    throw new Error('Invalid compression context.');
}
// -----------------------------------------------------------------------------
// Generate compressed output
// -----------------------------------------------------------------------------
async function generateCompressedFile(sourcePath, destination, algorithm, options, zopfli) {
    await mkdir(dirname(destination), {
        recursive: true,
    });
    const temporaryPath = `${destination}.${randomUUID()}.tmp`;
    try {
        const compressor = createCompressor(algorithm, options, zopfli);
        await pipeline(createReadStream(sourcePath), compressor, createWriteStream(temporaryPath, {
            flags: 'wx',
        }));
        await rename(temporaryPath, destination);
    }
    catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => { });
        throw error;
    }
}
// -----------------------------------------------------------------------------
// Process one algorithm
// -----------------------------------------------------------------------------
async function processAlgorithm(sourcePath, artifactDirectory, relativePath, algorithm, currentHash, cachedHash, forceRecompress, options, logger, zopfli) {
    const start = performance.now();
    const extension = ALGORITHM_EXTENSIONS[algorithm];
    const cachePath = getArtifactPath(artifactDirectory, relativePath, extension);
    const outputPath = `${sourcePath}${extension}`;
    const hashMatches = !forceRecompress && currentHash === cachedHash;
    const cached = hashMatches && (await fileExists(cachePath));
    log(logger, options, 2, `${relativePath}: ${algorithm} cache ${cached ? 'hit' : 'miss'}`);
    if (!cached) {
        log(logger, options, 2, `${relativePath}: Starting ${algorithm} compression`);
        await generateCompressedFile(sourcePath, cachePath, algorithm, options.algorithms, zopfli);
        log(logger, options, 2, `${relativePath}: ${algorithm} compression complete`);
    }
    const sourceStats = await stat(sourcePath);
    const compressedStats = await stat(cachePath);
    const discarded = options.performance.discardCompressionIfLarger && compressedStats.size >= sourceStats.size;
    if (discarded) {
        log(logger, options, 2, `${relativePath}: Skipping ${algorithm} because compressed size is not smaller`);
    }
    else {
        await copyPreservingTimestamps(cachePath, outputPath);
    }
    const elapsed = performance.now() - start;
    log(logger, options, 2, `${relativePath}: ${algorithm} processed in ${formatDuration(elapsed)}`);
    return {
        algorithm,
        elapsed,
        generated: !cached,
        size: discarded ? 0 : compressedStats.size,
        discarded,
    };
}
// -----------------------------------------------------------------------------
// Process one source file using all configured algorithms
// -----------------------------------------------------------------------------
export async function compressFile(sourcePath, artifactDirectory, relativePath, currentHash, cachedHash, forceRecompress, options, logger, zopfli) {
    const start = performance.now();
    // Each algorithm has its own independent input stream.
    // Promise.allSettled ensures that one failed algorithm does not
    // prevent the other algorithms from completing.
    const processors = [];
    for (const [algorithm, value] of Object.entries(options.algorithms)) {
        if (!value) {
            continue;
        }
        processors.push(processAlgorithm(sourcePath, artifactDirectory, relativePath, algorithm, currentHash, cachedHash, forceRecompress, options, logger, zopfli));
    }
    const results = await Promise.allSettled(processors);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length === 1) {
        throw failures[0].reason;
    }
    if (failures.length > 1) {
        throw new AggregateError(failures.map(failure => failure.reason), `One or more compression algorithms failed for ${relativePath}.`);
    }
    return {
        elapsed: performance.now() - start,
        compressions: results.map(result => {
            if (result.status !== 'fulfilled') {
                throw result.reason;
            }
            return result.value;
        }),
    };
}
//# sourceMappingURL=compression.js.map