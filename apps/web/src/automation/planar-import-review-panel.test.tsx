import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { automationReviews } from "./automation-review-controller"
import { AutomationReviewPanel } from "./automation-review-panel"
import { planarReviewFixture } from "./planar-import-test-fixtures"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it("renders exact curve preview, units and selected plane before manual approval without Part claims", async () => {
  const input = await planarReviewFixture(),
    decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AutomationReviewPanel
        review={{ id: "planar-review", input, status: "ready", diagnostic: null }}
      />
    </I18nProvider>,
  )
  expect(
    screen.getByRole("img", { name: "Imported planar curve preview" }).querySelectorAll("path"),
  ).toHaveLength(4)
  expect(screen.getByText("Sketch plane: XZ")).toBeTruthy()
  expect(screen.getByText("millimeter · scale 1 to millimeters")).toBeTruthy()
  expect(screen.getByText("Size: 20 × 10 mm")).toBeTruthy()
  expect(screen.queryByText(/Volume:/)).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))
  expect(decide).toHaveBeenCalledWith("planar-review", "approved")
})
it("locks both review actions until the ordinary atomic transaction settles", async () => {
  const input = await planarReviewFixture()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AutomationReviewPanel
        review={{ id: "planar-review", input, status: "applying", diagnostic: null }}
      />
    </I18nProvider>,
  )
  for (const name of ["Apply", "Discard"])
    expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true)
  expect(screen.getByRole("button", { name: "Apply" }).getAttribute("aria-busy")).toBe("true")
})
