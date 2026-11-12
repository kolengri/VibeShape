import { describe, expect, it } from "bun:test"
import { createCoordinateSketchProject } from "../../../../../tests/support/sketch-coordinate-fixture"
import {
  layoutSketchCoordinateAnnotations,
  sketchCoordinateDimensionPoint,
} from "./sketch-coordinate-annotations"

describe("sketch coordinate annotations", () => {
  it("anchors coordinates to the measured point with either point ordering", () => {
    const { sketch } = createCoordinateSketchProject()
    const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]))
    const fixed = sketch.constraints.find((constraint) => constraint.type === "fixed")
    const dimension = sketch.constraints.find(
      (constraint) => constraint.type === "horizontal-distance",
    )
    if (!fixed || !dimension) throw new Error("The fixture requires a fixed origin and coordinate.")
    const fixedIds = new Set([fixed.pointId])
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBe(
      dimension.firstPointId,
    )
    expect(
      sketchCoordinateDimensionPoint(
        {
          ...dimension,
          firstPointId: dimension.secondPointId,
          secondPointId: dimension.firstPointId,
        },
        entities,
        fixedIds,
      ),
    ).toBe(dimension.firstPointId)
    expect(sketchCoordinateDimensionPoint(dimension, entities, new Set())).toBeNull()
    const origin = entities.get(fixed.pointId)
    if (origin?.type !== "point") throw new Error("The origin must be a point.")
    entities.set(origin.id, { ...origin, construction: false })
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBeNull()
    entities.set(origin.id, { ...origin, x: 3 })
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBeNull()
  })

  it("places the original formula pair beside its point with separate direct leaders", () => {
    const annotations = (["horizontal", "vertical"] as const).map((axis) => ({
      id: axis,
      pointId: "point",
      anchor: { x: 400, y: 300 },
      label: "#cover_length * -0.5",
      axis,
    }))
    const placements = layoutSketchCoordinateAnnotations(annotations, { width: 800, height: 600 })
    expect(placements.get("horizontal")).toMatchObject({
      left: 416,
      top: 282,
      leaderX: 416,
      leaderY: 294,
    })
    expect(placements.get("vertical")).toMatchObject({
      left: 416,
      top: 318,
      leaderX: 416,
      leaderY: 306,
    })
    expect(
      layoutSketchCoordinateAnnotations(
        [
          {
            id: "offscreen",
            pointId: "point",
            label: "10 mm",
            axis: "horizontal",
            anchor: { x: 900, y: 300 },
          },
        ],
        { width: 800, height: 600 },
      ).size,
    ).toBe(0)
  })

  it("keeps labels inside the canvas region left free by floating panels", () => {
    const label = "26 mm * 1.000000000000"
    const annotations = [
      { id: "beside-panel", pointId: "a", anchor: { x: 650, y: 300 }, label, axis: "horizontal" },
      { id: "under-header", pointId: "b", anchor: { x: 200, y: 20 }, label, axis: "vertical" },
    ] as const
    // A 300 px task panel on the right and an 80 px band on top cover part of the canvas.
    const free = { left: 0, top: 80, right: 700, bottom: 600 }
    const placements = layoutSketchCoordinateAnnotations(
      annotations,
      { width: 1000, height: 600 },
      free,
    )
    const beside = placements.get("beside-panel")
    const header = placements.get("under-header")
    if (!beside || !header) throw new Error("Both anchors are inside the canvas.")
    // The label flips to the free side of its point instead of sliding under the panel.
    expect(beside.left + beside.width).toBeLessThanOrEqual(free.right - 8)
    expect(beside.left + beside.width).toBeLessThan(650)
    expect(beside.leaderX).toBe(beside.left + beside.width)
    expect(header.top).toBeGreaterThanOrEqual(free.top + 12)
    // Without a measured region the whole canvas stays available, as before.
    expect(
      layoutSketchCoordinateAnnotations(annotations, { width: 1000, height: 600 }).get(
        "beside-panel",
      )?.left,
    ).toBe(666)
  })

  it("moves a point's coordinate pair together when the free region clips it", () => {
    const label = "26 mm * 1.000000000000"
    const viewport = { width: 1000, height: 600 }
    const free = { left: 80, top: 80, right: 920, bottom: 520 }
    const pair = (x: number, y: number) =>
      (["horizontal", "vertical"] as const).map((axis) => ({
        id: axis,
        pointId: "point",
        anchor: { x, y },
        label,
        axis,
      }))
    const boxes = (x: number, y: number, region = free) => {
      const placements = layoutSketchCoordinateAnnotations(pair(x, y), viewport, region)
      return (["horizontal", "vertical"] as const).map((id) => {
        const placement = placements.get(id)
        if (!placement) throw new Error(`The ${id} label must be placed.`)
        return {
          ...placement,
          right: placement.left + placement.width,
          upper: placement.top - 12,
          lower: placement.top + 12,
        }
      })
    }
    const expectSeparatedInside = (
      [first, second]: ReturnType<typeof boxes>,
      region: typeof free,
    ) => {
      if (!first || !second) throw new Error("Both labels must be placed.")
      for (const box of [first, second]) {
        expect(box.left).toBeGreaterThanOrEqual(region.left)
        expect(box.right).toBeLessThanOrEqual(region.right)
        expect(box.upper).toBeGreaterThanOrEqual(region.top)
        expect(box.lower).toBeLessThanOrEqual(region.bottom)
      }
      const overlap =
        first.left < second.right &&
        second.left < first.right &&
        first.upper < second.lower &&
        second.upper < first.lower
      expect(overlap).toBe(false)
    }

    // The point is panned under the top chrome: both labels used to clamp to top 92.
    const [horizontal, vertical] = boxes(200, 20)
    expectSeparatedInside([horizontal, vertical] as ReturnType<typeof boxes>, free)
    // The pair keeps the 36 px separation it has without a region (38 and 74).
    expect((vertical?.top ?? 0) - (horizontal?.top ?? 0)).toBe(36)
    expect(horizontal?.top).toBe(92)
    // Mirrored at the bottom edge, and beside the left and right edges.
    expectSeparatedInside(boxes(200, 580), free)
    expectSeparatedInside(boxes(20, 300), free)
    expectSeparatedInside(boxes(980, 300), free)
    // A region too short for the stacked pair separates the labels side by side instead.
    const short = { left: 80, top: 80, right: 920, bottom: 110 }
    expectSeparatedInside(boxes(500, 95, short), short)
  })

  it("does not attempt pixel placement before the viewport has a size", () => {
    expect(
      layoutSketchCoordinateAnnotations(
        [
          {
            id: "x",
            pointId: "point",
            anchor: { x: 10, y: 20 },
            label: "10 mm",
            axis: "horizontal",
          },
        ],
        {
          width: 0,
          height: 0,
        },
      ).size,
    ).toBe(0)
  })
})
