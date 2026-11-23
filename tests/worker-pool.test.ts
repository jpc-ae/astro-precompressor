import { describe, expect, it, vi } from 'vitest'
import { runWorkerPool } from '../src/worker-pool.js'
import { deferred } from './helpers/deferred.js'

describe('runWorkerPool', () => {
	it('preserves result order despite out-of-order completion', async () => {
		const result = await runWorkerPool([30, 10, 20], 3, async value => {
			await new Promise(resolve => setTimeout(resolve, value))
			return value * 2
		})
		expect(result).toEqual([60, 20, 40])
	})

	it('handles empty and single-item input', async () => {
		expect(await runWorkerPool([], 4, async value => value)).toEqual([])
		expect(await runWorkerPool([4], 8, async value => value + 1)).toEqual([5])
	})

	it.for([0, -1, 1.2, Number.NaN])('rejects invalid concurrency %s', async concurrency => {
		await expect(runWorkerPool([1], concurrency, async value => value)).rejects.toThrow(
			'positive integer',
		)
	})

	it('never exceeds the concurrency limit', async () => {
		let active = 0
		let peak = 0
		await runWorkerPool(
			Array.from({ length: 12 }, (_, i) => i),
			3,
			async value => {
				active++
				peak = Math.max(peak, active)
				await new Promise(resolve => setTimeout(resolve, 2))
				active--
				return value
			},
		)
		expect(peak).toBe(3)
	})

	it('rejects with the first task error and stops scheduling further work', async () => {
		const task = vi.fn(async (value: number) => {
			if (value === 1) throw new Error('task failed')
			await new Promise(resolve => setTimeout(resolve, 5))
			return value
		})
		await expect(runWorkerPool([0, 1, 2, 3, 4], 1, task)).rejects.toThrow('task failed')
		expect(task).toHaveBeenCalledTimes(2)
	})
})

describe('runWorkerPool failure coordination', () => {
	it('waits for already-running tasks and does not schedule new tasks after a failure', async () => {
		const started: number[] = []
		const running = deferred()
		const task = vi.fn(async (value: number) => {
			started.push(value)
			if (value === 0) await running.promise
			if (value === 1) throw new Error('parallel failure')
			return value
		})

		const pending = runWorkerPool([0, 1, 2, 3], 2, task)
		await vi.waitFor(() => expect(started).toEqual([0, 1]))
		running.resolve()
		await expect(pending).rejects.toThrow('parallel failure')
		expect(started).toEqual([0, 1])
	})

	it('passes each item and its original index to the task', async () => {
		const task = vi.fn(async (item: string, index: number) => `${index}:${item}`)
		await expect(runWorkerPool(['a', 'b', 'c'], 2, task)).resolves.toEqual(['0:a', '1:b', '2:c'])
		expect(task).toHaveBeenNthCalledWith(1, 'a', 0)
		expect(task).toHaveBeenNthCalledWith(2, 'b', 1)
		expect(task).toHaveBeenNthCalledWith(3, 'c', 2)
	})
})
