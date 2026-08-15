import { describe, expect, it } from "vitest"
import { canonicalJson } from "./canonical-json"

describe("canonical JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalJson({ z: 1, nested: { beta: true, alpha: null }, list: [{ y: 2, x: 1 }] }),
    ).toBe('{"list":[{"x":1,"y":2}],"nested":{"alpha":null,"beta":true},"z":1}')
  })

  it("rejects values that JSON cannot represent", () => {
    expect(() => canonicalJson(undefined)).toThrow("Canonical JSON accepts only JSON values.")
    expect(() => canonicalJson(new Date(0))).toThrow("Canonical JSON accepts only JSON values.")
    expect(() => canonicalJson(Number.NaN)).toThrow("Canonical JSON accepts only JSON values.")
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      "Canonical JSON accepts only JSON values.",
    )
  })
})
