export type LogLevel = 0 | 1 | 2;
export type CompressionAlgorithm = 'brotli' | 'gzip';
export type ZopfliModule = typeof import('node-zopfli-es');
export interface ZopfliOptions {
    numiterations?: number;
    blocksplitting?: boolean;
    blocksplittinglast?: boolean;
    blocksplittingmax?: number;
}
export interface CompressionOptions {
    concurrency?: number;
    incremental?: boolean;
    minSize?: number;
    failOnError?: boolean;
    prune?: boolean;
    useZopfli?: boolean | Partial<ZopfliOptions>;
    recompressOnConfigChange?: boolean;
    logLevel?: LogLevel;
    fileTypes?: string[];
    algorithms?: CompressionAlgorithm[];
}
export interface ResolvedOptions {
    concurrency: number;
    incremental: boolean;
    minSize: number;
    failOnError: boolean;
    prune: boolean;
    useZopfli: false | ZopfliOptions;
    recompressOnConfigChange: boolean;
    logLevel: LogLevel;
    fileTypes: string[];
    algorithms: CompressionAlgorithm[];
}
export interface CacheManifest {
    version: number;
    configHash: string | null;
    entries: Record<string, string>;
}
export interface CompressionResult {
    algorithm: CompressionAlgorithm;
    elapsed: number;
    generated: boolean;
    size: number;
}
export interface FileResult {
    elapsed: number;
    compressions: CompressionResult[];
}
export interface AlgorithmStats {
    generated: number;
    bytes: number;
    elapsed: number;
}
export interface BuildStats {
    files: number;
    reusedFiles: number;
    regeneratedFiles: number;
    sourceBytes: number;
    workerElapsed: number;
    algorithms: Record<CompressionAlgorithm, AlgorithmStats>;
    errors: Error[];
}
export interface IntegrationLogger {
    fork(label: string): IntegrationLogger;
    info(message: string): void;
    debug(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
//# sourceMappingURL=types.d.ts.map