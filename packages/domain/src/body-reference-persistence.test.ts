import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema, sketchIdSchema } from "./identifiers"
import { boxFeatureType } from "./part-design"
import { holeFeatureTypeV2 } from "./part-design-hole"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const uuid = (suffix: string) => `0195b5ac-b220-7a2c-8c33-${suffix}`
const documentId = uuid("000000000001")
const targetId = featureIdSchema.parse(uuid("000000000002"))
const holeId = featureIdSchema.parse(uuid("000000000003"))
const sketchId = sketchIdSchema.parse(uuid("000000000004"))
const pointId = uuid("000000000005")
const actor = { type: "user" as const, userId: "org.vibeshape.user.persistence-test" }

function envelope(kind: string, baseRevision: number, value: number) {
  return {
    kind,
    schemaVersion: 1 as const,
    commandId: uuid(value.toString().padStart(12, "0")),
    documentId,
    baseRevision,
    issuedAt: `2026-09-07T08:${value.toString().padStart(2, "0")}:00.000Z`,
    actor,
  }
}

function targetFeature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: targetId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function holeFeature(diameter = 8) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: holeId,
    type: holeFeatureTypeV2.type,
    parameters: {
      sketchId,
      pointIds: [pointId],
      diameter: createLengthQuantity(diameter, "mm", `${diameter} mm`),
      direction: "forward",
      extent: "through-all",
      targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "result" },
    },
    dependencies: [targetId],
    references: [],
    suppressed: false,
  })
}

function apply(snapshot: Parameters<typeof applyVersionedDocumentCommand>[0], command: unknown) {
  const result = applyVersionedDocumentCommand(snapshot, command)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic))
  expect(result).toMatchObject({ ok: true })
  return result
}

describe("versioned body reference persistence", () => {
  it("preserves a V2 Hole target through insert, expression edit, and replay", () => {
    const created = apply(null, {
      ...envelope("org.vibeshape.document.create", 0, 10),
      payload: { name: "Body target" },
    })
    const target = apply(created.snapshot, {
      ...envelope("org.vibeshape.history.insert-feature", 1, 11),
      payload: { feature: targetFeature(), historyAfter: null },
    })
    const sketch = apply(target.snapshot, {
      ...envelope("org.vibeshape.history.insert-sketch", 2, 12),
      payload: {
        sketch: {
          ...createEmptySketch({ id: sketchId, label: "Hole points", plane: "xy" }),
          entities: [
            {
              schemaVersion: 0,
              id: pointId,
              type: "point",
              x: 0,
              y: 0,
              construction: false,
            },
          ],
        },
        historyAfter: { kind: "feature", id: targetId },
      },
    })
    const inserted = apply(sketch.snapshot, {
      ...envelope("org.vibeshape.history.insert-feature", 3, 13),
      payload: { feature: holeFeature(), historyAfter: { kind: "sketch", id: sketchId } },
    })
    const saved = inserted.snapshot.features.find(({ id }) => id === holeId)
    expect(saved?.parameters).toMatchObject({
      targetBody: { featureId: targetId, outputRole: "result" },
    })
    if (!saved) throw new Error("Expected the inserted Hole feature.")

    const { semanticInputs: _semanticInputs, ...editable } = saved
    const updated = apply(inserted.snapshot, {
      ...envelope("org.vibeshape.feature.update", 4, 14),
      payload: {
        feature: { ...editable, schemaVersion: 0, parameters: holeFeature(11).parameters },
      },
    })
    expect(updated.snapshot.features.find(({ id }) => id === holeId)?.parameters).toMatchObject({
      diameter: { value: 11, source: { expression: "11 mm" } },
      targetBody: { featureId: targetId, outputRole: "result" },
    })

    expect(
      replayVersionedDocumentEvents([
        created.event,
        target.event,
        sketch.event,
        inserted.event,
        updated.event,
      ]),
    ).toEqual({ ok: true, snapshot: updated.snapshot })
  })
})
