import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { type ComponentProps, useEffect } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantPanel } from "./assistant-panel"

type PanelProps = ComponentProps<typeof AssistantPanel>
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function panel(props: Partial<PanelProps> = {}) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <button type="button">Chat toggle</button>
      <AssistantPanel
        open
        messages={[]}
        busy={false}
        canSend
        configuration={null}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onSend={async () => true}
        onCancel={async () => {}}
        onReset={async () => {}}
        {...props}
      />
    </I18nProvider>
  )
}

it("keeps one compact chat header without project copy and retains cancellation in the composer", () => {
  const view = render(panel())
  const heading = screen.getByRole("heading", { name: "AI chat" })
  const header = heading.closest("header")
  expect(header?.textContent).toBe("AI chat")
  expect(header?.querySelector("p")).toBeNull()
  expect(heading.hasAttribute("data-window-title")).toBe(true)
  const fold = screen.getByRole("button", { name: "Collapse AI chat window" })
  expect(heading.contains(fold)).toBe(true)
  expect(fold.getAttribute("aria-expanded")).toBe("true")
  expect(heading.querySelectorAll("svg")).toHaveLength(1)
  for (const button of header?.querySelectorAll("button[data-slot=button]") ?? []) {
    expect(button.getAttribute("data-size")).toBe("icon-xs")
  }
  view.rerender(panel({ busy: true }))
  expect(heading.closest("header")).toBe(header)
  expect(header?.textContent).toBe("AI chat")
  expect(header?.querySelector('[role="status"]')).toBeNull()
  expect(screen.getByRole("button", { name: /^Stop$/ })).toBeTruthy()
})

function ConnectionControls({ mount, disconnect }: { mount: () => void; disconnect: () => void }) {
  useEffect(() => {
    mount()
    return disconnect
  }, [mount, disconnect])
  return <input aria-label="Connection label" defaultValue="Connected" />
}

