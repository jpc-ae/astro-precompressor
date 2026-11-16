import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createFile, createOptions, useTempDirectory } from './helpers.js'

describe('createOptions', () => {
	it('merges nested overrides without discarding defaults', () => {
		const options = createOptions({
			performance: { concurrency: 4 },
			filters: { minSize: 10 },
		})

		expect(options.performance).toEqual({
			concurrency: 4,
			incremental: true,
			discardCompressionIfLarger: true,
		})
		expect(options.filters).toEqual({
			minSize: 10,
			fileTypes: ['.html'],
			include: undefined,
			exclude: undefined,
			pruneCache: true,
		})
	})
})

describe('useTempDirectory', () => {
	const temp = useTempDirectory()

	it('creates a directory and supports creating nested test files', async () => {
		const directory = await temp.create()
		const filePath = await createFile(directory, 'nested/file.txt', 'test data')

		expect(filePath).toBe(join(directory, 'nested', 'file.txt'))
		await expect(readFile(filePath, 'utf8')).resolves.toBe('test data')
		await expect(access(directory)).resolves.toBeUndefined()
	})
})
