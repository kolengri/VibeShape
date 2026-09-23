import { describe, expect, it } from "vitest"
import {
  cameraAwareSketchBounds,
  projectSketchPlanePoint,
  sketchPlaneSvgTransform,
  unprojectSketchPlanePoint,
} from "./sketch-camera-projection"

describe("sketch camera coordinates", () => {
  const projection = { a: 0.01, b: 0.005, c: -0.01, d: 0.005, e: 0.5, f: 0.4 }

  it("maps pointer positions back onto an oblique plane instead of a screen-aligned plane", () => {
    const point = unprojectSketchPlanePoint({ x: 0.6, y: 0.55 }, projection)
    expect(point.x).toBeCloseTo(20)
    expect(point.y).toBeCloseTo(10)
    const screen = projectSketchPlanePoint({ x: 20, y: 10 }, projection)
    expect(screen.x).toBeCloseTo(0.6)
    expect(screen.y).toBeCloseTo(0.55)
  })

  it("keeps screen-space annotations aligned after camera translation and scaling", () => {
    const zoomed = { a: 0.02, b: 0.01, c: -0.02, d: 0.01, e: 0.3, f: 0.2 }
    expect(projectSketchPlanePoint({ x: 20, y: 10 }, zoomed)).toEqual({ x: 0.5, y: 0.5 })
    const point = unprojectSketchPlanePoint({ x: 0.5, y: 0.5 }, zoomed)
    expect(point.x).toBeCloseTo(20)
    expect(point.y).toBeCloseTo(10)
  })

  it("composes projection with the SVG viewBox and inverted sketch Y", () => {
    const bounds = { minX: -50, minY: -50, width: 100, height: 100, cameraProjection: projection }
    expect(sketchPlaneSvgTransform(bounds, { width: 1000, height: 1000 })).toBe(
      "matrix(1 0.5 1 -0.5 0 -10)",
    )
  })

  it("keeps the center and marker scale coupled to camera zoom without changing the saved bounds", () => {
    const bounds = { minX: -50, minY: -50, width: 100, height: 100 }
    const result = cameraAwareSketchBounds(bounds, projection, { width: 1000, height: 1000 })
    expect(result.width).toBeCloseTo(89.4427191)
    expect(result.minX + result.width / 2).toBeCloseTo(10)
    expect(result.minY + result.height / 2).toBeCloseTo(10)
    expect(bounds.width).toBe(100)
    expect(
      cameraAwareSketchBounds(bounds, null, { width: 1000, height: 1000 }).cameraProjection,
    ).toBeNull()
    expect(sketchPlaneSvgTransform(bounds, { width: 1000, height: 1000 })).toBeUndefined()
  })
})
