import { describe, expect, it } from "vitest"
import {
  identitySketchTransform,
  isIdentitySketchTransform,
  sketchEntityTransformFromPreview,
  sketchTransformCenter,
  sketchTransformSvgValue,
  updateSketchTransformFromKeyboard,
  updateSketchTransformGesture,
} from "./sketch-transform-manipulator"

describe("sketch transform interaction", () => {
  it("updates free and axis translations from a stable gesture base", () => {
    const base = { ...identitySketchTransform, translation: { x: 2, y: 3 } }
    const gesture = {
      base,
      center: { x: 2, y: 3 },
      handle: "move-x" as const,
      pointerId: 1,
      start: { x: 10, y: 10 },
    }
    expect(updateSketchTransformGesture(gesture, { x: 14, y: 17 }, false)).toEqual({
      ...base,
      translation: { x: 6, y: 3 },
    })
    expect(
      updateSketchTransformGesture({ ...gesture, handle: "move" }, { x: 14, y: 17 }, false),
    ).toEqual({ ...base, translation: { x: 6, y: 10 } })
  })

  it("snaps rotation to 15 degrees and scale to tenths", () => {
    const rotation = updateSketchTransformGesture(
      {
        base: identitySketchTransform,
        center: { x: 0, y: 0 },
        handle: "rotate",
        pointerId: 1,
        start: { x: 10, y: 0 },
      },
      { x: 10, y: 10 },
      true,
    )
    expect(rotation.rotationRadians).toBeCloseTo(Math.PI / 4)
    const scale = updateSketchTransformGesture(
      {
        base: identitySketchTransform,
        center: { x: 0, y: 0 },
        handle: "scale",
        pointerId: 1,
        start: { x: 10, y: 0 },
      },
      { x: 14.4, y: 0 },
      true,
    )
    expect(scale.scale).toBeCloseTo(1.4)
  })

  it("converts the preview consistently for domain and SVG use", () => {
    const preview = {
      rotationRadians: Math.PI / 2,
      scale: 2,
      translation: { x: 3, y: -4 },
    }
    expect(sketchTransformCenter({ x: 5, y: 6 }, preview)).toEqual({ x: 8, y: 2 })
    expect(sketchEntityTransformFromPreview({ x: 5, y: 6 }, preview)).toEqual({
      origin: { x: 5, y: 6 },
      rotationRadians: Math.PI / 2,
      scale: 2,
      translation: { x: 3, y: -4 },
    })
    expect(sketchTransformSvgValue({ x: 5, y: 6 }, preview)).toContain("rotate(90)")
    expect(isIdentitySketchTransform(identitySketchTransform)).toBe(true)
    expect(isIdentitySketchTransform(preview)).toBe(false)
  })

  it("provides a complete keyboard path for manipulator adjustments", () => {
    const moved = updateSketchTransformFromKeyboard(identitySketchTransform, "ArrowRight", true)
    expect(moved?.translation).toEqual({ x: 10, y: 0 })
    const rotated = updateSketchTransformFromKeyboard(moved ?? identitySketchTransform, "]", false)
    expect(rotated?.rotationRadians).toBeCloseTo(Math.PI / 12)
    const scaled = updateSketchTransformFromKeyboard(rotated ?? identitySketchTransform, "=", false)
    expect(scaled?.scale).toBeCloseTo(1.1)
    expect(updateSketchTransformFromKeyboard(identitySketchTransform, "x", false)).toBeNull()
  })
})
