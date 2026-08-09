// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { variableIdSchema } from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { VariablesForm } from "./variables-form"

const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601")
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
} as const

function renderForm(onApply = vi.fn(async () => ({ ok: true as const }))) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <VariablesForm
        baseRevision={1}
        copy={copy}
        variables={[]}
        createVariableId={() => variableId}
        onApply={onApply}
      />
    </I18nProvider>,
  )
  return onApply
}

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
    renderForm(onApply)

    await user.click(screen.getByRole("button", { name: copy.add }))
    const name = screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement
    expect(document.activeElement).toBe(name)
    await user.type(name, "width")
    await user.type(screen.getByRole("textbox", { name: copy.expressionInput }), "20 mm")

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
    const onApply = renderForm()

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
})
