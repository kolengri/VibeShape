import { documentSnapshotSchema, sketchRecordSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { externalSketchPointCandidates } from "./external-sketch-points"

const sourcePointId = "0195b5ac-b220-7a2c-8c33-000000004001"
const sourceSketchId = "0195b5ac-b220-7a2c-8c33-000000004002"
const targetSketchId = "0195b5ac-b220-7a2c-8c33-000000004003"

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

    expect(externalSketchPointCandidates(document, target)).toEqual([
      {
        label: "Source · Point",
        sourcePointId,
        sourceSketchId,
        world: [2, 3, 0],
        x: 3,
        y: 0,
      },
    ])
  })
})
