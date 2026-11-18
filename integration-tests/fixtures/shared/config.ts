import { defineConfig } from 'astro/config'
import { resolve } from 'node:path'
import { constants } from 'node:zlib'

import precompressor from '../../../dist/index.js'
import type { CompressionOptions } from '../../../dist/index.js'

type BuildFormat = 'file' | 'directory' | 'preserve' | undefined

const scenario = process.env.PRECOMPRESSOR_TEST_SCENARIO ?? 'basic'

const fastGzip = {
	level: constants.Z_MIN_LEVEL,
}

const fastBrotli = {
	params: {
		[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MIN_QUALITY,
	},
}

const fastZstandard = {
	params: {
		[constants.ZSTD_c_compressionLevel]: 1,
	},
}

const fastZopfli = {
	numiterations: 1,
}

const gzipOnly = {
	gzip: fastGzip,
	brotli: false,
}

const configurations: Record<string, CompressionOptions> = {
	basic: {},
	gzipOnly: {
		algorithms: gzipOnly,
	},
	brotliOnly: {
		algorithms: {
			gzip: false,
			brotli: fastBrotli,
		},
	},
	zstdOnly: {
		algorithms: {
			gzip: false,
			brotli: false,
			zstd: fastZstandard,
		},
	},
	zopfliOnly: {
		algorithms: {
			gzip: {
				zopfli: fastZopfli,
			},
			brotli: false,
		},
	},
	filters: {
		algorithms: gzipOnly,
		filters: {
			fileTypes: ['.html', '.txt'],
			minSize: 1,
			exclude: ['ignored/**'],
		},
	},
	picomatchOnly: {
		algorithms: gzipOnly,
		filters: {
			fileTypes: ['.html', '.txt', '.bin'],
			minSize: 1,
			include: ['**/*.txt'],
			exclude: ['ignored/**'],
		},
	},
	fileTypesNotIncluded: {
		algorithms: gzipOnly,
		filters: {
			fileTypes: ['.html', '.bin'],
			minSize: 1,
			include: ['**/*.txt'],
		},
	},
	cache: {
		algorithms: gzipOnly,
	},
}

if (!(scenario in configurations)) {
	throw new Error(`Unknown PRECOMPRESSOR_TEST_SCENARIO: ${scenario}`)
}

export function createAstroConfig(
	fixtureDirectory: string,
	options: CompressionOptions = configurations[scenario],
	buildFormat: BuildFormat = 'directory',
) {
	return defineConfig({
		output: 'static',
		cacheDir: resolve(fixtureDirectory, '.cache'),
		build: { format: buildFormat },
		integrations: [precompressor(options)],
	})
}
