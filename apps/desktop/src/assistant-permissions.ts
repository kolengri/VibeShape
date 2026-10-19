import { randomUUID } from "node:crypto"
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { AssistantEvent, AssistantSnapshot } from "@vibeshape/automation-api/assistant"

export function createAssistantPermissions(
  snapshot: AssistantSnapshot,
  emit: (event: AssistantEvent) => void,
  timeoutMs: number,
) {
  const pending = new Map<string, { settle: (allow: boolean) => void }>()
  const scope = { projectId: snapshot.projectId, sessionToken: snapshot.sessionToken }
  return {
    request(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      if (pending.size >= 8) return Promise.resolve({ outcome: { outcome: "cancelled" } })
      const requestId = randomUUID()
      const allowOnce = params.options.find((option) => option.kind === "allow_once")
      const reject = params.options.find((option) => option.kind === "reject_once")
      return new Promise((resolve) => {
        const settle = (allow: boolean) => {
          if (!pending.delete(requestId)) return
          clearTimeout(timer)
          const option = allow ? allowOnce : reject
          resolve({
            outcome: option
              ? { outcome: "selected", optionId: option.optionId }
              : { outcome: "cancelled" },
          })
          emit({ ...scope, type: "permission-resolved", requestId })
        }
        const timer = setTimeout(() => settle(false), timeoutMs)
        pending.set(requestId, { settle })
        emit({
          ...scope,
          type: "permission",
          requestId,
          title: (params.toolCall.title ?? params.toolCall.toolCallId).slice(0, 512),
          canAllow: Boolean(allowOnce),
          expiresAt: Date.now() + timeoutMs,
        })
      })
    },
    respond(requestId: string, allow: boolean) {
      const request = pending.get(requestId)
      if (!request) return false
      request.settle(allow)
      return true
    },
    cancel() {
      for (const request of pending.values()) request.settle(false)
    },
  }
}
