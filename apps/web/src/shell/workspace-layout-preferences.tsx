import { createContext, type ReactNode, useContext, useState } from "react"
import { z } from "zod"
import { useStore } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"

const STORAGE_KEY = "vibeshape.workspace-layout.v1"
const MAX_STORAGE_LENGTH = 4096

const persistedPreferencesSchema = z
  .object({
    version: z.literal(1),
    treeWidth: z.number().min(200).max(420),
    taskWidth: z.number().min(280).max(480),
    treeOpacity: z.number().min(0).max(100),
    taskOpacity: z.number().min(0).max(100),
    treeCollapsed: z.boolean(),
    taskCollapsed: z.boolean(),
  })
  .strict()

export type WorkspaceLayoutPanel = "tree" | "task"

export type WorkspaceLayoutPreferencesState = Readonly<{
  treeWidth: number
  taskWidth: number
  treeOpacity: number
  taskOpacity: number
  treeCollapsed: boolean
  taskCollapsed: boolean
  actions: Readonly<{
    setWidth: (panel: WorkspaceLayoutPanel, value: number) => void
    setOpacity: (panel: WorkspaceLayoutPanel, value: number) => void
    setCollapsed: (panel: WorkspaceLayoutPanel, collapsed: boolean) => void
    reset: () => void
  }>
}>

type StorageLike = Pick<Storage, "getItem" | "setItem">

const defaults = {
  treeWidth: 240,
  taskWidth: 320,
  treeOpacity: 100,
  taskOpacity: 100,
  treeCollapsed: false,
  taskCollapsed: false,
}

function getBrowserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function readPreferences(storage: StorageLike | null) {
  if (!storage) return defaults
  try {
    const serialized = storage.getItem(STORAGE_KEY)
    if (!serialized || serialized.length > MAX_STORAGE_LENGTH) return defaults
    const parsed: unknown = JSON.parse(serialized)
    const result = persistedPreferencesSchema.safeParse(parsed)
    if (!result.success) return defaults
    const { version: _version, ...preferences } = result.data
    return preferences
  } catch {
    return defaults
  }
}

function persistPreferences(storage: StorageLike | null, state: WorkspaceLayoutPreferencesState) {
  if (!storage) return
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        treeWidth: state.treeWidth,
        taskWidth: state.taskWidth,
        treeOpacity: state.treeOpacity,
        taskOpacity: state.taskOpacity,
        treeCollapsed: state.treeCollapsed,
        taskCollapsed: state.taskCollapsed,
      }),
    )
  } catch {
    // Storage is best-effort; in-memory preferences remain available for this session.
  }
}

export function createWorkspaceLayoutStore(storage: StorageLike | null = getBrowserStorage()) {
  const initial = readPreferences(storage)
  const store = createStore<WorkspaceLayoutPreferencesState>()(
    immer((set) => ({
      ...initial,
      actions: {
        setWidth: (panel, value) => {
          if (!Number.isFinite(value)) return
          const minimum = panel === "tree" ? 200 : 280
          const maximum = panel === "tree" ? 420 : 480
          set((state) => {
            state[`${panel}Width`] = Math.min(maximum, Math.max(minimum, Math.round(value)))
          })
        },
        setOpacity: (panel, value) => {
          if (!Number.isFinite(value)) return
          set((state) => {
            state[`${panel}Opacity`] = Math.min(100, Math.max(0, Math.round(value)))
          })
        },
        setCollapsed: (panel, collapsed) =>
          set((state) => {
            state[`${panel}Collapsed`] = collapsed
          }),
        reset: () => set(() => ({ ...defaults, actions: store.getState().actions })),
      },
    })),
  )

  store.subscribe((state) => persistPreferences(storage, state))
  return store
}

const WorkspaceLayoutPreferencesContext = createContext<ReturnType<
  typeof createWorkspaceLayoutStore
> | null>(null)

export function WorkspaceLayoutPreferencesProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [store] = useState(() => createWorkspaceLayoutStore())
  return (
    <WorkspaceLayoutPreferencesContext.Provider value={store}>
      {children}
    </WorkspaceLayoutPreferencesContext.Provider>
  )
}

function useWorkspaceLayoutPreferencesStore() {
  const store = useContext(WorkspaceLayoutPreferencesContext)
  if (!store) {
    throw new Error(
      "useWorkspaceLayoutPreferences must be used within WorkspaceLayoutPreferencesProvider",
    )
  }
  return store
}

export function useWorkspaceLayoutPreferences<Result>(
  selector: (state: WorkspaceLayoutPreferencesState) => Result,
) {
  return useStore(useWorkspaceLayoutPreferencesStore(), selector)
}
