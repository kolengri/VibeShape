import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { vi } from "../../../../../tests/unit/support/bun-test"
import {
  EditorSessionProvider,
  useEditorSession,
  useEditorSessionStoreApi,
  useHistoryNavigation,
} from "../../editor-session/editor-session-provider"
import { i18n } from "../../i18n"
import { TaskPanelFormActions } from "./task-panel-form-actions"

function FeatureForm({ save }: { save: () => Promise<boolean> }) {
  const store = useEditorSessionStoreApi()
  const form = useAppForm({
    defaultValues: { name: "Feature" },
    onSubmit: async () => {
      if (await save()) store.getState().actions.closeActiveTool()
    },
  })
  return (
    <Form form={form} aria-label="Feature form">
      <TaskPanelFormActions
        acceptLabel="Save feature"
        ariaLabel="Feature actions"
        cancelLabel="Cancel"
        onCancel={() => store.getState().actions.closeActiveTool()}
        previewStatus="ready"
      />
    </Form>
  )
}

function NavigationHarness({
  save,
  onFirst,
  onLast,
  onNavigation,
}: {
  save: () => Promise<boolean>
  onFirst: () => void
  onLast: () => void
  onNavigation: (destination: string, succeeded: boolean) => void
}) {
  const store = useEditorSessionStoreApi()
  const navigation = useHistoryNavigation()
  const activeTask = useEditorSession((state) => state.activePartDesignTool?.kind)
  return (
    <TooltipProvider>
      <button
        type="button"
        onClick={() => store.getState().actions.startPartDesignTool({ kind: "create-box" })}
      >
        Begin task
      </button>
      {activeTask && <FeatureForm save={save} />}
      <button
        type="button"
        onClick={() => void navigation.navigate(onFirst).then((ok) => onNavigation("first", ok))}
      >
        First History row
      </button>
      <button
        type="button"
        onClick={() => void navigation.navigate(onLast).then((ok) => onNavigation("last", ok))}
      >
        Last History row
      </button>
      <output aria-label="Active task">{activeTask ?? "none"}</output>
    </TooltipProvider>
  )
}

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

afterEach(cleanup)

describe("History navigation during a manual feature save", () => {
  it.each([true, false])(
    "awaits the existing save and opens only the latest destination on success (%s)",
    async (saved) => {
      let complete!: (saved: boolean) => void
      const operation = new Promise<boolean>((resolve) => {
        complete = resolve
      })
      const save = vi.fn(() => operation)
      const first = vi.fn()
      const last = vi.fn()
      const settled = vi.fn()
      const user = userEvent.setup()
      render(
        <I18nProvider i18n={i18n}>
          <EditorSessionProvider>
            <NavigationHarness save={save} onFirst={first} onLast={last} onNavigation={settled} />
          </EditorSessionProvider>
        </I18nProvider>,
      )
      await user.click(screen.getByRole("button", { name: "Begin task" }))
      await user.click(screen.getByRole("button", { name: "Save feature" }))
      await user.click(screen.getByRole("button", { name: "First History row" }))
      await user.click(screen.getByRole("button", { name: "Last History row" }))

      expect(save).toHaveBeenCalledTimes(1)
      expect(settled).not.toHaveBeenCalled()
      expect(first).not.toHaveBeenCalled()
      expect(last).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: "Save feature" }).getAttribute("aria-busy")).toBe(
        "true",
      )

      complete(saved)
      await waitFor(() => expect(settled).toHaveBeenCalledTimes(2))
      expect(settled).toHaveBeenCalledWith("first", false)
      expect(settled).toHaveBeenCalledWith("last", saved)
      expect(first).not.toHaveBeenCalled()
      expect(last).toHaveBeenCalledTimes(saved ? 1 : 0)
      expect(save).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText("Active task").textContent).toBe(saved ? "none" : "create-box")
      if (saved) expect(screen.queryByRole("form", { name: "Feature form" })).toBeNull()
      else
        expect(
          (screen.getByRole("button", { name: "Save feature" }) as HTMLButtonElement).disabled,
        ).toBe(false)
    },
  )
})
