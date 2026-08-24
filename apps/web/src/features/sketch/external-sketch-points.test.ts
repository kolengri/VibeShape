import { documentSnapshotSchema, sketchRecordSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { externalSketchGeometryCandidates } from "./external-sketch-points"

const sourcePointId = "0195b5ac-b220-7a2c-8c33-000000004001"
const sourceSketchId = "0195b5ac-b220-7a2c-8c33-000000004002"
const targetSketchId = "0195b5ac-b220-7a2c-8c33-000000004003"
const labels = {
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
})
