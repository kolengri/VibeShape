import {
  ASSISTANT_EVENT_CHANNEL,
  ASSISTANT_REQUEST_CHANNEL,
  type AssistantBridge,
  type AssistantResult,
  assistantEventSchema,
  assistantRequestSchema,
  assistantResultSchema,
} from "@vibeshape/automation-api/assistant"
import type { ContextBridge, IpcRenderer, IpcRendererEvent } from "electron"

export function exposeAssistantBridge(
  contextBridge: Pick<ContextBridge, "exposeInMainWorld">,
  ipcRenderer: Pick<IpcRenderer, "invoke"> & {
    on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): unknown
    removeListener(
      channel: string,
      listener: (event: IpcRendererEvent, payload: unknown) => void,
    ): unknown
  },
) {
  async function invoke(request: unknown): Promise<AssistantResult> {
    const parsed = assistantRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, code: "invalid-request" }
    try {
      const result = assistantResultSchema.safeParse(
        await ipcRenderer.invoke(ASSISTANT_REQUEST_CHANNEL, parsed.data),
      )
      return result.success ? result.data : { ok: false, code: "protocol-error" }
    } catch {
      return { ok: false, code: "request-failed" }
    }
  }
  const bridge: AssistantBridge = Object.freeze({
    protocolVersion: 1,
    connect: (input) => invoke({ operation: "connect", input }),
    prompt: (input) => invoke({ operation: "prompt", input }),
    cancel: (input) => invoke({ operation: "cancel", input }),
    disconnect: (input) => invoke({ operation: "disconnect", input }),
    respondPermission: (input) => invoke({ operation: "respondPermission", input }),
    setMode: (input) => invoke({ operation: "setMode", input }),
    setModel: (input) => invoke({ operation: "setModel", input }),
    setConfigOption: (input) => invoke({ operation: "setConfigOption", input }),
    respondQuestion: (input) => invoke({ operation: "respondQuestion", input }),
    authenticate: (input) => invoke({ operation: "authenticate", input }),
    onEvent(callback) {
      const listener = (_event: IpcRendererEvent, payload: unknown) => {
        const event = assistantEventSchema.safeParse(payload)
        if (event.success) callback(event.data)
      }
      ipcRenderer.on(ASSISTANT_EVENT_CHANNEL, listener)
      return () => ipcRenderer.removeListener(ASSISTANT_EVENT_CHANNEL, listener)
    },
  })
  contextBridge.exposeInMainWorld("vibeshapeAssistant", bridge)
}
