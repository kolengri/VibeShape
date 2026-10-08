import { describe, expect, it } from "bun:test"
import { assemblyExportSettingsSchema, exportAssemblyInputSchema } from "./assembly-export"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "./document-worker"

const id = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const assembly = {
  authorityJson: "{}",
  sourceAssets: [],
  mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  interferencePairs: [],
}
describe("assembly export boundary", () => {
  it("requires a unique nonempty instance selection and reserves print preparation for 3MF", () => {
    expect(
      assemblyExportSettingsSchema.safeParse({ format: "step", instanceIds: [] }).success,
    ).toBe(false)
    expect(
      assemblyExportSettingsSchema.safeParse({ format: "stl", instanceIds: [id, id] }).success,
    ).toBe(false)
    expect(
      assemblyExportSettingsSchema.safeParse({ format: "step", printPreparation: {} }).success,
    ).toBe(false)
    expect(
      assemblyExportSettingsSchema.parse({ format: "3mf", printPreparation: {} }).printPreparation,
    ).toBeDefined()
  })
  it("excludes pair inspection and unrecognized export options", () => {
    expect(
      exportAssemblyInputSchema.parse({ assembly, settings: { format: "step" } }),
    ).toMatchObject({ settings: { format: "step" } })
    expect(
      exportAssemblyInputSchema.safeParse({
        assembly: {
          ...assembly,
          interferencePairs: [
            { leftInstanceId: id, rightInstanceId: "0195b5ac-b220-7a2c-8c33-67a36a7f3202" },
          ],
        },
        settings: { format: "step" },
      }).success,
    ).toBe(false)
    expect(assemblyExportSettingsSchema.safeParse({ format: "step", bodies: [] }).success).toBe(
      false,
    )
  })
  it("requires nonempty exported bytes and a positive body count", () => {
    const response = {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: id,
      documentId: id,
      revision: 4,
      generation: 1,
      type: "assemblyExported",
      format: "step",
      bodyCount: 2,
      file: new Uint8Array([1, 2]),
    }
    expect(documentWorkerResponseSchema.parse(response)).toMatchObject({
      type: "assemblyExported",
      bodyCount: 2,
    })
    expect(
      documentWorkerResponseSchema.safeParse({ ...response, file: new Uint8Array() }).success,
    ).toBe(false)
    expect(documentWorkerResponseSchema.safeParse({ ...response, bodyCount: 0 }).success).toBe(
      false,
    )
  })
})
