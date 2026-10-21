import {
  ASSISTANT_CONNECTION_TEST_CHANNEL,
  ASSISTANT_REQUEST_CHANNEL,
  type AssistantConnectionTestResult,
  type AssistantResult,
  assistantConnectionTestResultSchema,
  assistantConnectionTestSchema,
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
  options.ipcMain.handle(
    ASSISTANT_CONNECTION_TEST_CHANNEL,
    async (event, payload: unknown): Promise<AssistantConnectionTestResult> => {
      if (!options.isOwnedSender(event)) return { ok: false, code: "forbidden", stage: "agent" }
      const input = assistantConnectionTestSchema.safeParse(payload)
      if (!input.success) return { ok: false, code: "invalid-request", stage: "agent" }
      try {
        const result = assistantConnectionTestResultSchema.safeParse(
          await options.service.testConnection(input.data),
        )
        return result.success ? result.data : { ok: false, code: "protocol-error", stage: "agent" }
      } catch {
        return { ok: false, code: "request-failed", stage: "agent" }
      }
    },
  )
  return () => {
    options.ipcMain.removeHandler(ASSISTANT_REQUEST_CHANNEL)
    options.ipcMain.removeHandler(ASSISTANT_CONNECTION_TEST_CHANNEL)
  }
}
