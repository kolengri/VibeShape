import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TaskPanelHeader } from "./task-panel-header"

afterEach(cleanup)

it("keeps required instructions and their description target mounted while optional help is closed", async () => {
  const user = userEvent.setup()
  render(
    <>
      <TaskPanelHeader
        title="Repair part"
        description="A replacement retains the feature parameters."
        instruction={
          <span id="body-instruction">Choose a replacement body before continuing.</span>
        }
        actions={<button type="button">Cancel</button>}
      />
      <label htmlFor="replacement">Replacement body</label>
      <select id="replacement" aria-describedby="body-instruction">
        <option>Box</option>
      </select>
    </>,
  )
  const control = screen.getByRole("combobox", { name: "Replacement body" })
  const instruction = document.getElementById(control.getAttribute("aria-describedby") ?? "")
  expect(instruction?.textContent).toBe("Choose a replacement body before continuing.")
  expect(instruction?.closest("[role=dialog]")).toBeNull()
  expect(screen.queryByRole("dialog")).toBeNull()
  await user.click(screen.getByRole("button", { name: "Help for Repair part" }))
  await user.keyboard("{Escape}")
  expect(document.getElementById("body-instruction")).toBe(instruction)
  expect(screen.getByRole("combobox", { name: "Replacement body" })).toBe(control)
})
