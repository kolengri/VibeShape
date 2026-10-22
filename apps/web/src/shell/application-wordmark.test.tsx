import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { ActivityProvider, useReportActivity } from "@vibeshape/ui/components/activity"
import { ApplicationWordmark } from "./application-wordmark"

afterEach(cleanup)

function Work({ active }: { active: boolean }) {
  useReportActivity(active)
  return null
}

it("shows a visible activity icon beside the complete wordmark for background work", () => {
  const view = (active: boolean) => (
    <ActivityProvider>
      <ApplicationWordmark />
      <Work active={active} />
    </ActivityProvider>
  )
  const result = render(view(false))
  const wordmark = screen.getByText("VibeShape").closest("strong")
  expect(wordmark?.querySelector("svg")).toBeNull()
  result.rerender(view(true))
  expect(wordmark?.getAttribute("aria-busy")).toBe("true")
  expect(wordmark?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
  expect(wordmark?.textContent).toBe("VibeShape")
  result.rerender(view(false))
  expect(wordmark?.getAttribute("aria-busy")).toBeNull()
  expect(wordmark?.querySelector("svg")).toBeNull()
})
