import { INTEGRATION_NAME } from './constants.js'
import { bold, getPackageManager } from './utils.js'
import { constants, createGzip, type ZlibOptions } from 'node:zlib'

import type {
	AlgorithmOptions,
	CompressorFactory,
	ResolvedAlgorithmOptions,
	ZopfliModule,
	ZopfliOptions,
} from './types.js'

export const DEFAULT_ZLIB_OPTIONS = {
	level: constants.Z_BEST_COMPRESSION,
	memLevel: constants.Z_MAX_MEMLEVEL,
} as const satisfies ZlibOptions

export const DEFAULT_ZOPFLI_OPTIONS = {
	numiterations: 5,
	blocksplitting: false,
} as const satisfies ZopfliOptions

export function resolveZopfliOptions(value?: boolean | ZopfliOptions): false | ZopfliOptions {
	if (!value) {
		return false
	}

	const options: ZopfliOptions = {
		...DEFAULT_ZOPFLI_OPTIONS,
		...(typeof value === 'object' ? value : {}),
	}

	return options
}

export function resolveGzipOptions(
	value: AlgorithmOptions['gzip'],
): ResolvedAlgorithmOptions['gzip'] {
	if (!value) {
		return false
	}

	if (typeof value === 'object' && 'zopfli' in value) {
		const zopfliOptions = resolveZopfliOptions(value.zopfli)

		if (!zopfliOptions) {
			return DEFAULT_ZLIB_OPTIONS
		}

		return { zopfli: zopfliOptions }
	}

	return {
		...DEFAULT_ZLIB_OPTIONS,
		...(typeof value === 'object' ? value : {}),
	}
}

export async function importZopfli(): Promise<ZopfliModule> {
	const zopfliPackage = (await import('node-zopfli-es')) as unknown as {
		default: ZopfliModule
	}

	return zopfliPackage.default
}

export async function createGzipCompressorFactory(
	options: ZlibOptions | { zopfli: ZopfliOptions },
	explicitZopfli: boolean,
	optionalZopfli: boolean,
	zopfliImporter = importZopfli,
): Promise<CompressorFactory> {
	if (explicitZopfli && 'zopfli' in options) {
		try {
			const zopfli = await zopfliImporter()
			return () => zopfli.createGzip(options.zopfli)
		} catch (error) {
			const cause = error as NodeJS.ErrnoException

			// Only handle errors related to the package itself being absent.
			// Don't hide errors caused by a broken installation.
			if (!(cause.code === 'ERR_MODULE_NOT_FOUND' && cause.message.includes("'node-zopfli-es'"))) {
				throw error
			}

			const installScripts = new Map([
				['pnpm', 'pnpm add -D node-zopfli-es'],
				['yarn', 'yarn add -D node-zopfli-es'],
				['bun', 'bun add -d node-zopfli-es'],
				['npm', 'npm install -D node-zopfli-es'],
			])

			const packageManager = getPackageManager()

			const command = packageManager ? installScripts.get(packageManager) : undefined

			throw new Error(
				`The "node-zopfli-es" package is required when Zopfli is explicitly enabled.${
					command ? ` Install it with: ${bold(command)}` : ''
				}`,
				{ cause: error },
			)
		}
	}

	if (optionalZopfli) {
		try {
			const zopfli = await zopfliImporter()
			return () => zopfli.createGzip(DEFAULT_ZOPFLI_OPTIONS)
		} catch (error) {
			const cause = error as NodeJS.ErrnoException

			// Only treat the package itself being absent as optional.
			// Don't hide errors caused by a broken installation.
			if (!(cause.code === 'ERR_MODULE_NOT_FOUND' && cause.message.includes("'node-zopfli-es'"))) {
				throw error
			}
		}
	}

	if ('zopfli' in options) {
		throw new Error(`[${INTEGRATION_NAME}] Error: zopfli options could not be resolved`)
	}

	return () => createGzip(options)
}
