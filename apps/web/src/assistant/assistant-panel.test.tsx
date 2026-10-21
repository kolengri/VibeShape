import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AssistantQuestion } from "@vibeshape/automation-api/assistant"
import { createI18n, defaultFormats } from "@vibeshape/i18n"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { ActivityProvider, useActivityPending } from "@vibeshape/ui/components/activity"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { messages } from "../i18n"
import { AssistantPanel } from "./assistant-panel"

type PanelProps = ComponentProps<typeof AssistantPanel>
const i18n = createI18n({
  defaultLocale: "en",
  formats: defaultFormats,
  messages: {
    en: {
      ...messages.en,
      app: {
        ...messages.en.app,
        assistant: {
          ...messages.en.app.assistant,
          applyChanges: "Confirm changes",
          applyingChanges: "Applying changes…",
          applyChangesFailed:
            "Changes could not be applied ({code}). Review the current model and preview again.",
        },
      },
    },
  },
})
const defaults: PanelProps = {
  open: true,
  projectName: "Bracket",
  messages: [],
  busy: false,
  canSend: true,
  configuration: null,
  error: null,
  storageFailed: false,
  onClose: () => {},
  onSend: async () => true,
  onCancel: async () => {},
  onReset: async () => {},
}
function ActivityReceipt() {
  return <output aria-label="Global activity">{useActivityPending() ? "active" : "idle"}</output>
}
function panel(props: Partial<PanelProps> = {}) {
  return (
    <ActivityProvider>
      <I18nProvider i18n={i18n} initialLocale="en">
        <AssistantPanel {...defaults} {...props} />
        <ActivityReceipt />
      </I18nProvider>
    </ActivityProvider>
  )
}
function draft() {
  return screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement
}
function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function selectFiles(files: File[]) {
  const input = screen.getByLabelText("Attach files", { selector: 'input[type="file"]' })
  fireEvent.change(input, { target: { files } })
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("assistant transcript and composer", () => {
  it("shows Thinking above the composer while busy and preserves the chat heading", () => {
    const view = render(panel({ busy: true }))
    const chat = screen.getByRole("complementary", { name: "AI chat" })
    const heading = within(chat).getByRole("heading", { name: "AI chat" })
    const thinking = within(chat).getByText("Thinking")
    expect(heading.textContent).toBe("AI chat")
    expect(thinking.closest('[role="status"]')).not.toBeNull()
    expect(thinking.classList.contains("application-wordmark-ink")).toBe(true)
    expect(
      thinking.compareDocumentPosition(draft()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    view.rerender(panel({ busy: false }))
    expect(heading.textContent).toBe("AI chat")
    expect(within(chat).queryByText("Thinking")).toBeNull()
  })

  it("applies only a ready private draft through its checkpoint wrapper and keeps the action pending", async () => {
    const pending = deferred<boolean>()
    const apply = vi.fn(() => pending.promise)
    const withCheckpoint = vi.fn((operation: () => Promise<boolean>) => operation())
    const send = vi.fn(async () => true)
    const props: Partial<PanelProps> = {
      onSend: send,
      draftDisplay: {
        mode: "result",
        onChange: () => {},
        application: { status: "ready", diagnostic: null, onApply: apply },
      },
      onApplyDraft: withCheckpoint,
    }
    const rendered = render(panel({ ...props, busy: true }))
    expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull()
    rendered.rerender(panel(props))
    expect(apply).not.toHaveBeenCalled()
    const button = screen.getByRole("button", { name: "Confirm changes" })
    expect(button.textContent).toBe("")
    expect(button.querySelector("svg")).not.toBeNull()
    expect(screen.getByRole("log").contains(button)).toBe(false)
    await userEvent.dblClick(button)
    expect(send).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(withCheckpoint).toHaveBeenCalledTimes(1)
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.hasAttribute("disabled")).toBe(true)
    rendered.rerender(
      panel({
        ...props,
        busy: true,
        draftDisplay: {
          mode: "changes",
          onChange: () => {},
          application: { status: "applying", diagnostic: null, onApply: apply },
        },
      }),
    )
    expect(screen.getByRole("button", { name: "Confirm changes" }).getAttribute("aria-busy")).toBe(
      "true",
    )
    expect(screen.getByText("Applying changes…").getAttribute("role")).toBe("status")
    await act(async () => pending.resolve(true))
    rendered.rerender(panel({ canUndoAgentChanges: true, onViewBefore: async () => true }))
    expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull()
    expect(screen.getByText("Changes saved to this project")).toBeTruthy()
  })

  it("keeps saved checkpoints and display-only previews free of Apply and reports an unconfirmed apply failure", () => {
    const rendered = render(panel({ canUndoAgentChanges: true }))
    expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull()
    rendered.rerender(panel({ draftDisplay: { mode: "result", onChange: () => {} } }))
    expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull()
    rendered.rerender(
      panel({
        draftDisplay: {
          mode: "result",
          onChange: () => {},
          application: {
            status: "error",
            diagnostic: "document-commit-failed",
            onApply: async () => false,
          },
        },
      }),
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "Changes could not be applied (document-commit-failed)",
    )
    expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull()
    expect(screen.queryByText("Agent preview · not saved yet")).toBeNull()
    expect(screen.queryByText("Changes saved to this project")).toBeNull()
  })

  it("keeps icon-only change controls above the composer after a batch finishes", async () => {
    const changeDisplay = vi.fn()
    const before = vi.fn().mockResolvedValue(true)
    const undo = vi.fn().mockResolvedValue(true)
    const props: Partial<PanelProps> = {
      messages: [{ id: "last", role: "assistant", text: "The container is ready." }],
      draftDisplay: { mode: "result", onChange: changeDisplay },
      canUndoAgentChanges: true,
      onViewBefore: before,
      onUndoAgentChanges: undo,
    }
    const rendered = render(panel({ ...props, busy: true }))
    expect(screen.queryByRole("region", { name: "Agent changes" })).toBeNull()
    rendered.rerender(panel(props))
    const review = screen.getByRole("region", { name: "Agent changes" })
    expect(screen.getByRole("log").contains(review)).toBe(false)
    expect(review.compareDocumentPosition(draft()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const button of within(review).getAllByRole("button")) {
      expect(button.textContent).toBe("")
      expect(button.querySelector("svg")).not.toBeNull()
    }
    expect(
      review.compareDocumentPosition(screen.getByText("The container is ready.")) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
    expect(within(review).getByText("Agent preview · not saved yet")).toBeTruthy()
    expect(
      within(review).getByRole("button", { name: "Result" }).getAttribute("aria-pressed"),
    ).toBe("true")
    await userEvent.click(within(review).getByRole("button", { name: "Changes" }))
    expect(changeDisplay).toHaveBeenLastCalledWith("changes")
    expect(before).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    rendered.rerender(
      panel({ ...props, draftDisplay: { mode: "changes", onChange: changeDisplay } }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Result" }))
    expect(changeDisplay).toHaveBeenLastCalledWith("result")
    await userEvent.click(screen.getByRole("button", { name: "View before" }))
    expect(before).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("button", { name: "Undo agent changes" }))
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it("labels saved changes and preserves the reading position when the batch finishes", () => {
    const props: Partial<PanelProps> = {
      messages: [{ id: "last", role: "assistant", text: "Saved." }],
      canUndoAgentChanges: true,
      onViewBefore: async () => true,
      onUndoAgentChanges: async () => true,
    }
    const rendered = render(panel({ ...props, busy: true }))
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    log.scrollTop = 100
    fireEvent.scroll(log)
    const scrollCalls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length
    rendered.rerender(panel(props))
    const review = screen.getByRole("region", { name: "Agent changes" })
    expect(within(review).getByText("Changes saved to this project")).toBeTruthy()
    expect(within(review).queryByRole("button", { name: "Changes" })).toBeNull()
    expect(log.scrollTop).toBe(100)
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls).toHaveLength(scrollCalls)
    rendered.rerender(panel({ ...props, viewingBefore: true }))
    expect(screen.getByRole("button", { name: "View current" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
  })

  it("keeps settings closed and scroll position steady during Before/current checkpoint locks", async () => {
    const props = {
      messages: [{ id: "reply", role: "assistant", text: "Saved batch." }],
      configuration: <span>Connection setup</span>,
      configurationRequired: false,
      canUndoAgentChanges: true,
      onViewBefore: async () => true,
    } satisfies Partial<PanelProps>
    const rendered = render(panel(props))
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    log.scrollTop = 560
    fireEvent.scroll(log)
    const calls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length
    rendered.rerender(
      panel({
        ...props,
        canSend: false,
        preparingBefore: true,
        messages: structuredClone(props.messages),
      }),
    )
    expect(screen.queryByText("Connection setup")).toBeNull()
    expect(log.scrollTop).toBe(560)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(calls)
    rendered.rerender(
      panel({ ...props, viewingBefore: true, messages: structuredClone(props.messages) }),
    )
    expect(screen.getByRole("button", { name: "View current" })).toBeTruthy()
    expect(screen.queryByText("Connection setup")).toBeNull()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(calls)
    rendered.rerender(panel({ ...props, canSend: false, configurationRequired: true }))
    await userEvent.click(screen.getByRole("button", { name: "Configure AI" }))
    expect(screen.getByRole("dialog", { name: "AI settings" }).textContent).toContain(
      "Connection setup",
    )
  })

  it("preserves a reader's position and closed settings through temporary reconnect attempts and manual recovery feedback", () => {
    const props = {
      messages: [{ id: "reply", role: "assistant", text: "An interrupted answer." }],
      configuration: <span>Connection setup</span>,
      configurationRequired: false,
    } satisfies Partial<PanelProps>
    const rendered = render(panel(props))
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    log.scrollTop = 100
    fireEvent.scroll(log)
    const calls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length
    for (const attempt of [1, 2, 3, 4, 5]) {
      rendered.rerender(
        panel({
          ...props,
          canSend: false,
          busy: true,
          sessionControls: <span role="status">Reconnecting… attempt {attempt} of 5</span>,
        }),
      )
      expect(screen.queryByText("Connection setup")).toBeNull()
      expect(log.scrollTop).toBe(100)
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(calls)
    }
    rendered.rerender(
      panel({
        ...props,
        canSend: false,
        busy: false,
        error: "Connection recovery stopped",
        sessionControls: <button type="button">Retry connection</button>,
      }),
    )
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeTruthy()
    expect(screen.queryByText("Connection setup")).toBeNull()
    expect(log.scrollTop).toBe(100)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(calls)
  })

  it("collapses tool output behind its structured name and status without interpreting assistant prose", async () => {
    const messages: PanelProps["messages"] = [
      {
        id: "tool",
        role: "tool",
        text: "bun test\nComplete command output",
        tool: { title: "Run tests", status: "completed" },
      },
      { id: "assistant", role: "assistant", text: "Would you prefer option one or option two?" },
    ]
    render(panel({ messages, sessionControls: <button type="button">Advertised model</button> }))
    const summary = screen.getByText("Run tests", { selector: "summary span" }).closest("summary")
    if (!summary) throw new Error("The tool output must expose a native summary control.")
    const details = summary.closest("details")
    expect(details?.open).toBe(false)
    expect(details?.querySelector("summary")?.textContent).toContain("Completed")
    expect(screen.queryByRole("form", { name: "Agent question" })).toBeNull()
    summary.focus()
    expect(document.activeElement).toBe(summary)
    await userEvent.click(summary)
    expect(details?.open).toBe(true)
    expect(screen.getByRole("region", { name: "Tool details" }).textContent).toContain(
      "Complete command output",
    )
    const composer = screen.getByRole("region", { name: "Message" })
    expect(within(composer).getByRole("textbox", { name: "Message" })).toBeTruthy()
    expect(within(composer).getByRole("button", { name: "Advertised model" })).toBeTruthy()
    expect(
      composer.compareDocumentPosition(screen.getByRole("log")) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  it("retains text on rejected sends and locks keyboard and pointer submission until acceptance", async () => {
    const pending = deferred<boolean>()
    const send = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(true)
    render(panel({ onSend: send }))
    fireEvent.change(draft(), { target: { value: "Keep this draft" } })
    fireEvent.keyDown(draft(), { key: "Enter", ctrlKey: true })
    fireEvent.keyDown(draft(), { key: "Enter", metaKey: true })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(draft().value).toBe("Keep this draft")
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull()
    await act(async () => {
      pending.resolve(false)
      await pending.promise
    })
    expect(draft().value).toBe("Keep this draft")
    expect(draft().disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(draft().value).toBe(""))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("exposes one accessible attachment action and triggers the hidden file input from the keyboard", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    render(panel({ attachmentCapabilities: { text: true, images: false } }))
    const actions = screen.getAllByRole("button", { name: "Attach files" })
    expect(actions).toHaveLength(1)
    const input = screen.getByLabelText("Attach files", {
      selector: 'input[type="file"]',
    }) as HTMLInputElement
    expect(input.hidden).toBe(true)
    const chooseFiles = vi.fn()
    input.addEventListener("click", chooseFiles)
    await act(async () => actions[0]?.focus())
    await userEvent.keyboard("{Enter}")
    expect(chooseFiles).toHaveBeenCalledTimes(1)
  })

  it("preserves drafts and selected file content after rejection and transfers them on retry", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const view = render(
      panel({ onSend: send, attachmentCapabilities: { text: true, images: false } }),
    )
    selectFiles([new File(["width=42\nheight=8"], "dimensions.txt", { type: "text/plain" })])
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.change(draft(), { target: { value: "Use these dimensions" } })
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(send.mock.calls[0]?.[1]).toEqual([
      {
        id: expect.any(String),
        name: "dimensions.txt",
        type: "text",
        mimeType: "text/plain",
        text: "width=42\nheight=8",
      },
    ])
    expect(draft().value).toBe("Use these dimensions")
    expect(screen.getByRole("button", { name: "Remove dimensions.txt" })).toBeTruthy()
    view.rerender(
      panel({ open: false, onSend: send, attachmentCapabilities: { text: true, images: false } }),
    )
    view.rerender(panel({ onSend: send, attachmentCapabilities: { text: true, images: false } }))
    expect(draft().value).toBe("Use these dimensions")
    expect(screen.getByRole("button", { name: "Remove dimensions.txt" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove dimensions.txt" })).toBeNull(),
    )
    expect(draft().value).toBe("")
  })

  it("forwards explicit viewport capture and retains the provider image capability gate", async () => {
    const onCaptureView = vi
      .fn()
      .mockResolvedValue(new File([new Uint8Array([1, 2, 3])], "view.png", { type: "image/png" }))
    const view = render(
      panel({ onCaptureView, attachmentCapabilities: { text: true, images: false } }),
    )
    expect(screen.queryByRole("button", { name: "Attach current view" })).toBeNull()
    view.rerender(panel({ onCaptureView, attachmentCapabilities: { text: true, images: true } }))
    expect(onCaptureView).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Attach current view" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false),
    )
    expect(onCaptureView).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Remove view.png" })).toBeTruthy()
  })

  it("blocks sending while files are read and does not resurrect a removed pending file", async () => {
    const readers: { onload: (() => void) | null; result: ArrayBuffer }[] = []
    vi.stubGlobal(
      "FileReader",
      class {
        onload = null
        onerror = null
        onabort = null
        result = new TextEncoder().encode("late content").buffer
        readAsArrayBuffer() {
          readers.push(this)
        }
      },
    )
    render(panel({ attachmentCapabilities: { text: true, images: false } }))
    fireEvent.change(draft(), { target: { value: "Check this" } })
    selectFiles([new File(["content"], "notes.txt", { type: "text/plain" })])
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("active")
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }))
    await act(async () => readers[0]?.onload?.())
    expect(screen.queryByRole("button", { name: "Remove notes.txt" })).toBeNull()
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
  })

  it("reports unsupported, oversized, and invalid text files and permits removal", async () => {
    render(panel({ attachmentCapabilities: { text: true, images: false } }))
    selectFiles([
      new File(["%PDF"], "drawing.pdf", { type: "application/pdf" }),
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" }),
      new File([new Uint8Array([0xff])], "invalid.txt", { type: "text/plain" }),
    ])
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3))
    expect(
      screen.getByText("drawing.pdf: this file type is not supported by this agent."),
    ).toBeTruthy()
    expect(screen.getByText("large.txt exceeds the 2 MB attachment limit.")).toBeTruthy()
    expect(screen.getByText("invalid.txt is not valid UTF-8 text.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Remove drawing.pdf" }))
    expect(
      screen.queryByText("drawing.pdf: this file type is not supported by this agent."),
    ).toBeNull()
  })

  it("sends advertised image data without exposing file paths and rejects excess selections", async () => {
    const send = vi.fn().mockResolvedValue(true)
    render(panel({ onSend: send, attachmentCapabilities: { text: true, images: true } }))
    selectFiles(
      Array.from(
        { length: 6 },
        (_, index) => new File(["a"], `${index}.txt`, { type: "text/plain" }),
      ),
    )
    expect(screen.getByRole("alert").textContent).toBe("Attach up to 5 files per message.")
    selectFiles([new File([new Uint8Array([137, 80, 78, 71])], "view.png", { type: "image/png" })])
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false),
    )
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(send).toHaveBeenCalledWith("", [
      {
        id: expect.any(String),
        name: "view.png",
        type: "image",
        mimeType: "image/png",
        data: "iVBORw==",
      },
    ])
  })

  it("keeps Stop available while sending edited text to the real queue and exposes recovery controls", async () => {
    const queue = vi.fn().mockResolvedValue(true)
    const remove = vi.fn()
    const resume = vi.fn().mockResolvedValue(true)
    const cancel = vi.fn().mockResolvedValue(undefined)
    render(
      panel({
        busy: true,
        onQueue: queue,
        onCancel: cancel,
        queuedMessages: [{ id: "queued", text: "Make the rim thicker" }],
        queuePaused: true,
        onRemoveQueued: remove,
        onResumeQueue: resume,
        messages: [{ id: "old", role: "user", text: "Start" }],
      }),
    )
    fireEvent.change(draft(), { target: { value: "Then add a hole" } })
    expect(draft().disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Queue message" }))
    expect(queue).toHaveBeenCalledWith("Then add a hole")
    expect(draft().value).toBe("")
    expect(screen.getByRole("button", { name: "New chat" }).hasAttribute("disabled")).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }))
    expect(remove).toHaveBeenCalledWith("queued")
    await userEvent.click(screen.getByRole("button", { name: "Resume queued messages" }))
    expect(resume).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe("structured agent questions", () => {
  const question = (): AssistantQuestion => ({
    requestId: "shape-choice",
    message: "Which corner treatment should I use?",
    expiresAt: Date.now() + 60_000,
    fields: [
      {
        id: "finish",
        label: "Corner treatment",
        required: true,
        secret: false,
        options: [
          { id: "fillet", name: "Fillet", description: "Round the corners" },
          { id: "chamfer", name: "Chamfer" },
        ],
      },
      { id: "note", label: "Custom instructions", required: false, secret: false },
    ],
  })

  it("omits untouched optional choices and constrained text while preserving required-field validation", async () => {
    const answer = vi.fn().mockResolvedValue(true)
    const asked: AssistantQuestion = {
      ...question(),
      fields: [
        { id: "size", label: "Required size", required: true, secret: false },
        {
          id: "finish",
          label: "Optional treatment",
          required: false,
          secret: false,
          options: [{ id: "fillet", name: "Fillet" }],
        },
        {
          id: "note",
          label: "Optional instructions",
          required: false,
          secret: false,
          minLength: 1,
        },
      ],
    }
    render(panel({ question: asked, onAnswer: answer }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    expect(answer).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox", { name: "Required size" }), {
      target: { value: "10 mm" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    expect(answer).toHaveBeenCalledWith({ size: "10 mm" })
  })

  it("submits advertised clickable choices and custom text, guards double answers, and retains rejected values", async () => {
    const pending = deferred<boolean>()
    const answer = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true)
    render(panel({ busy: true, question: question(), onAnswer: answer }))
    await userEvent.click(screen.getByRole("radio", { name: "Fillet" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Custom instructions" }), {
      target: { value: "Use a 2 mm radius" },
    })
    const form = screen.getByRole("form", { name: "Agent question" })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(answer).toHaveBeenCalledTimes(1)
    expect(answer).toHaveBeenCalledWith({ finish: "fillet", note: "Use a 2 mm radius" })
    expect(screen.getByRole("button", { name: "Submit answers" }).getAttribute("aria-busy")).toBe(
      "true",
    )
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull()
    await act(async () => {
      pending.resolve(false)
      await pending.promise
    })
    expect(screen.getByRole("alert").textContent).toBe("The answer was not accepted. Try again.")
    expect((screen.getByRole("radio", { name: "Fillet" }) as HTMLInputElement).checked).toBe(true)
    expect(
      (screen.getByRole("textbox", { name: "Custom instructions" }) as HTMLInputElement).value,
    ).toBe("Use a 2 mm radius")
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    expect(answer).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByText("Which corner treatment should I use?"))
    expect(form.closest("details")?.open).toBe(false)
  })

  it("declines through the protocol callback and prevents answers after expiration", async () => {
    const answer = vi.fn().mockResolvedValue(true)
    const active = question()
    const view = render(panel({ question: active, onAnswer: answer }))
    await userEvent.click(screen.getByRole("button", { name: "Skip question" }))
    expect(answer).toHaveBeenCalledWith(null)
    view.rerender(
      panel({
        question: { ...active, requestId: "expired", expiresAt: Date.now() - 1 },
        onAnswer: answer,
      }),
    )
    expect(screen.getByText("This question has expired.")).toBeTruthy()
    fireEvent.submit(screen.getByRole("form", { name: "Agent question" }))
    expect(answer).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Submit answers" }).hasAttribute("disabled")).toBe(
      true,
    )
  })
})
