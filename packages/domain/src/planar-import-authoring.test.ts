import { describe, expect, it, vi } from "vitest"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import {
  authorPreparedPlanarImport,
  type PreparedPlanarCurve,
  preparedPlanarImportSchema,
} from "./planar-import-authoring"
import { sketchRecordSchema } from "./sketch"

const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
const line = (start: [number, number], end: [number, number]): PreparedPlanarCurve => ({
  type: "line",
  start,
  end,
})
function prepared(paths: { curves: unknown[]; closed?: boolean }[]) {
  return {
    schemaVersion: 0,
    format: "svg",
    units: { coordinateUnit: "mm", sourceUnit: "mm", millimetersPerUnit: 1, policy: "selected" },
    paths: paths.map((path, sourceOrdinal) => ({
      sourceOrdinal,
      inspectionId: `path:${sourceOrdinal}`,
      label: "Imported contour",
      layer: "outline",
      closed: path.closed ?? false,
      segments: path.curves.map((curve, ordinal) => ({
        sourceOrdinal: ordinal,
        sourceDirection: 1,
        curve,
      })),
    })),
  }
}
function allocation() {
  let id = 10
  return {
    id: sketchIdSchema.parse(uuid(1)),
    label: "Imported sketch",
    plane: "xz" as const,
    createEntityId: vi.fn(() => sketchEntityIdSchema.parse(uuid(id++))),
  }
}

describe("captured planar sketch authoring", () => {
  it("shares only same-path endpoint identities and captures source labels and ordinals", () => {
    const source = prepared([
      {
        closed: true,
        curves: [
          line([0, 0], [4, 0]),
          line([4, 0], [4, 3]),
          line([4, 3], [0, 3]),
          line([0, 3], [0, 0]),
        ],
      },
      { curves: [line([0, 0], [4, 0])] },
    ])
    const frozen = JSON.stringify(source)
    const result = authorPreparedPlanarImport(source, allocation())
    expect(result.sketch.plane).toBe("xz")
    expect(result.sketch.constraints).toEqual([])
    expect(result.paths[0]?.pointIds).toHaveLength(4)
    expect(result.paths[1]?.pointIds).toHaveLength(2)
    expect(result.paths[0]?.pointIds.some((id) => result.paths[1]?.pointIds.includes(id))).toBe(
      false,
    )
    expect(result.paths[0]).toMatchObject({
      sourcePathOrdinal: 0,
      inspectionId: "path:0",
      label: "Imported contour",
      layer: "outline",
      closed: true,
    })
    expect(result.createdEntityIds).toHaveLength(11)
    expect(sketchRecordSchema.parse(JSON.parse(JSON.stringify(result.sketch)))).toEqual(
      result.sketch,
    )
    expect(JSON.stringify(source)).toBe(frozen)
  })

  it("welds roundoff joins within the existing topology tolerance", () => {
    const result = authorPreparedPlanarImport(
      prepared([{ curves: [line([0, 0], [1, 0]), line([1 + 1e-8, 0], [2, 0])] }]),
      allocation(),
    )
    const curves = result.sketch.entities.filter((entity) => entity.type === "line")
    expect(curves[0]?.endPointId).toBe(curves[1]?.startPointId)
    expect(result.paths[0]?.pointIds).toHaveLength(3)
  })

  it("gives a closed cubic four distinct role UUIDs with coincident endpoint positions", () => {
    const result = authorPreparedPlanarImport(
      prepared([
        {
          closed: true,
          curves: [
            {
              type: "cubic-bezier",
              start: [0, 0],
              control1: [4, 0],
              control2: [0, 4],
              end: [0, 0],
            },
          ],
        },
      ]),
      allocation(),
    )
    const curve = result.sketch.entities.find((entity) => entity.type === "cubic-bezier")
    if (curve?.type !== "cubic-bezier") throw new Error("The fixture must contain a cubic.")
    expect(
      new Set([curve.startPointId, curve.control1PointId, curve.control2PointId, curve.endPointId])
        .size,
    ).toBe(4)
    const points = result.sketch.entities.filter((entity) => entity.type === "point")
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[3]).toMatchObject({ x: 0, y: 0 })
  })

  it("authors exact signed ellipse axes and retains arc endpoints without helper projection", () => {
    const result = authorPreparedPlanarImport(
      prepared([
        {
          curves: [
            {
              type: "elliptical-arc",
              center: [10, 20],
              primaryAxis: [4, 0],
              secondaryAxis: [0, -2],
              startAngle: 0,
              sweep: Math.PI / 2,
            },
          ],
        },
        { closed: true, curves: [{ type: "circle", center: [0, 0], radius: 2 }] },
      ]),
      allocation(),
    )
    const arc = result.sketch.entities.find((entity) => entity.type === "elliptical-arc")
    if (arc?.type !== "elliptical-arc")
      throw new Error("The fixture must contain an elliptical arc.")
    expect(
      result.sketch.entities.find((entity) => entity.id === arc.secondaryAxisPointId),
    ).toMatchObject({ x: 10, y: 18 })
    expect(result.sketch.entities.find((entity) => entity.id === arc.endPointId)).toMatchObject({
      x: 10,
      y: 18,
    })
    expect(result.paths[0]?.curves[0]?.pointIds).toHaveLength(5)
    expect(result.sketch.entities.find((entity) => entity.type === "circle")).toMatchObject({
      radius: 2,
    })
  })
})

