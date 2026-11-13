import { gunzipSync } from 'node:zlib'
import { Readable, Transform } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadZopfli } from '../src/integration.js'

describe('Zopfli', () => {
	afterEach(() => {
		vi.doUnmock('node-zopfli-es')
		vi.resetModules()
	})

	describe('loadZopfli', () => {
		it('loads the Zopfli module', async () => {
			const zopfli = await loadZopfli()

			expect(zopfli).toBeDefined()
			expect(zopfli.createGzip).toBeTypeOf('function')
		})

		it('returns a module that creates Gzip streams', async () => {
			const zopfli = await loadZopfli()
			const compressor = zopfli.createGzip()

			expect(compressor).toBeInstanceOf(Transform)

			compressor.destroy()
		})

		it('rejects when the Zopfli module cannot be loaded', async () => {
			vi.resetModules()

			vi.doMock('node-zopfli-es', () => {
				throw new Error('Module unavailable')
			})

			const { loadZopfli: load } = await import('../src/integration.js')

			await expect(load()).rejects.toThrow()
		})
	})

	describe('compression', () => {
		it('produces valid Gzip data', async () => {
			const content = Buffer.from('<html><body>Test content</body></html>\n'.repeat(100))

			const zopfli = await loadZopfli()
			const compressor = zopfli.createGzip()
			const chunks: Buffer[] = []

			for await (const chunk of Readable.from([content]).pipe(compressor)) {
				chunks.push(Buffer.from(chunk))
			}

			const compressed = Buffer.concat(chunks)

			expect(compressed.length).toBeGreaterThan(0)
			expect(gunzipSync(compressed)).toEqual(content)
		})

		it('compresses empty input into valid Gzip data', async () => {
			const content = Buffer.alloc(0)

			const zopfli = await loadZopfli()
			const compressor = zopfli.createGzip()
			const chunks: Buffer[] = []

			for await (const chunk of Readable.from([content]).pipe(compressor)) {
				chunks.push(Buffer.from(chunk))
			}

			const compressed = Buffer.concat(chunks)

			expect(compressed.length).toBeGreaterThan(0)
			expect(gunzipSync(compressed)).toEqual(content)
		})

		it('handles binary input', async () => {
			const content = Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 256))

			const zopfli = await loadZopfli()
			const compressor = zopfli.createGzip()
			const chunks: Buffer[] = []

			for await (const chunk of Readable.from([content]).pipe(compressor)) {
				chunks.push(Buffer.from(chunk))
			}

			const compressed = Buffer.concat(chunks)

			expect(gunzipSync(compressed)).toEqual(content)
		})

		it('accepts custom Zopfli options', async () => {
			const content = Buffer.from('<html><body>Custom options</body></html>\n'.repeat(100))

			const zopfli = await loadZopfli()
			const compressor = zopfli.createGzip({
				numiterations: 5,
			})
			const chunks: Buffer[] = []

			for await (const chunk of Readable.from([content]).pipe(compressor)) {
				chunks.push(Buffer.from(chunk))
			}

			const compressed = Buffer.concat(chunks)

			expect(gunzipSync(compressed)).toEqual(content)
		})
	})
})
