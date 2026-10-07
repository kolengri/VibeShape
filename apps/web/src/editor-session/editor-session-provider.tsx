import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react"
import { useStore } from "zustand"
import {
  createEditorSessionStore,
  type EditorSessionStore,
  type EditorSessionStoreApi,
} from "./editor-session-store"
import { createHistoryNavigation } from "./history-navigation"
import { loadSketchVisibility, saveSketchVisibility } from "./sketch-visibility"

function browserStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

const EditorSessionContext = createContext<EditorSessionStoreApi | null>(null)
const HistoryNavigationContext = createContext<ReturnType<typeof createHistoryNavigation> | null>(
  null,
)

export function EditorSessionProvider({
  children,
  documentId,
}: Readonly<{ children: ReactNode; documentId?: string | undefined }>) {
  const [store] = useState(() =>
    createEditorSessionStore(documentId ? loadSketchVisibility(browserStorage(), documentId) : {}),
  )
  const [navigation] = useState(() => createHistoryNavigation(store))
  useEffect(() => {
    if (!documentId) return
    return store.subscribe((state, previous) => {
      if (state.sketchVisibilityOverrides !== previous.sketchVisibilityOverrides)
        saveSketchVisibility(browserStorage(), documentId, state.sketchVisibilityOverrides)
    })
  }, [store, documentId])
  return (
    <EditorSessionContext.Provider value={store}>
      <HistoryNavigationContext.Provider value={navigation}>
        {children}
      </HistoryNavigationContext.Provider>
    </EditorSessionContext.Provider>
  )
}

export function useHistoryNavigation() {
  const navigation = useContext(HistoryNavigationContext)
  if (!navigation) throw new Error("History navigation requires EditorSessionProvider.")
  return navigation
}

export function useRegisterTaskSubmission(
  submit: () => Promise<unknown>,
  workspaceTaskKey?: string,
) {
  const navigation = useContext(HistoryNavigationContext)
  const owner = useId()
  useLayoutEffect(
    () => navigation?.register(submit, workspaceTaskKey, owner),
    [navigation, submit, workspaceTaskKey, owner],
  )
}

export function useEditorSession<Result>(selector: (state: EditorSessionStore) => Result) {
  return useStore(useEditorSessionStoreApi(), selector)
}

export function useEditorSessionStoreApi() {
  const store = useContext(EditorSessionContext)
  if (!store) throw new Error("useEditorSession must be used within EditorSessionProvider")
  return store
}
