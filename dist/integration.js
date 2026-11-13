import { fileURLToPath } from 'node:url';
import { DEFAULT_CONCURRENCY, DEFAULT_FILE_TYPES, DEFAULT_ZLIB_OPTIONS, DEFAULT_BROTLI_OPTIONS, DEFAULT_ZSTD_OPTIONS, DEFAULT_ZOPFLI_OPTIONS, PLUGIN_NAME, DEFAULT_MIN_SIZE, SILLY_FILE_TYPES, DEFAULT_ALGORITHMS, DEFAULT_LOG_LEVEL, } from './constants.js';
import { createConfigHash, getPackageManager, log, normalizeExtensions } from './utils.js';
import { runBuild } from './build.js';
import { resolve } from 'node:path';
/**
 * Dynamically load zopfli when needed
 */
export async function loadZopfli() {
    try {
        const zopfliPackage = (await import('node-zopfli-es'));
        return zopfliPackage.default;
    }
    catch (error) {
        const installScripts = new Map([
            ['pnpm', 'pnpm add -D node-zopfli-es'],
            ['yarn', 'yarn add -D node-zopfli-es'],
            ['bun', 'bun add -d node-zopfli-es'],
            ['npm', 'npm install -D node-zopfli-es'],
        ]);
        const packageManager = getPackageManager();
        const command = packageManager ? installScripts.get(packageManager) : undefined;
        throw new Error(`The "node-zopfli-es" package is required when Zopfli is enabled.${command ? ` Install it with: ${command}` : ''}`, { cause: error });
    }
}
// -----------------------------------------------------------------------------
// Option resolution
// -----------------------------------------------------------------------------
function resolveZopfliOptions(value) {
    if (!value) {
        return false;
    }
    const options = {
        ...DEFAULT_ZOPFLI_OPTIONS,
        ...(typeof value === 'object' ? value : {}),
    };
    return options;
}
function resolveGzipOptions(value) {
    if (!value) {
        return false;
    }
    if (typeof value === 'object' && 'zopfli' in value) {
        const zopfliOptions = resolveZopfliOptions(value.zopfli);
        if (zopfliOptions) {
            return { zopfli: zopfliOptions };
        }
    }
    return {
        ...DEFAULT_ZLIB_OPTIONS,
        ...(typeof value === 'object' ? value : {}),
    };
}
function resolveBrotliOptions(value) {
    if (!value) {
        return false;
    }
    const options = {
        ...DEFAULT_BROTLI_OPTIONS,
        ...(typeof value === 'object' ? value : {}),
    };
    return options;
}
function resolveZstdOptions(value) {
    if (!value) {
        return false;
    }
    const options = {
        ...DEFAULT_ZSTD_OPTIONS,
        ...(typeof value === 'object' ? value : {}),
    };
    return options;
}
function resolveOptions(userOptions) {
    const algorithms = {
        ...DEFAULT_ALGORITHMS,
        ...userOptions.algorithms,
    };
    const options = {
        algorithms: {
            gzip: resolveGzipOptions(algorithms.gzip),
            brotli: resolveBrotliOptions(algorithms.brotli),
            zstd: resolveZstdOptions(algorithms.zstd),
        },
        performance: {
            concurrency: userOptions.performance?.concurrency ?? DEFAULT_CONCURRENCY,
            incremental: userOptions.performance?.incremental ?? true,
            discardCompressionIfLarger: userOptions.performance?.discardCompressionIfLarger ?? true,
        },
        filters: {
            minSize: userOptions.filters?.minSize ?? DEFAULT_MIN_SIZE,
            fileTypes: normalizeExtensions(userOptions.filters?.fileTypes ?? DEFAULT_FILE_TYPES),
            include: userOptions.filters?.include,
            exclude: userOptions.filters?.exclude,
            pruneCache: userOptions.filters?.pruneCache ?? true,
        },
        logLevel: userOptions.logLevel ?? DEFAULT_LOG_LEVEL,
        failOnError: userOptions.failOnError ?? false,
        recompressOnConfigChange: userOptions.recompressOnConfigChange ?? false,
    };
    if (!(options.algorithms.gzip || options.algorithms.brotli || options.algorithms.zstd)) {
        throw new Error(`[${PLUGIN_NAME}] At least one compression algorithm must be enabled.`);
    }
    if (!Number.isInteger(options.performance.concurrency) || options.performance.concurrency < 1) {
        throw new Error(`[${PLUGIN_NAME}] concurrency must be a positive integer.`);
    }
    if (!options.filters.fileTypes.length) {
        throw new Error(`[${PLUGIN_NAME}] At least one file type must be provided.`);
    }
    if (!Number.isFinite(options.filters.minSize) || options.filters.minSize < 0) {
        throw new Error(`[${PLUGIN_NAME}] minSize must be a non-negative number.`);
    }
    if (![0, 1, 2].includes(options.logLevel)) {
        throw new Error(`[${PLUGIN_NAME}] logLevel must be 0, 1, or 2.`);
    }
    return options;
}
// -----------------------------------------------------------------------------
// Astro integration
// -----------------------------------------------------------------------------
export default function precompressor(userOptions = {}) {
    const options = resolveOptions(userOptions);
    const shouldLoadZopfli = options.algorithms.gzip && 'zopfli' in options.algorithms.gzip;
    // Start zopfli import while vite is still available, ignoring errors if unawaited
    const zopfliPromise = shouldLoadZopfli ? loadZopfli() : undefined;
    void zopfliPromise?.catch(() => { });
    let zopfli;
    let cacheDirectory;
    let configHash;
    return {
        name: PLUGIN_NAME,
        hooks: {
            'astro:config:setup': async ({ config, logger }) => {
                // Finish loading Zopfli only if needed
                if (shouldLoadZopfli) {
                    log(logger, options, 2, 'Loading Zopfli');
                    zopfli = await zopfliPromise;
                }
                cacheDirectory = resolve(fileURLToPath(config.cacheDir));
                configHash = createConfigHash(config, options);
                for (const fileType of options.filters.fileTypes) {
                    if (SILLY_FILE_TYPES.includes(fileType)) {
                        logger.warn(`Compressing ${fileType} files is silly, but since you asked...`);
                    }
                }
            },
            'astro:build:done': async ({ dir, logger }) => {
                if (!cacheDirectory || !configHash) {
                    throw new Error(`[${PLUGIN_NAME}] Integration was not initialized correctly.`);
                }
                await runBuild(fileURLToPath(dir), cacheDirectory, configHash, options, logger, zopfli);
            },
        },
    };
}
//# sourceMappingURL=integration.js.map