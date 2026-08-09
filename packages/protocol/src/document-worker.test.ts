import { describe, expect, it } from "vitest"
import {
  DOCUMENT_PROTOCOL_VERSION,
  documentRebuildSnapshotSchema,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "./document-worker"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"

function document(revision = 1) {
  return {
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Protocol test",
    features: [
      {
        schemaVersion: 0,
        id: featureId,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.box",
          schemaVersion: 1,
        },
        parameters: {
          width: { value: 20, unit: "mm" },
          depth: { value: 30, unit: "mm" },
          height: { value: 40, unit: "mm" },
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      },
    ],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  } as const
}

function envelope(revision = 1) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "request-1",
    documentId,
    revision,
    generation: 1,
  } as const
}

describe("document worker protocol", () => {
  it("accepts a bounded document rebuild request", () => {
    expect(
      documentWorkerRequestSchema.parse({
        ...envelope(),
        type: "rebuildDocument",
        document: document(),
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      }),
    ).toMatchObject({ type: "rebuildDocument", documentId, revision: 1 })
  })

  it("rejects document identity drift at the worker boundary", () => {
    expect(
      documentWorkerRequestSchema.safeParse({
        ...envelope(2),
        type: "rebuildDocument",
        document: document(1),
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      }).success,
    ).toBe(false)
    expect(
      documentWorkerRequestSchema.safeParse({
        ...envelope(),
        type: "rebuildDocument",
        document: { ...document(), id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad" },
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      }).success,
    ).toBe(false)
  })

  it("rejects unknown feature fields and oversized parameter payloads", () => {
    const feature = document().features[0]
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        features: [{ ...feature, transientKernelIndex: 12 }],
      }).success,
    ).toBe(false)
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        features: [{ ...feature, parameters: { payload: "x".repeat(1024 * 1024 + 1) } }],
      }).success,
    ).toBe(false)
  })

  it("accepts bounded authored variables and rejects invalid table identifiers", () => {
    const variable = {
      schemaVersion: 0,
      id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
      name: "wall_thickness",
      expression: "2.4 mm",
    }
    expect(
      documentRebuildSnapshotSchema.parse({ ...document(), variables: [variable] }),
    ).toMatchObject({ variables: [variable] })
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        variables: [{ ...variable, name: "wall thickness" }],
      }).success,
    ).toBe(false)
  })

  it("accepts progress and terminal failure responses", () => {
    expect(
      documentWorkerResponseSchema.parse({
        ...envelope(),
        type: "progress",
        featureId,
        stage: "feature-evaluation",
        fraction: 0.5,
      }),
    ).toMatchObject({ type: "progress", featureId })
    expect(
      documentWorkerResponseSchema.parse({
        ...envelope(),
        type: "failure",
        diagnostic: {
          code: "invalid-document-snapshot",
          message: "The committed snapshot is invalid.",
          retryable: false,
        },
      }),
    ).toMatchObject({ type: "failure", diagnostic: { retryable: false } })
  })

  it("validates non-empty STEP and STL export transfers", () => {
    expect(
      documentWorkerRequestSchema.parse({
        ...envelope(),
        type: "exportDocument",
        format: "step",
      }),
    ).toMatchObject({ type: "exportDocument", format: "step" })
    expect(
      documentWorkerResponseSchema.parse({
        ...envelope(),
        type: "documentExported",
        format: "stl",
        file: new Uint8Array([1, 2, 3]),
        bodyCount: 2,
      }),
    ).toMatchObject({ type: "documentExported", format: "stl", bodyCount: 2 })
    expect(
      documentWorkerResponseSchema.safeParse({
        ...envelope(),
        type: "documentExported",
        format: "stl",
        file: new Uint8Array(),
        bodyCount: 1,
      }).success,
    ).toBe(false)
  })
})
