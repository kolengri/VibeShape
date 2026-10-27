import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { VariableUsageInspector } from "./variable-usage-inspector"
import { VariablesDialog } from "./variables-dialog"

afterEach(cleanup)
const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const controller = {
  status: "ready",
  saveStatus: "saved",
  report: {
    mode: "read-write",
    snapshot: { revision: 1, variables: [], features: [], sketches: [] },
  },
} as unknown as DocumentControllerState
function setup(saving = false) {
  const close = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <VariablesDialog
        controller={{ ...controller, saveStatus: saving ? "saving" : "saved" }}
        open
        onOpenChange={close}
      />
    </I18nProvider>,
  )
  return close
}
it("opens the existing variables editor as a named modal and dismisses through Escape", async () => {
  const close = setup()
  expect(screen.getByRole("dialog", { name: "Variables" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Add variable" })).toBeTruthy()
  await userEvent.keyboard("{Escape}")
  expect(close).toHaveBeenCalledWith(false)
})
it("keeps the editor mounted while its document save is pending", async () => {
  const close = setup(true)
  await userEvent.keyboard("{Escape}")
  expect(close).not.toHaveBeenCalled()
  expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole("dialog", { name: "Variables" })).toBeTruthy()
})

const usageSnapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(10),
  revision: 7,
  name: "Variable usage",
  createdAt: "2026-10-27T00:00:00Z",
  updatedAt: "2026-10-27T00:00:00Z",
  variables: [
    { schemaVersion: 0, id: id(1), name: "width", expression: "20 mm" },
    { schemaVersion: 0, id: id(2), name: "doubleWidth", expression: "#width * 2" },
    { schemaVersion: 0, id: id(3), name: "offset", expression: "#doubleWidth + 5 mm" },
  ],
  features: [
    {
      schemaVersion: 0,
      id: id(4),
      label: "Variable box",
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(40, "mm", "#doubleWidth"),
        depth: createLengthQuantity(10),
        height: createLengthQuantity(10),
      },
      dependencies: [],
      references: [],
      suppressed: true,
    },
  ],
})

function setupUsage(readOnly = false, saving = false) {
  const state = {
    ...controller,
    saveStatus: saving ? "saving" : "saved",
    report: {
      ...controller.report,
      mode: readOnly ? "read-only" : "read-write",
      snapshot: usageSnapshot,
    },
  } as DocumentControllerState
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <VariablesDialog controller={state} open onOpenChange={vi.fn()} />
    </I18nProvider>,
  )
  return { ...view, state }
}

it("inspects saved variable uses without replacing unapplied expressions, then restores row focus", async () => {
  setupUsage()
  const user = userEvent.setup()
  const expression = screen.getAllByRole("combobox", {
    name: "Variable expression",
  })[0]
  if (!expression) throw new Error("Expected width expression field.")
  await user.clear(expression)
  await user.type(expression, "99 mm")
  const trigger = screen.getByRole("button", { name: "Where is #width used?" })
  await user.click(trigger)
  const inspector = screen.getByRole("region", { name: "Uses of #width" })
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Uses of #width" }))
  expect(within(inspector).getByText("1 use", { exact: true })).toBeTruthy()
  expect(within(inspector).getByText("#doubleWidth", { exact: true })).toBeTruthy()
  expect(within(inspector).queryByText("Variable box", { exact: true })).toBeNull()
  expect(inspector.textContent).toContain(
    "Saved revision 7. Unapplied edits in this table are not included.",
  )
  await user.click(
    within(inspector).getByRole("button", {
      name: "Include indirect uses through other variables",
    }),
  )
  expect(within(inspector).getByText("3 uses", { exact: true })).toBeTruthy()
  expect(within(inspector).getByText("Variable box", { exact: true })).toBeTruthy()
  expect(inspector.textContent).toContain("/parameters/width")
  expect(within(inspector).getByText("Suppressed", { exact: true })).toBeTruthy()
  expect((expression as HTMLInputElement).value).toBe("99 mm")
  await user.click(within(inspector).getByRole("button", { name: "Close variable uses" }))
  expect(screen.queryByRole("region", { name: "Uses of #width" })).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect((expression as HTMLInputElement).value).toBe("99 mm")
})

it("keeps saved usage available in read-only documents but does not expose it for unsaved rows", async () => {
  setupUsage(true)
  const trigger = screen.getByRole("button", { name: "Where is #width used?" })
  expect((trigger as HTMLButtonElement).disabled).toBe(false)
  await userEvent.click(trigger)
  expect(screen.getByRole("region", { name: "Uses of #width" })).toBeTruthy()
  cleanup()
  setupUsage()
  await userEvent.click(screen.getByRole("button", { name: "Add variable" }))
  expect(screen.getAllByRole("button", { name: /^Where is #/ })).toHaveLength(3)
})

it("reports unavailable saved inspection while a document save is pending", async () => {
  setupUsage(false, true)
  await userEvent.click(screen.getByRole("button", { name: "Where is #width used?" }))
  const inspector = screen.getByRole("region", { name: "Uses of #width" })
  expect(within(inspector).getByRole("alert").textContent).toContain("could not be read")
  expect(within(inspector).queryByText("No uses found in saved expressions.")).toBeNull()
})

it("warns about unreadable expressions rather than implying complete independence", () => {
  const snapshot = documentSnapshotSchema.parse({
    ...usageSnapshot,
    features: usageSnapshot.features.map((feature) => ({
      ...feature,
      parameters: { ...feature.parameters, width: createLengthQuantity(40, "mm", "#width @") },
    })),
  })
  const variable = snapshot.variables[0]
  if (!variable) throw new Error("Expected width variable.")
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <VariableUsageInspector
        snapshot={snapshot}
        variableId={variable.id}
        name={variable.name}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(screen.getByRole("alert").textContent).toContain("Additional uses may exist.")
})

it("returns focus to search if filtering hides the inspected variable row", async () => {
  setupUsage()
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Where is #width used?" }))
  const search = screen.getByRole("searchbox", { name: "Search variables" })
  await user.type(search, "doubleWidth")
  await user.click(screen.getByRole("button", { name: "Close variable uses" }))
  expect(document.activeElement).toBe(search)
  expect((search as HTMLInputElement).value).toBe("doubleWidth")
})

it.each([false, true])(
  "restores current inspection focus after a revision remount (filtered=%s)",
  async (filtered) => {
    const { rerender, state } = setupUsage()
    if (!state.report) throw new Error("Expected saved document report.")
    const user = userEvent.setup()
    const original = screen.getByRole("button", { name: "Where is #width used?" })
    await user.click(original)
    rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <VariablesDialog
          controller={{
            ...state,
            report: { ...state.report, snapshot: { ...usageSnapshot, revision: 8 } },
          }}
          open
          onOpenChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(original.isConnected).toBe(false)
    const current = screen.getByRole("button", { name: "Where is #width used?" })
    const search = screen.getByRole("searchbox", { name: "Search variables" })
    if (filtered) await user.type(search, "doubleWidth")
    expect(screen.getByRole("region", { name: "Uses of #width" }).textContent).toContain(
      "Saved revision 8.",
    )
    await user.click(screen.getByRole("button", { name: "Close variable uses" }))
    expect(document.activeElement).toBe(filtered ? search : current)
  },
)
