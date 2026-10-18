import { describe, expect, it } from "bun:test"
import { projectAssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import { solveAssemblyKinematics } from "@vibeshape/domain/assembly-kinematics"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "./assembly-model"
import {
  assemblyMotionChanges,
  assemblyMotionCoordinates,
  assemblyMotionSamples,
  assemblyMotionUnits,
} from "./assembly-motion"
import { assemblyUiFixture } from "./assembly-test-fixture"

function joint(kind: "revolute" | "prismatic" | "cylindrical", schemaVersion = 2) {
  return assemblyJointRecordSchema.parse({
    schemaVersion,
    id: id(503),
    kind,
    parentInstanceId: id(501),
    childInstanceId: id(502),
    parentFrame: identityAssemblyPose,
    childFrame: identityAssemblyPose,
    axis: [0, 0, -1],
    ...(kind === "cylindrical"
      ? {
          angle: 0.1,
          angleLimits: { min: -1, max: 1 },
          rotationDriven: false,
          translation: 5,
          translationLimits: { min: -10, max: 10 },
          translationDriven: false,
        }
      : {
          value: 0,
          limits: { min: -1, max: 1 },
          ...(schemaVersion === 2 ? { driven: false } : {}),
        }),
  })
}
function firstCoordinate(input: ReturnType<typeof joint>) {
  const coordinate = assemblyMotionCoordinates(input)[0]
  if (!coordinate) throw new Error("The motion fixture requires a coordinate.")
  return coordinate
}
describe("Assembly motion coordinate authority", () => {
  it("converts project angle and length units without changing canonical limits", () => {
    const rotation = firstCoordinate(joint("revolute"))
    const slide = firstCoordinate(joint("prismatic"))
    const degrees = assemblyMotionUnits(rotation, { angle: "deg", length: "in" })
    const inches = assemblyMotionUnits(slide, { angle: "deg", length: "in" })
    expect(degrees.canonical(180)).toBe(Math.PI)
    expect(degrees.display(Math.PI / 2)).toBe(90)
    expect(degrees.display(degrees.canonical(30))).toBe(30)
    expect(degrees.canonical(degrees.display(rotation.max))).toBe(rotation.max)
    expect(inches.canonical(2)).toBe(50.8)
    expect(inches.display(25.4)).toBe(1)
    expect(assemblyMotionUnits(rotation, { angle: "rad", length: "mm" }).canonical(0.5)).toBe(0.5)
  })
  it("drives one cylindrical coordinate and preserves the other freedom and frame authority", () => {
    const input = joint("cylindrical")
    if (input.kind !== "cylindrical") throw new Error("Expected a cylindrical fixture.")
    const before = structuredClone(input)
    const [angle, translation] = assemblyMotionCoordinates(input)
    if (!angle || !translation)
      throw new Error("The cylindrical fixture requires both coordinates.")
    expect(assemblyMotionChanges(input, angle, 0.75)).toEqual([
      { kind: "joint.update", joint: { ...input, angle: 0.75, rotationDriven: true } },
    ])
    expect(assemblyMotionChanges(input, translation, -7)).toEqual([
      { kind: "joint.update", joint: { ...input, translation: -7, translationDriven: true } },
    ])
    expect(input).toEqual(before)
  })
  it("keeps inclusive limits and rejects invalid ranges instead of clamping", () => {
    const input = joint("revolute")
    const coordinate = firstCoordinate(input)
    for (const value of [-1, 1])
      expect(assemblyMotionChanges(input, coordinate, value)[0]).toMatchObject({
        kind: "joint.update",
        joint: { value, driven: true },
      })
    for (const value of [-1.01, 1.01, Infinity, Number.NaN])
      expect(() => assemblyMotionChanges(input, coordinate, value)).toThrow()
    for (const [start, end] of [
      [0, 0],
      [1, -1],
      [-2, 0],
      [0, 2],
      [Number.NaN, 1],
    ] as const)
      expect(() => assemblyMotionSamples(coordinate, start, end)).toThrow()
    const values = assemblyMotionSamples(coordinate, -1, 1)
    expect(values).toHaveLength(13)
    expect(values[0]).toBe(-1)
    expect(values.at(-1)).toBe(1)
    expect(values.every((value) => value >= -1 && value <= 1)).toBe(true)
  })
  it("preserves signed-axis kinematics for legacy drive coordinates without mutating the source graph", () => {
    const f = assemblyUiFixture()
    const floating = {
      schemaVersion: 1,
      id: id(502),
      definitionId: f.definition.id,
      name: "Slider",
      grounded: false,
    }
    const input = joint("prismatic", 1)
    const graph = { ...f.assembly, instances: [f.parent, floating], joints: [input] }
    const coordinate = firstCoordinate(input)
    const change = assemblyMotionChanges(input, coordinate, 1)[0]
    if (change?.kind !== "joint.update") throw new Error("Expected joint update.")
    const solved = solveAssemblyKinematics({
      ...projectAssemblyAuthority(f.assembly),
      instances: graph.instances,
      joints: [change.joint],
    })
    expect(solved.ok).toBe(true)
    if (solved.ok)
      expect(
        solved.instances.find(({ instanceId }) => instanceId === id(502))?.worldFrame.translation,
      ).toEqual([0, 0, -1])
    expect(input).toMatchObject({ schemaVersion: 1, value: 0 })
  })
})
