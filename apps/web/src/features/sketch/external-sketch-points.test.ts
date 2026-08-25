import { documentSnapshotSchema, sketchRecordSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  externalSketchContextGeometry,
  externalSketchGeometryCandidates,
} from "./external-sketch-points"

const sourcePointId = "0195b5ac-b220-7a2c-8c33-000000004001"
const sourceSketchId = "0195b5ac-b220-7a2c-8c33-000000004002"
const targetSketchId = "0195b5ac-b220-7a2c-8c33-000000004003"
const labels = {
  curve: (sourceLabel: string, kind: string, ordinal: number) =>
    `${sourceLabel} · ${kind} ${ordinal}`,
  line: (sourceLabel: string, ordinal: number) => `${sourceLabel} · Line ${ordinal}`,
  point: (sourceLabel: string, ordinal: number) => `${sourceLabel} · Point ${ordinal}`,
}

describe("external sketch point candidates", () => {
  it("projects an earlier sketch point into the active support while retaining its world position", () => {
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Source",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: sourcePointId,
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "yz",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004004",
      revision: 1,
      name: "Cross-frame reference test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toEqual([
      {
        kind: "point",
        label: "Source · Point 1",
        role: "vertex",
        sourcePointId,
        sourceSketchId,
        world: [2, 3, 0],
        x: 3,
        y: 0,
      },
    ])
  })

  it("projects an earlier sketch line into the active support with world-space endpoints", () => {
    const sourceEndPointId = "0195b5ac-b220-7a2c-8c33-000000004005"
    const sourceLineId = "0195b5ac-b220-7a2c-8c33-000000004006"
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Layout",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: sourcePointId, type: "point", x: 2, y: 3 },
        { schemaVersion: 0, id: sourceEndPointId, type: "point", x: 2, y: 8 },
        {
          schemaVersion: 0,
          id: sourceLineId,
          type: "line",
          startPointId: sourcePointId,
          endPointId: sourceEndPointId,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "yz",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004007",
      revision: 1,
      name: "Cross-frame line reference test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toContainEqual({
      kind: "line",
      label: "Layout · Line 1",
      sourceLineId,
      sourceSketchId,
      start: { world: [2, 3, 0], x: 3, y: 0 },
      end: { world: [2, 8, 0], x: 8, y: 0 },
    })
  })

  it("keeps a prior circle as one sampled context curve without making it a Use candidate", () => {
    const circleId = "0195b5ac-b220-7a2c-8c33-000000004008"
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Wheel profile",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: sourcePointId, type: "point", x: 2, y: 3 },
        {
          schemaVersion: 0,
          id: circleId,
          type: "circle",
          centerPointId: sourcePointId,
          radius: 5,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004009",
      revision: 1,
      name: "Circle context test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    const context = externalSketchContextGeometry(document, target, labels)
    const curve = context.find((geometry) => geometry.kind === "curve")

    expect(curve).toEqual(
      expect.objectContaining({
        closed: true,
        kind: "curve",
        sourceEntityId: circleId,
        sourceType: "circle",
      }),
    )
    expect(curve?.points).toHaveLength(65)
    expect(curve?.points[0]?.x).toBeCloseTo(7)
    expect(curve?.points[0]?.y).toBeCloseTo(3)
    expect(curve?.points[32]?.x).toBeCloseTo(-3)
    expect(curve?.points[32]?.y).toBeCloseTo(3)
    expect(context).toContainEqual(
      expect.objectContaining({ kind: "point", role: "center", sourcePointId }),
    )
    expect(externalSketchGeometryCandidates(document, target, labels)).not.toContainEqual(
      expect.objectContaining({ sourceEntityId: circleId }),
    )
  })

  it("keeps a referenced sketch eligible as the next source in an ordered chain", () => {
    const first = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Layout",
      plane: "xy",
      entities: [{ schemaVersion: 0, id: sourcePointId, type: "point", x: 4, y: 2 }],
      constraints: [],
    })
    const secondPointId = "0195b5ac-b220-7a2c-8c33-000000004011"
    const secondEndPointId = "0195b5ac-b220-7a2c-8c33-000000004012"
    const secondLineId = "0195b5ac-b220-7a2c-8c33-000000004013"
    const second = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004014",
      label: "Driven layout",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: secondPointId, type: "point", x: 4, y: 2 },
        { schemaVersion: 0, id: secondEndPointId, type: "point", x: 12, y: 2 },
        {
          schemaVersion: 0,
          id: secondLineId,
          type: "line",
          startPointId: secondPointId,
          endPointId: secondEndPointId,
        },
      ],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000004015",
          sourceSketchId: first.id,
          sourcePointId,
          projectedPointId: "0195b5ac-b220-7a2c-8c33-000000004016",
        },
      ],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Detail",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004017",
      revision: 1,
      name: "Chained reference candidates",
      sketches: [first, second, target],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toContainEqual(
      expect.objectContaining({
        kind: "line",
        sourceSketchId: second.id,
        sourceLineId: secondLineId,
      }),
    )
  })
})
