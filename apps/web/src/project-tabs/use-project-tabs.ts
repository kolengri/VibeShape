import { useCallback, useEffect, useRef, useState } from "react"
import {
  type AutomationProjectExpectation,
  activateLocalProject,
  createNewLocalProject,
  type DocumentControllerState,
  getDocumentControllerState,
  getProjectActionBlock,
  listLocalProjects,
  type ProjectSwitchResult,
} from "../document/document-controller"
import { useProjectTabs, useProjectTabsStore } from "./project-tabs-provider"

type ProjectTabsFeedback = "blocked" | "switchFailed" | "listFailed" | null

function projectTransitionExpectation(controller: DocumentControllerState) {
  if (
    controller.status !== "ready" ||
    controller.saveStatus !== "saved" ||
    getProjectActionBlock()
  ) {
    return null
  }
  const snapshot = controller.report?.snapshot
  return snapshot ? { documentId: snapshot.id, revision: snapshot.revision } : null
}

export function useProjectTabsController(
  controller: DocumentControllerState,
  onOpenProjects?: () => Promise<ProjectSwitchResult>,
) {
  const store = useProjectTabsStore()
  const state = useProjectTabs()
  const [feedback, setFeedback] = useState<ProjectTabsFeedback>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const listRequest = useRef(0)
  const previousActiveId = useRef<string | undefined>(undefined)
  const snapshot = controller.report?.snapshot
  const activeId = snapshot?.id
  const activeName = snapshot?.name
  const ready = controller.status === "ready"
  const blocked = getProjectActionBlock()

  useEffect(() => {
    if (ready && activeId && activeName) {
      store.getState().actions.remember({ documentId: activeId, name: activeName })
    }
  }, [activeId, activeName, ready, store])

  useEffect(() => {
    if (previousActiveId.current && previousActiveId.current !== activeId) setLibraryOpen(false)
    previousActiveId.current = activeId
  }, [activeId])

  const refresh = useCallback(async () => {
    const request = ++listRequest.current
    const before = getDocumentControllerState()
    const active = before.report?.snapshot
    if (before.status !== "ready" || !active) return
    const result = await listLocalProjects().catch(() => ({ ok: false as const }))
    const current = getDocumentControllerState()
    if (
      request !== listRequest.current ||
      current.status !== "ready" ||
      current.report?.snapshot.id !== active.id
    )
      return
    if (!result.ok) {
      setFeedback("listFailed")
      return
    }
    store.getState().actions.reconcile(result.projects, {
      documentId: active.id,
      name: current.report.snapshot.name,
    })
    setFeedback((previous) => (previous === "listFailed" ? null : previous))
  }, [store])

  useEffect(() => {
    if (ready) void refresh()
  }, [activeId, activeName, ready, refresh])

  useEffect(() => {
    const refreshWhenFocused = () => void refresh()
    window.addEventListener("focus", refreshWhenFocused)
    return () => {
      listRequest.current += 1
      window.removeEventListener("focus", refreshWhenFocused)
    }
  }, [refresh])

  const transition = async (
    action: (expected: AutomationProjectExpectation) => Promise<ProjectSwitchResult>,
    closingId?: string,
    focusAfter = true,
  ) => {
    const expected = projectTransitionExpectation(controller)
    if (!expected) {
      setFeedback("blocked")
      return
    }
    if (!store.getState().actions.beginTransition()) return
    setFeedback(null)
    try {
      const result = await action(expected)
      if (!result.ok) {
        setFeedback(
          result.diagnostic.code === "project-action-blocked" ? "blocked" : "switchFailed",
        )
        return
      }
      if (closingId) store.getState().actions.remove(closingId)
      if (focusAfter) store.getState().actions.requestFocus()
    } catch {
      setFeedback("switchFailed")
    } finally {
      store.getState().actions.endTransition()
    }
  }

  const navigate = (documentId: string | null, closingId?: string) => {
    if (documentId === activeId) return
    return transition(
      (expected) =>
        documentId ? activateLocalProject(documentId, expected) : createNewLocalProject(),
      closingId,
    )
  }

  const openLibrary = (closingId?: string) => {
    if (onOpenProjects) return transition(onOpenProjects, closingId, false)
    if (closingId) store.getState().actions.replaceOnActivation(closingId)
    setLibraryOpen(true)
  }

  const close = (documentId: string) => {
    if (state.pending) return
    if (documentId !== activeId) {
      store.getState().actions.remove(documentId)
      store.getState().actions.requestFocus()
      return
    }
    if (!projectTransitionExpectation(controller)) {
      setFeedback("blocked")
      return
    }
    const index = state.tabs.findIndex((tab) => tab.documentId === documentId)
    const adjacent = state.tabs[index + 1] ?? state.tabs[index - 1]
    if (adjacent) return navigate(adjacent.documentId, documentId)
    return openLibrary(documentId)
  }

  return {
    ...state,
    activeId,
    blocked,
    feedback,
    libraryOpen,
    refresh,
    activate: (documentId: string) => navigate(documentId),
    create: () => navigate(null),
    close,
    openLibrary: () => openLibrary(),
    changeLibraryOpen: (open: boolean) => {
      setLibraryOpen(open)
      if (!open) {
        store.getState().actions.replaceOnActivation(null)
        void refresh()
      }
    },
  }
}
