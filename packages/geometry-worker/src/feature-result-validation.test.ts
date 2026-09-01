import { describe, expect, it, vi } from "vitest"
import {
  disposeTemporaryShape,
  featureResultMetricsAreValid,
  featureSolidCountLimit,
} from "./feature-result-validation"

const positiveResult = { valid: true, volume: 100, solidCount: 1 }

describe("feature result validation", () => {
  it("keeps modifying multi-profile operations on the single-solid contract", () => {
    expect(featureSolidCountLimit("multi-extrusion-modifying", 2)).toBe(1)
    expect(featureSolidCountLimit("multi-extrusion", 2)).toBe(2)
    expect(featureSolidCountLimit("multi-revolve", 2)).toBe(2)
    expect(featureSolidCountLimit("multi-revolve-modifying", 2)).toBe(1)
  })

  it.each([
    ["disjoint Add", { ...positiveResult, solidCount: 2 }],
    ["split-result Remove", { ...positiveResult, solidCount: 2 }],
    ["multi-solid Intersect", { ...positiveResult, solidCount: 2 }],
    ["empty Intersect", { ...positiveResult, volume: 0, solidCount: 0 }],
  ])("rejects an invalid %s result before it can be retained", (_scenario, metrics) => {
    expect(featureResultMetricsAreValid(metrics, 1)).toBe(false)
  })

  it("accepts one valid positive-volume modifying result", () => {
    expect(featureResultMetricsAreValid(positiveResult, 1)).toBe(true)
  })

  it("disposes a rejected temporary result and reports cleanup failures", () => {
    const deleteShape = vi.fn()
    expect(disposeTemporaryShape({ delete: deleteShape })).toBe(true)
    expect(deleteShape).toHaveBeenCalledOnce()
    expect(
      disposeTemporaryShape({
        delete() {
          throw new Error("cleanup failed")
        },
      }),
    ).toBe(false)
    expect(disposeTemporaryShape(null)).toBe(true)
  })
})
