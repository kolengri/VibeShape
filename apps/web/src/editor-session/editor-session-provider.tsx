import { createContext, type ReactNode, useContext, useState } from "react"
import { useStore } from "zustand"
import {
  createEditorSessionStore,
  type EditorSessionStore,
  type EditorSessionStoreApi,
} from "./editor-session-store"

const EditorSessionContext = createContext<EditorSessionStoreApi | null>(null)

export function EditorSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(() => createEditorSessionStore())
  return <EditorSessionContext.Provider value={store}>{children}</EditorSessionContext.Provider>
}

export function useEditorSession<Result>(selector: (state: EditorSessionStore) => Result) {
  const store = useContext(EditorSessionContext)
  if (!store) throw new Error("useEditorSession must be used within EditorSessionProvider")
  return useStore(store, selector)
}