describe("planar authoring failure boundaries", () => {
  it("rejects disconnected or false closed paths before UUID allocation", () => {
    for (const source of [
      prepared([{ curves: [line([0, 0], [1, 0]), line([2, 0], [3, 0])] }]),
      prepared([{ closed: true, curves: [line([0, 0], [1, 0])] }]),
    ]) {
      const ids = allocation()
      expect(() => authorPreparedPlanarImport(source, ids)).toThrow("disconnected endpoints")
      expect(ids.createEntityId).not.toHaveBeenCalled()
    }
  })

  it("rejects missing geometry, shear axes, tiny radii and nonfinite coordinates", () => {
    for (const curve of [
      line([0, 0], [0, 0]),
      line([NaN, 0], [1, 0]),
      { type: "circle", center: [0, 0], radius: 1e-9 },
      { type: "ellipse", center: [0, 0], primaryAxis: [4, 0], secondaryAxis: [1, 2] },
      {
        type: "ellipse",
        center: [0, 0],
        primaryAxis: [99_999, 99_999],
        secondaryAxis: [-0.77e-7, 0.77e-7],
      },
    ]) {
      expect(preparedPlanarImportSchema.safeParse(prepared([{ curves: [curve] }])).success).toBe(
        false,
      )
    }
  })

  it("rejects native capacity and large collection envelopes before UUID allocation", () => {
    const arc: PreparedPlanarCurve = {
      type: "elliptical-arc",
      center: [0, 0],
      primaryAxis: [4, 0],
      secondaryAxis: [0, 2],
      startAngle: 0,
      sweep: Math.PI / 2,
    }
    for (const source of [
      prepared(Array.from({ length: 333 }, () => ({ curves: [arc] }))),
      prepared([
        ...Array.from({ length: 1_659 }, () => ({ curves: [line([0, 0], [1, 0])] })),
        ...Array.from({ length: 2 }, () => ({
          curves: [{ type: "ellipse", center: [0, 0], primaryAxis: [4, 0], secondaryAxis: [0, 2] }],
        })),
      ]),
      { paths: Array.from({ length: 1_663 }, () => null) },
    ]) {
      const ids = allocation()
      expect(() => authorPreparedPlanarImport(source, ids)).toThrow("native sketch capacity")
      expect(ids.createEntityId).not.toHaveBeenCalled()
    }
  })

  it("fails duplicate identity factories without returning a partial sketch", () => {
    const ids = allocation()
    ids.createEntityId = vi.fn(() => sketchEntityIdSchema.parse(uuid(10)))
    expect(() =>
      authorPreparedPlanarImport(prepared([{ curves: [line([0, 0], [1, 0])] }]), ids),
    ).toThrow("duplicate UUID")
  })
})
