type Runtime = {
  getDocumentControllerState(): { report: { snapshot: { id: string } } | null }
  subscribeDocumentController(listener: () => void): () => void
}

/** Retention keeps document authority alive; selection changes only the visible projection. */
export function createProjectRuntimeRegistry<T extends Runtime>(initial: T) {
  let active = initial
  const projects = new Map<string, T>()
  const listeners = new Set<() => void>()
  const retained = new Map<T, () => void>()
  function retain(runtime: T) {
    if (retained.has(runtime)) return
    const changed = () => {
      const id = runtime.getDocumentControllerState().report?.snapshot.id
      if (id) projects.set(id, runtime)
      if (active === runtime) for (const listener of listeners) listener()
    }
    retained.set(runtime, runtime.subscribeDocumentController(changed))
    changed()
  }
  retain(initial)
  return {
    active: () => active,
    get: (projectId: string) => projects.get(projectId),
    retain,
    values: () => [...retained.keys()],
    release(runtime: T) {
      if (runtime === active) return false
      retained.get(runtime)?.()
      retained.delete(runtime)
      for (const [id, owner] of projects) if (owner === runtime) projects.delete(id)
      return true
    },
    activate(runtime: T) {
      retain(runtime)
      if (active === runtime) return
      active = runtime
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
