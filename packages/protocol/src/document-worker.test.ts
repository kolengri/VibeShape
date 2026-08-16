import { describe, expect, it } from "vitest"
import {
  DOCUMENT_PROTOCOL_VERSION,
  documentRebuildSnapshotSchema,
  documentWorkerRequestSchema,
  documentWorkerResponseSchema,
} from "./document-worker"
import { sketchProfileResultWireSchema } from "./sketch"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const sketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const secondSketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
const thirdSketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
const fourthSketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3205"
const sourceLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3206"
const offsetLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3207"
const offsetConstraintId = "0195b5ac-b220-7a2c-8c33-67a36a7f3208"

function sketch() {
  return {
    schemaVersion: 0,
    id: sketchId,
    label: "Profile",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: sketchPointId,
        type: "point",
        x: 0,
        y: 0,
        construction: false,
      },
    ],
    constraints: [],
  } as const
}

function offsetSketch() {
  return {
    ...sketch(),
    entities: [
      ...sketch().entities,
      {
        schemaVersion: 0,
        id: secondSketchPointId,
        type: "point",
        x: 20,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: thirdSketchPointId,
        type: "point",
        x: 0,
        y: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: fourthSketchPointId,
        type: "point",
        x: 20,
        y: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: sourceLineId,
        type: "line",
        startPointId: sketchPointId,
        endPointId: secondSketchPointId,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: offsetLineId,
        type: "line",
        startPointId: thirdSketchPointId,
        endPointId: fourthSketchPointId,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: offsetConstraintId,
        type: "offset",
        endpointPairs: [],
        linePairs: [{ sourceLineId, offsetLineId, distanceScale: 1 }],
        value: {
          schemaVersion: 0,
          dimension: "length",
          value: 5,
          unit: "mm",
          source: { value: 5, unit: "mm", expression: "5 mm" },
        },
      },
    ],
  } as const
}

function document(revision = 1) {
  return {
    schemaVersion: 0,
    id: documentId,
    revision,
    name: "Protocol test",
    displayUnits: { length: "mm", angle: "deg" },
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

  it("accepts project display units and rejects unsupported units", () => {
    expect(
      documentRebuildSnapshotSchema.parse({
        ...document(),
        displayUnits: { length: "in", angle: "rad" },
      }),
    ).toMatchObject({ displayUnits: { length: "in", angle: "rad" } })
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        displayUnits: { length: "px", angle: "deg" },
      }).success,
    ).toBe(false)
  })

  it("validates production sketch records and stable solve messages", () => {
    expect(
      documentRebuildSnapshotSchema.parse({ ...document(), sketches: [sketch()] }),
    ).toMatchObject({ sketches: [{ id: sketchId }] })
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        sketches: [
          {
            ...sketch(),
            entities: [
              ...sketch().entities,
              { ...sketch().entities[0], type: "point", x: 1, y: 1 },
            ],
          },
        ],
      }).success,
    ).toBe(false)

    expect(
      documentWorkerRequestSchema.parse({
        ...envelope(),
        type: "solveSketch",
        sketchId,
        continuation: null,
        draggedPoints: [{ entityId: sketchPointId, x: 10, y: 20 }],
      }),
    ).toMatchObject({ type: "solveSketch", sketchId, draftSketch: null })
    expect(
      documentWorkerRequestSchema.parse({
        ...envelope(),
        type: "solveSketch",
        sketchId,
        draftSketch: { ...sketch(), label: "Unsaved profile" },
      }),
    ).toMatchObject({
      type: "solveSketch",
      sketchId,
      draftSketch: { id: sketchId, label: "Unsaved profile" },
    })
    expect(
      documentWorkerRequestSchema.safeParse({
        ...envelope(),
        type: "solveSketch",
        sketchId,
        draftSketch: {
          ...sketch(),
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3299",
        },
      }).success,
    ).toBe(false)
    expect(
      documentWorkerResponseSchema.parse({
        ...envelope(),
        type: "sketchSolved",
        solution: {
          schemaVersion: 0,
          sketchId,
          sourceRevision: 1,
          status: "under-constrained",
          degreesOfFreedom: 2,
          maximumResidual: 1e-10,
          points: [{ entityId: sketchPointId, x: 10, y: 20 }],
          circles: [],
          failedConstraintIds: [],
          profileResult: { schemaVersion: 0, profiles: [], loops: [], diagnostics: [] },
          heapCapacityBytes: 16 * 1024 * 1024,
          solverBuild: {
            schemaVersion: 0,
            solver: "SolveSpace",
            solverVersion: "3.2",
            sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
            abiVersion: 1,
            moduleSha256: "60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7",
            wasmSha256: "c9e3e35084b3812e9eae7bdff8fd3290394918c88ba38504e58a9a9d4a2bd978",
          },
        },
      }),
    ).toMatchObject({ type: "sketchSolved", solution: { sketchId } })
  })

  it("accepts a bounded signed line-chain offset and rejects unsafe pairs", () => {
    expect(
      documentRebuildSnapshotSchema.parse({ ...document(), sketches: [offsetSketch()] }),
    ).toMatchObject({
      sketches: [
        {
          constraints: [
            {
              type: "offset",
              endpointPairs: [],
              linePairs: [{ sourceLineId, offsetLineId, distanceScale: 1 }],
            },
          ],
        },
      ],
    })
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        sketches: [
          {
            ...offsetSketch(),
            constraints: [
              {
                ...offsetSketch().constraints[0],
                linePairs: [{ sourceLineId, offsetLineId: sourceLineId, distanceScale: 1 }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentRebuildSnapshotSchema.safeParse({
        ...document(),
        sketches: [
          {
            ...offsetSketch(),
            constraints: [
              {
                ...offsetSketch().constraints[0],
                linePairs: [{ sourceLineId: sketchPointId, offsetLineId, distanceScale: 1 }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("validates bounded deterministic profile results", () => {
    const profile = {
      schemaVersion: 0,
      profiles: [
        {
          profileIndex: 0,
          outerLoopIndex: 0,
          holeLoopIndices: [],
          area: 100,
          perimeter: 40,
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      ],
      loops: [
        {
          loopIndex: 0,
          parentLoopIndex: null,
          depth: 0,
          signedArea: 100,
          perimeter: 40,
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          sourceEntityIds: [sketchPointId],
          segments: [{ entityId: sketchPointId, type: "line", reversed: false }],
        },
      ],
      diagnostics: [],
    } as const

    expect(sketchProfileResultWireSchema.parse(profile)).toMatchObject({
      profiles: [{ area: 100 }],
    })
    expect(
      sketchProfileResultWireSchema.safeParse({
        ...profile,
        profiles: [{ ...profile.profiles[0], outerLoopIndex: 1 }],
      }).success,
    ).toBe(false)
    expect(
      sketchProfileResultWireSchema.safeParse({
        ...profile,
        loops: [{ ...profile.loops[0], signedArea: Number.POSITIVE_INFINITY }],
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

  it("validates non-empty 3MF, STEP, and STL export transfers", () => {
    expect(
      documentWorkerRequestSchema.parse({
        ...envelope(),
        type: "exportDocument",
        format: "3mf",
      }),
    ).toMatchObject({ type: "exportDocument", format: "3mf" })
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
