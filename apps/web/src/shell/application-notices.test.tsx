import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { type ReactNode, useState } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import {
  ApplicationNoticesProvider,
  useReportApplicationError,
  useReportApplicationSuccess,
} from "./application-notices"

function ErrorSource({ message, attempt = 0 }: { message: string | null; attempt?: number }) {
  const centralized = useReportApplicationError(message, attempt)
  return message && !centralized ? <p role="alert">{message}</p> : null
}
function SuccessSource({ message, attempt = 0 }: { message: string | null; attempt?: number }) {
  useReportApplicationSuccess(message, attempt)
  return null
}
function App({
  message,
  attempt = 0,
  children,
}: {
  message: string | null
  attempt?: number
  children?: ReactNode
}) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ApplicationNoticesProvider>
        <header>
          <button type="button">Application menu</button>
          <ErrorSource message={message} attempt={attempt} />
        </header>
        <input aria-label="Model name" />
        {children}
      </ApplicationNoticesProvider>
    </I18nProvider>
  )
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("application error notices", () => {
  it("keeps success neutral and dismissible without changing an existing error", async () => {
    const view = render(
      <App message="Save failed.">
        <SuccessSource message="STEP download started" />
      </App>,
    )
    const error = screen.getByRole("alert")
    expect(error.classList.contains("border-destructive")).toBe(true)
    const success = screen
      .getByText("STEP download started", { exact: true })
      .closest('[data-slot="notification"]')
    expect(success?.getAttribute("role")).toBe("status")
    expect(success?.classList.contains("border-border")).toBe(true)
    expect(success?.classList.contains("border-destructive")).toBe(false)
    const dismiss = within(success as HTMLElement).getByRole("button", {
      name: "Dismiss notification",
    })
    await userEvent.click(dismiss)
    expect(screen.getByRole("alert")).toBe(error)
    view.rerender(
      <App message="Save failed.">
        <SuccessSource message="STEP download started" />
      </App>,
    )
    expect(screen.queryByText("STEP download started", { exact: true })).toBeNull()
    view.rerender(
      <App message="Save failed.">
        <SuccessSource message="STEP download started" attempt={1} />
      </App>,
    )
    expect(screen.getByText("STEP download started", { exact: true })).toBeTruthy()
    view.rerender(<App message="Save failed." />)
    expect(screen.queryByText("STEP download started", { exact: true })).toBeNull()
    expect(screen.getByRole("alert").textContent).toBe("Save failed.")
  })
  it("reports outside the header without moving its controls or stealing input focus", () => {
    const view = render(<App message={null} />)
    const header = screen.getByRole("banner")
    const before = header.innerHTML
    const input = screen.getByRole("textbox", { name: "Model name" })
    input.focus()
    view.rerender(<App message="Could not switch projects." />)
    expect(screen.getByRole("alert").textContent).toBe("Could not switch projects.")
    expect(within(header).queryByRole("alert")).toBeNull()
    expect(header.innerHTML).toBe(before)
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy()
    expect(
      document.querySelector('[data-slot="notification-viewport"]')?.classList.contains("fixed"),
    ).toBe(true)
    expect(document.querySelectorAll('[data-slot="notification-viewport"]').length).toBe(1)
  })

  it("keeps dismissal until a new attempt or changed error and removes cleared or unmounted sources", async () => {
    const view = render(<App message="Save failed." />)
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByRole("alert")).toBeNull()
    view.rerender(<App message="Save failed." />)
    expect(screen.queryByRole("alert")).toBeNull()
    view.rerender(<App message="Save failed." attempt={1} />)
    expect(screen.getByRole("alert").textContent).toBe("Save failed.")
    view.rerender(<App message="Storage is unavailable." attempt={1} />)
    expect(screen.getByRole("alert").textContent).toBe("Storage is unavailable.")
    view.rerender(
      <App message={null}>
        <ErrorSource message="Another operation failed." />
      </App>,
    )
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    view.rerender(<App message={null} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("keeps errors past the normal toast duration and supports keyboard dismissal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    render(<App message="Export failed." />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.getByRole("alert").textContent).toBe("Export failed.")
    vi.useRealTimers()
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" })
    act(() => dismiss.focus())
    await userEvent.keyboard("{Enter}")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("dismisses a notice without closing or hiding an active modal", async () => {
    function Modal() {
      const [message, setMessage] = useState<string | null>(null)
      const [attempt, setAttempt] = useState(0)
      return (
        <Dialog defaultOpen>
          <DialogContent closeLabel="Close export">
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>Choose an output.</DialogDescription>
            <input aria-label="File name" defaultValue="Bracket" />
            <button
              type="button"
              onClick={() => {
                setMessage("Could not export Bracket.")
                setAttempt((value) => value + 1)
              }}
            >
              Export
            </button>
            <ErrorSource message={message} attempt={attempt} />
          </DialogContent>
        </Dialog>
      )
    }
    render(
      <App message={null}>
        <Modal />
      </App>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Export" }))
    expect(screen.getByRole("alert").textContent).toBe("Could not export Bracket.")
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("dialog", { name: "Export" })).toBeTruthy()
    expect((screen.getByRole("textbox", { name: "File name" }) as HTMLInputElement).value).toBe(
      "Bracket",
    )
    await userEvent.click(screen.getByRole("button", { name: "Export" }))
    expect(screen.getByRole("alert")).toBeTruthy()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("dialog", { name: "Export" })).toBeTruthy()
  })

  it("retains an accessible standalone fallback without an app provider", () => {
    render(<ErrorSource message="Project is unavailable." />)
    expect(screen.getByRole("alert").textContent).toBe("Project is unavailable.")
  })
})
