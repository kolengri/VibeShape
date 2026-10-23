import { documentNameSchema } from "@vibeshape/domain/document"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { createStore } from "zustand/vanilla"

const storageKey = "vibeshape.open-project-tabs.v1"
const tabSchema = z.object({ documentId: documentIdSchema, name: documentNameSchema }).strict()
const persistedTabsSchema = z
  .object({ version: z.literal(1), tabs: z.array(tabSchema).max(256) })
  .strict()
  .refine(({ tabs }) => new Set(tabs.map(({ documentId }) => documentId)).size === tabs.length)

type ProjectTab = z.infer<typeof tabSchema>
type StorageLike = Pick<Storage, "getItem" | "setItem">

type ProjectTabsState = {
  tabs: readonly ProjectTab[]
  pending: boolean
  closing: boolean
  pendingProjectId: string | null
  replacingDocumentId: string | null
  storageFailed: boolean
  focusRequested: boolean
  actions: {
    remember: (project: ProjectTab) => void
    reconcile: (projects: readonly ProjectTab[], active: ProjectTab) => void
    remove: (documentId: string) => void
    replaceOnActivation: (documentId: string | null) => void
    beginTransition: (kind?: "selection" | "close", projectId?: string) => number | null
    isCurrentTransition: (token: number) => boolean
    markClosing: (token: number) => void
    endTransition: (token: number) => void
    requestFocus: () => void
    clearFocus: () => void
  }
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function readTabs(storage: StorageLike | null): Pick<ProjectTabsState, "tabs" | "storageFailed"> {
  if (!storage) return { tabs: [], storageFailed: true }
  try {
    const raw = storage.getItem(storageKey)
    if (!raw || raw.length > 262_144) return { tabs: [], storageFailed: false }
    const value: unknown = JSON.parse(raw)
    const parsed = persistedTabsSchema.safeParse(value)
    return { tabs: parsed.success ? parsed.data.tabs : [], storageFailed: false }
  } catch {
    return { tabs: [], storageFailed: true }
  }
}

function sameTabs(first: readonly ProjectTab[], second: readonly ProjectTab[]) {
  return (
    first.length === second.length &&
    first.every((tab, index) => {
      const other = second[index]
      return tab.documentId === other?.documentId && tab.name === other.name
    })
  )
}

function rememberProject(state: ProjectTabsState, project: ProjectTab) {
  const remaining = state.tabs.filter(
    ({ documentId }) =>
      documentId !== state.replacingDocumentId || state.replacingDocumentId === project.documentId,
  )
  const exists = remaining.some(({ documentId }) => documentId === project.documentId)
  const tabs = exists
    ? remaining.map((tab) => (tab.documentId === project.documentId ? project : tab))
    : [...remaining, project]
  return {
    tabs: sameTabs(state.tabs, tabs) ? state.tabs : tabs,
    replacingDocumentId:
      state.replacingDocumentId === project.documentId ? state.replacingDocumentId : null,
    focusRequested:
      state.focusRequested ||
      (state.replacingDocumentId !== null && state.replacingDocumentId !== project.documentId),
  }
}

export function createProjectTabsStore(storage: StorageLike | null = browserStorage()) {
  let generation = 0
  const store = createStore<ProjectTabsState>()((set, get) => ({
    ...readTabs(storage),
    pending: false,
    closing: false,
    pendingProjectId: null,
    replacingDocumentId: null,
    focusRequested: false,
    actions: {
      remember: (project) => set((state) => rememberProject(state, project)),
      reconcile: (projects, active) => {
        const available = new Map(projects.map((project) => [project.documentId, project]))
        available.set(active.documentId, active)
        set((state) => {
          const tabs = state.tabs.flatMap((tab) => {
            const current = available.get(tab.documentId)
            return current ? [current] : []
          })
          const next = rememberProject({ ...state, tabs }, active)
          return { ...next, tabs: sameTabs(state.tabs, next.tabs) ? state.tabs : next.tabs }
        })
      },
      remove: (documentId) =>
        set((state) => ({ tabs: state.tabs.filter((tab) => tab.documentId !== documentId) })),
      replaceOnActivation: (documentId) => set({ replacingDocumentId: documentId }),
      beginTransition: (kind = "selection", projectId) => {
        const current = get()
        if (
          current.pending &&
          (kind === "close" ||
            current.closing ||
            !projectId ||
            current.pendingProjectId === projectId)
        )
          return null
        const token = ++generation
        set({ pending: true, closing: kind === "close", pendingProjectId: projectId ?? null })
        return token
      },
      isCurrentTransition: (token) => token === generation,
      markClosing: (token) => {
        if (token === generation) set({ closing: true })
      },
      endTransition: (token) => {
        if (token === generation) set({ pending: false, closing: false, pendingProjectId: null })
      },
      requestFocus: () => set({ focusRequested: true }),
      clearFocus: () => set({ focusRequested: false }),
    },
  }))
  store.subscribe((state, previous) => {
    if (!storage || state.tabs === previous.tabs) return
    const value = persistedTabsSchema.safeParse({ version: 1, tabs: state.tabs })
    if (!value.success) {
      store.setState({ storageFailed: true })
      return
    }
    try {
      storage.setItem(storageKey, JSON.stringify(value.data))
      if (state.storageFailed) store.setState({ storageFailed: false })
    } catch {
      store.setState({ storageFailed: true })
    }
  })
  return store
}
