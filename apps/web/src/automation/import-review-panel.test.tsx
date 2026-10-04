// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { automationReviews } from "./automation-review-controller"
import { AutomationReviewPanel } from "./automation-review-panel"
import { importReviewFixture } from "./import-review.test-fixtures"

vi.mock("../features/import/import-preview", () => ({
  ImportPreview: ({ onReady }: { onReady: (ready: boolean) => void }) => (
    <button type="button" onClick={() => onReady(true)}>
      Display preview
    </button>
  ),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe("manual import review", () => {
  it.each([false, true])(
    "requires a visible source preview before Apply and keeps mesh volume absent: mesh=%s",
    async (mesh) => {
      const decide = vi.spyOn(automationReviews, "decide").mockResolvedValue()
      const input = importReviewFixture(mesh)
      render(
        <I18nProvider i18n={i18n} initialLocale="en">
          <AutomationReviewPanel
            review={{ id: "import-review", input, status: "ready", diagnostic: null }}
          />
        </I18nProvider>,
      )
      expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
      expect(screen.getByText(mesh ? "Triangle mesh" : "Exact solid", { exact: true })).toBeTruthy()
      expect(screen.queryByText("Volume: 1,000 mm³", { exact: true }) !== null).toBe(!mesh)
      await userEvent.click(screen.getByRole("button", { name: "Display preview" }))
      await userEvent.click(screen.getByRole("button", { name: "Apply" }))
      expect(decide).toHaveBeenCalledWith("import-review", "approved")
    },
  )
  it("locks both actions while the atomic import persists", () => {
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <AutomationReviewPanel
          review={{
            id: "import-review",
            input: importReviewFixture(),
            status: "applying",
            diagnostic: null,
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole("button", { name: "Apply" }).getAttribute("aria-busy")).toBe("true")
    for (const name of ["Apply", "Discard"])
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true)
  })
})
