import {
  type DocumentSnapshot,
  type SketchRecord,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { revolveSketchLineAxisCandidates } from "./revolve-axis-candidates"

describe("revolveSketchLineAxisCandidates", () => {
  it("materializes exact solved construction and profile lines in their support frame", () => {
    const sketchId = sketchIdSchema.parse("01900000-0000-7000-8000-000000000001")
    const startPointId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000002")
    const endPointId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000003")
    const lineId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000004")
    const sketch = {
      schemaVersion: 0,
      id: sketchId,
      label: "Sketch 1",
      plane: "xz",
      entities: [
        { schemaVersion: 0, id: startPointId, type: "point", x: 0, y: 0, construction: true },
        { schemaVersion: 0, id: endPointId, type: "point", x: 1, y: 1, construction: true },
        {
          schemaVersion: 0,
          id: lineId,
          type: "line",
          startPointId,
          endPointId,
          construction: true,
        },
      ],
      constraints: [],
    } satisfies SketchRecord
    const document = {
      schemaVersion: 0,
      id: "01900000-0000-7000-8000-000000000010",
      revision: 0,
      name: "Axis",
      features: [],
      sketches: [sketch],
      variables: [],
      units: { length: "mm", angle: "deg" },
    } as unknown as DocumentSnapshot

    const candidates = revolveSketchLineAxisCandidates(
      document,
      sketch,
      {
        schemaVersion: 0,
        points: [
          { entityId: startPointId, x: 2, y: 3 },
          { entityId: endPointId, x: 8, y: 9 },
        ],
        circles: [],
      } as unknown as SolvedSketchWire,
      [],
      [],
      (label, ordinal) => `${label} · Line ${ordinal}`,
    )

    expect(candidates).toEqual([
      expect.objectContaining({
        axis: { kind: "sketch-line", sketchId, entityId: lineId },
        label: "Sketch 1 · Line 1",
        start: [2, 0, 3],
        end: [8, 0, 9],
      }),
    ])
  })

  it("fails closed when a solved line is degenerate", () => {
    const sketchId = sketchIdSchema.parse("01900000-0000-7000-8000-000000000101")
    const startPointId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000102")
    const endPointId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000103")
    const lineId = sketchEntityIdSchema.parse("01900000-0000-7000-8000-000000000104")
    const sketch = {
      schemaVersion: 0,
      id: sketchId,
      label: "Sketch 1",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: startPointId, type: "point", x: 0, y: 0, construction: false },
        { schemaVersion: 0, id: endPointId, type: "point", x: 0, y: 0, construction: false },
        {
          schemaVersion: 0,
          id: lineId,
          type: "line",
          startPointId,
          endPointId,
          construction: false,
        },
      ],
      constraints: [],
    } satisfies SketchRecord
    const document = {
      schemaVersion: 0,
      id: "01900000-0000-7000-8000-000000000110",
      revision: 0,
      name: "Axis",
      features: [],
      sketches: [sketch],
      variables: [],
      units: { length: "mm", angle: "deg" },
    } as unknown as DocumentSnapshot

    expect(
      revolveSketchLineAxisCandidates(
        document,
        sketch,
        {
          schemaVersion: 0,
          points: [
            { entityId: startPointId, x: 1, y: 1 },
            { entityId: endPointId, x: 1, y: 1 },
          ],
          circles: [],
        } as unknown as SolvedSketchWire,
        [],
        [],
        () => "Line",
      ),
    ).toEqual([])
  })
})
