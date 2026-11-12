import { describe, expect, it } from 'vitest'

import precompressor from '../src/integration'

describe('integration options', () => {
	describe('defaults', () => {
		it('creates an integration without options', () => {
			const integration = precompressor()

			expect(integration.name).toBe('astro-precompressor')
		})

		it('accepts an empty configuration', () => {
			expect(() => precompressor({})).not.toThrow()
		})
	})

	describe('concurrency', () => {
		it('accepts a positive integer', () => {
			expect(() =>
				precompressor({
					concurrency: 4,
				}),
			).not.toThrow()
		})

		it('rejects zero', () => {
			expect(() =>
				precompressor({
					concurrency: 0,
				}),
			).toThrow(/concurrency/)
		})

		it('rejects negative values', () => {
			expect(() =>
				precompressor({
					concurrency: -1,
				}),
			).toThrow(/concurrency/)
		})

		it('rejects non-integer values', () => {
			expect(() =>
				precompressor({
					concurrency: 1.5,
				}),
			).toThrow(/concurrency/)
		})
	})

	describe('minSize', () => {
		it('accepts zero', () => {
			expect(() =>
				precompressor({
					minSize: 0,
				}),
			).not.toThrow()
		})

		it('accepts positive values', () => {
			expect(() =>
				precompressor({
					minSize: 1024,
				}),
			).not.toThrow()
		})

		it('rejects negative values', () => {
			expect(() =>
				precompressor({
					minSize: -1,
				}),
			).toThrow(/minSize/)
		})

		it('rejects infinite values', () => {
			expect(() =>
				precompressor({
					minSize: Infinity,
				}),
			).toThrow(/minSize/)
		})

		it('rejects NaN', () => {
			expect(() =>
				precompressor({
					minSize: NaN,
				}),
			).toThrow(/minSize/)
		})
	})

	describe('logLevel', () => {
		it.each([0, 1, 2] as const)('accepts log level %i', logLevel => {
			expect(() =>
				precompressor({
					logLevel,
				}),
			).not.toThrow()
		})

		it('rejects unsupported levels', () => {
			expect(() =>
				precompressor({
					logLevel: 3 as 0,
				}),
			).toThrow(/logLevel/)
		})

		it('rejects negative levels', () => {
			expect(() =>
				precompressor({
					logLevel: -1 as 0,
				}),
			).toThrow(/logLevel/)
		})
	})

	describe('fileTypes', () => {
		it('accepts extensions with leading dots', () => {
			expect(() =>
				precompressor({
					fileTypes: ['.html', '.css'],
				}),
			).not.toThrow()
		})

		it('accepts extensions without leading dots', () => {
			expect(() =>
				precompressor({
					fileTypes: ['html', 'css'],
				}),
			).not.toThrow()
		})

		it('accepts mixed case extensions', () => {
			expect(() =>
				precompressor({
					fileTypes: ['HTML', '.CSS', 'Js'],
				}),
			).not.toThrow()
		})

		it('accepts an empty array', () => {
			expect(() =>
				precompressor({
					fileTypes: [],
				}),
			).not.toThrow()
		})

		it('rejects invalid extensions', () => {
			expect(() =>
				precompressor({
					fileTypes: ['.html', '../css'],
				}),
			).toThrow(/Invalid file extension/)
		})

		it('rejects empty extensions', () => {
			expect(() =>
				precompressor({
					fileTypes: [''],
				}),
			).toThrow(/Invalid file extension/)
		})

		it('rejects extensions containing spaces', () => {
			expect(() =>
				precompressor({
					fileTypes: ['ht ml'],
				}),
			).toThrow(/Invalid file extension/)
		})
	})

	describe('algorithms', () => {
		it('accepts Brotli only', () => {
			expect(() =>
				precompressor({
					algorithms: ['brotli'],
				}),
			).not.toThrow()
		})

		it('accepts Gzip only', () => {
			expect(() =>
				precompressor({
					algorithms: ['gzip'],
				}),
			).not.toThrow()
		})

		it('accepts both algorithms', () => {
			expect(() =>
				precompressor({
					algorithms: ['brotli', 'gzip'],
				}),
			).not.toThrow()
		})

		it('removes duplicate algorithms', () => {
			expect(() =>
				precompressor({
					algorithms: ['brotli', 'brotli'],
				}),
			).not.toThrow()
		})

		it('rejects an empty algorithm array', () => {
			expect(() =>
				precompressor({
					algorithms: [],
				}),
			).toThrow(/At least one compression algorithm/)
		})

		it('rejects unsupported algorithms', () => {
			expect(() =>
				precompressor({
					algorithms: ['deflate' as 'gzip'],
				}),
			).toThrow(/Unsupported compression algorithm/)
		})
	})

	describe('Zopfli', () => {
		it('accepts false', () => {
			expect(() =>
				precompressor({
					useZopfli: false,
				}),
			).not.toThrow()
		})

		it('accepts true', () => {
			expect(() =>
				precompressor({
					useZopfli: true,
				}),
			).not.toThrow()
		})

		it('accepts a partial configuration', () => {
			expect(() =>
				precompressor({
					useZopfli: {
						numiterations: 20,
					},
				}),
			).not.toThrow()
		})

		it('accepts a complete configuration', () => {
			expect(() =>
				precompressor({
					useZopfli: {
						numiterations: 20,
						blocksplitting: false,
						blocksplittinglast: true,
						blocksplittingmax: 10,
					},
				}),
			).not.toThrow()
		})
	})
})
