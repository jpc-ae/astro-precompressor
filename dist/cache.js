import { copyFile, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { ALGORITHM_EXTENSIONS, CACHE_VERSION } from './constants.js';
import { resolveInsideDirectory } from './utils.js';
// -----------------------------------------------------------------------------
// Manifest
// -----------------------------------------------------------------------------
export function emptyCache() {
    return {
        version: CACHE_VERSION,
        configHash: null,
        entries: {},
    };
}
export async function loadCache(manifestPath) {
    try {
        const contents = await readFile(manifestPath, 'utf8');
        const parsed = JSON.parse(contents);
        if (parsed.version !== CACHE_VERSION ||
            !parsed.entries ||
            typeof parsed.entries !== 'object' ||
            Array.isArray(parsed.entries)) {
            return emptyCache();
        }
        const entries = {};
        for (const [key, value] of Object.entries(parsed.entries)) {
            if (typeof value === 'string') {
                entries[key] = value;
            }
        }
        return {
            version: CACHE_VERSION,
            configHash: typeof parsed.configHash === 'string' ? parsed.configHash : null,
            entries,
        };
    }
    catch {
        return emptyCache();
    }
}
export async function saveCache(manifestPath, cache) {
    await mkdir(dirname(manifestPath), {
        recursive: true,
    });
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, JSON.stringify(cache, null, 2), 'utf8');
        await rename(temporaryPath, manifestPath);
    }
    catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => { });
        throw error;
    }
}
// -----------------------------------------------------------------------------
// Artifact paths
// -----------------------------------------------------------------------------
export function getArtifactPath(artifactDirectory, relativePath, extension) {
    const target = resolveInsideDirectory(artifactDirectory, relativePath);
    return `${target}${extension}`;
}
// -----------------------------------------------------------------------------
// File utilities
// -----------------------------------------------------------------------------
export async function fileExists(path) {
    try {
        const info = await stat(path);
        return info.isFile();
    }
    catch {
        return false;
    }
}
export async function copyPreservingTimestamps(source, destination) {
    const sourceStats = await stat(source);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await utimes(destination, sourceStats.atime, sourceStats.mtime);
}
// -----------------------------------------------------------------------------
// Pruning
// -----------------------------------------------------------------------------
export async function pruneCache(cache, artifactDirectory, currentKeys) {
    const retainedEntries = {};
    let removed = 0;
    for (const [key, hash] of Object.entries(cache.entries)) {
        if (currentKeys.has(key)) {
            retainedEntries[key] = hash;
            continue;
        }
        for (const extension of Object.values(ALGORITHM_EXTENSIONS)) {
            const cachePath = getArtifactPath(artifactDirectory, key, extension);
            await rm(cachePath, { force: true });
        }
        removed++;
    }
    cache.entries = retainedEntries;
    return removed;
}
// -----------------------------------------------------------------------------
// Remove disabled algorithms
// -----------------------------------------------------------------------------
export async function removeDisabledArtifacts(relativePath, artifactDirectory, algorithms) {
    for (const [algorithm, extension] of Object.entries(ALGORITHM_EXTENSIONS)) {
        const typedAlgorithm = algorithm;
        if (!algorithms[typedAlgorithm]) {
            await rm(getArtifactPath(artifactDirectory, relativePath, extension), { force: true });
        }
    }
}
//# sourceMappingURL=cache.js.map