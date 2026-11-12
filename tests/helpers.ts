import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { pathToFileURL } from 'node:url'

import { vi, type Mock } from 'vitest'

import precompressor from '../src/integration'

import type { CompressionOptions } from '../src/types'

export interface TestLogger {
	info: Mock<(message: string) => void>
	warn: Mock<(message: string) => void>
	error: Mock<(message: string) => void>
	debug: Mock<(message: string) => void>
	fork: Mock<(label: string) => TestLogger>
}

export function createTestLogger(): TestLogger {
	const logger: TestLogger = {
		info: vi.fn<(message: string) => void>(),
		warn: vi.fn<(message: string) => void>(),
		error: vi.fn<(message: string) => void>(),
		debug: vi.fn<(message: string) => void>(),
		fork: vi.fn<(label: string) => TestLogger>(),
	}

	logger.fork.mockImplementation(() => createTestLogger())

	return logger
}

export async function createTestDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'astro-precompressor-test-'))
}

export async function createTestFile(
	directory: string,
	filePath: string,
	contents: string | Buffer = 'Test content',
): Promise<string> {
	const fullPath = join(directory, filePath)

	await mkdir(join(fullPath, '..'), { recursive: true })

	await writeFile(fullPath, contents)

	return fullPath
}

export async function readTestFile(path: string): Promise<Buffer> {
	return readFile(path)
}

export async function getModificationTime(path: string): Promise<number> {
	const info = await stat(path)
	return info.mtimeMs
}

export async function removeTestDirectory(directory: string): Promise<void> {
	await rm(directory, {
		recursive: true,
		force: true,
	})
}

export interface TestEnvironment {
	root: string
	outputDirectory: string
	cacheDirectory: string
	logger: TestLogger
}

export async function createTestEnvironment(): Promise<TestEnvironment> {
	const root = await createTestDirectory()

	const outputDirectory = join(root, 'dist')
	const cacheDirectory = join(root, '.astro')

	await mkdir(outputDirectory, { recursive: true })
	await mkdir(cacheDirectory, { recursive: true })

	return {
		root,
		outputDirectory,
		cacheDirectory,
		logger: createTestLogger(),
	}
}

export async function runIntegration(
	environment: TestEnvironment,
	options: CompressionOptions = {},
): Promise<TestLogger> {
	const integration = precompressor(options)

	const hooks = integration.hooks as unknown as Record<
		string,
		(args: Record<string, unknown>) => Promise<void>
	>

	await hooks['astro:config:setup']({
		config: {
			cacheDir: pathToFileURL(environment.cacheDirectory),
		},
		logger: environment.logger,
	})

	await hooks['astro:build:done']({
		dir: pathToFileURL(environment.outputDirectory),
		logger: environment.logger,
	})

	return environment.logger
}
