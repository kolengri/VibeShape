import { describe, expect, it } from "vitest"
import {
  assertLocalPerformanceEnvironment,
  createOcctPerformanceEnvironment,
  OCCT_PERFORMANCE_ENVIRONMENT,
} from "./run-occt-performance-evidence"

describe("controlled OCCT performance runner", () => {
  it("declares a local controlled Chromium sample matrix", () => {
    expect(OCCT_PERFORMANCE_ENVIRONMENT).toEqual({
      VIBESHAPE_CONTROLLED_OCCT: "1",
      VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS: "10",
    })
  })

  it("preserves the caller environment and permits explicit local overrides", () => {
    expect(
      createOcctPerformanceEnvironment(
        { PATH: "/bin", VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS: "5" },
        { VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS: "20" },
      ),
    ).toEqual({
      PATH: "/bin",
      VIBESHAPE_CONTROLLED_OCCT: "1",
      VIBESHAPE_OCCT_PERFORMANCE_PAGE_RUNS: "20",
    })
  })

  it("rejects every CI environment before starting Playwright", () => {
    expect(() => assertLocalPerformanceEnvironment({ CI: "true" })).toThrow(
      "OCCT performance evidence is local-only",
    )
    expect(() => assertLocalPerformanceEnvironment({})).not.toThrow()
  })
})
