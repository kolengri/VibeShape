import { describe, expect, it } from "bun:test"
import { Vector3 } from "three"
import { sectionClipPlanes, sectionPointVisible } from "./section-view"

describe("view-only section planes", () => {
  it.each(["x", "y", "z"] as const)(
    "keeps either side of a %s plane without modifying coordinates",
    (axis) => {
      const coordinate = { x: 0, y: 1, z: 2 }[axis]
      const below = new Vector3().setComponent(coordinate, 9)
      const above = new Vector3().setComponent(coordinate, 11)
      const ordinary = sectionClipPlanes({ axis, offset: 10, flipped: false })?.[0]
      const flipped = sectionClipPlanes({ axis, offset: 10, flipped: true })?.[0]
      expect(ordinary?.distanceToPoint(below)).toBe(1)
      expect(ordinary?.distanceToPoint(above)).toBe(-1)
      expect(flipped?.distanceToPoint(below)).toBe(-1)
      expect(flipped?.distanceToPoint(above)).toBe(1)
      expect(below.getComponent(coordinate)).toBe(9)
      expect(sectionClipPlanes(null)).toBeNull()
    },
  )
  it("ignores nearer clipped model hits while retaining visible candidates", () => {
    const planes = sectionClipPlanes({ axis: "z", offset: 10, flipped: false })
    const hits = [
      { distance: 1, point: new Vector3(0, 0, 15), id: "hidden" },
      { distance: 2, point: new Vector3(0, 0, 10), id: "boundary" },
      { distance: 3, point: new Vector3(0, 0, 5), id: "visible" },
    ]
    expect(
      hits.filter(({ point }) => sectionPointVisible(planes, point)).map(({ id }) => id),
    ).toEqual(["boundary", "visible"])
    expect(hits.filter(({ point }) => sectionPointVisible(null, point))).toEqual(hits)
  })
  it.each([NaN, Infinity, -Infinity, 100001, -100001])("rejects invalid offset %s", (offset) => {
    expect(() => sectionClipPlanes({ axis: "z", offset, flipped: false })).toThrow(
      "Invalid section plane",
    )
  })
})
