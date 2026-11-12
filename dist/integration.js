import { fileURLToPath } from 'node:url';
import { DEFAULT_ALGORITHMS, DEFAULT_CONCURRENCY, DEFAULT_FILE_TYPES, DEFAULT_ZOPFLI_OPTIONS, PLUGIN_NAME, } from './constants.js';
import { createConfigHash, normalizeExtensions } from './utils.js';
import { runBuild } from './build.js';
/**
 * Dynamically load zopfli when needed
 */
async function loadZopfli() {
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
        const userAgent = process.env.npm_config_user_agent ?? '';
        const packageManager = ['pnpm', 'yarn', 'bun', 'npm'].find(manager => userAgent.includes(manager));
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
function resolveAlgorithms(algorithms) {
    const resolved = [...new Set(algorithms ?? DEFAULT_ALGORITHMS)];
    for (const algorithm of resolved) {
        if (algorithm !== 'brotli' && algorithm !== 'gzip') {
            throw new Error(`[${PLUGIN_NAME}] Unsupported compression algorithm: "${algorithm}".`);
        }
    }
    if (resolved.length === 0) {
        throw new Error(`[${PLUGIN_NAME}] At least one compression algorithm must be specified.`);
    }
    return resolved;
}
function resolveOptions(userOptions) {
    const options = {
        concurrency: userOptions.concurrency ?? DEFAULT_CONCURRENCY,
        incremental: userOptions.incremental ?? true,
        minSize: userOptions.minSize ?? 0,
        failOnError: userOptions.failOnError ?? false,
        prune: userOptions.prune ?? false,
        useZopfli: resolveZopfliOptions(userOptions.useZopfli),
        recompressOnConfigChange: userOptions.recompressOnConfigChange ?? false,
        logLevel: userOptions.logLevel ?? 0,
        fileTypes: normalizeExtensions(userOptions.fileTypes ?? DEFAULT_FILE_TYPES),
        algorithms: resolveAlgorithms(userOptions.algorithms),
    };
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
        throw new Error(`[${PLUGIN_NAME}] concurrency must be a positive integer.`);
    }
    if (!Number.isFinite(options.minSize) || options.minSize < 0) {
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
    const shouldLoadZopfli = options.algorithms.includes('gzip') && Boolean(options.useZopfli);
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
                    logger.debug('Loading Zopfli');
                    zopfli = await zopfliPromise;
                }
                cacheDirectory = fileURLToPath(config.cacheDir);
                configHash = createConfigHash(config, options);
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