/** Tracks update I/O through cleanup without retaining native dialog promises during quit. */
export function createPendingUpdateWork() {
  const pending = new Set<Promise<unknown>>()
  let stopped = false
  return {
    async run<T>(start: () => Promise<T>): Promise<T> {
      if (stopped) throw new Error("Desktop update work has stopped.")
      const operation = Promise.resolve().then(start)
      pending.add(operation)
      try {
        return await operation
      } finally {
        pending.delete(operation)
      }
    },
    async stop() {
      stopped = true
      await Promise.allSettled(pending)
    },
  }
}
