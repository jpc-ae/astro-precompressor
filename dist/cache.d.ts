import type { CacheManifest } from './types.js';
export declare function emptyCache(): CacheManifest;
export declare function loadCache(manifestPath: string): Promise<CacheManifest>;
export declare function saveCache(manifestPath: string, cache: CacheManifest): Promise<void>;
export declare function getArtifactPath(artifactDirectory: string, relativePath: string, extension: 'br' | 'gz'): string;
export declare function fileExists(path: string): Promise<boolean>;
export declare function copyPreservingTimestamps(source: string, destination: string): Promise<void>;
export declare function pruneCache(cache: CacheManifest, artifactDirectory: string, outputDirectory: string, currentKeys: Set<string>): Promise<number>;
export declare function removeDisabledArtifacts(relativePath: string, artifactDirectory: string, sourcePath: string, algorithms: Set<'brotli' | 'gzip'>): Promise<void>;
//# sourceMappingURL=cache.d.ts.map