import { ALGORITHM_EXTENSIONS } from './constants.js';
import type { CacheManifest, ResolvedAlgorithmOptions } from './types.js';
export declare function emptyCache(): CacheManifest;
export declare function loadCache(manifestPath: string): Promise<CacheManifest>;
export declare function saveCache(manifestPath: string, cache: CacheManifest): Promise<void>;
export declare function getArtifactPath(artifactDirectory: string, relativePath: string, extension: (typeof ALGORITHM_EXTENSIONS)[keyof typeof ALGORITHM_EXTENSIONS]): string;
export declare function fileExists(path: string): Promise<boolean>;
export declare function copyPreservingTimestamps(source: string, destination: string): Promise<void>;
export declare function pruneCache(cache: CacheManifest, artifactDirectory: string, currentKeys: Set<string>): Promise<number>;
export declare function removeDisabledArtifacts(relativePath: string, artifactDirectory: string, algorithms: ResolvedAlgorithmOptions): Promise<void>;
//# sourceMappingURL=cache.d.ts.map