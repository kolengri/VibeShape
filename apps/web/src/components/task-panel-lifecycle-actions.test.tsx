import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import { TaskPanelLifecycleActions } from "./task-panel-lifecycle-actions"
import { TaskPanelLifecycleButton } from "./task-panel-lifecycle-button"

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
  it("renders visible text labels with standard small footer buttons", () => {
    renderActions()

    expect(screen.getByRole("group", { name: "Feature actions" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cancel feature" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Accept feature" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Accept feature" }).textContent).toBe(
      "Accept feature",
    )
    expect(screen.getByRole("button", { name: "Cancel feature" }).textContent).toBe(
      "Cancel feature",
    )
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("data-size")).toBe("sm")
    }
  })

  it("keeps direct lifecycle buttons as icons with their tooltip labels", async () => {
    const user = userEvent.setup()
    render(<TaskPanelLifecycleButton kind="cancel" label="Cancel feature" />)

    expect(screen.getByRole("button", { name: "Cancel feature" }).textContent).toBe("")
    expect(screen.getByRole("button", { name: "Cancel feature" }).getAttribute("data-size")).toBe(
      "icon-xs",
    )

    await user.hover(screen.getByRole("button", { name: "Cancel feature" }))
    expect(await screen.findByRole("tooltip", { name: "Cancel feature" })).toBeTruthy()

    cleanup()
    render(<TaskPanelLifecycleButton kind="accept" label="Accept feature" />)
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
    expect(cancel).toHaveProperty("disabled", true)
    await user.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)

    operation.resolve()
    await waitFor(() => expect(accept.disabled).toBe(false))
    expect(cancel).toHaveProperty("disabled", false)
  })

  it("locks both lifecycle actions while an externally controlled save is pending and releases them afterwards", async () => {
    const onCancel = vi.fn()
    const view = renderActions({ acceptLoading: true, onCancel })
    const cancel = screen.getByRole("button", { name: "Cancel feature" })
    const accept = screen.getByRole("button", { name: "Accept feature" })
    expect(cancel).toHaveProperty("disabled", true)
    expect(accept).toHaveProperty("disabled", true)
    expect(accept.getAttribute("aria-busy")).toBe("true")
    await userEvent.click(cancel)
    expect(onCancel).not.toHaveBeenCalled()
    view.rerender(
      <TaskPanelLifecycleActions
        ariaLabel="Feature actions"
        acceptLabel="Accept feature"
        cancelLabel="Cancel feature"
        acceptLoading={false}
        onAccept={vi.fn()}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByRole("button", { name: "Cancel feature" })).toHaveProperty("disabled", false)
    await userEvent.click(screen.getByRole("button", { name: "Cancel feature" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("releases the lifecycle group after a rejected save so cancellation and retry remain available", async () => {
    const onAccept = vi
      .fn()
      .mockRejectedValueOnce(new Error("Save failed"))
      .mockResolvedValue(undefined)
    const onCancel = vi.fn()
    renderActions({ onAccept, onCancel })
    const accept = screen.getByRole("button", { name: "Accept feature" }) as HTMLButtonElement
    const cancel = screen.getByRole("button", { name: "Cancel feature" }) as HTMLButtonElement
    await userEvent.click(accept)
    await waitFor(() => expect(accept.disabled).toBe(false))
    expect(cancel.disabled).toBe(false)
    await userEvent.click(accept)
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(cancel.disabled).toBe(false))
    await userEvent.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
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
