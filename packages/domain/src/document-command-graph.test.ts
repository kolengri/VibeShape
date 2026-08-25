import { describe, expect, it } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent } from "./commands"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema, sketchIdSchema } from "./identifiers"
import { extrusionFeatureType } from "./part-design"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f4100"
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4101")
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4102")
const boundaryId = "0195b5ac-b220-7a2c-8c33-67a36a7f4103"
const actor = { type: "user", userId: null } as const

function commandId(index: number) {
  return `0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`
}

function commandEnvelope(baseRevision: number, index: number) {
  return {
    schemaVersion: 1 as const,
    commandId: commandId(index),
    documentId,
    baseRevision,
    issuedAt: `2026-08-26T01:${String(index).padStart(2, "0")}:00.000Z`,
    actor,
  }
}

function genericFeature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.graph-authority-test",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function extrusion(profileSketchId = sketchId) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: extrusionFeatureType.type,
    parameters: {
      profile: {
        schemaVersion: 0,
        sketchId: profileSketchId,
        outerBoundaryEntityIds: [boundaryId],
        holeBoundaryEntityIds: [],
      },
      distance: createLengthQuantity(10),
      symmetric: false,
      operation: "new",
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function createDocument() {
  const result = applyDocumentCommand(null, {
    ...commandEnvelope(0, 1),
    kind: "org.vibeshape.document.create",
    payload: { name: "Document graph authority" },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

describe("document command graph authority", () => {
  it("rejects a feature whose cross-kind source is missing", () => {
    const created = createDocument()

    const result = applyDocumentCommand(created.snapshot, {
      ...commandEnvelope(1, 2),
      kind: "org.vibeshape.feature.add",
      payload: {
        feature: extrusion(sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4199")),
      },
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })
    if (result.ok) return
    expect(result.diagnostic.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "missing-node" })]),
    )
  })

  it("rejects cross-kind cycles for commands and tampered event replay", () => {
    const created = createDocument()
    const addedFeature = applyDocumentCommand(created.snapshot, {
      ...commandEnvelope(1, 3),
      kind: "org.vibeshape.feature.add",
      payload: { feature: genericFeature() },
    })
    if (!addedFeature.ok) throw new Error(addedFeature.diagnostic.message)
    const supportedSketch = createEmptySketch({
      id: sketchId,
      label: "Supported sketch",
      plane: "xy",
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "face",
          semanticRole: "primitive.box.cap.end",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 400,
            centroid: [0, 0, 10],
            bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
            direction: [0, 0, 1],
            directionMode: "oriented",
            boundaryCount: 4,
            adjacentGeometryClasses: ["PLANE"],
          },
        },
      },
    })
    const addedSketch = applyDocumentCommand(addedFeature.snapshot, {
      ...commandEnvelope(2, 4),
      kind: "org.vibeshape.sketch.add",
      payload: { sketch: supportedSketch },
    })
    if (!addedSketch.ok) throw new Error(addedSketch.diagnostic.message)

    const cyclicCommand = applyDocumentCommand(addedSketch.snapshot, {
      ...commandEnvelope(3, 5),
      kind: "org.vibeshape.feature.update",
      payload: { feature: extrusion() },
    })
    expect(cyclicCommand).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-command" },
    })
    if (cyclicCommand.ok) return
    expect(cyclicCommand.diagnostic.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "cycle" })]),
    )

    const validUpdate = applyDocumentCommand(addedSketch.snapshot, {
      ...commandEnvelope(3, 6),
      kind: "org.vibeshape.feature.update",
      payload: { feature: { ...genericFeature(), label: "Updated" } },
    })
    if (!validUpdate.ok || validUpdate.event.type !== "org.vibeshape.feature.updated") {
      throw new Error("Expected a valid feature update event.")
    }
    const cyclicEvent = reduceDocumentEvent(addedSketch.snapshot, {
      ...validUpdate.event,
      feature: extrusion(),
    })
    expect(cyclicEvent).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
    if (cyclicEvent.ok) return
    expect(cyclicEvent.diagnostic.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "cycle" })]),
    )
  })
})
