export async function runWorkerPool<T, R>(
	items: T[],
	concurrency: number,
	task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new Error('Concurrency must be a positive integer.')
	}

	const results = new Array<R>(items.length)
	let nextIndex = 0
	let failure: unknown
	let failed = false

	async function worker(): Promise<void> {
		while (!failed) {
			const index = nextIndex++

			if (index >= items.length) {
				return
			}

			try {
				results[index] = await task(items[index], index)
			} catch (error) {
				if (!failed) {
					failed = true
					failure = error
				}

				return
			}
		}
	}

	const workerCount = Math.min(concurrency, items.length)

	await Promise.all(Array.from({ length: workerCount }, () => worker()))

	if (failed) {
		throw failure
	}

	return results
}
