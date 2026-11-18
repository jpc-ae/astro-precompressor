import { spawn } from 'node:child_process'
import { lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const integrationDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(integrationDirectory, '..')
const fixtureDirectory = resolve(integrationDirectory, 'fixtures/site')
const fixtureNodeModules = resolve(fixtureDirectory, 'node_modules')
const fixtureOutput = resolve(fixtureDirectory, 'dist')
const fixtureCache = resolve(fixtureDirectory, '.site-cache')
const originalIncludedText =
	'This public text file should be included by the file type filter. Repeated text makes it large enough to be useful for compression testing.\n'

interface AstroPackage {
	bin: string | Record<string, string>
}

async function ensureFixtureDependencies(): Promise<string> {
	const rootNodeModules = resolve(projectDirectory, 'node_modules')

	try {
		await lstat(fixtureNodeModules)
	} catch {
		await symlink(
			rootNodeModules,
			fixtureNodeModules,
			process.platform === 'win32' ? 'junction' : 'dir',
		)
	}

	const astroPackage = JSON.parse(
		await readFile(resolve(rootNodeModules, 'astro/package.json'), 'utf8'),
	) as AstroPackage

	const astroBin = typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro

	if (!astroBin) {
		throw new Error('Could not find the Astro CLI entry point in astro/package.json.')
	}

	return resolve(rootNodeModules, 'astro', astroBin)
}

let astroCli = ''

async function cleanBuildArtifacts(): Promise<void> {
	await Promise.all([
		rm(fixtureOutput, { recursive: true, force: true }),
		rm(fixtureCache, { recursive: true, force: true }),
	])
}

async function runAstroBuild(scenario: string): Promise<string> {
	const child = spawn(process.execPath, [astroCli, 'build'], {
		cwd: fixtureDirectory,
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

async function readOutput(relativePath: string): Promise<Buffer> {
	return readFile(resolve(fixtureOutput, relativePath))
}

beforeAll(async () => {
	astroCli = await ensureFixtureDependencies()
	await cleanBuildArtifacts()
})

afterAll(async () => {
	await cleanBuildArtifacts()
	await rm(fixtureNodeModules, { recursive: true, force: true })
	await writeFile(resolve(fixtureDirectory, 'public/included.txt'), originalIncludedText)
})

describe('Astro build integration', () => {
	it('generates valid Gzip and Brotli files in a real Astro build', async () => {
		await cleanBuildArtifacts()
		await runAstroBuild('basic')

		const original = await readOutput('index.html')
		const gzip = gunzipSync(await readOutput('index.html.gz'))
		const brotli = brotliDecompressSync(await readOutput('index.html.br'))

		expect(gzip.equals(original)).toBe(true)
		expect(brotli.equals(original)).toBe(true)
	})

	it('respects algorithm configuration and does not emit disabled algorithms', async () => {
		await cleanBuildArtifacts()
		await runAstroBuild('brotliOnly')

		const original = await readOutput('index.html')
		const brotli = brotliDecompressSync(await readOutput('index.html.br'))

		expect(brotli.equals(original)).toBe(true)
		await expect(readOutput('index.html.gz')).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(readOutput('index.html.zst')).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('respects configured file types and exclude patterns', async () => {
		await cleanBuildArtifacts()
		await runAstroBuild('filters')

		// HTML and .txt are configured file types.
		await expect(readOutput('index.html.gz')).resolves.toBeInstanceOf(Buffer)
		await expect(readOutput('included.txt.gz')).resolves.toBeInstanceOf(Buffer)

		// The ignored directory is excluded, and .bin is not an eligible type.
		await expect(readOutput('ignored/ignored.txt.gz')).rejects.toMatchObject({ code: 'ENOENT' })
		await expect(readOutput('unmatched.bin.gz')).rejects.toMatchObject({ code: 'ENOENT' })

		const included = await readOutput('included.txt')
		const compressed = gunzipSync(await readOutput('included.txt.gz'))
		expect(compressed.equals(included)).toBe(true)
	})

	it('reuses cached artifacts across builds and regenerates only changed files', async () => {
		await cleanBuildArtifacts()

		const firstBuild = await runAstroBuild('cache')
		expect(firstBuild).toMatch(/Updated: [1-9]\d*/)

		const secondBuild = await runAstroBuild('cache')
		expect(secondBuild).toMatch(/Reused: [1-9]\d* \| Updated: 0/)

		const changedText = `${originalIncludedText}Changed between builds.\n`
		await writeFile(resolve(fixtureDirectory, 'public/included.txt'), changedText)

		const thirdBuild = await runAstroBuild('cache')
		expect(thirdBuild).toMatch(/Reused: [1-9]\d* \| Updated: [1-9]\d*/)

		const original = await readOutput('included.txt')
		const compressed = gunzipSync(await readOutput('included.txt.gz'))
		expect(compressed.equals(original)).toBe(true)
		expect(original.toString()).toBe(changedText)
	})
})
