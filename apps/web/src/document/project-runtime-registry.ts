type Runtime = {
  getDocumentControllerState(): {
    report: { snapshot: { id: string } } | null
    openingProjectId?: string
  }
  subscribeDocumentController(listener: () => void): () => void
}

/** Retention keeps document authority alive; selection changes only the visible projection. */
export function createProjectRuntimeRegistry<T extends Runtime>(initial: T) {
  let active = initial
  const projects = new Map<string, T>()
  const listeners = new Set<() => void>()
  const retained = new Map<T, () => void>()
  const membershipListeners = new Set<() => void>()
  let openIds: readonly string[] = []
  // Publishes a stable snapshot so UI can follow which projects keep a retained session.
  function publishMembership() {
    const next = [...projects.keys()].sort()
    if (next.length === openIds.length && next.every((id, index) => id === openIds[index])) return
    openIds = next
    for (const listener of membershipListeners) listener()
  }
  function retain(runtime: T) {
    if (retained.has(runtime)) return
    const changed = () => {
      const state = runtime.getDocumentControllerState()
      const id = state.report?.snapshot.id ?? state.openingProjectId
      if (id) projects.set(id, runtime)
      publishMembership()
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
    openProjectIds: () => openIds,
    subscribeOpenProjects(listener: () => void) {
      membershipListeners.add(listener)
      return () => membershipListeners.delete(listener)
    },
    release(runtime: T) {
      if (runtime === active) return false
      retained.get(runtime)?.()
      retained.delete(runtime)
      for (const [id, owner] of projects) if (owner === runtime) projects.delete(id)
      publishMembership()
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
