import { beforeAll, describe, expect, test } from "bun:test"
import { type AssemblyMateGraph, assemblyMateGraphSchema } from "@vibeshape/domain/assembly-mates"
import createNativeSolver from "../runtime/vibeshape_slvs.mjs"
import type { NativeSketchSolverModule } from "./abi"
import { solveAssemblyConstraints } from "./assembly"

let module: NativeSketchSolverModule
beforeAll(async () => {
  module = await createNativeSolver({
    locateFile: (path) =>
      path.endsWith(".wasm")
        ? new URL("../runtime/vibeshape_slvs.wasm", import.meta.url).pathname
        : path,
  })
})
const id = (n: number) => `018f0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
const pose = (x = 0, y = 0, angle = 0) => ({
  translation: [x, y, 0],
  quaternion: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
})
function definition() {
  return {
    schemaVersion: 1,
    id: id(1),
    name: "Link",
    sourceFrame: pose(),
    sources: [
      {
        kind: "part",
        partId: id(2),
        body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
        contentHash: "a".repeat(64),
      },
    ],
  }
}
function occurrence(n: number, grounded: boolean, x = 0, y = 0, angle = 0) {
  return {
    schemaVersion: 2,
    id: id(n),
    definitionId: id(1),
    name: `Link ${n}`,
    grounded,
    ...(grounded ? { worldFrame: pose(x, y, angle) } : { initialFrame: pose(x, y, angle) }),
  }
}
function mate(n: number, parent: number, child: number, kind: string, parentX = 0, childX = 0) {
  const axial = { axis: [0, 0, 1], value: 0, limits: { min: -6, max: 6 }, driven: false }
  return {
    schemaVersion: 2,
    id: id(n),
    parentInstanceId: id(parent),
    childInstanceId: id(child),
    parentFrame: pose(parentX),
    childFrame: pose(childX),
    kind,
    ...(kind === "revolute" || kind === "prismatic" ? axial : {}),
    ...(kind === "cylindrical"
      ? {
          axis: [0, 0, 1],
          angle: 0,
          angleLimits: { min: -6, max: 6 },
          translation: 0,
          translationLimits: { min: -100, max: 100 },
          rotationDriven: false,
          translationDriven: false,
        }
      : {}),
  }
}
function graph(kind: string) {
  return assemblyMateGraphSchema.parse({
    schemaVersion: 2,
    definitions: [definition()],
    instances: [occurrence(10, true), occurrence(11, false)],
    joints: [mate(20, 10, 11, kind)],
  })
}
function fourBar(driven = false): AssemblyMateGraph {
  const theta = 0.6
  const joints = [
    mate(20, 10, 11, "revolute"),
    mate(21, 11, 12, "revolute", 10),
    mate(22, 12, 13, "revolute", 20, 10),
    mate(23, 10, 13, "revolute", 20),
  ]
  if (driven) Object.assign(joints[0] ?? {}, { driven: true, value: theta })
  return assemblyMateGraphSchema.parse({
    schemaVersion: 2,
    definitions: [definition()],
    instances: [
      occurrence(10, true),
      occurrence(11, false, 0, 0, theta),
      occurrence(12, false, 10 * Math.cos(theta), 10 * Math.sin(theta)),
      occurrence(13, false, 20, 0, theta),
    ],
    joints,
  })
}
describe("native assembly mate constraints", () => {
  test.each([
    ["ball", 3],
    ["cylindrical", 2],
    ["revolute", 1],
    ["prismatic", 1],
    ["fixed", 0],
  ])("reports the physical mobility of a %s mate", (kind, dof) => {
    const result = solveAssemblyConstraints(module, graph(String(kind)))
    expect(result).toMatchObject({
      ok: true,
      degreesOfFreedom: dof,
      status: dof === 0 ? "fully-constrained" : "under-constrained",
    })
  })
  test("solves a redundant closed four-bar loop and distinguishes its driven mobility", () => {
    for (const driven of [false, true]) {
      const result = solveAssemblyConstraints(module, fourBar(driven))
      expect(result).toMatchObject({ ok: true, redundant: true, degreesOfFreedom: driven ? 0 : 1 })
      if (result.ok) {
        expect(result.maximumResidual).toBeLessThan(1e-7)
        expect(
          result.instances.find((i) => i.instanceId === id(13))?.worldFrame.translation[0],
        ).toBeCloseTo(20, 7)
      }
    }
  })
  test("rejects contradictory mates instead of treating redundancy as a valid solution", () => {
    const input = graph("fixed")
    input.joints.push(
      assemblyMateGraphSchema.shape.joints.element.parse(mate(21, 10, 11, "fixed", 1)),
    )
    const result = solveAssemblyConstraints(module, input)
    expect(result).toMatchObject({ ok: false, code: "conflicting-mates" })
    expect(result).not.toHaveProperty("instances")
  })
  test("uses signed arbitrary local 3D frame origins without reflecting a rigid body", () => {
    const input = graph("fixed")
    required(input.joints[0]).parentFrame.translation = [22, 33, 45]
    required(input.joints[0]).childFrame.translation = [2, 3, 5]
    const result = solveAssemblyConstraints(module, input)
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.instances[1]?.worldFrame.translation).toEqual(
        expect.arrayContaining([
          expect.closeTo(20, 7),
          expect.closeTo(30, 7),
          expect.closeTo(40, 7),
        ]),
      )
  })
  test("preserves authored input and deterministic native results across orderings", () => {
    const input = fourBar(true),
      before = JSON.stringify(input)
    const result = solveAssemblyConstraints(module, input)
    expect(
      solveAssemblyConstraints(module, {
        ...input,
        instances: [...input.instances].reverse(),
        joints: [...input.joints].reverse(),
      }),
    ).toEqual(result)
    expect(JSON.stringify(input)).toBe(before)
  })
  test("keeps a floating component explicit instead of inventing a world anchor", () => {
    const input = graph("ball")
    input.instances[0] = assemblyMateGraphSchema.shape.instances.element.parse(
      occurrence(10, false),
    )
    expect(solveAssemblyConstraints(module, input)).toMatchObject({
      ok: false,
      code: "unanchored-component",
    })
  })
  test("aligns an arbitrary passive joint axis before ball mates while preserving free mobility", () => {
    const input = graph("ball"),
      ball = required(input.joints[0])
    ball.parentFrame = { translation: [20, 30, 40], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }
    const cylinder = assemblyMateGraphSchema.shape.joints.element.parse({
      ...mate(21, 10, 11, "cylindrical"),
      parentFrame: ball.parentFrame,
    })
    input.joints.push(cylinder)
    const result = solveAssemblyConstraints(module, input)
    expect(result).toMatchObject({ ok: true, degreesOfFreedom: 1, redundant: true })
    if (result.ok)
      expect(result.instances[1]?.worldFrame.translation).toEqual(
        expect.arrayContaining([
          expect.closeTo(20, 7),
          expect.closeTo(30, 7),
          expect.closeTo(40, 7),
        ]),
      )
  })
  test("rejects a passive coordinate outside its authored limits without clamping", () => {
    const input = graph("cylindrical")
    const instance = input.instances[1]
    if (instance && !instance.grounded) instance.initialFrame.translation = [0, 0, 20]
    const joint = input.joints[0]
    if (joint?.kind === "cylindrical") joint.translationLimits = { min: -5, max: 5 }
    expect(solveAssemblyConstraints(module, input)).toMatchObject({
      ok: false,
      code: "drive-limit",
    })
  })
  test("contains repeated native solves without growing the warmed heap", () => {
    const input = fourBar(true)
    expect(solveAssemblyConstraints(module, input).ok).toBe(true)
    const capacity = module.getHeapCapacityBytes()
    for (let i = 0; i < 100; i++) expect(solveAssemblyConstraints(module, input).ok).toBe(true)
    expect(module.getHeapCapacityBytes()).toBe(capacity)
  })
  test("fails closed on a composed pose beyond the authored world bounds", () => {
    const input = graph("fixed"),
      anchor = required(input.instances[0])
    if (!anchor.grounded) throw new Error("The fixture anchor must be grounded.")
    anchor.worldFrame.translation = [100000, 0, 0]
    required(input.joints[0]).parentFrame.translation = [100000, 0, 0]
    expect(solveAssemblyConstraints(module, input)).toMatchObject({
      ok: false,
      code: "world-bounds",
    })
  })
  test.each([
    [2, "did-not-converge"],
    [3, "solver-budget"],
  ] as const)(
    "preserves native status %s without publishing a partial placement",
    (status, code) => {
      const controlled: NativeSketchSolverModule = {
        ...module,
        solveFlatSystem(...args) {
          return { ...module.solveFlatSystem(...args), solverStatus: status }
        },
      }
      const result = solveAssemblyConstraints(controlled, graph("fixed"))
      expect(result).toMatchObject({ ok: false, code })
      expect(result).not.toHaveProperty("instances")
    },
  )
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture evidence is missing.")
  return value
}
