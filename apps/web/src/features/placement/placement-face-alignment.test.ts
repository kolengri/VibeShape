import { featureIdSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  calculateFaceAlignment,
  type PlacementAlignmentFace,
  selectedAlignmentFace,
} from "./placement-face-alignment"

type Vector3 = readonly [number, number, number]
function face(index: number, normal: Vector3, center: Vector3): PlacementAlignmentFace {
  return {
    key: `face-${index}`,
    context: "revision-4-rebuild-7",
    candidateId: "face:2",
    meshFaceId: 37,
    bodyName: `Part ${index}`,
    reference: {
      schemaVersion: 1,
      featureId: featureIdSchema.parse(
        `0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`,
      ),
      outputRole: "result",
      kind: "face",
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: 100,
        centroid: [...center],
        bounds: { min: [...center], max: [...center] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
        direction: [...normal],
        directionMode: "oriented",
      },
    },
    center,
    normal,
  }
}

// Apply the documented kernel order independently of the alignment matrix implementation.
function rotate(point: Vector3, [x, y, z]: Vector3): Vector3 {
  const afterX = [
    point[0],
    point[1] * Math.cos(x) - point[2] * Math.sin(x),
    point[1] * Math.sin(x) + point[2] * Math.cos(x),
  ] as const
  const afterY = [
    afterX[0] * Math.cos(y) + afterX[2] * Math.sin(y),
    afterX[1],
    -afterX[0] * Math.sin(y) + afterX[2] * Math.cos(y),
  ] as const
  return [
    afterY[0] * Math.cos(z) - afterY[1] * Math.sin(z),
    afterY[0] * Math.sin(z) + afterY[1] * Math.cos(z),
    afterY[2],
  ]
}

describe("frozen face alignment", () => {
  const normals: Vector3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [2 / 3, -2 / 3, 1 / 3],
    [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  ]
  const cases = normals.flatMap((sourceNormal) =>
    normals.flatMap((targetNormal) =>
      [-5, 0, 12].flatMap((offset) =>
        (["opposed", "same"] as const).map((orientation) => ({
          sourceNormal,
          targetNormal,
          offset,
          orientation,
        })),
      ),
    ),
  )
  it.each(cases)(
    "matches centers and $orientation normals: $sourceNormal to $targetNormal with offset $offset",
    ({ sourceNormal, targetNormal, offset, orientation }) => {
      const source = face(1, sourceNormal, [11, -23, 7])
      const target = face(2, targetNormal, [-19, 3, 41])
      const transform = calculateFaceAlignment(source, target, orientation, offset)
      expect(transform).not.toBeNull()
      if (!transform) throw new Error("Valid planar faces must yield a rigid transform.")
      const movedNormal = rotate(source.normal, transform.rotation)
      const movedCenter = rotate(source.center, transform.rotation)
      for (const axis of [0, 1, 2]) {
        expect(movedNormal[axis]).toBeCloseTo(
          (orientation === "opposed" ? -1 : 1) * (target.normal[axis] as number),
          8,
        )
        expect((movedCenter[axis] as number) + (transform.translation[axis] as number)).toBeCloseTo(
          (target.center[axis] as number) + offset * (target.normal[axis] as number),
          8,
        )
      }
    },
  )
  it("retains zero rotation for matching normals and follows the signed target normal for offset", () => {
    const result = calculateFaceAlignment(
      face(1, [0, 0, -1], [1, 2, 3]),
      face(2, [0, 0, 1], [10, 20, 30]),
      "opposed",
      -4,
    )
    expect(result?.translation).toEqual([9, 18, 23])
    for (const angle of result?.rotation ?? []) expect(angle).toBeCloseTo(0, 10)
  })
  it("rejects stale rebuilds, same-body faces, invalid normals and unbounded results", () => {
    const source = face(1, [0, 0, 1], [0, 0, 0])
    const target = face(2, [0, 0, 1], [10, 20, 30])
    for (const [a, b, offset] of [
      [source, { ...target, context: "different-rebuild" }, 0],
      [source, { ...target, reference: source.reference }, 0],
      [{ ...source, normal: [0, 0, 0] }, target, 0],
      [source, target, Number.NaN],
      [source, { ...target, center: [100_001, 0, 0] }, 0],
    ] as const)
      expect(calculateFaceAlignment(a, b, "opposed", offset)).toBeNull()
  })
  it("binds graphical selection to the exact body role instead of a sibling face index", () => {
    const source = face(1, [0, 0, 1], [0, 0, 0])
    const selection = { featureId: source.reference.featureId, faceId: 37, faceOrdinal: 3 }
    expect(selectedAlignmentFace([source], selection)).toBe(source)
    expect(
      selectedAlignmentFace([source], { ...selection, outputRole: "pattern.instance.1" }),
    ).toBeNull()
    expect(selectedAlignmentFace([source], { ...selection, faceId: 3 })).toBeNull()
    expect(selectedAlignmentFace([source], { ...selection, faceId: 2 })).toBeNull()
    expect(selectedAlignmentFace([source, source], selection)).toBeNull()
  })
})
