import type { EditorSessionStoreApi } from "./editor-session-store"

/** Save the current task once before navigating; a failed save keeps its editor open. */
export function createHistoryNavigation(store: EditorSessionStoreApi) {
  let submit: (() => Promise<unknown>) | null = null
  let pending: Promise<boolean> | null = null
  let request = 0
  let destination: (() => void) | null = null
  const hasTask = () => {
    const state = store.getState()
    return Boolean(
      (state.activePartDesignTool && state.activePartDesignTool.kind !== "measure") ||
        state.sketch.activeSketchTool,
    )
  }
  return {
    register(handler: () => Promise<unknown>) {
      submit = handler
      return () => {
        if (submit === handler) submit = null
      }
    },
    async navigate(activate: () => void, alreadyActive = false) {
      if (alreadyActive && !pending) return true
      const current = ++request
      destination = activate
      if (!pending) {
        if (!hasTask()) {
          if (store.getState().activePartDesignTool?.kind === "measure")
            store.getState().actions.closeActiveTool()
          destination = null
          activate()
          return true
        }
        const save = submit
        if (!save) return false
        pending = (async () => {
          try {
            await save()
            if (hasTask()) return false
            const next = destination
            destination = null
            next?.()
            return true
          } catch {
            return false
          } finally {
            pending = null
          }
        })()
      }
      const succeeded = await pending
      return succeeded && current === request
    },
  }
}
