import type { EditorSessionStoreApi } from "./editor-session-store"

/** Save the current task once before navigating; a failed save keeps its editor open. */
export function createHistoryNavigation(store: EditorSessionStoreApi) {
  let submit: (() => Promise<unknown>) | null = null
  let workspaceTaskOwner: object | string | null = null
  let pending: Promise<boolean> | null = null
  let request = 0
  let destination: (() => void) | null = null
  const hasTask = () => {
    const state = store.getState()
    return Boolean(
      (state.activePartDesignTool && state.activePartDesignTool.kind !== "measure") ||
        state.sketch.activeSketchTool ||
        workspaceTaskOwner !== null,
    )
  }
  return {
    register(handler: () => Promise<unknown>, taskKey?: string, owner: object | string = handler) {
      submit = handler
      workspaceTaskOwner = taskKey ? owner : null
      return () => {
        if (submit === handler) {
          submit = null
          workspaceTaskOwner = null
        }
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
        const taskOwner = workspaceTaskOwner
        pending = (async () => {
          try {
            const result = await save()
            if (taskOwner !== null) {
              if (result !== true) return false
              if (workspaceTaskOwner !== null && workspaceTaskOwner !== taskOwner) return false
              workspaceTaskOwner = null
            }
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
