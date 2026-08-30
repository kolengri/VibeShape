import { type SketchEntity, type SketchPoint2, sketchEntityIdSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  projectSketchCurveBetweenFrames,
  projectWorldCircularEdgeToSupport,
  projectWorldEllipticalEdgeToSupport,
  sampleWorldCircularEdge,
  sampleWorldEllipticalEdge,
} from "./sketch-curve-projection"
import type { SupportFrame } from "./support-frame"

const id = (suffix: string) =>
  sketchEntityIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${suffix.padStart(12, "0")}`)

const xy: SupportFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}

function pointMap(entries: readonly (readonly [string, SketchPoint2])[]) {
  return new Map(entries)
}

describe("analytical sketch curve projection", () => {
  it("projects exact full-circle model edges without tessellation-derived dimensions", () => {
    const projected = projectWorldCircularEdgeToSupport(
      {
        kind: "circle-edge",
        center: [2, 3, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        radius: 5,
      },
      xy,
    )

    expect(projected).toEqual({ type: "circle", points: [{ x: 2, y: 3 }], radius: 5 })
  })

  it("uses the analytical middle point to preserve a model arc's major segment", () => {
    const geometry = {
      kind: "arc-edge" as const,
      center: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
      radius: 5,
      start: [5, 0, 0] as const,
      middle: [-5, 0, 0] as const,
      end: [0, -5, 0] as const,
    }

    const projected = projectWorldCircularEdgeToSupport(geometry, xy)
    const sampled = sampleWorldCircularEdge(geometry, 4)

    expect(projected).toEqual({
      type: "arc",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: -5 },
      ],
    })
    expect(sampled[0]).toEqual([5, 0, 0])
    expect(sampled.at(-1)?.[0]).toBeCloseTo(0)
    expect(sampled.at(-1)?.[1]).toBeCloseTo(-5)
    expect(sampled[2]?.[0]).toBeCloseTo(-Math.sqrt(12.5))
  })

  it("projects and samples a bounded ellipse from exact role points", () => {
    const geometry = {
      kind: "elliptical-arc-edge" as const,
      center: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
      majorRadius: 5,
      minorRadius: 3,
      start: [5, 0, 0] as const,
      middle: [0, 3, 0] as const,
      end: [-5, 0, 0] as const,
    }
    expect(projectWorldEllipticalEdgeToSupport(geometry, xy)).toEqual({
      type: "elliptical-arc",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 3 },
        { x: 5, y: 0 },
        { x: -5, y: 0 },
      ],
    })
    const sampled = sampleWorldEllipticalEdge(geometry, 2)
    expect(sampled[0]).toEqual([5, 0, 0])
    expect(sampled[1]?.[1]).toBeCloseTo(3)
    expect(sampled.at(-1)?.[0]).toBeCloseTo(-5)
    expect(sampled.at(-1)?.[1]).toBeCloseTo(0)
  })

  it("preserves reflected and major elliptical-arc branches", () => {
    const reflected = {
      kind: "elliptical-arc-edge" as const,
      center: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
      majorRadius: 5,
      minorRadius: 3,
      start: [5, 0, 0] as const,
      middle: [0, -3, 0] as const,
      end: [-5, 0, 0] as const,
    }
    expect(projectWorldEllipticalEdgeToSupport(reflected, xy)).toEqual({
      type: "elliptical-arc",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: -3 },
        { x: 5, y: 0 },
        { x: -5, y: 0 },
      ],
    })
    expect(sampleWorldEllipticalEdge(reflected, 2)[1]?.[1]).toBeCloseTo(-3)

    const major = {
      ...reflected,
      middle: [-5, 0, 0] as const,
      end: [0, -3, 0] as const,
    }
    const projectedMajor = projectWorldEllipticalEdgeToSupport(major, xy)
    expect(projectedMajor).toMatchObject({
      type: "elliptical-arc",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 3 },
        { x: 5, y: 0 },
        { x: 0, y: -3 },
      ],
    })
    const sampledMajor = sampleWorldEllipticalEdge(major, 3)
    expect(sampledMajor[2]?.[0]).toBeCloseTo(-5)
    expect(sampledMajor.at(-1)?.[1]).toBeCloseTo(-3)
  })

  it("bounds transient circular display sampling", () => {
    const geometry = {
      kind: "circle-edge" as const,
      center: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
      radius: 5,
    }

    expect(() => sampleWorldCircularEdge(geometry, 0)).toThrow(RangeError)
    expect(() => sampleWorldCircularEdge(geometry, 4_097)).toThrow(RangeError)
  })

  it("bounds transient elliptical display sampling", () => {
    const geometry = {
      kind: "ellipse-edge" as const,
      center: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
      majorRadius: 5,
      minorRadius: 3,
    }

    expect(() => sampleWorldEllipticalEdge(geometry, 0)).toThrow(RangeError)
    expect(() => sampleWorldEllipticalEdge(geometry, 4_097)).toThrow(RangeError)
  })

  it("fails closed when a circular model edge projects to a line", () => {
    const yz: SupportFrame = {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    }
    expect(
      projectWorldCircularEdgeToSupport(
        {
          kind: "circle-edge",
          center: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          radius: 5,
        },
        yz,
      ),
    ).toBeNull()
  })

  it("keeps a circle analytical on an equivalent translated support", () => {
    const centerId = id("1")
    const circle: Extract<SketchEntity, { type: "circle" }> = {
      schemaVersion: 0,
      id: id("2"),
      type: "circle",
      construction: false,
      centerPointId: centerId,
      radius: 5,
    }
    const target = { ...xy, origin: [0, 0, 8] } satisfies SupportFrame

    const projected = projectSketchCurveBetweenFrames(
      xy,
      target,
      circle,
      pointMap([[centerId, { x: 2, y: 3 }]]),
    )

    expect(projected).toEqual({ type: "circle", points: [{ x: 2, y: 3 }], radius: 5 })
  })

  it("projects a circle exactly to an ellipse on an oblique support", () => {
    const centerId = id("3")
    const circle: Extract<SketchEntity, { type: "circle" }> = {
      schemaVersion: 0,
      id: id("4"),
      type: "circle",
      construction: false,
      centerPointId: centerId,
      radius: 5,
    }
    const cosine = 0.5
    const sine = Math.sqrt(3) / 2
    const target: SupportFrame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, cosine, sine],
      normal: [0, -sine, cosine],
    }

    const projected = projectSketchCurveBetweenFrames(
      xy,
      target,
      circle,
      pointMap([[centerId, { x: 0, y: 0 }]]),
    )

    expect(projected?.type).toBe("ellipse")
    expect(projected?.points[1]).toEqual({ x: 5, y: 0 })
    expect(projected?.points[2]?.x).toBeCloseTo(0)
    expect(projected?.points[2]?.y).toBeCloseTo(2.5)
  })

  it("rejects a rank-degenerate projection onto a perpendicular support", () => {
    const centerId = id("5")
    const circle: Extract<SketchEntity, { type: "circle" }> = {
      schemaVersion: 0,
      id: id("6"),
      type: "circle",
      construction: false,
      centerPointId: centerId,
      radius: 5,
    }
    const yz: SupportFrame = {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    }

    expect(
      projectSketchCurveBetweenFrames(xy, yz, circle, pointMap([[centerId, { x: 0, y: 0 }]])),
    ).toBeNull()
  })

  it("preserves an arc's intended segment through a reflected support", () => {
    const centerId = id("7")
    const startId = id("8")
    const endId = id("9")
    const arc: Extract<SketchEntity, { type: "arc" }> = {
      schemaVersion: 0,
      id: id("10"),
      type: "arc",
      construction: false,
      centerPointId: centerId,
      startPointId: startId,
      endPointId: endId,
    }
    const reflected: SupportFrame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, -1, 0],
      normal: [0, 0, -1],
    }

    const projected = projectSketchCurveBetweenFrames(
      xy,
      reflected,
      arc,
      pointMap([
        [centerId, { x: 0, y: 0 }],
        [startId, { x: 5, y: 0 }],
        [endId, { x: 0, y: 5 }],
      ]),
    )

    expect(projected).toEqual({
      type: "arc",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: -5 },
        { x: 5, y: 0 },
      ],
    })
  })

  it("projects ellipse axes and elliptical-arc endpoints analytically", () => {
    const centerId = id("11")
    const primaryId = id("12")
    const secondaryId = id("13")
    const startId = id("14")
    const endId = id("15")
    const points = pointMap([
      [centerId, { x: 1, y: 2 }],
      [primaryId, { x: 6, y: 2 }],
      [secondaryId, { x: 1, y: 4 }],
      [startId, { x: 6, y: 2 }],
      [endId, { x: 1, y: 4 }],
    ])
    const ellipse: Extract<SketchEntity, { type: "ellipse" }> = {
      schemaVersion: 0,
      id: id("16"),
      type: "ellipse",
      construction: false,
      centerPointId: centerId,
      primaryAxisPointId: primaryId,
      secondaryAxisPointId: secondaryId,
    }
    const arc: Extract<SketchEntity, { type: "elliptical-arc" }> = {
      ...ellipse,
      id: id("17"),
      type: "elliptical-arc",
      startPointId: startId,
      endPointId: endId,
    }

    expect(projectSketchCurveBetweenFrames(xy, xy, ellipse, points)).toEqual({
      type: "ellipse",
      points: [
        { x: 1, y: 2 },
        { x: 6, y: 2 },
        { x: 1, y: 4 },
      ],
    })
    expect(projectSketchCurveBetweenFrames(xy, xy, arc, points)).toEqual({
      type: "elliptical-arc",
      points: [
        { x: 1, y: 2 },
        { x: 6, y: 2 },
        { x: 1, y: 4 },
        { x: 6, y: 2 },
        { x: 1, y: 4 },
      ],
    })
  })
})
