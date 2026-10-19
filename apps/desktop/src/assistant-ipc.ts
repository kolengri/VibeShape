import {
  ASSISTANT_REQUEST_CHANNEL,
  type AssistantResult,
  assistantRequestSchema,
} from "@vibeshape/automation-api/assistant"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { createAssistantService } from "./assistant-service"

export function registerAssistantIpc(options: {
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">
  isOwnedSender: (event: IpcMainInvokeEvent) => boolean
  service: ReturnType<typeof createAssistantService>
}) {
  options.ipcMain.handle(
    ASSISTANT_REQUEST_CHANNEL,
    async (event, payload: unknown): Promise<AssistantResult> => {
      if (!options.isOwnedSender(event)) return { ok: false, code: "forbidden" }
      const parsed = assistantRequestSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, code: "invalid-request" }
      try {
        return await options.service.handle(parsed.data)
      } catch {
        return { ok: false, code: "request-failed" }
      }
    },
  )
  return () => options.ipcMain.removeHandler(ASSISTANT_REQUEST_CHANNEL)
}
