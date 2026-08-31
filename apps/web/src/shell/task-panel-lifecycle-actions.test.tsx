// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
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

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onAccept).toHaveBeenCalledOnce()
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
})
