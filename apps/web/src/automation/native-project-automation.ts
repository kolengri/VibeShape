import { getProjectRuntime } from "../document/document-controller"
import { registerProjectRuntimeResource } from "../document/project-runtime-resources"
import { createLocalAutomationConnection } from "./local-automation-connection"

const connections = new Map<string, ReturnType<typeof createLocalAutomationConnection>>()
const started = new WeakSet<ReturnType<typeof createLocalAutomationConnection>>()

/** The project, rather than its mounted chat or tab, owns native MCP polling and cancellation. */
export function getNativeProjectAutomationConnection(projectId: string) {
  const existing = connections.get(projectId)
  if (existing) return existing
  const runtime = getProjectRuntime(projectId)
  if (!runtime) throw new Error("The native assistant requires an open project runtime.")
  const connection = createLocalAutomationConnection({
    projectId,
    createDocumentSession: runtime.createActiveDocumentAutomationSession,
    reviews: runtime.reviews,
  })
  connections.set(projectId, connection)
  const unregister = registerProjectRuntimeResource(projectId, {
    isBusy: () => connection.getSnapshot().busy,
    async dispose() {
      connection.dispose()
      await connection.disconnect()
      connections.delete(projectId)
      started.delete(connection)
      unregister()
    },
  })
  return connection
}

export function startNativeProjectAutomationConnection(projectId: string) {
  const connection = getNativeProjectAutomationConnection(projectId)
  if (!started.has(connection)) {
    started.add(connection)
    connection.start()
  }
  void connection.status()
}
