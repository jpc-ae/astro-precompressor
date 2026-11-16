import type { ZopfliModule } from './types.js'
import { bold, getPackageManager } from './utils.js'

/**
 * Dynamically load zopfli when available or required
 */
async function importZopfli(): Promise<ZopfliModule> {
	const zopfliPackage = (await import('node-zopfli-es')) as unknown as {
		default: ZopfliModule
	}

	return zopfliPackage.default
}

export async function loadZopfli(): Promise<ZopfliModule> {
	try {
		return await importZopfli()
	} catch (error) {
		const installScripts = new Map([
			['pnpm', 'pnpm add -D node-zopfli-es'],
			['yarn', 'yarn add -D node-zopfli-es'],
			['bun', 'bun add -d node-zopfli-es'],
			['npm', 'npm install -D node-zopfli-es'],
		])

		const packageManager = getPackageManager()

		const command = packageManager ? installScripts.get(packageManager) : undefined

		throw new Error(
			`The "node-zopfli-es" package is required when Zopfli is explicitely enabled.${
				command ? ` Install it with: ${bold(command)}` : ''
			}`,
			{ cause: error },
		)
	}
}

export async function loadOptionalZopfli(
	importer = importZopfli,
): Promise<ZopfliModule | undefined> {
	try {
		return await importer()
	} catch (error) {
		const cause = error as NodeJS.ErrnoException

		// Only treat the package itself being absent as optional.
		// Don't hide errors caused by a broken installation.
		if (cause.code === 'ERR_MODULE_NOT_FOUND' && cause.message.includes("'node-zopfli-es'")) {
			return undefined
		}

		throw error
	}
}
