import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"

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
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <Form form={form} aria-label="Feature form">
          <ParameterPanel
            copy={{ title: "Feature", description: "Edit feature parameters.", cancel: "Cancel" }}
            legend="Feature parameters"
            actions={
              <TaskPanelFormActions
                acceptLabel="Create feature"
                ariaLabel="Feature actions"
                cancelLabel="Cancel"
                onCancel={vi.fn()}
                {...(previewStatus ? { previewStatus } : {})}
              />
            }
          >
            <label htmlFor="feature-name">Feature name</label>
            <input id="feature-name" name="name" defaultValue="Feature" />
          </ParameterPanel>
        </Form>
      </TooltipProvider>
    </I18nProvider>
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
const { ParameterPanel } = await import("./parameter-panel")

vi.stubGlobal("ResizeObserver", ResizeObserverMock)

afterEach(cleanup)

describe("TaskPanelFormActions", () => {
  it("retains native form ownership and Enter submission with lifecycle actions in the footer", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<FormActionsHarness onSubmit={onSubmit} previewStatus="ready" />)

    const form = screen.getByRole<HTMLFormElement>("form", { name: "Feature form" })
    const accept = screen.getByRole<HTMLButtonElement>("button", { name: "Create feature" })
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Feature name" })
    expect(accept.form).toBe(form)
    expect(input.closest("[data-slot='task-panel-content']")).not.toBeNull()
    expect(accept.closest("[data-slot='task-panel-footer']")).not.toBeNull()
    expect(accept.closest("[data-slot='task-panel-content']")).toBeNull()
    expect(accept.closest("[data-slot='task-panel-header']")).toBeNull()

    await user.click(input)
    await user.keyboard("{Enter}")
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each(["idle", "loading", "error"] as const)(
    "blocks submission while the exact preview is %s",
    async (previewStatus) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn(async () => undefined)
      render(<FormActionsHarness onSubmit={onSubmit} previewStatus={previewStatus} />)

      const accept = screen.getByRole("button", { name: "Create feature" }) as HTMLButtonElement
      expect(accept.disabled).toBe(true)
      const reason =
        previewStatus === "loading"
          ? "Apply is waiting for the preview to finish."
          : previewStatus === "error"
            ? "Apply requires a successful preview. Review the preview error and adjust the inputs or selections."
            : "Apply is waiting for a valid preview. Complete any missing inputs or selections."
      const description = accept.getAttribute("aria-describedby")
      expect(description).not.toBeNull()
      expect(
        description
          ?.split(" ")
          .map((id) => document.getElementById(id)?.textContent)
          .join(" "),
      ).toBe(reason)
      expect(screen.getByText(reason)).toBeTruthy()
      expect(accept.getAttribute("aria-busy")).not.toBe("true")
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
