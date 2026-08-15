// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { variableIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { VariablesForm } from "./variables-form"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601")
const secondVariableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const copy = {
  caption: "Document variables",
  name: "Name",
  expression: "Expression",
  result: "Result",
  status: "Status",
  actions: "Actions",
  empty: "No variables yet.",
  add: "Add variable",
  remove: "Remove",
  rename: "Rename",
  confirmRename: "Rename variable",
  cancelRename: "Cancel",
  nameInput: "Variable name",
  expressionInput: "Variable expression",
  valid: "Valid",
  invalid: "Invalid",
  pending: "Pending",
  apply: "Apply variables",
  readOnly: "Read-only",
  validationSummary: "Fix variable fields.",
  staleRevision: "The document changed.",
  applyFailed: "Apply failed.",
  removeInUse: "Variable in use.",
  invalidName: "Enter a valid variable name.",
  invalidExpression: "Enter a valid expression.",
  renameNoChange: "Enter a different name.",
  renameConflict: "Name already used.",
  renameFailed: "Rename failed.",
} as const

type VariablesFormProps = Parameters<typeof VariablesForm>[0]
type ApplyHandler = VariablesFormProps["onApply"]
type RenameHandler = VariablesFormProps["onRename"]

function renderForm({
  onApply = vi.fn<ApplyHandler>(async () => ({ ok: true as const })),
  onRename = vi.fn<RenameHandler>(async () => ({ ok: true as const })),
  variables = [],
  displayUnits = { length: "mm", angle: "deg" } as const,
}: {
  onApply?: ApplyHandler
  onRename?: RenameHandler
  variables?: VariablesFormProps["variables"]
  displayUnits?: React.ComponentProps<typeof DocumentDisplayUnitsProvider>["displayUnits"]
} = {}) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider displayUnits={displayUnits}>
        <VariablesForm
          baseRevision={1}
          copy={copy}
          variables={variables}
          createVariableId={() => variableId}
          onApply={onApply}
          onRename={onRename}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
  return { onApply, onRename }
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock)
afterEach(cleanup)

describe("VariablesForm", () => {
  it("adds a focused draft row, evaluates it, and guards async double submission", async () => {
    const user = userEvent.setup()
    let resolveApply: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      resolveApply = resolve
    })
    const onApply = vi.fn(async () => {
      await pending
      return { ok: true as const }
    })
    renderForm({ onApply })

    await user.click(screen.getByRole("button", { name: copy.add }))
    const name = screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement
    expect(document.activeElement).toBe(name)
    await user.type(name, "width")
    await user.type(screen.getByRole("combobox", { name: copy.expressionInput }), "20 mm")

    expect(await screen.findByText("20 mm", { selector: "td" })).toBeTruthy()
    const apply = screen.getByRole("button", { name: copy.apply })
    await user.dblClick(apply)

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(1, [
      { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
    ])
    expect(apply.getAttribute("aria-busy")).toBe("true")

    resolveApply?.()
    await waitFor(() => expect(apply.getAttribute("aria-busy")).toBeNull())
  })

  it("keeps invalid draft text and shows an adjacent validation summary", async () => {
    const user = userEvent.setup()
    const { onApply } = renderForm()

    await user.click(screen.getByRole("button", { name: copy.add }))
    await user.click(screen.getByRole("button", { name: copy.apply }))

    expect((await screen.findByText(copy.validationSummary)).textContent).toBe(
      copy.validationSummary,
    )
    expect(onApply).not.toHaveBeenCalled()
    const name = screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement
    expect(name.value).toBe("")
    expect(document.activeElement).toBe(name)
  })

  it("formats resolved length and angle results in project display units", async () => {
    renderForm({
      displayUnits: { length: "in", angle: "deg" },
      variables: [
        { schemaVersion: 0, id: variableId, name: "width", expression: "25.4 mm" },
        {
          schemaVersion: 0,
          id: secondVariableId,
          name: "draft",
          expression: "1.5707963267948966 rad",
        },
      ],
    })

    expect(screen.getByText("1 in", { selector: "td" })).toBeTruthy()
    expect(screen.getByText("90 deg", { selector: "td" })).toBeTruthy()
  })

  it("suggests other variables while editing a variable expression", async () => {
    const user = userEvent.setup()
    renderForm({
      variables: [
        { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
        { schemaVersion: 0, id: secondVariableId, name: "height", expression: "10 mm" },
      ],
    })

    const expression = screen.getAllByRole("combobox", { name: copy.expressionInput })[1]
    expect(expression).toBeDefined()
    if (!expression) return
    await user.clear(expression)
    await user.type(expression, "#")

    expect(screen.getByRole("option", { name: /#width/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /#height/ })).toBeNull()
    await user.keyboard("{Enter}")
    expect((expression as HTMLInputElement).value).toBe("#width")
  })

  it("renames a committed variable once while locking ordinary table edits", async () => {
    const user = userEvent.setup()
    let resolveRename: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      resolveRename = resolve
    })
    const onRename = vi.fn(async () => {
      await pending
      return { ok: true as const }
    })
    renderForm({
      onRename,
      variables: [
        {
          schemaVersion: 0,
          id: variableId,
          name: "width",
          expression: "20 mm",
        },
      ],
    })

    const name = screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement
    expect(name.disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: copy.rename }))
    expect(name.disabled).toBe(false)
    expect(document.activeElement).toBe(name)
    await user.clear(name)
    await user.type(name, "temporary")
    await user.click(screen.getByRole("button", { name: copy.cancelRename }))
    expect(name.value).toBe("width")
    expect(name.disabled).toBe(true)

    await user.click(screen.getByRole("button", { name: copy.rename }))
    await user.clear(name)
    await user.type(name, "span")

    const confirm = screen.getByRole("button", { name: copy.confirmRename })
    await user.dblClick(confirm)

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith(1, variableId, "span")
    expect(confirm.getAttribute("aria-busy")).toBe("true")
    expect((screen.getByRole("button", { name: copy.apply }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    resolveRename?.()
    await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBeNull())
  })

  it("preserves a conflicting rename draft and reports the adjacent error", async () => {
    const user = userEvent.setup()
    const { onRename } = renderForm({
      variables: [
        {
          schemaVersion: 0,
          id: variableId,
          name: "width",
          expression: "20 mm",
        },
        {
          schemaVersion: 0,
          id: secondVariableId,
          name: "depth",
          expression: "10 mm",
        },
      ],
    })

    await user.click(screen.getAllByRole("button", { name: copy.rename })[0] as HTMLElement)
    const name = screen.getAllByRole("textbox", { name: copy.nameInput })[0] as HTMLInputElement
    await user.clear(name)
    await user.type(name, "depth")
    await user.click(screen.getByRole("button", { name: copy.confirmRename }))

    expect(onRename).not.toHaveBeenCalled()
    expect(name.value).toBe("depth")
    expect(name.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getAllByText(copy.renameConflict).length).toBeGreaterThan(0)
  })
})
