import type { Edge } from "replicad"
import { afterEach, expect, it, vi } from "vitest"
import { edgeDisplayPolyline } from "./edge-display-polyline"

const native = vi.hoisted(() => ({
  point: (t: number) => [Math.cos(t), Math.sin(t), 0],
  first: 0,
  last: Math.PI * 2,
  points: 0,
  deletedPoints: 0,
  deletedAdaptors: 0,
}))
vi.mock("replicad", () => ({
  getOC: () => ({
    BRepAdaptor_Curve_2: class {
      FirstParameter() {
        return native.first
      }
      LastParameter() {
        return native.last
      }
      Value(t: number) {
        const [x, y, z] = native.point(t)
        native.points += 1
        return {
          X: () => x,
          Y: () => y,
          Z: () => z,
          delete: () => {
            native.deletedPoints += 1
          },
        }
      }
      delete() {
        native.deletedAdaptors += 1
      }
    },
  }),
}))
const edge = { wrapped: {} } as Edge

afterEach(() => {
  expect(native.deletedPoints).toBe(native.points)
  expect(native.deletedAdaptors).toBe(1)
  native.point = (t) => [Math.cos(t), Math.sin(t), 0]
  native.first = 0
  native.last = Math.PI * 2
  native.points = 0
  native.deletedPoints = 0
  native.deletedAdaptors = 0
})

it("samples a closed curve with bounded display error and releases native coordinates", () => {
  const points = edgeDisplayPolyline(edge)
  expect(points).toBeDefined()
  if (!points) throw new Error("Expected a display polyline.")
  expect(points.length).toBeGreaterThan(16)
  expect(points[0]).toEqual([1, 0, 0])
  expect(points.at(-1)?.[0]).toBeCloseTo(1)
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (!a || !b) throw new Error("Expected adjacent samples.")
    expect(1 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBeLessThanOrEqual(0.025)
  }
})

it("does not require an analytical curve class to produce a display polyline", () => {
  native.first = -1
  native.last = 1
  native.point = (t) => [t * 20, t * t * 12, t * t * t * 8]
  const points = edgeDisplayPolyline(edge)
  expect(points?.[0]).toEqual([-20, 12, -8])
  expect(points?.at(-1)).toEqual([20, 12, 8])
})

it("stops sampling at the caller's remaining aggregate budget", () => {
  native.first = -1
  native.last = 1
  native.point = (t) => [t * 20, t * t * 12, t * t * t * 8]
  expect(edgeDisplayPolyline(edge, 2)).toBeUndefined()
  expect(native.points).toBeLessThanOrEqual(50)
})

it("omits display geometry when the bounded approximation cannot represent the curve", () => {
  native.point = (t) => [Math.cos(t) * 1e9, Math.sin(t) * 1e9, 0]
  expect(edgeDisplayPolyline(edge)).toBeUndefined()
  expect(native.points).toBeLessThan(3100)
})

it("omits non-finite display coordinates without retaining native resources", () => {
  native.point = () => [NaN, 0, 0]
  expect(edgeDisplayPolyline(edge)).toBeUndefined()
})
