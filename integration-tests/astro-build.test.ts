import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
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

		it('respects include patterns', async () => {
			await build('picomatchOnly')

			// `**/*.txt` is included
			const original = await readOutput(fixture, 'included.txt')
			const gzip = gunzipSync(await readOutput(fixture, 'included.txt.gz'))

			expect(gzip.equals(original)).toBe(true)

			// .html and .bin do not match the include pattern
			await expect(readOutput(fixture, 'index.html.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})
			await expect(readOutput(fixture, 'unmatched.bin.gz')).rejects.toMatchObject({
				code: 'ENOENT',
			})

			// `ignored/**` is excluded
			await expect(readOutput(fixture, 'ignored/ignored.txt.gz')).rejects.toMatchObject({
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
	})
}

describe('Astro build integration', () => {
	for (const fixture of fixtures) {
		testAstroFixture(fixture)
	}
})