it("retains mounted composer, pending attachments, transcript expansion, settings, questions, and reading position through hide and reopen", async () => {
  const readers: { onload: (() => void) | null; result: ArrayBuffer }[] = []
  vi.stubGlobal(
    "FileReader",
    class {
      onload = null
      onerror = null
      onabort = null
      result = new TextEncoder().encode("retained content").buffer
      readAsArrayBuffer() {
        readers.push(this)
      }
    },
  )
  const mount = vi.fn(),
    disconnect = vi.fn(),
    cancel = vi.fn(),
    reset = vi.fn()
  const props: Partial<PanelProps> = {
    configuration: <ConnectionControls mount={mount} disconnect={disconnect} />,
    attachmentCapabilities: { text: true, images: false },
    onClose: () => screen.getByRole("button", { name: "Chat toggle" }).focus(),
    onCancel: cancel,
    onReset: reset,
    onAnswer: async () => true,
    question: {
      requestId: "preserved-question",
      message: "Choose the finish",
      expiresAt: Date.now() + 60_000,
      fields: [{ id: "finish", label: "Finish", required: false, secret: false }],
    },
    messages: [
      {
        id: "tool",
        role: "tool",
        text: "Full operation output",
        tool: { title: "Inspect model", status: "completed" },
      },
    ],
  }
  const view = render(panel(props))
  const aside = screen.getByRole("complementary", { name: "AI chat" })
  const draft = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement
  fireEvent.change(draft, { target: { value: "Unsent description" } })
  const answer = screen.getByRole("textbox", { name: "Finish" }) as HTMLInputElement
  await userEvent.click(screen.getByRole("button", { name: "AI settings" }))
  const setting = screen.getByRole("textbox", { name: "Connection label" }) as HTMLInputElement
  fireEvent.change(setting, { target: { value: "Keep this connection" } })
  await userEvent.click(screen.getByRole("button", { name: "Close AI settings" }))
  fireEvent.change(answer, { target: { value: "Round corners" } })
  const summary = screen.getByText("Inspect model", { selector: "summary span" }).closest("summary")
  if (!summary) throw new Error("Missing tool output disclosure.")
  await userEvent.click(summary)
  const details = summary.closest("details")
  expect(details?.open).toBe(true)
  const log = screen.getByRole("log")
  Object.defineProperties(log, {
    clientHeight: { configurable: true, value: 300 },
    scrollHeight: { configurable: true, value: 900 },
  })
  log.scrollTop = 120
  fireEvent.scroll(log)
  const scrollCalls = vi.mocked(HTMLElement.prototype.scrollTo).mock.calls.length
  fireEvent.change(screen.getByLabelText("Attach files", { selector: "input" }), {
    target: { files: [new File(["pending"], "pending.txt", { type: "text/plain" })] },
  })
  const attachment = screen.getByText("pending.txt").parentElement
  expect(attachment?.getAttribute("aria-busy")).toBe("true")
  await userEvent.click(screen.getByRole("button", { name: "Collapse AI chat" }))
  const toggle = screen.getByRole("button", { name: "Chat toggle" })
  view.rerender(panel({ ...props, open: false }))
  expect(aside.hasAttribute("hidden")).toBe(true)
  expect(aside.classList.contains("hidden")).toBe(true)
  expect(aside.classList.contains("flex")).toBe(false)
  expect(aside.getAttribute("aria-modal")).toBeNull()
  expect(screen.queryByRole("complementary")).toBeNull()
  expect(document.activeElement).toBe(toggle)
  expect(draft.isConnected && log.isConnected && setting.isConnected && answer.isConnected).toBe(
    true,
  )
  expect(disconnect).not.toHaveBeenCalled()
  view.rerender(panel(props))
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(draft)
  expect(attachment?.getAttribute("aria-busy")).toBe("true")
  view.rerender(
    panel({
      ...props,
      open: false,
      messages: [
        ...(props.messages ?? []),
        { id: "next", role: "assistant", text: "Another update" },
      ],
    }),
  )
  await act(async () => {
    readers[0]?.onload?.()
  })
  expect(attachment?.getAttribute("aria-busy")).toBe("false")
  expect(document.activeElement).toBe(toggle)
  view.rerender(panel(props))
  expect(aside.hasAttribute("hidden")).toBe(false)
  expect(aside.classList.contains("flex")).toBe(true)
  expect(aside.classList.contains("hidden")).toBe(false)
  expect(screen.getByRole("log")).toBe(log)
  expect(draft.value).toBe("Unsent description")
  expect(setting.value).toBe("Keep this connection")
  expect(answer.value).toBe("Round corners")
  expect(screen.getByRole("button", { name: "AI settings" }).getAttribute("aria-expanded")).toBe(
    "false",
  )
  expect(details?.open).toBe(true)
  expect(log.scrollTop).toBe(120)
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(scrollCalls)
  expect(screen.getByRole("button", { name: "Remove pending.txt" })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "AI settings" }))
  expect(screen.getByRole("textbox", { name: "Connection label" })).toBe(setting)
  expect(setting.value).toBe("Keep this connection")
  expect(mount).toHaveBeenCalledTimes(1)
  expect(disconnect).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(reset).not.toHaveBeenCalled()
})

it("distinguishes retained transcript from bounded provider context and exposes a single-flight storage retry", async () => {
  let resolve = () => {}
  let retries = 0
  const retry = new Promise<void>((done) => {
    resolve = done
  })
  const view = render(
    panel({
      contextOmittedMessages: 24,
      storageFailed: true,
      onRetryHistory: () => {
        retries += 1
        return retry
      },
    }),
  )
  expect(
    screen.getByText(/24 earlier messages are not included in the current API request/).textContent,
  ).toContain("full conversation remains in chat history")
  const button = screen.getByRole("button", { name: "Retry chat storage" })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(retries).toBe(1)
  expect(button.getAttribute("aria-busy")).toBe("true")
  await act(async () => {
    resolve()
    await retry
  })
  expect(button.hasAttribute("disabled")).toBe(false)
  view.rerender(
    panel({ contextOmittedMessages: 0, storageFailed: false, onRetryHistory: async () => {} }),
  )
  expect(screen.queryByText(/outside the API context budget/)).toBeNull()
  expect(screen.queryByRole("button", { name: "Retry chat storage" })).toBeNull()
})
