import { describe, expect, it } from 'vitest'

import { checkForZstd } from '../src/zstd.js'

import type { ZstdCompress } from 'node:zlib'

describe('Zstandard availability', () => {
	it('does not throw when Zstandard is available', () => {
		expect(() =>
			checkForZstd((): ZstdCompress => {
				return {} as ZstdCompress
			}),
		).not.toThrow()
	})

	it('throws a helpful error when Zstandard is unavailable', () => {
		expect(() => checkForZstd(null)).toThrow(/Node\.js 22\.15\.0 or later/)
	})
})
