// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Form, useAppForm } from "../index"

function SelectFormHarness({ onSubmit }: { onSubmit: (value: string) => void }) {
  const form = useAppForm({
    defaultValues: { target: "box" },
    onSubmit: ({ value }) => onSubmit(value.target),
  })

  return (
    <Form form={form} aria-label="Boolean inputs">
      <form.AppField name="target">
        {(field) => (
          <field.NativeSelectField label="Target solid">
            <option value="box">Box 1</option>
            <option value="cylinder">Cylinder 1</option>
          </field.NativeSelectField>
        )}
      </form.AppField>
      <form.SubmitButton requireDirty={false}>Apply</form.SubmitButton>
    </Form>
  )
}

afterEach(cleanup)

describe("TanStack NativeSelectField", () => {
  it("binds the state-agnostic select to form state", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SelectFormHarness onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByRole("combobox", { name: "Target solid" }), "cylinder")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onSubmit).toHaveBeenCalledWith("cylinder")
  })
})
