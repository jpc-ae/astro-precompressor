import { describe, expect, it } from 'vitest'
import { Semaphore } from '../src/semaphore.js'

describe('Semaphore', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', limit => {
    expect(() => new Semaphore(limit)).toThrow('positive integer')
  })
  it('allows the configured number of concurrent tasks', async () => {
    const semaphore = new Semaphore(2)
    let active = 0
    let maximum = 0
    await Promise.all(Array.from({ length: 8 }, () => semaphore.run(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
    })))
    expect(maximum).toBe(2)
  })
  it('hands released permits to queued waiters in FIFO order', async () => {
    const semaphore = new Semaphore(1)
    const releaseFirst = await semaphore.acquire()
    const order: number[] = []
    const second = semaphore.acquire().then(release => { order.push(2); return release })
    const third = semaphore.acquire().then(release => { order.push(3); return release })
    releaseFirst()
    const releaseSecond = await second
    expect(order).toEqual([2])
    releaseSecond()
    const releaseThird = await third
    expect(order).toEqual([2, 3])
    releaseThird()
  })
  it('makes release idempotent and releases after task errors', async () => {
    const semaphore = new Semaphore(1)
    const release = await semaphore.acquire()
    release(); release()
    await expect(semaphore.run(async () => { throw new Error('failure') })).rejects.toThrow('failure')
    await expect(semaphore.acquire()).resolves.toBeTypeOf('function')
  })
})

describe('Semaphore edge cases', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', limit => {
    expect(() => new Semaphore(limit)).toThrow('positive integer')
  })

  it('hands a released permit directly to the next waiter without increasing capacity', async () => {
    const semaphore = new Semaphore(1)
    const releaseFirst = await semaphore.acquire()
    let acquiredSecond = false
    const second = semaphore.acquire().then(release => {
      acquiredSecond = true
      return release
    })
    await Promise.resolve()
    expect(acquiredSecond).toBe(false)
    releaseFirst()
    const releaseSecond = await second
    expect(acquiredSecond).toBe(true)
    releaseSecond()
    const releaseThird = await semaphore.acquire()
    releaseThird()
  })

  it('releases the permit when a task rejects', async () => {
    const semaphore = new Semaphore(1)
    await expect(semaphore.run(async () => { throw new Error('task error') })).rejects.toThrow('task error')
    await expect(semaphore.run(async () => 'next task')).resolves.toBe('next task')
  })
})
