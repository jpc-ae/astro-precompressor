import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:zlib'

import precompressor from '../../../dist/index.js'
import type { CompressionOptions } from '../../../dist/index.js'

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
	txtOnly: {
		algorithms: gzipOnly,
		filters: {
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

export default defineConfig({
	output: 'static',
	cacheDir: fileURLToPath(new URL('./.site-cache/', import.meta.url)),
	build: {
		format: 'directory',
	},
	integrations: [precompressor(configurations[scenario])],
})
