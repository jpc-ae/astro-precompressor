import { PassThrough, Transform } from 'node:stream'
import { vi } from 'vitest'
import type { CompressorFactory, Compressors } from '../../src/types.js'

export function createPassThroughCompressor(): ReturnType<CompressorFactory> {
	return new PassThrough()
}

export function createMockCompressors(overrides: Partial<Compressors> = {}): Compressors {
	return {
		gzip: vi.fn<CompressorFactory>(createPassThroughCompressor),
		brotli: vi.fn<CompressorFactory>(createPassThroughCompressor),
		zstd: vi.fn<CompressorFactory>(createPassThroughCompressor),
		...overrides,
	}
}

export interface CompressionTracker {
	active: number
	maximumActive: number
	total: number
}

/**
 * Tracks concurrent compression streams.
 *
 * The active count is decremented when each stream finishes flushing,
 * so it measures the whole pipeline rather than just factory creation.
 */
export function createTrackingCompressorFactory(tracker: CompressionTracker): CompressorFactory {
	return () => {
		tracker.active++
		tracker.total++
		tracker.maximumActive = Math.max(tracker.maximumActive, tracker.active)

		return new Transform({
			transform(chunk, _encoding, callback) {
				callback(null, chunk)
			},
			flush(callback) {
				tracker.active--
				callback()
			},
		})
	}
}

export function createFailingCompressorFactory(message = 'compression failed'): CompressorFactory {
	return () => {
		throw new Error(message)
	}
}

export function createFailingStreamCompressorFactory(
	message = 'stream compression failed',
	marker = 'FAIL_STREAM',
): CompressorFactory {
	return () =>
		new Transform({
			transform(chunk, _encoding, callback) {
				if (chunk.toString().includes(marker)) {
					callback(new Error(message))
					return
				}

				callback(null, chunk)
			},
		})
}
