import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const integrationDirectory = dirname(fileURLToPath(import.meta.url))

const originalIncludedText =
	'This public text file should be included by the file type filter. Repeated text makes it large enough to be useful for compression testing.\n'

interface AstroPackage {
	bin: string | Record<string, string>
	version: string
}

interface Fixture {
	name: string
	directory: string
	expectedVersion?: string
}

interface FixtureContext extends Fixture {
	output: string
	cache: string
}

const fixtures: Fixture[] = [
	{
		name: 'minimum Astro version (5.0.0)',
		directory: resolve(integrationDirectory, 'fixtures/minimum'),
		expectedVersion: '5.0.0',
	},
	{
		name: 'latest Astro version',
		directory: resolve(integrationDirectory, 'fixtures/latest'),
	},
]

async function ensureFixtureDependencies(fixture: Fixture): Promise<string> {
	const rootNodeModules = resolve(fixture.directory, 'node_modules')
	const astroPackagePath = resolve(rootNodeModules, 'astro/package.json')

	const astroPackage = JSON.parse(await readFile(astroPackagePath, 'utf8')) as AstroPackage

	if (fixture.expectedVersion && astroPackage.version !== fixture.expectedVersion) {
		throw new Error(
			`Expected Astro ${fixture.expectedVersion}, found ${astroPackage.version}. ` +
				`Run pnpm --dir ${fixture.directory} install.`,
		)
	}

	const astroBin = typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro

	if (!astroBin) {
		throw new Error('Could not find the Astro CLI entry point in astro/package.json.')
	}

	return resolve(rootNodeModules, 'astro', astroBin)
}

function createFixtureContext(fixture: Fixture): FixtureContext {
	return {
		...fixture,
		output: resolve(fixture.directory, 'dist'),
		cache: resolve(fixture.directory, '.cache'),
	}
}

async function cleanBuildArtifacts(fixture: FixtureContext): Promise<void> {
	await Promise.all([
		rm(fixture.output, { recursive: true, force: true }),
		rm(fixture.cache, { recursive: true, force: true }),
	])
}

