import { availableParallelism } from 'node:os';
import { constants } from 'node:zlib';
export const PLUGIN_NAME = 'astro-precompressor';
/** Cache serial, increase to force recompression on update */
export const CACHE_VERSION = 1;
export const DEFAULT_CONCURRENCY = availableParallelism();
// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------
export const DEFAULT_MIN_SIZE = 150;
// -----------------------------------------------------------------------------
// Recommended file types for compression
// -----------------------------------------------------------------------------
export const WEB_FILE_TYPES = [
    '.html',
    '.htm',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
];
export const DATA_FILE_TYPES = [
    '.json',
    '.xml',
    '.rss',
    '.atom',
];
export const FONT_FILE_TYPES = [
    '.ttf',
    '.otf',
    '.eot',
];
export const DEFAULT_FILE_TYPES = [
    ...WEB_FILE_TYPES,
    ...DATA_FILE_TYPES,
    ...FONT_FILE_TYPES,
    '.txt',
    '.svg',
];
// -----------------------------------------------------------------------------
// Already compressed file types
// -----------------------------------------------------------------------------
export const IMAGE_FILE_TYPES = [
    '.ico',
    '.cur',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.jxl',
    '.heic',
    '.heif',
];
export const VIDEO_FILE_TYPES = [
    '.mp4',
    '.webm',
    '.mov',
    '.mkv',
    '.avi',
    '.flv',
    '.wmv',
    '.m4v',
    '.ts',
];
export const AUDIO_FILE_TYPES = [
    '.mp3',
    '.aac',
    '.ogg',
    '.opus',
    '.flac',
    '.m4a',
    '.wav',
];
export const ARCHIVE_FILE_TYPES = [
    '.7z',
    '.rar',
    '.gz',
    '.bz2',
    '.xz',
    '.zst',
    '.br',
    '.dmg',
    '.iso',
];
export const WOFF_FILE_TYPES = [
    '.woff',
    '.woff2',
];
export const SILLY_FILE_TYPES = [
    ...IMAGE_FILE_TYPES,
    ...VIDEO_FILE_TYPES,
    ...AUDIO_FILE_TYPES,
    ...ARCHIVE_FILE_TYPES,
    ...WOFF_FILE_TYPES,
    '.docx',
    '.xlsx',
    '.pptx',
    '.epub',
    '.exe',
    '.bin',
];
// -----------------------------------------------------------------------------
// Compression options
// -----------------------------------------------------------------------------
export const SUPPORTED_ENGINES = [
    'zlib',
    'zopfli',
];
export const SUPPORTED_ALGORITHMS = [
    'gzip',
    'brotli',
    'zstd',
];
export const DEFAULT_ALGORITHMS = {
    gzip: true,
    brotli: true,
    zstd: false,
};
export const ALGORITHM_EXTENSIONS = {
    gzip: '.gz',
    brotli: '.br',
    zstd: '.zst',
};
export const DEFAULT_ZLIB_OPTIONS = {
    level: constants.Z_BEST_COMPRESSION,
    memLevel: constants.Z_MAX_MEMLEVEL,
};
export const DEFAULT_BROTLI_OPTIONS = {
    params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
    },
};
export const DEFAULT_ZSTD_OPTIONS = {
    params: {
        [constants.ZSTD_c_compressionLevel]: 22,
    },
};
export const DEFAULT_ZOPFLI_OPTIONS = {
    numiterations: 5,
    blocksplitting: false,
};
export const DEFAULT_LOG_LEVEL = 2;
//# sourceMappingURL=constants.js.map