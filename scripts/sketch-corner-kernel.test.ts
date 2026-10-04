// @vitest-environment node
import { expect, it } from "vitest"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../packages/domain/src/identifiers"
import { createRectangleSketch } from "../packages/domain/src/rectangle-sketch"
import { sketchRecordSchema } from "../packages/domain/src/sketch"
import { treatSketchCorner } from "../packages/domain/src/sketch-corner-edit"
import { createLengthQuantity } from "../packages/domain/src/units"
import initializeSolver from "../packages/sketch-solver/runtime/vibeshape_slvs.mjs"
import { solveSketchRecord } from "../packages/sketch-solver/src/production"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
it.each(["fillet", "chamfer"] as const)(
  "solves %s intent, radius/distance edits, residuals and a closed profile",
  async (kind) => {
    const solver = await initializeSolver({
      locateFile: () =>
        new URL("../packages/sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
    })
    let entity = 1,
      constraint = 100
    const createEntityId = () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId = () => sketchConstraintIdSchema.parse(id(constraint++))
    const sketch = createRectangleSketch({
      id: sketchIdSchema.parse(id(200)),
      label: "Corner",
      plane: "xy",
      width: createLengthQuantity(10),
      height: createLengthQuantity(8),
      createEntityId,
      createConstraintId,
    })
    const base = {
      firstLineId: sketchEntityIdSchema.parse(id(5)),
      secondLineId: sketchEntityIdSchema.parse(id(6)),
    }
    const treatment =
      kind === "fillet"
        ? { ...base, kind, radius: createLengthQuantity(2) }
        : {
            ...base,
            kind,
            firstDistance: createLengthQuantity(2),
            secondDistance: createLengthQuantity(3),
          }
    const original = solveSketchRecord(solver, { sketch, revision: 0, variables: [] })
    if (!original.ok) throw new Error(original.diagnostic.message)
    const solvedPoints = new Map(
      original.solution.points.map(({ entityId, x, y }) => [entityId, { x, y }]),
    )
    const result = treatSketchCorner(sketch, {
      treatment,
      solvedPoints,
      createEntityId,
      createConstraintId,
    })
    const solved = solveSketchRecord(solver, { sketch: result.sketch, revision: 1, variables: [] })
    if (!solved.ok) throw new Error(solved.diagnostic.message)
    expect(solved.solution.status).toBe("fully-constrained")
    expect(solved.solution.maximumResidual).toBeLessThan(1e-7)
    expect(solved.solution.failedConstraintIds).toEqual([])
    expect(solved.solution.profileResult.diagnostics).toEqual([])
    expect(solved.solution.profileResult.profiles).toHaveLength(1)
    expect(solved.solution.profileResult.profiles[0]?.area).toBeCloseTo(
      kind === "fillet" ? 80 - (4 - Math.PI) : 77,
      5,
    )
    const modified = {
      ...result.sketch,
      constraints: result.sketch.constraints.map((c) =>
        c.type === "radius"
          ? { ...c, value: createLengthQuantity(3) }
          : kind === "chamfer" && c.type === "distance" && "value" in c && c.value.value === 2
            ? { ...c, value: createLengthQuantity(4) }
            : c,
      ),
    }
    const edited = solveSketchRecord(solver, { sketch: modified, revision: 2, variables: [] })
    if (!edited.ok) throw new Error(edited.diagnostic.message)
    expect(edited.solution.status).toBe("fully-constrained")
    expect(edited.solution.maximumResidual).toBeLessThan(1e-7)
    expect(edited.solution.profileResult.profiles[0]?.area).toBeCloseTo(
      kind === "fillet" ? 80 - 9 * (1 - Math.PI / 4) : 74,
      5,
    )
  },
  60_000,
)

it.each(["fillet", "chamfer"] as const)(
  "rejects a solved coincident branch with distinct endpoint IDs for %s",
  async (kind) => {
    const solver = await initializeSolver({
      locateFile: () =>
        new URL("../packages/sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
    })
    let entity = 1,
      constraint = 100
    const createEntityId = () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId = () => sketchConstraintIdSchema.parse(id(constraint++))
    const rectangle = createRectangleSketch({
      id: sketchIdSchema.parse(id(200)),
      label: "Coincident branch",
      plane: "xy",
      width: createLengthQuantity(10),
      height: createLengthQuantity(8),
      createEntityId,
      createConstraintId,
    })
    const sketch = sketchRecordSchema.parse({
      ...rectangle,
      entities: [
        ...rectangle.entities,
        { schemaVersion: 0, id: id(300), type: "point", x: 0, y: 0, construction: false },
        { schemaVersion: 0, id: id(301), type: "point", x: 10, y: 5, construction: false },
        {
          schemaVersion: 0,
          id: id(302),
          type: "line",
          startPointId: id(300),
          endPointId: id(301),
          construction: false,
        },
      ],
      constraints: [
        ...rectangle.constraints,
        {
          schemaVersion: 0,
          id: id(303),
          type: "coincident",
          firstPointId: id(300),
          secondPointId: id(2),
        },
      ],
    })
    const before = JSON.stringify(sketch)
    const solved = solveSketchRecord(solver, { sketch, revision: 1, variables: [] })
    if (!solved.ok) throw new Error(solved.diagnostic.message)
    expect(solved.solution.maximumResidual).toBeLessThan(1e-7)
    const solvedPoints = new Map(
      solved.solution.points.map(({ entityId, x, y }) => [entityId, { x, y }]),
    )
    expect(solvedPoints.get(sketchEntityIdSchema.parse(id(300)))).toEqual(
      solvedPoints.get(sketchEntityIdSchema.parse(id(2))),
    )
    const base = {
      firstLineId: sketchEntityIdSchema.parse(id(5)),
      secondLineId: sketchEntityIdSchema.parse(id(6)),
    }
    const treatment =
      kind === "fillet"
        ? { ...base, kind, radius: createLengthQuantity(2) }
        : {
            ...base,
            kind,
            firstDistance: createLengthQuantity(2),
            secondDistance: createLengthQuantity(3),
          }
    expect(() =>
      treatSketchCorner(sketch, { treatment, solvedPoints, createEntityId, createConstraintId }),
    ).toThrow("branched")
    expect(JSON.stringify(sketch)).toBe(before)
  },
  60_000,
)
