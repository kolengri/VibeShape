import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"

mock.module("../features/import/import-preview", () => ({
  ImportPreview: ({ onReady }: { onReady: (ready: boolean) => void }) => (
    <button type="button" onClick={() => onReady(true)}>
      Display preview
    </button>
  ),
}))

const { cleanup, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { structuralOptimizationSettingsSchema } = await import("@vibeshape/domain/lightweighting")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const {
  lightweightingIdentity,
  lightweightingSettings,
  lightweightingStiffnessSummary,
  lightweightingSummary,
} = await import("../../../../packages/automation-api/src/lightweighting.test-fixtures")
const { quickLightweightingSettings, quickLightweightingSummary } = await import(
  "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
)
const { i18n } = await import("../i18n")
const { automationReviews } = await import("./automation-review-controller")
const { AutomationReviewPanel } = await import("./automation-review-panel")
const { importReviewFixture } = await import("./import-review.test-fixtures")
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
  it("shows the requested structural objective, keep-outs, and FDM policy before Apply", () => {
    const input = importReviewFixture(true)
    const settings = structuralOptimizationSettingsSchema.parse({
      ...lightweightingSettings,
      objective: { kind: "maximize-stiffness", retainedMassFraction: 0.8 },
      obstacleRegions: [{ min: [1, 2, 3], max: [4, 5, 6] }],
      fdm: {
        buildDirection: "-x",
        supportMode: "forbidden",
        minFeatureSizeMm: 1.2,
        layerHeightMm: 0.2,
        maxOverhangAngleDeg: 45,
      },
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
    expect(screen.getByText("Keep-out regions")).toBeTruthy()
    expect(screen.getByText("1, 2, 3")).toBeTruthy()
    expect(screen.getByText("4, 5, 6")).toBeTruthy()
    expect(screen.getByRole("region", { name: "FDM settings" })).toBeTruthy()
    expect(screen.getByText("Without supports")).toBeTruthy()
    expect(screen.getByText("Build toward -X")).toBeTruthy()
    expect(screen.getByText("Minimum feature size (mm)")).toBeTruthy()
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
