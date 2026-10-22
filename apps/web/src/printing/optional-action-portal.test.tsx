import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ActionContainer, OptionalActionPortal } from "./optional-action-portal"

afterEach(cleanup)

it("waits for the dialog footer and keeps portaled actions associated with their form", async () => {
  const user = userEvent.setup()
  let submissions = 0
  const footer = document.createElement("footer")
  document.body.append(footer)
  const content = (container: ActionContainer) => (
    <form
      id="action-slot-form"
      onSubmit={(event) => {
        event.preventDefault()
        submissions += 1
      }}
    >
      <OptionalActionPortal container={container}>
        <button type="submit" form="action-slot-form">
          Apply
        </button>
      </OptionalActionPortal>
    </form>
  )
  try {
    const view = render(content(undefined))
    const inlineAction = screen.getByRole("button", { name: "Apply" })
    expect(inlineAction.closest("form")?.id).toBe("action-slot-form")
    await user.click(inlineAction)
    expect(submissions).toBe(1)

    view.rerender(content(null))
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull()

    view.rerender(content(footer))
    const footerAction = screen.getByRole("button", { name: "Apply" })
    expect(footer.contains(footerAction)).toBe(true)
    expect(footerAction.closest("form")).toBeNull()
    await user.click(footerAction)
    expect(submissions).toBe(2)
    view.unmount()
    expect(footer.childElementCount).toBe(0)
  } finally {
    footer.remove()
  }
})
