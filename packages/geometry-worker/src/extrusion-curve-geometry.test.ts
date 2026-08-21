import { describe, expect, it } from "vitest"
import { ellipticalArcKernelParameters } from "./extrusion-curve-geometry"

const center = [0, 0, 0] as [number, number, number]
const normal = [0, 0, 1] as [number, number, number]

describe("extrusion elliptical-arc kernel geometry", () => {
  it.each([
    {
      name: "right-handed primary-major axes",
      primaryAxisPoint: [10, 0, 0] as [number, number, number],
      secondaryAxisPoint: [0, 5, 0] as [number, number, number],
      expectedNormal: [0, 0, 1],
      expectedXDirection: [1, 0, 0],
    },
    {
      name: "left-handed primary-major axes",
      primaryAxisPoint: [10, 0, 0] as [number, number, number],
      secondaryAxisPoint: [0, -5, 0] as [number, number, number],
      expectedNormal: [0, 0, -1],
      expectedXDirection: [1, 0, 0],
    },
    {
      name: "secondary-major axes",
      primaryAxisPoint: [5, 0, 0] as [number, number, number],
      secondaryAxisPoint: [0, 10, 0] as [number, number, number],
      expectedNormal: [0, 0, 1],
      expectedXDirection: [0, 1, 0],
    },
  ])("preserves the authored sweep for $name", (fixture) => {
    const parameters = ellipticalArcKernelParameters({
      center,
      end: [-fixture.primaryAxisPoint[0], 0, 0],
      normal,
      primaryAxisPoint: fixture.primaryAxisPoint,
      reverse: false,
      secondaryAxisPoint: fixture.secondaryAxisPoint,
      start: fixture.primaryAxisPoint,
    })

    expect(parameters.normal).toEqual(fixture.expectedNormal)
    expect(parameters.xDirection).toEqual(fixture.expectedXDirection)
    expect(parameters.endParameter - parameters.startParameter).toBeCloseTo(Math.PI, 12)
  })

  it("reverses both traversal and kernel normal for a reversed loop", () => {
    const parameters = ellipticalArcKernelParameters({
      center,
      end: [-10, 0, 0],
      normal,
      primaryAxisPoint: [10, 0, 0],
      reverse: true,
      secondaryAxisPoint: [0, 5, 0],
      start: [10, 0, 0],
    })

    expect(parameters.normal).toEqual([0, 0, -1])
    expect(parameters.endParameter - parameters.startParameter).toBeCloseTo(Math.PI, 12)
  })
})
