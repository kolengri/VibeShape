import "../../../../tests/unit/support/dom"

import { afterEach, expect, it, mock } from "bun:test"
import type { AssistantBridge, AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import type { ComponentProps } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { MemoryTranscriptStore } from "./chat-history.test-fixture"
import { createNativeChatController } from "./native-chat-controller"

type PanelProps = ComponentProps<typeof import("./assistant-panel").AssistantPanel>
let chat: ReturnType<typeof createNativeChatController>
mock.module("./native-project-chat-registry", () => ({
  getNativeProjectChatController: () => chat,
  getNativeProjectChatRegistry: () => ({
    subscribe: (listener: () => void) => chat.subscribe(listener),
    isBusy: () => chat.getSnapshot().controlBusy,
  }),
}))
mock.module("./assistant-draft-display", () => ({ useAssistantDraftDisplay: () => undefined }))
mock.module("./assistant-tool-highlight", () => ({ useAssistantToolHighlight: () => undefined }))
mock.module("./assistant-panel", () => ({
  AssistantPanel: ({ historyBusy, busy, canSend }: PanelProps) => (
    <output aria-label="Native chat controls">
      {JSON.stringify({ historyBusy, busy, canSend })}
    </output>
  ),
}))
const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { NativeProjectAssistant } = await import("./native-project-assistant")

afterEach(() => {
  cleanup()
  chat.dispose()
})

it("locks native conversation navigation during configuration while preserving queued Send", async () => {
  const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
  const snapshot: AssistantSnapshot = {
    projectId,
    sessionToken: "session-token",
    sessionId: "session-id",
    status: "ready",
    canResume: true,
    modes: [],
    models: [],
    configOptions: [],
    authMethods: [],
    currentModeId: null,
    currentModelId: null,
    attachmentCapabilities: { text: true, images: true },
  }
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const result = async () => ({ ok: true as const, value: snapshot })
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    connect: result,
    disconnect: result,
    prompt: result,
    cancel: result,
    setModel: result,
    setConfigOption: result,
    authenticate: result,
    respondPermission: result,
    respondQuestion: result,
    async setMode() {
      await waiting
      return result()
    },
    onEvent: () => () => {},
  }
  chat = createNativeChatController({
    projectId,
    bridge,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    historyStore: new MemoryTranscriptStore(),
  })
  chat.start()
  await chat.connect({ command: "/installed/agent", args: [] })
  const controller = { report: { snapshot: { id: projectId } } } as DocumentControllerState
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <NativeProjectAssistant bridge={bridge} controller={controller} open onClose={() => {}} />
    </I18nProvider>,
  )
  const controls = () => JSON.parse(screen.getByLabelText("Native chat controls").textContent ?? "")
  expect(controls()).toEqual({ historyBusy: false, busy: false, canSend: true })
  let pending: Promise<void> | undefined
  try {
    act(() => {
      pending = chat.setMode("chosen-mode")
    })
    expect(controls()).toEqual({ historyBusy: true, busy: false, canSend: true })
  } finally {
    await act(async () => {
      release()
      await pending
    })
  }
  await waitFor(() =>
    expect(controls()).toEqual({ historyBusy: false, busy: false, canSend: true }),
  )
})
