import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"

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

mock.module("../../editor-session/editor-session-provider", () => ({
  useRegisterTaskSubmission: vi.fn(),
}))

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { Form, useAppForm } = await import("@vibeshape/ui/integrations/tanstack-form")
const { useRegisterTaskSubmission } = await import("../../editor-session/editor-session-provider")
const { TaskPanelFormActions } = await import("./task-panel-form-actions")

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
      const submitFromHistory = vi.mocked(useRegisterTaskSubmission).mock.calls.at(-1)?.[0]
      if (!submitFromHistory) throw new Error("History submission must be registered.")
      await submitFromHistory()
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it("allows submission after the exact preview is ready", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<FormActionsHarness onSubmit={onSubmit} previewStatus="ready" />)

    await user.click(screen.getByRole("button", { name: "Create feature" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("uses the same ready-preview gate when History requests saving", async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(<FormActionsHarness onSubmit={onSubmit} previewStatus="ready" />)
    const submitFromHistory = vi.mocked(useRegisterTaskSubmission).mock.calls.at(-1)?.[0]
    if (!submitFromHistory) throw new Error("History submission must be registered.")
    await submitFromHistory()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("submits once and exposes the pending state through the compact accept action", async () => {
    const user = userEvent.setup()
    const operation = deferred<void>()
    const onSubmit = vi.fn(() => operation.promise)
    render(<FormActionsHarness onSubmit={onSubmit} />)

    const accept = screen.getByRole("button", { name: "Create feature" }) as HTMLButtonElement
    await user.click(accept)
    await user.click(accept)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(accept.disabled).toBe(true)
    expect(accept.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true)

    operation.resolve()
    await waitFor(() => expect(accept.disabled).toBe(false))
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false)
  })
})
