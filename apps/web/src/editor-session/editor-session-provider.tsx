import { createContext, type ReactNode, useContext, useRef } from "react"
import { useStore } from "zustand"
import {
  createEditorSessionStore,
  type EditorSessionStore,
  type EditorSessionStoreApi,
} from "./editor-session-store"

const EditorSessionContext = createContext<EditorSessionStoreApi | null>(null)

type EditorSessionOwner = {
  documentId: string | null
  store: EditorSessionStoreApi
}

export function EditorSessionProvider({
  children,
  documentId,
}: Readonly<{ children: ReactNode; documentId: string | null }>) {
  const ownerRef = useRef<EditorSessionOwner | null>(null)
  let owner = ownerRef.current
  if (!owner) {
    owner = { documentId, store: createEditorSessionStore() }
    ownerRef.current = owner
  } else if (documentId && !owner.documentId) {
    owner.documentId = documentId
  } else if (documentId && documentId !== owner.documentId) {
    owner = { documentId, store: createEditorSessionStore() }
    ownerRef.current = owner
  }
  return (
    <EditorSessionContext.Provider value={owner.store}>{children}</EditorSessionContext.Provider>
  )
}

export function useEditorSession<Result>(selector: (state: EditorSessionStore) => Result) {
  const store = useContext(EditorSessionContext)
  if (!store) throw new Error("useEditorSession must be used within EditorSessionProvider")
  return useStore(store, selector)
}
