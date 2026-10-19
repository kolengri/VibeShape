export interface BrowserWorkerStartupLease {
  start(release: () => void, retire: () => void): void
  rejectWaiting(): void
}

/** Only unacknowledged native starts occupy slots, including timed-out starts. */
export class BrowserWorkerStartupQueue {
  readonly #waiting = new Set<BrowserWorkerStartupLease>()
  readonly #active = new Set<BrowserWorkerStartupLease>()
  readonly #retired = new Set<BrowserWorkerStartupLease>()
  #scheduled = false

  enqueue(lease: BrowserWorkerStartupLease) {
    if (this.#retired.size === 2) {
      lease.rejectWaiting()
      return
    }
    this.#waiting.add(lease)
    this.#schedule()
  }

  remove(lease: BrowserWorkerStartupLease) {
    this.#waiting.delete(lease)
  }

  #schedule() {
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      this.#drain()
    })
  }

  #next() {
    if (this.#active.size === 2) return
    return this.#waiting.values().next().value
  }

  #drain() {
    let lease = this.#next()
    while (lease) {
      this.#waiting.delete(lease)
      this.#active.add(lease)
      const owner = lease
      owner.start(
        () => this.#release(owner),
        () => this.#retire(owner),
      )
      lease = this.#next()
    }
  }

  #release(lease: BrowserWorkerStartupLease) {
    this.#active.delete(lease)
    this.#retired.delete(lease)
    this.#schedule()
  }

  #retire(lease: BrowserWorkerStartupLease) {
    this.#retired.add(lease)
    if (this.#retired.size !== 2) return
    const waiting = [...this.#waiting]
    this.#waiting.clear()
    for (const pending of waiting) pending.rejectWaiting()
  }
}
