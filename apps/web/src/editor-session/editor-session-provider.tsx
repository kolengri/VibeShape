import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { useStore } from "zustand"
import {
  createEditorSessionStore,
  type EditorSessionStore,
  type EditorSessionStoreApi,
} from "./editor-session-store"

import { loadSketchVisibility, saveSketchVisibility } from "./sketch-visibility"

function browserStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

const EditorSessionContext = createContext<EditorSessionStoreApi | null>(null)

export function EditorSessionProvider({
  children,
  documentId,
}: Readonly<{ children: ReactNode; documentId?: string | undefined }>) {
  const [store] = useState(() =>
    createEditorSessionStore(documentId ? loadSketchVisibility(browserStorage(), documentId) : {}),
  )
  useEffect(() => {
    if (!documentId) return
    return store.subscribe((state, previous) => {
      if (state.sketchVisibilityOverrides !== previous.sketchVisibilityOverrides)
        saveSketchVisibility(browserStorage(), documentId, state.sketchVisibilityOverrides)
    })
  }, [store, documentId])
  return <EditorSessionContext.Provider value={store}>{children}</EditorSessionContext.Provider>
}

export function useEditorSession<Result>(selector: (state: EditorSessionStore) => Result) {
  return useStore(useEditorSessionStoreApi(), selector)
}

export function useEditorSessionStoreApi() {
  const store = useContext(EditorSessionContext)
  if (!store) throw new Error("useEditorSession must be used within EditorSessionProvider")
  return store
}
