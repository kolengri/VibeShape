import { documentIdSchema } from "@vibeshape/domain"

type ProjectId = ReturnType<typeof documentIdSchema.parse>
export type ProjectNavigationError =
  | "invalid-project-url"
  | "document-not-found"
  | "project-action-blocked"
  | "project-open-failed"
  | "project-url-unavailable"

export function readProjectUrl(href: string) {
  const values = new URL(href).searchParams.getAll("project")
  if (values.length === 0) return { kind: "default" } as const
  const parsed = documentIdSchema.safeParse(values.length === 1 ? values[0] : null)
  return parsed.success
    ? ({ kind: "project", documentId: parsed.data } as const)
    : ({ kind: "invalid" } as const)
}

export function projectRecoveryUrl(href: string) {
  const url = new URL(href)
  url.searchParams.delete("project")
  return url.href
}

function navigationResultError(
  result: { ok: true } | { ok: false; diagnostic: { code: string } },
): ProjectNavigationError | null {
  if (result.ok) return null
  const code = result.diagnostic.code
  return code === "document-not-found" || code === "project-action-blocked"
    ? code
    : "project-open-failed"
}

type NavigationPort = Readonly<{
  href: () => string
  write: (href: string, mode: "push" | "replace") => void
  subscribe: (listener: () => void) => () => void
  activeProjectId: () => string | null
  open: (
    documentId: ProjectId,
    signal: AbortSignal,
  ) => Promise<{ ok: true } | { ok: false; diagnostic: { code: string } }>
  library?:
    | ((signal: AbortSignal) => Promise<{ ok: true } | { ok: false; diagnostic: { code: string } }>)
    | undefined
  failed: (error: ProjectNavigationError) => void
}>

// History selects a local session through its ordinary guarded transition. It never owns a draft.
export function createProjectNavigation(port: NavigationPort) {
  let generation = 0
  let pending = 0
  let abort: AbortController | null = null
  let queue = Promise.resolve()
  let unsubscribe: (() => void) | null = null
  let owners = 0
  const pendingListeners = new Set<() => void>()

  function setPending(next: number) {
    const wasPending = pending !== 0
    pending = next
    if (wasPending !== (pending !== 0)) for (const listener of pendingListeners) listener()
  }

  function write(documentId: string, mode: "push" | "replace") {
    const url = new URL(port.href())
    if (
      url.searchParams.getAll("project").length === 1 &&
      url.searchParams.get("project") === documentId
    )
      return true
    url.searchParams.set("project", documentId)
    try {
      port.write(url.href, mode)
      return true
    } catch {
      port.failed("project-url-unavailable")
      return false
    }
  }

  async function openRequestedProject(
    request: ReturnType<typeof readProjectUrl>,
    signal: AbortSignal,
  ): Promise<ProjectNavigationError | null> {
    try {
      if (request.kind === "invalid") return "invalid-project-url"
      if (request.kind === "default") {
        if (!port.library) return "invalid-project-url"
        return navigationResultError(await port.library(signal))
      }
      if (request.documentId === port.activeProjectId()) return null
      return navigationResultError(await port.open(request.documentId, signal))
    } catch {
      return "project-open-failed"
    }
  }

  function isCurrentRequest(requestGeneration: number) {
    return requestGeneration === generation && owners > 0
  }

  async function navigate(request: ReturnType<typeof readProjectUrl>, requestGeneration: number) {
    if (!isCurrentRequest(requestGeneration)) return
    const signal = new AbortController()
    abort = signal
    let error: ProjectNavigationError | null = null
    try {
      error = await openRequestedProject(request, signal.signal)
    } finally {
      if (pending === requestGeneration) setPending(0)
      if (abort === signal) abort = null
    }
    if (!isCurrentRequest(requestGeneration)) return
    const activeId = port.activeProjectId()
    if (activeId && !write(activeId, "replace")) return
    if (error) port.failed(error)
  }

  function onPopState() {
    const requestGeneration = ++generation
    setPending(requestGeneration)
    abort?.abort()
    const request = readProjectUrl(port.href())
    queue = queue.then(() => navigate(request, requestGeneration))
  }

  return {
    getPendingSnapshot: () => pending !== 0,
    subscribePending(listener: () => void) {
      pendingListeners.add(listener)
      return () => pendingListeners.delete(listener)
    },
    clear(mode: "push" | "replace" = "push") {
      if (readProjectUrl(port.href()).kind === "default") return true
      try {
        port.write(projectRecoveryUrl(port.href()), mode)
        return true
      } catch {
        port.failed("project-url-unavailable")
        return false
      }
    },
    sync(documentId: string, mode: "push" | "replace" = "push") {
      if (pending === 0) write(documentId, mode)
    },
    listen() {
      if (owners++ === 0) unsubscribe = port.subscribe(onPopState)
      return () => {
        if (--owners !== 0) return
        unsubscribe?.()
        unsubscribe = null
        generation += 1
        abort?.abort()
        setPending(0)
      }
    },
  }
}
