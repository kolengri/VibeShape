import { documentSnapshotSchema, sketchRecordSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { createSketchDisplayRecords } from "./sketch-display"

describe("document sketch display", () => {
  it("projects authored sketch curves and points through the exact origin-plane frame", async () => {
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      label: "XZ reference",
      plane: "xz",
      entities: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
          type: "point",
          x: 7,
          y: 11,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3213",
          type: "line",
          startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
          construction: false,
        },
      ],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      revision: 4,
      name: "Sketch display",
      variables: [],
      sketches: [sketch],
      features: [],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    })

    const records = await createSketchDisplayRecords(document, null, new Map())

    expect(records).toHaveLength(1)
    expect(Array.from(records[0]?.curvePositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
    expect(Array.from(records[0]?.pointPositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
  })
})
