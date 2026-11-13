import type { CompressionResult, Logger, ResolvedOptions, ZopfliModule } from './types.js';
export declare function compressFile(sourcePath: string, artifactDirectory: string, relativePath: string, currentHash: string, cachedHash: string | undefined, forceRecompress: boolean, options: ResolvedOptions, logger: Logger, zopfli: ZopfliModule | undefined): Promise<{
    elapsed: number;
    compressions: CompressionResult[];
}>;
//# sourceMappingURL=compression.d.ts.map