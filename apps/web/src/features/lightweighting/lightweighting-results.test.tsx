import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, within } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { lightweightingSummary } from "../../../../../packages/automation-api/src/lightweighting.test-fixtures"
import { i18n } from "../../i18n"
import { LightweightingResults } from "./lightweighting-results"

afterEach(cleanup)

it("reports pre-optimization keep-out loss together with voxelization loss", () => {
  const result = lightweightingSummary()
  result.sourceVolumeMm3 = 160
  result.sourceVolumeLossFraction = 0.0125
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <LightweightingResults result={result} />
    </I18nProvider>,
  )
  expect(
    screen.getByText(
      "Source volume: 160 mm³. Conservative voxelization and any keep-out exclusions omit 1.25% of source volume before optimization.",
    ),
  ).toBeTruthy()
})

it("shows small nonzero masses without rounding them to zero", () => {
  const result = lightweightingSummary()
  result.sourceVolumeMm3 = 0.00004
  const load = result.optimized.cases[0]
  if (!load) throw new Error("Missing load fixture.")
  load.maxDisplacementMm = 0.000032
  load.maxVonMisesMpa = 0.000048
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <LightweightingResults result={result} />
    </I18nProvider>,
  )
  const row = screen.getByRole("rowheader", { name: "Assumed mass (kg)" }).closest("tr")
  if (!row) throw new Error("Missing mass row.")
  expect(
    within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["0.00004", "0.000032"])
  expect(screen.getByText(/Source volume: 0.00004 mm³/)).toBeTruthy()
  expect(screen.getByText(/stress 0.000048 MPa; displacement 0.000032 mm/)).toBeTruthy()
})

it("distinguishes density convergence from a missed reconstructed solid target", () => {
  const result = lightweightingSummary()
  result.algorithm = {
    kind: "simp",
    settings: { kind: "simp", volumeFraction: 0.5, filterRadiusMm: 1.5, penalty: 3 },
    densityIterations: 4,
    converged: true,
    maxDensityChange: 0.005,
    targetCellCount: 20,
    achievedCellCount: 32,
    targetStatus: "not-reached",
    projectionEvaluations: 3,
  }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <LightweightingResults result={result} />
    </I18nProvider>,
  )
  expect(screen.getByText(/Converged: yes/)).toBeTruthy()
  expect(screen.getByText(/did not reach the requested volume target/)).toBeTruthy()
  expect(screen.getByText(/Requested retained volume: 50%. Achieved: 80%/)).toBeTruthy()
})
