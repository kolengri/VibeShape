import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { ActivityProvider, useActivityPending, useReportActivity } from "./activity"
import { Button } from "./button"
import { Spinner } from "./spinner"

afterEach(cleanup)

function ActivityStatus() {
  return (
    <output aria-label="Application activity">{useActivityPending() ? "working" : "idle"}</output>
  )
}
function OwnedWork({ active }: { active: boolean }) {
  useReportActivity(active)
  return null
}

it("keeps one aggregate pending state until overlapping owners settle or unmount", async () => {
  const view = (first: boolean, second: boolean, mounted: boolean) => (
    <StrictMode>
      <ActivityProvider>
        <ActivityStatus />
        <OwnedWork active={first} />
        {mounted && <OwnedWork active={second} />}
      </ActivityProvider>
    </StrictMode>
  )
  const result = render(view(true, true, true))
  expect(screen.getByLabelText("Application activity").textContent).toBe("working")
  result.rerender(view(false, true, true))
  expect(screen.getByLabelText("Application activity").textContent).toBe("working")
  result.rerender(view(false, true, false))
  expect(screen.getByLabelText("Application activity").textContent).toBe("idle")
})

it("centralizes async button and standalone spinner activity without weakening action locks", async () => {
  const user = userEvent.setup()
  let reject: (reason: Error) => void = () => undefined
  let calls = 0
  const operation = new Promise<void>((_, fail) => {
    reject = fail
  })
  const result = render(
    <ActivityProvider>
      <ActivityStatus />
      <Button
        onClick={() => {
          calls++
          return operation
        }}
      >
        Export
      </Button>
    </ActivityProvider>,
  )
  const button = screen.getByRole("button", { name: "Export" }) as HTMLButtonElement
  await user.click(button)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute("aria-busy")).toBe("true")
  expect(screen.getByLabelText("Application activity").textContent).toBe("working")
  expect(result.container.querySelector('[data-slot="spinner"]')).toBeNull()
  await user.click(button)
  expect(calls).toBe(1)
  reject(new Error("Export failed"))
  await waitFor(() => expect(button.disabled).toBe(false))
  expect(screen.getByLabelText("Application activity").textContent).toBe("idle")
  result.rerender(
    <ActivityProvider>
      <ActivityStatus />
      <Spinner aria-label="Loading model" />
    </ActivityProvider>,
  )
  expect(screen.getByLabelText("Application activity").textContent).toBe("working")
  expect(screen.getByRole("status", { name: "Loading model" }).className).toBe("sr-only")
  expect(result.container.querySelector("svg")).toBeNull()
})
