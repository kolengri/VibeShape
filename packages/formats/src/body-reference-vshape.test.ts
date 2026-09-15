import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { featureIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { holeFeatureTypeV2 } from "@vibeshape/domain/part-design-hole"
import { createEmptySketch } from "@vibeshape/domain/sketch-edit"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { expect, it } from "vitest"
import { readVShapeV2, writeVShapeV2 } from "./vshape"

const uuid = (suffix: string) => `0195b5ac-b220-7a2c-8c33-${suffix}`
const documentId = uuid("000000000101")
const targetId = featureIdSchema.parse(uuid("000000000102"))
const holeId = featureIdSchema.parse(uuid("000000000103"))
const sketchId = sketchIdSchema.parse(uuid("000000000104"))
const pointId = uuid("000000000105")
const actor = { type: "user" as const, userId: "org.vibeshape.user.vshape-test" }
const metadata = {
  exportedAt: "2026-09-07T09:00:00.000Z",
  createdBy: { application: "VibeShape", version: "0.0.0", build: "test" },
} as const

function command(kind: string, baseRevision: number, value: number) {
  return {
    kind,
    schemaVersion: 1 as const,
    commandId: uuid(value.toString().padStart(12, "0")),
    documentId,
    baseRevision,
    issuedAt: `2026-09-07T09:${value.toString().padStart(2, "0")}:00.000Z`,
    actor,
  }
}

function apply(snapshot: Parameters<typeof applyVersionedDocumentCommand>[0], input: unknown) {
  const result = applyVersionedDocumentCommand(snapshot, input)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

it("round-trips a V2 Hole body reference through native vshape", async () => {
  const created = apply(null, {
    ...command("org.vibeshape.document.create", 0, 10),
    payload: { name: "Native body target" },
  })
  const target = apply(created.snapshot, {
    ...command("org.vibeshape.history.insert-feature", 1, 11),
    payload: {
      feature: featureRecordSchema.parse({
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
      }),
      historyAfter: null,
    },
  })
  const sketch = apply(target.snapshot, {
    ...command("org.vibeshape.history.insert-sketch", 2, 12),
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
  const hole = featureRecordSchema.parse({
    schemaVersion: 0,
    id: holeId,
    type: holeFeatureTypeV2.type,
    parameters: {
      sketchId,
      pointIds: [pointId],
      diameter: createLengthQuantity(8, "mm", "8 mm"),
      direction: "forward",
      extent: "through-all",
      targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "result" },
    },
    dependencies: [targetId],
    references: [],
    suppressed: false,
  })
  const inserted = apply(sketch.snapshot, {
    ...command("org.vibeshape.history.insert-feature", 3, 13),
    payload: { feature: hole, historyAfter: { kind: "sketch", id: sketchId } },
  })

  const written = await writeVShapeV2({
    snapshot: inserted.snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents: [created.event, target.event, sketch.event, inserted.event],
    historyMode: "complete",
    promotionRevision: 0,
    ...metadata,
  })
  expect(written.ok).toBe(true)
  if (!written.ok) return
  const read = await readVShapeV2(written.value)
  expect(read).toMatchObject({ ok: true })
  if (!read.ok) return
  const restored = read.value.snapshot.features.find(({ id }) => id === holeId)
  expect(restored?.parameters).toMatchObject({
    targetBody: { featureId: targetId, outputRole: "result" },
  })
})
