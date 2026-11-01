import type { Material, WebGLRenderer } from "three"

/**
 * Owns compileAsync polling on a private renderer. Three 0.185.1 polls the mutable
 * material Set returned by its public compile method. Clearing that owned batch
 * ends polling without waiting for GPU readiness (including after context loss).
 * Keep this contract covered when upgrading Three; never dispose before drain.
 */
export function trackPictureCompilation(renderer: Pick<WebGLRenderer, "compile" | "compileAsync">) {
  const compile = renderer.compile
  const compileAsync = renderer.compileAsync
  const pending = new Map<Promise<void>, Set<Material>[]>()
  let collecting: Set<Material>[] | null = null
  let closing = false
  renderer.compile = (...args) => {
    const materials = compile.apply(renderer, args)
    collecting?.push(materials)
    if (closing) materials.clear()
    return materials
  }
  renderer.compileAsync = (...args) => {
    if (closing) return Promise.resolve(args[0])
    const batches: Set<Material>[] = []
    const previous = collecting
    collecting = batches
    let result: ReturnType<WebGLRenderer["compileAsync"]>
    try {
      result = compileAsync.apply(renderer, args)
    } finally {
      collecting = previous
    }
    // Observe both outcomes without creating an unhandled rejecting cleanup job.
    const settled = result.then(
      () => {
        pending.delete(settled)
      },
      () => {
        pending.delete(settled)
      },
    )
    pending.set(settled, batches)
    return result
  }
  return async () => {
    closing = true
    for (const batches of pending.values()) for (const materials of batches) materials.clear()
    await Promise.all(pending.keys())
    renderer.compile = compile
    renderer.compileAsync = compileAsync
  }
}
