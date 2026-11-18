import * as zlib from 'node:zlib'

import { INTEGRATION_NAME } from './constants.js'

export function checkForZstd(
	createZstdCompress: typeof zlib.createZstdCompress | null | undefined = zlib.createZstdCompress,
): void {
	if (typeof createZstdCompress !== 'function') {
		throw new Error(
			`[${INTEGRATION_NAME}] Zstandard compression requires Node.js 22.15.0 or later. Current version: ${process.versions.node}.`,
		)
	}
}

export function createZstdCompress(options: zlib.ZstdOptions) {
	checkForZstd()

	return zlib.createZstdCompress(options)
}
