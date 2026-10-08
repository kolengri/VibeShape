import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { BooleanParameterField, TanStackBooleanParameterField } from "./boolean-parameter-field"

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

  it("adapts a TanStack-style boolean field without owning form state", () => {
    const handleChange = vi.fn()
    const onBeforeChange = vi.fn()
    render(
      <TanStackBooleanParameterField
        label="Symmetric"
        onBeforeChange={onBeforeChange}
        field={{ name: "symmetric", state: { value: false }, handleBlur: vi.fn(), handleChange }}
      />,
    )

    fireEvent.click(screen.getByRole("checkbox", { name: "Symmetric" }))
    expect(onBeforeChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith(true)
  })
})
