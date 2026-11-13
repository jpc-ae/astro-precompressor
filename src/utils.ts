import { createReadStream } from 'node:fs'

import { createHash } from 'node:crypto'

import { isAbsolute, relative, resolve, sep } from 'node:path'

import { styleText } from 'node:util'

import { CACHE_VERSION } from './constants.js'

import type { Logger, ResolvedOptions } from './types.js'

export function getPackageManager(): string {
	const ua = process.env.npm_config_user_agent || ''
	const [manager] = ua.split('/')
	return manager
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
	const hash = createHash('sha256')

	for await (const chunk of createReadStream(path)) {
		hash.update(chunk)
	}

	return hash.digest('hex')
}

export function normalizeExtensions(extensions: string[]): string[] {
	return [
		...new Set(
			extensions.map(extension => {
				const normalized = extension.trim().toLowerCase().replace(/^\./, '')

				if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
					throw new Error(`Invalid file extension: "${extension}".`)
				}

				return `.${normalized}`
			}),
		),
	]
}

export function toCacheKey(outputDirectory: string, filePath: string): string {
	return relative(outputDirectory, filePath).split(sep).join('/')
}

export function isInsideDirectory(directory: string, target: string): boolean {
	const relativePath = relative(resolve(directory), resolve(target))

	return (
		relativePath !== '' &&
		relativePath !== '..' &&
		!relativePath.startsWith(`..${sep}`) &&
		!isAbsolute(relativePath)
	)
}

export function resolveInsideDirectory(directory: string, relativePath: string): string {
	if (isAbsolute(relativePath)) {
		throw new Error(`Invalid cache path: ${relativePath}`)
	}

	const resolvedPath = resolve(directory, ...relativePath.split('/'))

	if (!isInsideDirectory(directory, resolvedPath)) {
		throw new Error(`Invalid cache path: ${relativePath}`)
	}

	return resolvedPath
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}

	const units = ['KiB', 'MiB', 'GiB']

	let value = bytes / 1024
	let unit = 0

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}

	return `${value.toFixed(2)} ${units[unit]}`
}

export function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`
}

// -----------------------------------------------------------------------------
// Log formatting
// -----------------------------------------------------------------------------

export function green(message: string) {
	return styleText('green', message)
}

export function blue(message: string) {
	return styleText('blue', message)
}

export function dim(message: string) {
	return styleText('dim', message)
}

// -----------------------------------------------------------------------------
// Configuration fingerprinting
// -----------------------------------------------------------------------------

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
	function normalize(input: unknown): unknown {
		if (input === null || input === undefined) {
			return input
		}

		if (typeof input === 'function') {
			return `[Function:${input.name}:${input.toString()}]`
		}

		if (typeof input === 'bigint') {
			return input.toString()
		}

		if (typeof input !== 'object') {
			return input
		}

		if (input instanceof URL) {
			return input.toString()
		}

		if (input instanceof Date) {
			return input.toISOString()
		}

		if (input instanceof RegExp) {
			return input.toString()
		}

		if (Buffer.isBuffer(input)) {
			return `[Buffer:${input.toString('base64')}]`
		}

		if (seen.has(input)) {
			return '[Circular]'
		}

		seen.add(input)

		try {
			if (Array.isArray(input)) {
				return input.map(normalize)
			}

			if (input instanceof Map) {
				return [...input.entries()]
					.map(([key, entry]) => [normalize(key), normalize(entry)])
					.sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])))
			}

			if (input instanceof Set) {
				return [...input]
					.map(normalize)
					.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
			}

			const result: Record<string, unknown> = {}

			for (const key of Object.keys(input).sort()) {
				try {
					result[key] = normalize((input as Record<string, unknown>)[key])
				} catch {
					result[key] = '[Unserializable]'
				}
			}

			return result
		} finally {
			seen.delete(input)
		}
	}

	return JSON.stringify(normalize(value))
}

export function createConfigHash(config: unknown, options: ResolvedOptions): string {
	return sha256(
		stableSerialize({
			astroConfig: config,
			compression: {
				version: CACHE_VERSION,
				algorithms: options.algorithms,
			},
		}),
	)
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

export function log(logger: Logger, options: ResolvedOptions, level: 1 | 2, message: string): void {
	if (options.logLevel < level) {
		return
	}

	if (level === 2) {
		logger.debug(message)
	} else {
		logger.info(message)
	}
}

export function logError(logger: Logger, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error)
	logger.error(message)
}

export function logHeader(title: string): void {
	const header = styleText(['bgGreen', 'black'], ` ${title} `)
	console.log(`\n${header}`)
}
