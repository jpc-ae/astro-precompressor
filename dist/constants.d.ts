import type { ZlibOptions, BrotliOptions, ZstdOptions, ZopfliOptions, LogLevel } from './types.js';
export declare const PLUGIN_NAME = "astro-precompressor";
/** Cache serial, increase to force recompression on update */
export declare const CACHE_VERSION = 1;
export declare const DEFAULT_CONCURRENCY: number;
export declare const DEFAULT_MIN_SIZE = 150;
export declare const WEB_FILE_TYPES: string[];
export declare const DATA_FILE_TYPES: string[];
export declare const FONT_FILE_TYPES: string[];
export declare const DEFAULT_FILE_TYPES: string[];
export declare const IMAGE_FILE_TYPES: string[];
export declare const VIDEO_FILE_TYPES: string[];
export declare const AUDIO_FILE_TYPES: string[];
export declare const ARCHIVE_FILE_TYPES: string[];
export declare const WOFF_FILE_TYPES: string[];
export declare const SILLY_FILE_TYPES: string[];
export declare const SUPPORTED_ENGINES: readonly ['zlib', 'zopfli'];
export declare const SUPPORTED_ALGORITHMS: readonly ['gzip', 'brotli', 'zstd'];
export declare const DEFAULT_ALGORITHMS: {
    readonly gzip: true;
    readonly brotli: true;
    readonly zstd: false;
};
export declare const ALGORITHM_EXTENSIONS: {
    readonly gzip: '.gz';
    readonly brotli: '.br';
    readonly zstd: '.zst';
};
export declare const DEFAULT_ZLIB_OPTIONS: ZlibOptions;
export declare const DEFAULT_BROTLI_OPTIONS: BrotliOptions;
export declare const DEFAULT_ZSTD_OPTIONS: ZstdOptions;
export declare const DEFAULT_ZOPFLI_OPTIONS: ZopfliOptions;
export declare const DEFAULT_LOG_LEVEL: LogLevel;
//# sourceMappingURL=constants.d.ts.map