import { createLocalAutomationActor } from "@vibeshape/automation-api/local-session"
import { createLocalToolExecutor } from "../automation/local-tool-executor"
import { createActiveDocumentAutomationSession } from "../document/document-controller"
import { createApiCadGateway } from "./api-cad-tools"
import { ApiAssistantError } from "./api-errors"

export type BrowserToolSession = Readonly<{
  execute: (name: string, input: unknown, signal: AbortSignal) => Promise<unknown>
  isActive: () => boolean
  dispose: () => void
}>

export function createBrowserToolSession(projectId: string): BrowserToolSession {
  const session = createActiveDocumentAutomationSession()
  if (!session.ok) throw new ApiAssistantError("tools-unavailable")
  if (session.documentId !== projectId) {
    session.dispose()
    throw new ApiAssistantError("stale-project")
  }
  session.disableAutoApply()
  let closed = false
  const actor = {
    ...createLocalAutomationActor(Date.now(), crypto.getRandomValues(new Uint8Array(10))),
    clientId: "org.vibeshape.direct-api-client",
  }
  const executor = createLocalToolExecutor(session, actor)
  const isActive = () => !closed && session.readIdentity()?.id === projectId
  return {
    execute: createApiCadGateway({
      projectId,
      isActive,
      execute: (operation, signal) => executor.execute(operation, signal),
    }),
    isActive,
    dispose() {
      if (closed) return
      closed = true
      session.dispose()
    },
  }
}
