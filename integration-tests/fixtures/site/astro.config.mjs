import { defineConfig } from 'astro/config'
import precompressor from '../../../dist/index.js'
import { fileURLToPath } from 'node:url'

const scenario = process.env.PRECOMPRESSOR_TEST_SCENARIO ?? 'basic'

const configurations = {
	basic: {
		algorithms: {
			gzip: { level: 1 },
			brotli: true,
			zstd: false,
		},
	},
	brotliOnly: {
		algorithms: {
			gzip: false,
			brotli: true,
			zstd: false,
		},
	},
	filters: {
		algorithms: {
			gzip: { level: 1 },
			brotli: false,
			zstd: false,
		},
		filters: {
			fileTypes: ['.html', '.txt'],
			minSize: 1,
			exclude: ['ignored/**'],
		},
	},
	cache: {
		algorithms: {
			gzip: { level: 1 },
			brotli: false,
			zstd: false,
		},
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
