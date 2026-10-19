import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  InitializeRequestSchema,
  InitializeResultSchema,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js"

type RelayPort = Omit<Transport, "sessionId">
type Remote = RelayPort & { terminateSession(): Promise<void> }
function initializeRequestId(message: JSONRPCMessage) {
  if (!isJSONRPCRequest(message)) return undefined
  return InitializeRequestSchema.safeParse(message).success ? message.id : undefined
}
function negotiatedVersion(message: JSONRPCMessage, initializeId: string | number | undefined) {
  if (!isJSONRPCResultResponse(message)) return undefined
  if (message.id !== initializeId) return undefined
  const result = InitializeResultSchema.safeParse(message.result)
  return result.success ? result.data.protocolVersion : undefined
}

export function createMcpRelay(remote: Remote, stdio: RelayPort, onFailure: () => void) {
  let closing: Promise<void> | undefined
  let pending = 0
  let initializeId: string | number | undefined
  function close() {
    closing ??= (async () => {
      await Promise.race([
        remote.terminateSession().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
      ])
      await Promise.allSettled([remote.close(), stdio.close()])
    })()
    return closing
  }
  function fail() {
    if (closing) return
    onFailure()
    void close()
  }
  stdio.onmessage = (message) => {
    if (closing) return
    if (pending >= 8) return fail()
    const id = initializeRequestId(message)
    if (id !== undefined) initializeId = id
    pending += 1
    void remote
      .send(message)
      .catch(fail)
      .finally(() => {
        pending -= 1
      })
  }
  remote.onmessage = (message) => {
    const version = negotiatedVersion(message, initializeId)
    if (version) remote.setProtocolVersion?.(version)
    void stdio.send(message).catch(fail)
  }
  stdio.onerror = fail
  remote.onerror = fail
  stdio.onclose = () => void close()
  remote.onclose = () => void close()
  return {
    close,
    fail,
    async start() {
      await remote.start()
      await stdio.start()
    },
  }
}
