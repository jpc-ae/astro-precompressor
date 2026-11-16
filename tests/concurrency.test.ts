import { describe, expect, it } from 'vitest'

import { Semaphore } from '../src/semaphore.js'
import { runWorkerPool } from '../src/worker-pool.js'

describe('Semaphore', () => {
	it('rejects invalid concurrency limits', () => {
		expect(() => new Semaphore(0)).toThrow('Semaphore limit must be a positive integer.')
		expect(() => new Semaphore(1.5)).toThrow('Semaphore limit must be a positive integer.')
	})

	it('limits concurrent work and services waiters in FIFO order', async () => {
		const semaphore = new Semaphore(1)
		const releaseInitial = await semaphore.acquire()
		const order: number[] = []

		const tasks = [1, 2, 3].map(value =>
			semaphore.run(async () => {
				order.push(value)
			}),
		)

		releaseInitial()
		await Promise.all(tasks)

		expect(order).toEqual([1, 2, 3])
	})

	it('releases a slot when a task rejects and ignores duplicate releases', async () => {
		const semaphore = new Semaphore(1)
		const release = await semaphore.acquire()

		release()
		release()

		await expect(
			semaphore.run(async () => {
				throw new Error('expected failure')
			}),
		).rejects.toThrow('expected failure')

		await expect(semaphore.run(async () => 'available')).resolves.toBe('available')
	})
})

describe('runWorkerPool', () => {
	it('returns results in input order', async () => {
		const results = await runWorkerPool([3, 1, 2], 2, async value => value * 2)

		expect(results).toEqual([6, 2, 4])
	})

	it('does not exceed the configured concurrency', async () => {
		let active = 0
		let maximumActive = 0

		const results = await runWorkerPool([0, 1, 2, 3, 4, 5], 2, async value => {
			active++
			maximumActive = Math.max(maximumActive, active)

			await new Promise(resolve => setTimeout(resolve, 5))

			active--
			return value
		})

		expect(results).toEqual([0, 1, 2, 3, 4, 5])
		expect(maximumActive).toBe(2)
	})

	it('returns an empty array for no items', async () => {
		await expect(runWorkerPool([], 4, async value => value)).resolves.toEqual([])
	})

	it('rejects invalid concurrency limits', async () => {
		await expect(runWorkerPool([1], 0, async value => value)).rejects.toThrow(
			'Concurrency must be a positive integer.',
		)
	})

	it('rejects when a worker task fails', async () => {
		await expect(
			runWorkerPool([1, 2, 3], 1, async value => {
				if (value === 2) throw new Error('worker failed')
				return value
			}),
		).rejects.toThrow('worker failed')
	})
})
