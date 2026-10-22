import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { BooleanParameterField } from "./boolean-parameter-field"
import { useCadForm } from "./cad-form"

afterEach(cleanup)

describe("BooleanParameterField", () => {
  it("remains state-agnostic and supports uncontrolled input state", () => {
    const onChange = vi.fn()
    render(<BooleanParameterField label="Center on origin" defaultChecked onChange={onChange} />)

    const checkbox = screen.getByRole("checkbox", { name: "Center on origin" })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    fireEvent.click(checkbox)
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("binds a registered boolean field and preserves its value-change callback", () => {
    const onValueChange = vi.fn()
    function Fixture() {
      const form = useCadForm({ defaultValues: { symmetric: false } })
      return (
        <Form form={form}>
          <form.AppField name="symmetric">
            {(field) => <field.CheckboxField label="Symmetric" onValueChange={onValueChange} />}
          </form.AppField>
        </Form>
      )
    }
    render(<Fixture />)

    const checkbox = screen.getByRole("checkbox", { name: "Symmetric" })
    fireEvent.click(checkbox)
    expect(onValueChange).toHaveBeenCalledWith(true)
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })
})
