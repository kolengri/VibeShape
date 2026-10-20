export function createLatestFramePublisher<Value>(
  publish: (value: Value) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelScheduled: (handle: number) => void = cancelAnimationFrame,
) {
  let frame: number | null = null
  let pending: Readonly<{ value: Value }> | null = null
  let generation = 0
  const cancel = () => {
    generation += 1
    if (frame !== null) cancelScheduled(frame)
    frame = null
    pending = null
  }
  const flush = () => {
    const sample = pending
    cancel()
    if (sample) publish(sample.value)
  }
  return {
    cancel,
    flush,
    push: (value: Value) => {
      pending = { value }
      if (frame !== null) return
      const scheduledGeneration = ++generation
      frame = schedule(() => {
        if (generation === scheduledGeneration) flush()
      })
    },
  }
}
