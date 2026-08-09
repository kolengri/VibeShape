// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import { VariablesTable, type VariablesTableCopy } from "./variables-table"

const copy: VariablesTableCopy = {
  caption: "Document variables",
  name: "Name",
  expression: "Expression",
  result: "Result",
  status: "Status",
  actions: "Actions",
  empty: "No variables yet.",
  add: "Add variable",
  remove: "Remove",
}

afterEach(cleanup)

describe("VariablesTable", () => {
  it("keeps the base table uncontrolled and exposes semantic labels", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onRemove = vi.fn()

    render(
      <VariablesTable
        copy={copy}
        onAdd={onAdd}
        rows={[
          {
            id: "wall",
            nameField: (
              <TextField
                label="Variable name"
                defaultValue="wall"
                className="[&_[data-slot=field-label]]:sr-only"
              />
            ),
            expressionField: (
              <TextField
                label="Variable expression"
                defaultValue="2 mm"
                className="[&_[data-slot=field-label]]:sr-only"
              />
            ),
            result: "2 mm",
            status: "Valid",
            onRemove,
          },
        ]}
      />,
    )

    expect(screen.getByRole("table", { name: copy.caption })).toBeTruthy()
    const name = screen.getByRole("textbox", { name: "Variable name" }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, "thickness")
    expect(name.value).toBe("thickness")

    await user.click(screen.getByRole("button", { name: copy.add }))
    await user.click(screen.getByRole("button", { name: copy.remove }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
