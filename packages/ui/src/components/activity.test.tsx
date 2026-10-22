import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { StrictMode } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  ActivityProvider,
  useActivityPending,
  useBlockingActivity,
  useReportActivity,
  useReportBlockingActivity,
} from "./activity"
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

function BlockingWork({ active, label }: { active: boolean; label: string }) {
  useReportBlockingActivity(active, label)
  return null
}

function BlockingStatus() {
  return <output aria-label="Blocking activity">{useBlockingActivity() ?? "none"}</output>
}

it("registers blocking work before passive effects without changing background timing", () => {
  let holdPassive = false
  const originalEffect = React.useEffect
  const passiveEffect = vi.spyOn(React, "useEffect").mockImplementation((setup, dependencies) =>
    originalEffect(() => {
      if (!holdPassive) return setup()
    }, dependencies),
  )
  const view = (background: boolean, blocking: boolean) => (
    <ActivityProvider>
      <ActivityStatus />
      <BlockingStatus />
      <OwnedWork active={background} />
      <BlockingWork active={blocking} label="Opening project" />
    </ActivityProvider>
  )
  try {
    const result = render(view(false, false))
    holdPassive = true
    result.rerender(view(true, false))
    expect(screen.getByLabelText("Application activity").textContent).toBe("idle")
    result.rerender(view(true, true))
    expect(screen.getByLabelText("Blocking activity").textContent).toBe("Opening project")
    expect(screen.getByLabelText("Application activity").textContent).toBe("working")
    result.rerender(view(true, false))
    expect(screen.getByLabelText("Blocking activity").textContent).toBe("none")
    expect(screen.getByLabelText("Application activity").textContent).toBe("idle")
  } finally {
    passiveEffect.mockRestore()
  }
})

it("retains blocking work until every blocking owner settles without promoting background work", () => {
  const view = (first: boolean, second: boolean) => (
    <StrictMode>
      <ActivityProvider>
        <ActivityStatus />
        <BlockingStatus />
        <OwnedWork active />
        <BlockingWork active={first} label="Opening project" />
        <BlockingWork active={second} label="Reading file" />
      </ActivityProvider>
    </StrictMode>
  )
  const result = render(view(true, true))
  expect(screen.getByLabelText("Blocking activity").textContent).toBe("Opening project")
  result.rerender(view(false, true))
  expect(screen.getByLabelText("Blocking activity").textContent).toBe("Reading file")
  result.rerender(view(false, false))
  expect(screen.getByLabelText("Blocking activity").textContent).toBe("none")
  expect(screen.getByLabelText("Application activity").textContent).toBe("working")
})

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
  await waitFor(() =>
    expect(screen.getByLabelText("Application activity").textContent).toBe("idle"),
  )
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
