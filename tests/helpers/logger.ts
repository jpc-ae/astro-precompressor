import { vi } from 'vitest'
import type { Logger } from '../../src/types.js'

export function createMockLogger(): Logger {
	const destination = {
		write: vi.fn(),
		flush: vi.fn(),
		close: vi.fn(),
	}

	const logger = {
		options: {
			destination,
			level: 'debug',
		},
		label: 'test',
		debug: vi.fn<Logger['debug']>(),
		info: vi.fn<Logger['info']>(),
		warn: vi.fn<Logger['warn']>(),
		error: vi.fn<Logger['error']>(),
		flush: vi.fn<Logger['flush']>(),
		close: vi.fn<Logger['close']>(),
		fork: vi.fn<Logger['fork']>(),
	} satisfies Logger

	logger.fork.mockImplementation(() => createMockLogger())
	return logger
}
