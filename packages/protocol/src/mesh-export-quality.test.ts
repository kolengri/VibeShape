import { describe, expect, it } from "bun:test"
import { assemblyExportSettingsSchema } from "./assembly-export"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerRequestSchema } from "./document-worker"
import { meshExportQualitySchema } from "./mesh-export-quality"

const quality = { chordTolerance: 0.01, angularTolerance: 0.05 }
describe("bounded export tessellation quality", () => {
  it.each([
    { chordTolerance: 0.005, angularTolerance: 0.01 },
    { chordTolerance: 1, angularTolerance: 0.5 },
  ])("accepts boundary tolerances $chordTolerance / $angularTolerance", (value) => {
    expect(meshExportQualitySchema.parse(value)).toEqual(value)
  })
  it.each([
    { chordTolerance: 0.004, angularTolerance: 0.05 },
    { chordTolerance: 1.001, angularTolerance: 0.05 },
    { chordTolerance: 0.01, angularTolerance: 0.009 },
    { chordTolerance: 0.01, angularTolerance: 0.501 },
    { chordTolerance: Number.NaN, angularTolerance: 0.05 },
    { chordTolerance: 0.01, angularTolerance: Number.POSITIVE_INFINITY },
  ])("rejects unsafe tolerance $chordTolerance / $angularTolerance", (value) => {
    expect(meshExportQualitySchema.safeParse(value).success).toBe(false)
  })
  it.each(["stl", "3mf", "step"] as const)(
    "validates the %s document/assembly boundaries",
    (format) => {
      const request = {
        protocolVersion: DOCUMENT_PROTOCOL_VERSION,
        requestId: "quality",
        documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
        revision: 1,
        generation: 1,
        type: "exportDocument",
        format,
      }
      expect(documentWorkerRequestSchema.safeParse(request).success).toBe(true)
      expect(
        documentWorkerRequestSchema.safeParse({ ...request, meshQuality: quality }).success,
      ).toBe(format !== "step")
      expect(assemblyExportSettingsSchema.safeParse({ format, meshQuality: quality }).success).toBe(
        format !== "step",
      )
    },
  )
})
