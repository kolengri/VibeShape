import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { Alert } from "./alert"
import { TextField } from "./text-field"

afterEach(cleanup)

it("keeps operation errors distinct from validation attached to a field", () => {
  render(
    <>
      <TextField label="Width" error="Width must be positive." />
      <Alert>
        <p>Export failed.</p>
        <button type="button">Retry export</button>
      </Alert>
    </>,
  )
  const input = screen.getByRole("textbox", { name: "Width" })
  const fieldError = screen.getByText("Width must be positive.")
  expect(input.getAttribute("aria-describedby")).toContain(fieldError.id)
  expect(fieldError.getAttribute("data-slot")).toBe("field-error")
  expect(fieldError.closest('[data-slot="alert"]')).toBeNull()
  const operation = screen.getByText("Export failed.").closest('[data-slot="alert"]')
  expect(operation?.getAttribute("role")).toBe("alert")
  expect(operation?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  expect(screen.getByRole("button", { name: "Retry export" }).closest('[data-slot="alert"]')).toBe(
    operation,
  )
})
