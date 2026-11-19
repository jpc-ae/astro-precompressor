import { mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { runBuild } from '../src/build.js'
import { createBrotliCompressorFactory } from '../src/brotli.js'
import { createResolvedOptions } from './helpers/options.js'
import { createMockLogger } from './helpers/logger.js'
import { createTempDir } from './helpers/filesystem.js'

describe('runBuild', () => {
	let cleanup: (() => Promise<void>) | undefined

	afterEach(async () => {
		await cleanup?.()
		cleanup = undefined
	})

	async function setup() {
		const temp = await createTempDir('precompressor-build-')
		cleanup = temp.cleanup

		const output = join(temp.path, 'dist')
		const cache = join(temp.path, 'cache')

		await mkdir(join(output, 'nested'), { recursive: true })

		return { output, cache, root: temp.path }
	}

	it('compresses eligible files, skips unsupported and undersized files, and respects include/exclude filters', async () => {
		const { output, cache } = await setup()
		await writeFile(join(output, 'index.html'), '<html>home page content</html>')
		await writeFile(join(output, 'nested', 'about.html'), '<html>about page content</html>')
		await writeFile(join(output, 'nested', 'skip.html'), '<html>excluded page content</html>')
		await writeFile(join(output, 'asset.css'), 'body{}')
		await writeFile(join(output, 'tiny.html'), 'x')
		const logger = createMockLogger()
		await runBuild(
			output,
			cache,
			'config-a',
			createResolvedOptions({
				filters: {
					minSize: 5,
					fileTypes: ['.html'],
					include: ['**/*.html'],
					exclude: ['nested/skip.html'],
					pruneCache: true,
				},
			}),
			logger,
			{ brotli: createBrotliCompressorFactory() },
		)

		expect(
			brotliDecompressSync(await readFile(join(output, 'index.html.br'))).toString(),
		).toContain('home page')
		expect(
			brotliDecompressSync(await readFile(join(output, 'nested', 'about.html.br'))).toString(),
		).toContain('about page')
		await expect(readFile(join(output, 'nested', 'skip.html.br'))).rejects.toMatchObject({
			code: 'ENOENT',
		})
		await expect(readFile(join(output, 'asset.css.br'))).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(readFile(join(output, 'tiny.html.br'))).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('does not follow symbolic links during discovery', async () => {
		const { output, cache, root } = await setup()
		const outside = join(root, 'outside.html')
		await writeFile(outside, '<html>outside target</html>')
		await symlink(outside, join(output, 'linked.html'))
		await runBuild(output, cache, 'config-a', createResolvedOptions(), createMockLogger(), {
			brotli: createBrotliCompressorFactory(),
		})
		await expect(readFile(join(output, 'linked.html.br'))).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('reuses cached artifacts on a subsequent incremental build', async () => {
		const { output, cache } = await setup()
		await writeFile(join(output, 'index.html'), '<html>cache reuse test</html>')
		const options = createResolvedOptions()
		const logger = createMockLogger()
		const compressors = { brotli: createBrotliCompressorFactory() }
		await runBuild(output, cache, 'config-a', options, logger, compressors)
		await rm(join(output, 'index.html.br'))
		await runBuild(output, cache, 'config-a', options, logger, compressors)
		expect(
			brotliDecompressSync(await readFile(join(output, 'index.html.br'))).toString(),
		).toContain('cache reuse')
	})

	it('throws a summarized error when failOnError is enabled and a compressor is missing', async () => {
		const { output, cache } = await setup()
		await writeFile(join(output, 'index.html'), '<html>failure path</html>')
		await expect(
			runBuild(
				output,
				cache,
				'config-a',
				createResolvedOptions({ failOnError: true }),
				createMockLogger(),
				{},
			),
		).rejects.toThrow('Compression failed for 1 operation')
	})

	it('rejects a build with no enabled algorithms', async () => {
		const { output, cache } = await setup()
		await expect(
			runBuild(
				output,
				cache,
				'config-a',
				createResolvedOptions({ algorithms: { gzip: false, brotli: false, zstd: false } }),
				createMockLogger(),
				{},
			),
		).rejects.toThrow('no eligible algorithms')
	})
})
