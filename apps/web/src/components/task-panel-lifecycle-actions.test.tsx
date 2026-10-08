import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import { TaskPanelLifecycleActions } from "./task-panel-lifecycle-actions"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderActions(
  overrides: Partial<React.ComponentProps<typeof TaskPanelLifecycleActions>> = {},
) {
  return render(
    <TooltipProvider delayDuration={0}>
      <TaskPanelLifecycleActions
        acceptLabel="Accept feature"
        ariaLabel="Feature actions"
        cancelLabel="Cancel feature"
        onAccept={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

afterEach(cleanup)

vi.stubGlobal("ResizeObserver", ResizeObserverMock)

describe("TaskPanelLifecycleActions", () => {
  it("renders a compact labelled action group with icon-only buttons", () => {
    renderActions()

    expect(screen.getByRole("group", { name: "Feature actions" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel feature" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Accept feature" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Accept feature" }).textContent).toBe("")
  })

  it("shows each action label in its tooltip", async () => {
    const user = userEvent.setup()
    renderActions()

    await user.hover(screen.getByRole("button", { name: "Cancel feature" }))
    expect(await screen.findByRole("tooltip", { name: "Cancel feature" })).toBeTruthy()

    cleanup()
    renderActions()
    await user.hover(screen.getByRole("button", { name: "Accept feature" }))
    expect(await screen.findByRole("tooltip", { name: "Accept feature" })).toBeTruthy()
  })

  it("forwards cancel and accepts only once while an async accept is pending", async () => {
    const user = userEvent.setup()
    const operation = deferred<void>()
    const onCancel = vi.fn()
    const onAccept = vi.fn(() => operation.promise)
    renderActions({ onAccept, onCancel })

    const cancel = screen.getByRole("button", { name: "Cancel feature" })
    const accept = screen.getByRole("button", { name: "Accept feature" }) as HTMLButtonElement
    await user.click(cancel)
    await user.click(accept)
    await user.click(accept)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(accept.disabled).toBe(true)
    expect(accept.getAttribute("aria-busy")).toBe("true")

    operation.resolve()
    await waitFor(() => expect(accept.disabled).toBe(false))
  })

  it("supports disabling accept independently", () => {
    renderActions({ acceptDisabled: true })

    expect(screen.getByRole("button", { name: "Accept feature" })).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "Cancel feature" })).toHaveProperty("disabled", false)
  })

  it("locks cancellation while an atomic apply is in progress", async () => {
    const onCancel = vi.fn()
    renderActions({ cancelDisabled: true, onCancel })
    const cancel = screen.getByRole("button", { name: "Cancel feature" })
    expect(cancel).toHaveProperty("disabled", true)
    await userEvent.click(cancel)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it("keeps the supplied blocked reason visible and linked to disabled accept", async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    const { rerender } = renderActions({
      acceptDisabled: true,
      acceptDisabledReason: "Select two faces first.",
      onAccept,
    })
    const accept = screen.getByRole("button", { name: "Accept feature" })
    const reason = screen.getByText("Select two faces first.")
    expect(accept.getAttribute("aria-describedby")).toBe(reason.id)
    expect(reason.classList.contains("sr-only")).toBe(false)
    expect(reason.closest('[role="tooltip"]')).toBeNull()

    await user.click(accept)
    expect(onAccept).not.toHaveBeenCalled()
    rerender(
      <TaskPanelLifecycleActions
        acceptDisabled={false}
        acceptDisabledReason="Select two faces first."
        acceptLabel="Accept feature"
        ariaLabel="Feature actions"
        cancelLabel="Cancel feature"
        onAccept={onAccept}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText("Select two faces first.")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Accept feature" }))
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it("supports a cancel-only selection task without rendering a fake accept action", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <TaskPanelLifecycleActions
          ariaLabel="Feature actions"
          cancelLabel="Cancel feature"
          onCancel={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole("button", { name: "Cancel feature" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Accept feature" })).toBeNull()
  })
})
