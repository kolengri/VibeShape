import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { variableIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
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
const thirdVariableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2603")
const copy = {
  caption: "Document variables",
  name: "Name",
  expression: "Expression",
  result: "Result",
  status: "Status",
  actions: "Actions",
  empty: "No variables yet.",
  noMatches: "No variables match your search.",
  search: "Search variables",
  searchPlaceholder: "Name or expression",
  clearSearch: "Clear search",
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
  it("searches names and expressions without mutating, and clears an unmatched search", async () => {
    const user = userEvent.setup()
    const { onApply, onRename } = renderForm({
      variables: [
        { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
        { schemaVersion: 0, id: secondVariableId, name: "height", expression: "#width * 2" },
      ],
    })
    const search = screen.getByRole("searchbox", { name: copy.search }) as HTMLInputElement
    await user.type(search, "#HEIGHT{Enter}")
    expect(screen.getAllByRole("textbox", { name: copy.nameInput })).toHaveLength(1)
    expect((screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement).value).toBe(
      "height",
    )
    await user.clear(search)
    await user.type(search, "MM")
    expect((screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement).value).toBe(
      "width",
    )
    await user.clear(search)
    await user.type(search, "#WIDTH")
    expect(screen.getAllByRole("textbox", { name: copy.nameInput })).toHaveLength(2)
    await user.clear(search)
    await user.type(search, "unmatched")
    expect(screen.queryAllByRole("textbox", { name: copy.nameInput })).toHaveLength(0)
    expect(screen.getByText(copy.noMatches)).toBeTruthy()
    expect(screen.queryByText(copy.empty)).toBeNull()
    await user.click(screen.getByRole("button", { name: copy.clearSearch }))
    expect(search.value).toBe("")
    expect(document.activeElement === search).toBe(true)
    expect(screen.getAllByRole("textbox", { name: copy.nameInput })).toHaveLength(2)
    expect(onApply).not.toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it("applies filtered edits at their original indices and preserves hidden authored and draft rows", async () => {
    const user = userEvent.setup()
    const { onApply } = renderForm({
      variables: [
        { schemaVersion: 0, id: secondVariableId, name: "width", expression: "20 mm" },
        { schemaVersion: 0, id: thirdVariableId, name: "height", expression: "#width * 2" },
      ],
    })
    await user.click(screen.getByRole("button", { name: copy.add }))
    const draftName = screen.getAllByRole("textbox", {
      name: copy.nameInput,
    })[2] as HTMLInputElement
    await user.type(draftName, "clearance")
    await user.type(
      screen.getAllByRole("combobox", { name: copy.expressionInput })[2] as HTMLElement,
      "3 mm",
    )
    await user.type(screen.getByRole("searchbox", { name: copy.search }), "#HEIGHT")
    const expression = screen.getByRole("combobox", {
      name: copy.expressionInput,
    }) as HTMLInputElement
    expect(expression.name).toBe("variables[1].expression")
    await user.clear(expression)
    await user.type(expression, "#width * 3")
    expect(screen.getByText("60 mm", { selector: "td" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: copy.apply }))
    expect(onApply).toHaveBeenCalledWith(1, [
      { schemaVersion: 0, id: secondVariableId, name: "width", expression: "20 mm" },
      { schemaVersion: 0, id: thirdVariableId, name: "height", expression: "#width * 3" },
      { schemaVersion: 0, id: variableId, name: "clearance", expression: "3 mm" },
    ])
    await user.click(screen.getByRole("button", { name: copy.clearSearch }))
    expect(draftName.value).toBe("clearance")
    expect(
      screen
        .getAllByRole("combobox", { name: copy.expressionInput })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(["20 mm", "#width * 3", "3 mm"])
  })

  it("clears a filter before adding and focusing a new draft row", async () => {
    const user = userEvent.setup()
    const { onApply } = renderForm({
      variables: [{ schemaVersion: 0, id: secondVariableId, name: "width", expression: "20 mm" }],
    })
    const search = screen.getByRole("searchbox", { name: copy.search }) as HTMLInputElement
    await user.type(search, "unmatched")
    await user.click(screen.getByRole("button", { name: copy.add }))
    expect(search.value).toBe("")
    const names = screen.getAllByRole("textbox", { name: copy.nameInput })
    expect(names).toHaveLength(2)
    expect(document.activeElement === names[1]).toBe(true)
    expect(onApply).not.toHaveBeenCalled()
  })

  it("keeps renamed and draft names visible as edits stop matching the original search", async () => {
    const user = userEvent.setup()
    const { onRename } = renderForm({
      variables: [{ schemaVersion: 0, id: secondVariableId, name: "width", expression: "20 mm" }],
    })
    const search = screen.getByRole("searchbox", { name: copy.search }) as HTMLInputElement
    await user.type(search, "#width")
    await user.click(screen.getByRole("button", { name: copy.rename }))
    const renamed = screen.getByRole("textbox", { name: copy.nameInput }) as HTMLInputElement
    expect(search.value).toBe("")
    expect(document.activeElement === renamed).toBe(true)
    await user.clear(renamed)
    await user.type(renamed, "span")
    expect(screen.getByRole("textbox", { name: copy.nameInput }) === renamed).toBe(true)
    await user.click(screen.getByRole("button", { name: copy.confirmRename }))
    expect(onRename).toHaveBeenCalledWith(1, secondVariableId, "span")

    await user.click(screen.getByRole("button", { name: copy.add }))
    const draft = screen.getAllByRole("textbox", { name: copy.nameInput })[1] as HTMLInputElement
    await user.type(draft, "clearance")
    await user.type(search, "#clearance")
    await user.click(screen.getByRole("textbox", { name: copy.nameInput }))
    expect(search.value).toBe("")
    await user.clear(draft)
    await user.type(draft, "gap")
    expect(document.activeElement === draft).toBe(true)
    expect(screen.getAllByRole("textbox", { name: copy.nameInput })).toHaveLength(2)
    expect(draft.value).toBe("gap")
  })

  it("reveals and focuses a hidden invalid expression when Apply fails validation", async () => {
    const user = userEvent.setup()
    const { onApply } = renderForm({
      variables: [
        { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
        { schemaVersion: 0, id: secondVariableId, name: "height", expression: "40 mm" },
      ],
    })
    const expression = screen.getAllByRole("combobox", {
      name: copy.expressionInput,
    })[1] as HTMLInputElement
    await user.clear(expression)
    const search = screen.getByRole("searchbox", { name: copy.search }) as HTMLInputElement
    await user.type(search, "width")
    expect(screen.getAllByRole("combobox", { name: copy.expressionInput })).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: copy.apply }))
    await waitFor(() => expect(document.activeElement === expression).toBe(true))
    expect(search.value).toBe("")
    expect(screen.getAllByRole("combobox", { name: copy.expressionInput })).toHaveLength(2)
    expect(expression.getAttribute("aria-invalid")).toBe("true")
    expect(
      screen.getByText(copy.validationSummary).closest('[role="alert"]')?.getAttribute("role"),
    ).toBe("alert")
    expect(onApply).not.toHaveBeenCalled()
  })

  it("shows the initial empty table separately from unmatched variables", () => {
    renderForm()
    expect(screen.getByText(copy.empty)).toBeTruthy()
    expect(screen.queryByText(copy.noMatches)).toBeNull()
  })

  it("keeps row actions compact and exposes protected removal reasons on keyboard focus", async () => {
    renderForm({
      variables: [
        { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
        { schemaVersion: 0, id: secondVariableId, name: "height", expression: "#width" },
      ],
    })
    const remove = screen.getAllByRole("button", { name: copy.remove })[0] as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(remove.getAttribute("title")).toBeNull()
    const reason = screen.getByText(copy.removeInUse)
    expect(reason.className).toContain("sr-only")
    expect(remove.getAttribute("aria-describedby")).toBe(reason.id)
    const actions = remove.closest("td")
    expect(actions).toBeTruthy()
    if (actions) {
      const rename = within(actions).getByRole("button", { name: copy.rename })
      expect(rename.textContent).toBe("")
      expect(rename.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    }
    expect(remove.textContent).toBe("")
    expect(remove.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    const explanation = screen.getAllByRole("group", { name: copy.remove })[0]
    expect(explanation?.getAttribute("tabindex")).toBe("0")
    act(() => explanation?.focus())
    expect((await screen.findByRole("tooltip")).textContent).toContain(copy.removeInUse)
    await userEvent.click(remove)
    expect(screen.getAllByRole("textbox", { name: copy.nameInput })).toHaveLength(2)
  })

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
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: copy.confirmRename })).toBeNull()
      expect((screen.getByRole("button", { name: copy.apply }) as HTMLButtonElement).disabled).toBe(
        false,
      )
    })
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
