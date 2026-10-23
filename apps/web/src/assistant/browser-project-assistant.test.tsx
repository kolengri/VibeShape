import "../../../../tests/unit/support/dom"

import { afterEach, expect, it, mock } from "bun:test"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { ApiAssistantError } from "./api-errors"

type AssistantPanelProps = ComponentProps<typeof import("./assistant-panel").AssistantPanel>

import { MemoryTranscriptStore } from "./chat-history.test-fixture"

const original = { ...(await import("./api-chat-controller")) }
let registry: ReturnType<typeof original.createApiChatRegistry>
const readyProjects = new Set<string>()
const createTools = vi.fn((projectId: string) => {
  if (!readyProjects.has(projectId)) throw new ApiAssistantError("tools-unavailable")
  return { execute: async () => ({}), isActive: () => readyProjects.has(projectId), dispose() {} }
})
mock.module("./api-chat-controller", () => ({
  ...original,
  createApiChatRegistry: (options: Parameters<typeof original.createApiChatRegistry>[0]) => {
    registry = original.createApiChatRegistry({
      ...options,
      historyStore: new MemoryTranscriptStore(),
    })
    return registry
  },
}))
mock.module("./browser-tool-session", () => ({ createBrowserToolSession: createTools }))
mock.module("./assistant-draft-display", () => ({ useAssistantDraftDisplay: () => undefined }))
mock.module("./assistant-tool-highlight", () => ({ useAssistantToolHighlight: () => undefined }))
mock.module("./api-configuration-form", () => ({ ApiConfigurationForm: () => null }))
mock.module("./assistant-panel", () => ({
  AssistantPanel: ({ canSend }: AssistantPanelProps) => (
    <output aria-label="Assistant connected">{String(canSend)}</output>
  ),
}))
const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { BrowserProjectAssistant } = await import("./browser-project-assistant")

const sourceId = "0195b5ac-b250-7a2c-8c33-000000000101"
const targetId = "0195b5ac-b250-7a2c-8c33-000000000102"
function view(status: DocumentControllerState["status"]) {
  const controller = { status, report: { snapshot: { id: targetId } } } as DocumentControllerState
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <BrowserProjectAssistant controller={controller} open onClose={() => {}} />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  registry.dispose()
  readyProjects.clear()
  createTools.mockClear()
})

it("automatically connects retained API configuration when a coarse project becomes ready", async () => {
  readyProjects.add(sourceId)
  expect(
    await registry.connect(sourceId, {
      endpoint: "https://api.example.test/v1/chat/completions",
      model: "test-model",
      stream: true,
      apiKey: "non-secret-test-value",
    }),
  ).toBe(true)
  createTools.mockClear()
  const rendered = render(view("loading"))
  await act(async () => {})
  expect(createTools).not.toHaveBeenCalled()
  expect(registry.get(targetId).getSnapshot().error).toBeNull()
  expect(screen.getByLabelText("Assistant connected").textContent).toBe("false")
  readyProjects.add(targetId)
  rendered.rerender(view("ready"))
  await waitFor(() => expect(screen.getByLabelText("Assistant connected").textContent).toBe("true"))
  expect(createTools).toHaveBeenCalledTimes(1)
  expect(createTools).toHaveBeenCalledWith(targetId)
  expect(registry.get(targetId).getSnapshot().error).toBeNull()
})
