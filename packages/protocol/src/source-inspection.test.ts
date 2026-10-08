import { describe, expect, it } from "bun:test"
import { inspectSourceImportInputSchema, sourceImportInspectionSchema } from "./document-worker"

function input() {
  return {
    source: {
      format: "step",
      digest: "a".repeat(64),
      byteLength: 3,
      normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4, normalizedUnit: "millimeter" },
      unitPolicy: "step-system-mm",
      readerPolicyVersion: 1,
    },
    bytes: new Uint8Array([1, 2, 3]),
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

describe("read-only exact source inspection boundary", () => {
  it("copies source bytes and rejects length or unit-policy disagreement", () => {
    const request = input()
    const parsed = inspectSourceImportInputSchema.parse(request)
    request.bytes.fill(0)
    expect(Array.from(parsed.bytes)).toEqual([1, 2, 3])
    expect(
      inspectSourceImportInputSchema.safeParse({ ...input(), bytes: new Uint8Array(4) }).success,
    ).toBe(false)
    const source = input().source
    expect(
      inspectSourceImportInputSchema.safeParse({
        ...input(),
        source: { ...source, unitPolicy: "brep-source-normalized" },
      }).success,
    ).toBe(false)
    expect(
      sourceImportInspectionSchema.safeParse({
        unitEvidence: "explicit-source-metadata",
        outputs: [],
      }).success,
    ).toBe(false)
  })
})
