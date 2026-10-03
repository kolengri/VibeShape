export type ProjectActionBlock = "editor-draft" | "surface-texture-draft" | "automation-busy"

// Readers retain the owning stores; no draft or automation state is copied here.
export function createProjectActionGuard() {
  const readers = new Map<symbol, () => ProjectActionBlock | null>()
  return {
    register(reader: () => ProjectActionBlock | null) {
      const owner = Symbol("project-action-guard")
      readers.set(owner, reader)
      return () => {
        readers.delete(owner)
      }
    },
    read() {
      for (const reader of readers.values()) {
        const blocked = reader()
        if (blocked) return blocked
      }
      return null
    },
  }
}
