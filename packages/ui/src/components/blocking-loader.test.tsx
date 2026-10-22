import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActivityProvider } from "./activity"
import { BlockingLoader } from "./blocking-loader"

afterEach(cleanup)

it("keeps blocking progress visible, traps focus, and restores the initiating control on settlement", async () => {
  const user = userEvent.setup()
  const view = (label: string | null) => (
    <ActivityProvider>
      <button type="button">Open project</button>
      <BlockingLoader label={label} />
    </ActivityProvider>
  )
  const result = render(view(null))
  const trigger = screen.getByRole("button", { name: "Open project" })
  await user.click(trigger)
  result.rerender(view("Opening project"))
  const dialog = screen.getByRole("dialog", { name: "Opening project" })
  expect(dialog.getAttribute("aria-modal")).toBe("true")
  expect(dialog.querySelector("svg")).not.toBeNull()
  expect(document.activeElement === dialog).toBe(true)
  await user.keyboard("{Escape}{Tab}")
  const overlay = document.querySelector('[data-slot="blocking-loader-overlay"]')
  if (!overlay) throw new Error("Blocking progress requires a dimmed overlay.")
  fireEvent.pointerDown(overlay)
  expect(screen.getByRole("dialog", { name: "Opening project" })).toBe(dialog)
  expect(document.activeElement === dialog).toBe(true)
  result.rerender(view(null))
  expect(screen.queryByRole("dialog")).toBeNull()
  await waitFor(() => expect(document.activeElement === trigger).toBe(true))
})
