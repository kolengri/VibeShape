// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { structuralOptimizationSettingsSchema } from "@vibeshape/domain/lightweighting"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  lightweightingIdentity,
  lightweightingSettings,
  lightweightingStiffnessSummary,
  lightweightingSummary,
} from "../../../../packages/automation-api/src/lightweighting.test-fixtures"
import {
  quickLightweightingSettings,
  quickLightweightingSummary,
} from "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
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
  it("shows measured quick removal and keeps Apply behind the native preview", () => {
    const input = importReviewFixture(true)
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <AutomationReviewPanel
          review={{
            id: "quick-review",
            status: "ready",
            diagnostic: null,
            input: {
              ...input,
              quickLightweighting: {
                sourceName: "Beam",
                source: lightweightingIdentity,
                settings: quickLightweightingSettings,
                summary: quickLightweightingSummary(),
              },
            },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText("Source Part: Beam")).toBeTruthy()
    expect(screen.getByText(/Material removed: 33/)).toBeTruthy()
    expect(screen.getByText("Source volume", { exact: true })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
  })
  it.each(["schwarz-p", "schwarz-d"] as const)(
    "shows %s and independent physical period before preview approval",
    (cellType) => {
      const input = importReviewFixture(true)
      const summary = { ...quickLightweightingSummary(), cellType, latticeCellSizeMm: 9 }
      render(
        <I18nProvider i18n={i18n} initialLocale="en">
          <AutomationReviewPanel
            review={{
              id: "cell-review",
              status: "ready",
              diagnostic: null,
              input: {
                ...input,
                quickLightweighting: {
                  sourceName: "Beam",
                  source: lightweightingIdentity,
                  settings: { ...quickLightweightingSettings, cellType, latticeCellSizeMm: 9 },
                  summary,
                },
              },
            }}
          />
        </I18nProvider>,
      )
      expect(
        screen.getAllByText(cellType === "schwarz-p" ? "Schwarz P" : "Schwarz D").length,
      ).toBeGreaterThan(0)
      expect(screen.getAllByText("Cell size (mm)")[0]?.nextElementSibling?.textContent).toBe("9")
      expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
    },
  )
  it("shows the requested structural objective and retained mass budget before Apply", () => {
    const input = importReviewFixture(true)
    const settings = structuralOptimizationSettingsSchema.parse({
      ...lightweightingSettings,
      objective: { kind: "maximize-stiffness", retainedMassFraction: 0.8 },
    })
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <AutomationReviewPanel
          review={{
            id: "objective-review",
            status: "ready",
            diagnostic: null,
            input: {
              ...input,
              lightweighting: {
                sourceName: "Beam",
                source: lightweightingIdentity,
                settings,
                summary: lightweightingStiffnessSummary(),
              },
            },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getAllByText("Maximize stiffness at target mass").length).toBeGreaterThan(0)
    expect(screen.getByText("Target retained mass: 80%")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
  })
  it("renders source surface scope and inward depth without assuming box bounds", () => {
    const input = importReviewFixture(true)
    const settings = structuralOptimizationSettingsSchema.parse({
      ...lightweightingSettings,
      supports: [{ kind: "surface", triangleIndices: [0, 2], depthMm: 3 }],
    })
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <AutomationReviewPanel
          review={{
            id: "surface-review",
            status: "ready",
            diagnostic: null,
            input: {
              ...input,
              lightweighting: {
                sourceName: "Beam",
                source: lightweightingIdentity,
                settings,
                summary: lightweightingSummary(),
              },
            },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText(/2 source triangles/)).toBeTruthy()
    expect(screen.getByText("Region depth (mm)", { exact: true })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
  })

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