async function runAstroBuild(
	fixture: FixtureContext,
	astroCli: string,
	scenario: string,
): Promise<string> {
	const child = spawn(process.execPath, [astroCli, 'build'], {
		cwd: fixture.directory,
		env: {
			...process.env,
			PRECOMPRESSOR_TEST_SCENARIO: scenario,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})

	let output = ''

	child.stdout.setEncoding('utf8')
	child.stderr.setEncoding('utf8')

	child.stdout.on('data', chunk => {
		output += chunk
	})

	child.stderr.on('data', chunk => {
		output += chunk
	})

	const exitCode = await new Promise<number | null>((resolveExit, reject) => {
		child.once('error', reject)
		child.once('close', resolveExit)
	})

	if (exitCode !== 0) {
		throw new Error(`Astro build failed with exit code ${exitCode}.\n\n${output}`)
	}

	return output
}

async function readOutput(fixture: FixtureContext, relativePath: string): Promise<Buffer> {
	return readFile(resolve(fixture.output, relativePath))
}

function testAstroFixture(fixtureDefinition: Fixture): void {
	const fixture = createFixtureContext(fixtureDefinition)

	describe(fixture.name, () => {
		let astroCli = ''

		async function build(scenario: string): Promise<string> {
			return runAstroBuild(fixture, astroCli, scenario)
		}

		beforeAll(async () => {
			astroCli = await ensureFixtureDependencies(fixture)
		})

		beforeEach(async () => {
			await cleanBuildArtifacts(fixture)
			await writeFile(resolve(fixture.directory, 'public/included.txt'), originalIncludedText)
		})

		afterAll(async () => {
			await cleanBuildArtifacts(fixture)
			await writeFile(resolve(fixture.directory, 'public/included.txt'), originalIncludedText)
		})

		it('generates valid Gzip and Brotli files in a real Astro build', async () => {
			await build('basic')

			const original = await readOutput(fixture, 'index.html')
			const gzip = gunzipSync(await readOutput(fixture, 'index.html.gz'))
			const brotli = brotliDecompressSync(await readOutput(fixture, 'index.html.br'))

			expect(gzip.equals(original)).toBe(true)
			expect(brotli.equals(original)).toBe(true)
		})

		it('respects algorithm configuration and does not emit disabled algorithms (gzip only)', async () => {
			await build('gzipOnly')

			const original = await readOutput(fixture, 'index.html')
			const gzip = gunzipSync(await readOutput(fixture, 'index.html.gz'))

			expect(gzip.equals(original)).toBe(true)

			await expect(readOutput(fixture, 'index.html.br')).rejects.toMatchObject({ code: 'ENOENT' })

			await expect(readOutput(fixture, 'index.html.zst')).rejects.toMatchObject({ code: 'ENOENT' })
		})

		it('respects algorithm configuration and does not emit disabled algorithms (brotli only)', async () => {
			await build('brotliOnly')

			const original = await readOutput(fixture, 'index.html')
			const brotli = brotliDecompressSync(await readOutput(fixture, 'index.html.br'))

			expect(brotli.equals(original)).toBe(true)

			await expect(readOutput(fixture, 'index.html.gz')).rejects.toMatchObject({ code: 'ENOENT' })

			await expect(readOutput(fixture, 'index.html.zst')).rejects.toMatchObject({ code: 'ENOENT' })
		})

		it('respects algorithm configuration and does not emit disabled algorithms (zstd only)', async () => {
			await build('zstdOnly')

			const original = await readOutput(fixture, 'index.html')
			const zstd = zstdDecompressSync(await readOutput(fixture, 'index.html.zst'))

			expect(zstd.equals(original)).toBe(true)

			await expect(readOutput(fixture, 'index.html.gz')).rejects.toMatchObject({ code: 'ENOENT' })

			await expect(readOutput(fixture, 'index.html.br')).rejects.toMatchObject({ code: 'ENOENT' })
		})

		it('respects algorithm configuration and does not emit disabled algorithms (zopfli only)', async () => {
			await build('zopfliOnly')

			const original = await readOutput(fixture, 'index.html')
			const gzip = gunzipSync(await readOutput(fixture, 'index.html.gz'))

			expect(gzip.equals(original)).toBe(true)

			await expect(readOutput(fixture, 'index.html.br')).rejects.toMatchObject({ code: 'ENOENT' })

			await expect(readOutput(fixture, 'index.html.zst')).rejects.toMatchObject({ code: 'ENOENT' })
		})

		it('respects configured file types and exclude patterns', async () => {
			await build('filters')

			// HTML and .txt are configured file types.
			const originalHtml = await readOutput(fixture, 'index.html')
			const gzipHtml = gunzipSync(await readOutput(fixture, 'index.html.gz'))

			expect(gzipHtml.equals(originalHtml)).toBe(true)

			const originalTxt = await readOutput(fixture, 'included.txt')
			const gzipTxt = gunzipSync(await readOutput(fixture, 'included.txt.gz'))

			expect(gzipTxt.equals(originalTxt)).toBe(true)

			// The ignored directory is excluded, and .bin is not an eligible type.
			await expect(readOutput(fixture, 'ignored/ignored.txt.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			await expect(readOutput(fixture, 'unmatched.bin.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
		})

		it('respects picomatch patterns with algorithm filters', async () => {
			await build('picomatch')

			// `**/*.txt` is included but brotli is excluded
			const originalTxt = await readOutput(fixture, 'included.txt')
			const gzipTxt = gunzipSync(await readOutput(fixture, 'included.txt.gz'))
			expect(gzipTxt.equals(originalTxt)).toBe(true)
			await expect(readOutput(fixture, 'included.txt.br')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			// `**/*.html` is only included for brotli
			const originalHtml = await readOutput(fixture, 'index.html')
			const brotliHtml = brotliDecompressSync(await readOutput(fixture, 'index.html.br'))
			expect(brotliHtml.equals(originalHtml)).toBe(true)
			await expect(readOutput(fixture, 'index.html.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			// .bin does not match the include patterns
			await expect(readOutput(fixture, 'unmatched.bin.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
			await expect(readOutput(fixture, 'unmatched.bin.br')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			// `ignored/**` is excluded
			await expect(readOutput(fixture, 'ignored/ignored.txt.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
			await expect(readOutput(fixture, 'ignored/ignored.txt.br')).rejects.toMatchObject({
				code: 'ENOENT',
			})
		})

		it('skips files with unmatched file types before applying include patterns', async () => {
			await build('fileTypesNotIncluded')

			// .txt is not included in fileTypes
			await expect(readOutput(fixture, 'included.txt.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			// .html and .bin do not match the include pattern
			await expect(readOutput(fixture, 'index.html.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
			await expect(readOutput(fixture, 'unmatched.bin.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
		})

		it('reuses cached artifacts across builds and regenerates only changed files', async () => {
			await cleanBuildArtifacts(fixture)

			const firstBuild = await build('cache')
			expect(firstBuild).toMatch(/Updated: [1-9]\d*/)

			const secondBuild = await build('cache')
			expect(secondBuild).toMatch(/Reused: [1-9]\d* \| Updated: 0/)

			const changedText = `${originalIncludedText}Changed between builds.\n`

			await writeFile(resolve(fixture.directory, 'public/included.txt'), changedText)

			const thirdBuild = await build('cache')
			expect(thirdBuild).toMatch(/Reused: [1-9]\d* \| Updated: [1-9]\d*/)

			const original = await readOutput(fixture, 'included.txt')
			const compressed = gunzipSync(await readOutput(fixture, 'included.txt.gz'))

			expect(compressed.equals(original)).toBe(true)
			expect(original.toString()).toBe(changedText)
		})

		it('preserves unrelated output but removes stale disabled sidecars on a cache miss', async () => {
			const preservedFile = resolve(fixture.output, 'preserved-by-vite.txt')

			const staleSidecar = resolve(fixture.output, 'index.html.br')

			const preservedContents =
				'This file must survive when Vite does not empty the output directory.'
			const staleContents = Buffer.from('pre-existing sidecar')

			await mkdir(fixture.output, { recursive: true })
			await writeFile(preservedFile, preservedContents)
			await writeFile(staleSidecar, staleContents)

			await build('preserveOutput')

			// Vite's emptyOutDir:false still preserves unrelated files.
			expect(await readFile(preservedFile, 'utf8')).toBe(preservedContents)

			// The pre-existing Brotli sidecar is stale because this scenario enables gzip only.
			await expect(readOutput(fixture, 'index.html.br')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			const original = await readOutput(fixture, 'index.html')
			const gzip = gunzipSync(await readOutput(fixture, 'index.html.gz'))

			expect(gzip.equals(original)).toBe(true)
		})

		it('preserves disabled sidecars when the file has a full cache hit', async () => {
			// First build creates the gzip cache entry.
			await build('preserveOutput')

			const staleSidecar = resolve(fixture.output, 'index.html.br')
			const staleContents = Buffer.from('deliberately preserved stale Brotli sidecar')

			// Simulate a sidecar left behind by an older build or external process.
			await writeFile(staleSidecar, staleContents)

			// The same build configuration and unchanged source should hit the cache.
			await build('preserveOutput')

			// The requested cache-hit exception means the sidecar is left untouched.
			expect(await readOutput(fixture, 'index.html.br')).toEqual(staleContents)

			// The enabled gzip artifact remains valid.
			const original = await readOutput(fixture, 'index.html')
			const gzip = gunzipSync(await readOutput(fixture, 'index.html.gz'))

			expect(gzip.equals(original)).toBe(true)
		})
	})
}

describe('Astro build integration', () => {
	for (const fixture of fixtures) {
		testAstroFixture(fixture)
	}
})
