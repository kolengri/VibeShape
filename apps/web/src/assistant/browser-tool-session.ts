import { createLocalAutomationActor } from "@vibeshape/automation-api/local-session"
import type { CommandActor } from "@vibeshape/domain/commands"
import { createLocalToolExecutor } from "../automation/local-tool-executor"
import { getProjectRuntime } from "../document/document-controller"
import { createApiCadGateway } from "./api-cad-tools"
import { ApiAssistantError } from "./api-errors"

export type BrowserToolSession = Readonly<{
  execute: (name: string, input: unknown, signal: AbortSignal) => Promise<unknown>
  isActive: () => boolean
  currentActor?: () => CommandActor | null
  dispose: () => void
}>

export function createBrowserToolSession(projectId: string): BrowserToolSession {
  const session = getProjectRuntime(projectId)?.createActiveDocumentAutomationSession({
    approvalPolicy: "connected-assistant",
  })
  if (!session?.ok) throw new ApiAssistantError("tools-unavailable")
  if (session.documentId !== projectId) {
    session.dispose()
    throw new ApiAssistantError("stale-project")
  }
  let closed = false
  const actor = {
    ...createLocalAutomationActor(Date.now(), crypto.getRandomValues(new Uint8Array(10))),
    clientId: "org.vibeshape.direct-api-client",
  }
  const { numericalJobs: _numericalJobs, ...inlineSession } = session
  const executor = createLocalToolExecutor(inlineSession, actor)
  const isActive = () => !closed && session.readIdentity()?.id === projectId
  return {
    execute: createApiCadGateway({
      projectId,
      isActive,
      execute: (operation, signal) => executor.execute(operation, signal),
    }),
    isActive,
    currentActor: () => (isActive() ? { ...actor } : null),
    dispose() {
      if (closed) return
      closed = true
      session.dispose()
    },
  }
}
