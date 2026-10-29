import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import {
  type NumericalJobStatus,
  type NumericalToolName,
  numericalJobStatusSchema,
} from "@vibeshape/automation-api/numerical-jobs"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { i18n } from "../i18n"
import { AssistantNumericalJobs } from "./assistant-numerical-jobs"

afterEach(cleanup)

const context = {
  jobId: "0195b5ac-b250-7a2c-8c33-000000000101",
  documentId: "0195b5ac-b250-7a2c-8c33-000000000102",
  baseRevision: 4,
  tool: "analyze_quick_lightweighting",
}
function jobs(jobs: readonly NumericalJobStatus[]) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssistantNumericalJobs jobs={jobs} />
    </I18nProvider>
  )
}

it.each([
  ["analyze_lightweighting", "Structural analysis"],
  ["request_lightweighting", "Structural generation"],
  ["analyze_quick_lightweighting", "Quick analysis"],
  ["request_quick_lightweighting", "Quick generation"],
  ["analyze_print_optimization", "Exact print optimization analysis"],
  ["request_print_optimization", "Exact print optimization generation"],
] satisfies [NumericalToolName, string][])(
  "names the active %s computation and announces automatic notification",
  (tool, label) => {
    render(
      jobs([numericalJobStatusSchema.parse({ ...context, tool, status: "running", result: null })]),
    )
    const status = screen.getByRole("status")
    expect(status.textContent).toContain(`${label} — Running`)
    expect(status.textContent).toContain("The assistant will be notified automatically")
    expect(status.getAttribute("aria-live")).toBe("polite")
    expect(status.querySelector("svg")?.classList.contains("motion-reduce:animate-none")).toBe(true)
    expect(status.textContent).not.toContain("%")
  },
)

it("distinguishes requested cancellation from cancellation and preserves the actual failure message", () => {
  const view = render(
    jobs([numericalJobStatusSchema.parse({ ...context, status: "cancelling", result: null })]),
  )
  expect(screen.getByRole("status").textContent).toContain("Quick analysis — Cancel requested")
  const failure = (code: string, message: string) =>
    numericalJobStatusSchema.parse({
      ...context,
      status: "completed",
      result: { ok: false, diagnostic: { code, message, retryable: false } },
    })
  view.rerender(jobs([failure("request-cancelled", "Quick analysis was cancelled.")]))
  expect(screen.getByRole("status").textContent).toContain("Quick analysis — Cancelled")
  expect(screen.getByRole("status").querySelector("svg")).toBeNull()
  expect(screen.queryByText(/will be notified automatically/)).toBeNull()
  view.rerender(
    jobs([failure("source-revision-changed", "The source changed during computation.")]),
  )
  expect(screen.getByRole("status").textContent).toContain("Quick analysis — Failed")
  expect(screen.getByText("The source changed during computation.")).toBeTruthy()
})

it("keeps completed results visible without a pending indicator", () => {
  const complete = numericalJobStatusSchema.parse({
    ...context,
    status: "completed",
    result: {
      ok: true,
      value: {
        documentId: context.documentId,
        baseRevision: 4,
        source: {
          partId: "0195b5ac-b250-7a2c-8c33-000000000103",
          featureId: "0195b5ac-b250-7a2c-8c33-000000000104",
          outputRole: "body",
          contentHash: "a".repeat(64),
        },
        summary: {
          schemaVersion: 1,
          mode: "preserve-exterior",
          requestedRemovalPercent: 50,
          removedPercent: 50,
          sourceVolumeMm3: 1000,
          resultVolumeMm3: 500,
          cellSizeMm: 1,
          skinThicknessMm: 2,
          cellType: "gyroid",
          latticeCellSizeMm: 6,
          warnings: [],
        },
      },
    },
  })
  const view = render(jobs([complete]))
  expect(screen.getByRole("status").textContent).toBe("Quick analysis — Completed")
  expect(screen.getByRole("status").querySelector("svg")).toBeNull()
  view.rerender(jobs([]))
  expect(screen.queryByRole("region", { name: "Background computations" })).toBeNull()
})
