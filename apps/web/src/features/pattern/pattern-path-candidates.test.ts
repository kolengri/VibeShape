import { describe, expect, it } from "bun:test"
import { materializeSketchDisplay } from "@vibeshape/application/sketch-display"
import {
  createLengthQuantity,
  documentSnapshotSchema,
  sketchRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { patternPathCandidates } from "./pattern-path-candidates"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const CENTER = { x: 5, y: -3 }
const AUTHORED_RADIUS = 10
const SOLVED_RADIUS = 12

// The radius dimension is driven by #hoop = 12 mm, so the solver moves the circle off its
// authored 10 mm radius.
const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: id(1),
  label: "Hoop",
  plane: "xz",
  entities: [
    { schemaVersion: 0, id: id(2), type: "point", ...CENTER, construction: false },
    {
      schemaVersion: 0,
      id: id(3),
      type: "circle",
      centerPointId: id(2),
      radius: AUTHORED_RADIUS,
      construction: false,
    },
    { schemaVersion: 0, id: id(4), type: "point", x: 20, y: 0, construction: false },
    { schemaVersion: 0, id: id(5), type: "point", x: 30, y: 5, construction: false },
    { schemaVersion: 0, id: id(6), type: "point", x: 20, y: 10, construction: false },
    { schemaVersion: 0, id: id(7), type: "point", x: 25, y: 5, construction: false },
    {
      schemaVersion: 0,
      id: id(8),
      type: "elliptical-arc",
      centerPointId: id(7),
      primaryAxisPointId: id(5),
      secondaryAxisPointId: id(6),
      startPointId: id(5),
      endPointId: id(6),
      construction: false,
    },
  ],
  constraints: [
    {
      schemaVersion: 0,
      id: id(9),
      type: "radius",
      curveId: id(3),
      value: createLengthQuantity(SOLVED_RADIUS, "mm", "#hoop"),
    },
  ],
})
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(10),
  revision: 4,
  name: "Solved radius",
  variables: [
    { schemaVersion: 0, id: variableIdSchema.parse(id(11)), name: "hoop", expression: "12 mm" },
  ],
  sketches: [sketch],
  features: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
})
const points = sketch.entities.flatMap((entity) =>
  entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
)
const display = materializeSketchDisplay(document, sketch, {
  sketchId: sketch.id,
  sourceRevision: document.revision,
  status: "fully-constrained",
  points,
  circles: [{ entityId: id(3), radius: SOLVED_RADIUS }],
})

describe("path Pattern viewport candidates", () => {
  it("samples circles at their solved radius in the sketch plane", () => {
    if (!display) throw new Error("The fixture sketch must display.")
    expect(display.solvedCircles).toEqual([{ entityId: id(3), radius: SOLVED_RADIUS }])
    const circle = patternPathCandidates(sketch, display, (kind) => kind).find(
      (candidate) => candidate.kind === "curve" && candidate.sourceEntityId === id(3),
    )
    if (circle?.kind !== "curve") throw new Error("The circle must be pickable.")
    // XZ sketch: local x is world X and local y is world Z; every sample lies on the solved radius.
    for (const [x, y, z] of circle.points) {
      expect(y).toBeCloseTo(0, 9)
      expect(Math.hypot(x - CENTER.x, z - CENTER.y)).toBeCloseTo(SOLVED_RADIUS, 6)
    }
  })

  it("offers elliptical arcs through the shared display sampler", () => {
    if (!display) throw new Error("The fixture sketch must display.")
    const arc = patternPathCandidates(sketch, display, (kind) => kind).find(
      (candidate) => candidate.kind === "curve" && candidate.sourceEntityId === id(8),
    )
    expect(arc).toMatchObject({
      kind: "curve",
      sourceType: "elliptical-arc",
      label: "elliptical-arc",
    })
  })
})
