import type { Logger, ResolvedOptions } from './types.js';
export declare function getPackageManager(): string;
export declare function sha256(value: string): string;
export declare function hashFile(path: string): Promise<string>;
export declare function normalizeExtensions(extensions: string[]): string[];
export declare function toCacheKey(outputDirectory: string, filePath: string): string;
export declare function isInsideDirectory(directory: string, target: string): boolean;
export declare function resolveInsideDirectory(directory: string, relativePath: string): string;
export declare function formatBytes(bytes: number): string;
export declare function formatDuration(ms: number): string;
export declare function green(message: string): string;
export declare function blue(message: string): string;
export declare function dim(message: string): string;
export declare function createConfigHash(config: unknown, options: ResolvedOptions): string;
export declare function log(logger: Logger, options: ResolvedOptions, level: 1 | 2, message: string): void;
export declare function logError(logger: Logger, error: unknown): void;
export declare function logHeader(title: string): void;
//# sourceMappingURL=utils.d.ts.map