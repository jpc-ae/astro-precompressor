export class Semaphore {
	private available: number
	private readonly waiting: Array<() => void> = []

	constructor(limit: number) {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error('Semaphore limit must be a positive integer.')
		}

		this.available = limit
	}

	async acquire(): Promise<() => void> {
		if (this.available > 0) {
			this.available--
		} else {
			await new Promise<void>(resolve => {
				this.waiting.push(resolve)
			})
		}

		let released = false

		return () => {
			if (released) return
			released = true

			const next = this.waiting.shift()

			if (next) {
				next()
			} else {
				this.available++
			}
		}
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		const release = await this.acquire()

		try {
			return await task()
		} finally {
			release()
		}
	}
}
