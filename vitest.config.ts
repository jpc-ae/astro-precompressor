import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		clearMocks: true,
		restoreMocks: true,
		mockReset: true,
		slowTestThreshold: 1000,
		testTimeout: 15_000,
		hookTimeout: 15_000,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/types.ts', 'src/constants.ts', 'src/index.ts'],
			reporter: ['text', 'html'],
		},
	},
})
