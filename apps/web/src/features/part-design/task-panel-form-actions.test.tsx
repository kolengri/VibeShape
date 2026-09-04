// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskPanelFormActions } from "./task-panel-form-actions"

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

function FormActionsHarness({
  onSubmit,
  previewStatus,
}: {
  onSubmit: () => Promise<void>
  previewStatus?: "error" | "idle" | "loading" | "ready"
}) {
  const form = useAppForm({ defaultValues: { name: "Feature" }, onSubmit })
  return (
    <TooltipProvider>
      <Form form={form} aria-label="Feature form">
        <TaskPanelFormActions
          acceptLabel="Create feature"
          ariaLabel="Feature actions"
          cancelLabel="Cancel"
          onCancel={vi.fn()}
          {...(previewStatus ? { previewStatus } : {})}
        />
      </Form>
    </TooltipProvider>
  )
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock)

afterEach(cleanup)

describe("TaskPanelFormActions", () => {
  it.each(["idle", "loading", "error"] as const)(
    "blocks submission while the exact preview is %s",
    async (previewStatus) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn(async () => undefined)
      render(<FormActionsHarness onSubmit={onSubmit} previewStatus={previewStatus} />)

      const accept = screen.getByRole("button", { name: "Create feature" }) as HTMLButtonElement
      expect(accept.disabled).toBe(true)
      await user.click(accept)
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it("allows submission after the exact preview is ready", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<FormActionsHarness onSubmit={onSubmit} previewStatus="ready" />)

    await user.click(screen.getByRole("button", { name: "Create feature" }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("submits once and exposes the pending state through the compact accept action", async () => {
    const user = userEvent.setup()
    const operation = deferred<void>()
    const onSubmit = vi.fn(() => operation.promise)
    render(<FormActionsHarness onSubmit={onSubmit} />)

    const accept = screen.getByRole("button", { name: "Create feature" }) as HTMLButtonElement
    await user.click(accept)
    await user.click(accept)

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(accept.disabled).toBe(true)
    expect(accept.getAttribute("aria-busy")).toBe("true")

    operation.resolve()
    await waitFor(() => expect(accept.disabled).toBe(false))
  })
})
