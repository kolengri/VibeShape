import { describe, expect, it } from "bun:test"
import type { AssemblyQuaternion, AssemblyRigidPose, AssemblyVector3 } from "./assembly"
import { solveAssemblyKinematics } from "./assembly-kinematics"

const id = (number: number) => `01900000-0000-7000-8000-${number.toString(16).padStart(12, "0")}`
const rigid = (
  translation: AssemblyVector3 = [0, 0, 0],
  quaternion: AssemblyQuaternion = [0, 0, 0, 1],
): AssemblyRigidPose => ({ translation, quaternion })
const half = Math.SQRT1_2
const xQuarter: AssemblyQuaternion = [half, 0, 0, half]
const yQuarter: AssemblyQuaternion = [0, half, 0, half]
const zQuarter: AssemblyQuaternion = [0, 0, half, half]
const definition = (sourceFrame = rigid()) => ({
  schemaVersion: 1,
  id: id(1),
  name: "Pinned link",
  sources: [
    {
      kind: "part",
      partId: id(500),
      body: { schemaVersion: 0, featureId: id(600), outputRole: "body" },
      contentHash: "a".repeat(64),
    },
  ],
  sourceFrame,
})
const grounded = (number = 10, worldFrame = rigid()) => ({
  schemaVersion: 1,
  id: id(number),
  definitionId: id(1),
  name: "Grounded link",
  grounded: true,
  worldFrame,
})
const child = (number = 20) => ({
  schemaVersion: 1,
  id: id(number),
  definitionId: id(1),
  name: "Moving link",
  grounded: false,
})
const fixed = (number = 100, parent = 10, target = 20) => ({
  schemaVersion: 1,
  id: id(number),
  parentInstanceId: id(parent),
  childInstanceId: id(target),
  parentFrame: rigid(),
  childFrame: rigid(),
  kind: "fixed",
})
const model = () => ({
  schemaVersion: 1,
  definitions: [definition()],
  instances: [grounded(), child()],
  joints: [fixed()],
})
function solved(raw: unknown) {
  const result = solveAssemblyKinematics(raw)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}
function occurrence(raw: unknown, number = 20) {
  const output = solved(raw).instances.find((entry) => entry.instanceId === id(number))
  if (!output) throw new Error("The solved occurrence must exist.")
  return output
}
function expectVector(actual: AssemblyVector3, expected: AssemblyVector3) {
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 9)
  })
}
// Independent quaternion-to-matrix oracle checks orientation and active handedness.
function transformedPoint(pose: AssemblyRigidPose, point: AssemblyVector3): AssemblyVector3 {
  const [x, y, z, w] = pose.quaternion
  const [a, b, c] = point
  return [
    (1 - 2 * (y * y + z * z)) * a +
      2 * (x * y - z * w) * b +
      2 * (x * z + y * w) * c +
      pose.translation[0],
    2 * (x * y + z * w) * a +
      (1 - 2 * (x * x + z * z)) * b +
      2 * (y * z - x * w) * c +
      pose.translation[1],
    2 * (x * z - y * w) * a +
      2 * (y * z + x * w) * b +
      (1 - 2 * (x * x + y * y)) * c +
      pose.translation[2],
  ]
}
function expectFailure(raw: unknown, code: string) {
  const result = solveAssemblyKinematics(raw)
  expect(result).toMatchObject({ ok: false, diagnostic: { code } })
  if (result.ok) throw new Error("The fixture must fail.")
  expect(result.diagnostic.issues.length).toBeGreaterThan(0)
  return result.diagnostic
}

describe("grounded assembly frame composition", () => {
  it("composes parent, local joint frames and inverse child frame", () => {
    const raw = model()
    raw.instances = [grounded(10, rigid([10, 20, 30], zQuarter)), child()]
    raw.joints = [{ ...fixed(), parentFrame: rigid([2, 0, 0]), childFrame: rigid([0, 3, 0]) }]
    const frame = occurrence(raw).worldFrame
    expectVector(frame.translation, [13, 22, 30])
    expectVector(transformedPoint(frame, [1, 0, 0]), [13, 23, 30])
  })

  it("applies noncommuting parent and joint rotations in the authored order", () => {
    const raw = model()
    raw.instances = [grounded(10, rigid([0, 0, 0], xQuarter)), child()]
    raw.joints = [{ ...fixed(), parentFrame: rigid([0, 0, 0], yQuarter) }]
    const frame = occurrence(raw).worldFrame
    expectVector(transformedPoint(frame, [1, 0, 0]), [0, 1, 0])
    expectVector(transformedPoint(frame, [0, 1, 0]), [0, 0, 1])
    expectVector(transformedPoint(frame, [0, 0, 1]), [1, 0, 0])
  })

  it("inverts the complete rotated child frame rather than only its translation", () => {
    const raw = model()
    raw.joints = [{ ...fixed(), childFrame: rigid([2, 0, 0], zQuarter) }]
    const frame = occurrence(raw).worldFrame
    expectVector(frame.translation, [0, 2, 0])
    expectVector(transformedPoint(frame, [2, 0, 0]), [0, 0, 0])
    expectVector(transformedPoint(frame, [2, 1, 0]), [1, 0, 0])
  })

  it("maps original source coordinates through the inverse definition frame", () => {
    const raw = model()
    raw.definitions = [definition(rigid([10, 0, 0], zQuarter))]
    raw.instances = [grounded(10, rigid([50, 0, 0], zQuarter)), child()]
    const output = occurrence(raw, 10)
    expectVector(output.geometryFrame.translation, [40, 0, 0])
    expectVector(transformedPoint(output.geometryFrame, [10, 0, 0]), [50, 0, 0])
    expectVector(transformedPoint(output.geometryFrame, [10, 2, 0]), [50, 2, 0])
    expectVector(output.worldFrame.translation, [50, 0, 0])
  })

  it.each([
    { axis: [1, 0, 0], point: [0, 1, 0], expected: [0, 0, 1] },
    { axis: [0, 1, 0], point: [0, 0, 1], expected: [1, 0, 0] },
    { axis: [0, 0, 1], point: [1, 0, 0], expected: [0, 1, 0] },
  ])("uses right-handed positive revolute rotation around $axis", ({ axis, point, expected }) => {
    const raw = {
      ...model(),
      joints: [
        {
          ...fixed(),
          kind: "revolute",
          axis,
          value: Math.PI / 2,
          limits: { min: -Math.PI, max: Math.PI },
        },
      ],
    }
    expectVector(
      transformedPoint(occurrence(raw).worldFrame, point as [number, number, number]),
      expected as [number, number, number],
    )
  })

  it("rotates an offset child about the exact joint origin", () => {
    const joint = {
      ...fixed(),
      kind: "revolute",
      axis: [0, 0, 10],
      value: Math.PI / 2,
      limits: { min: -Math.PI, max: Math.PI },
      parentFrame: rigid([3, 4, 0]),
      childFrame: rigid([2, 0, 0]),
    }
    const frame = occurrence({ ...model(), joints: [joint] }).worldFrame
    expectVector(frame.translation, [3, 2, 0])
    expectVector(transformedPoint(frame, [2, 0, 0]), [3, 4, 0])
  })

  it("respects negative axes and signed angle drives", () => {
    const joint = {
      ...fixed(),
      kind: "revolute",
      axis: [0, 0, -2],
      value: -Math.PI / 2,
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
    }
    expectVector(
      transformedPoint(occurrence({ ...model(), joints: [joint] }).worldFrame, [1, 0, 0]),
      [0, 1, 0],
    )
  })

  it("moves along a normalized axis in the rotated parent joint frame", () => {
    const joint = {
      ...fixed(),
      kind: "prismatic",
      axis: [1, 1, 0],
      value: Math.SQRT2,
      limits: { min: -2, max: 2 },
      parentFrame: rigid([3, 4, 5], zQuarter),
    }
    const frame = occurrence({ ...model(), joints: [joint] }).worldFrame
    expectVector(frame.translation, [2, 5, 5])
    expectVector(transformedPoint(frame, [1, 0, 0]), [2, 6, 5])
  })

  it("accepts both closed prismatic limits without clamping the drive", () => {
    const joint = {
      ...fixed(),
      kind: "prismatic",
      axis: [1, 0, 0],
      value: -2,
      limits: { min: -2, max: 2 },
    }
    expectVector(occurrence({ ...model(), joints: [joint] }).worldFrame.translation, [-2, 0, 0])
    expectVector(
      occurrence({ ...model(), joints: [{ ...joint, value: 2 }] }).worldFrame.translation,
      [2, 0, 0],
    )
  })
})

describe("deterministic bounded assembly evaluation", () => {
  it("orders roots and siblings by UUID while preserving independent occurrence poses", () => {
    const raw = {
      ...model(),
      instances: [
        child(40),
        grounded(30, rigid([7, 0, 0])),
        child(20),
        grounded(10, rigid([1, 0, 0])),
      ],
      joints: [fixed(102, 10, 40), fixed(101, 10, 20)],
    }
    const result = solved(raw)
    expect(result.evaluationOrder).toEqual<unknown>([id(10), id(30), id(20), id(40)])
    expect(result.instances.map((entry) => entry.instanceId)).toEqual<unknown>([
      id(10),
      id(20),
      id(30),
      id(40),
    ])
    expectVector(occurrence(raw, 30).worldFrame.translation, [7, 0, 0])
    expectVector(occurrence(raw, 20).worldFrame.translation, [1, 0, 0])
    expect(
      solved({
        ...raw,
        instances: [...raw.instances].reverse(),
        joints: [...raw.joints].reverse(),
      }),
    ).toEqual(result)
  })

  it("evaluates a full 256-occurrence chain without floating or omitted nodes", () => {
    const instances = [
      grounded(10),
      ...Array.from({ length: 255 }, (_, index) => child(index + 11)),
    ]
    const joints = Array.from({ length: 255 }, (_, index) => ({
      ...fixed(index + 1000, index + 10, index + 11),
      parentFrame: rigid([1, 0, 0]),
    }))
    const result = solved({ ...model(), instances, joints })
    expect(result.instances).toHaveLength(256)
    expect(result.evaluationOrder).toHaveLength(256)
    expectVector(
      occurrence({ ...model(), instances, joints }, 265).worldFrame.translation,
      [255, 0, 0],
    )
  })

  it("returns a valid empty solution", () => {
    expect(solved({ schemaVersion: 1, definitions: [], instances: [], joints: [] })).toEqual({
      ok: true,
      instances: [],
      evaluationOrder: [],
    })
  })

  it("fails when chained occurrence origins exceed the world budget", () => {
    const raw = {
      ...model(),
      instances: [grounded(10, rigid([100_000, 0, 0])), child()],
      joints: [{ ...fixed(), parentFrame: rigid([1, 0, 0]) }],
    }
    expectFailure(raw, "world-bounds")
  })

  it("canonicalizes only tiny composition roundoff at an exact world boundary", () => {
    const raw = {
      ...model(),
      instances: [grounded(10, rigid([0, 0, 0], zQuarter)), child()],
      joints: [{ ...fixed(), parentFrame: rigid([0, -100_000, 0]) }],
    }
    expect(occurrence(raw).worldFrame.translation[0]).toBe(100_000)
    expectFailure(
      {
        ...model(),
        instances: [grounded(10, rigid([100_000, 0, 0])), child()],
        joints: [{ ...fixed(), parentFrame: rigid([1e-8, 0, 0]) }],
      },
      "world-bounds",
    )
  })

  it("checks the transformed source origin as well as the occurrence origin", () => {
    const raw = {
      ...model(),
      definitions: [definition(rigid([-100_000, 0, 0]))],
      instances: [grounded(10, rigid([1, 0, 0]))],
      joints: [],
    }
    const diagnostic = expectFailure(raw, "world-bounds")
    expect(diagnostic.issues[0]?.path).toContain("geometryFrame")
  })

  it("budgets final frame origins even when joint translations cancel", () => {
    const raw = {
      ...model(),
      instances: [grounded(10, rigid([100_000, 0, 0])), child()],
      joints: [
        { ...fixed(), parentFrame: rigid([100_000, 0, 0]), childFrame: rigid([100_000, 0, 0]) },
      ],
    }
    expectVector(occurrence(raw).worldFrame.translation, [100_000, 0, 0])
  })

  it("returns explicit grounded forest and drive diagnostics", () => {
    expectFailure({ ...model(), joints: [] }, "ungrounded-root")
    expectFailure({ ...model(), instances: [grounded(), grounded(20)] }, "grounded-child")
    expectFailure({ ...model(), definitions: [] }, "missing-definition")
    expectFailure({ ...model(), joints: [fixed(100, 99, 20)] }, "missing-instance")
    expectFailure({ ...model(), joints: [fixed(), fixed(101)] }, "multiple-parents")
    expectFailure(
      { ...model(), instances: [child(10), child(20)], joints: [fixed(), fixed(101, 20, 10)] },
      "cycle",
    )
    expectFailure(
      {
        ...model(),
        joints: [
          { ...fixed(), kind: "prismatic", axis: [1, 0, 0], value: 3, limits: { min: -2, max: 2 } },
        ],
      },
      "drive-limit",
    )
  })

  it("rejects malformed and nonfinite input without partial solutions", () => {
    expectFailure(undefined, "invalid-assembly")
    expectFailure({ ...model(), instances: [grounded(10, rigid([NaN, 0, 0]))] }, "invalid-assembly")
    expectFailure(
      {
        ...model(),
        joints: [
          {
            ...fixed(),
            kind: "revolute",
            axis: [0, 0, 1],
            value: Infinity,
            limits: { min: -1, max: 1 },
          },
        ],
      },
      "invalid-assembly",
    )
  })

  it("never mutates source definitions, instances, joints or their nested frames", () => {
    const raw = model()
    const original: unknown = JSON.parse(JSON.stringify(raw))
    raw.definitions.forEach((entry) => {
      Object.freeze(entry.sourceFrame.translation)
      Object.freeze(entry.sourceFrame.quaternion)
      Object.freeze(entry.sourceFrame)
      Object.freeze(entry.sources[0]?.body)
      Object.freeze(entry.sources[0])
      Object.freeze(entry.sources)
      Object.freeze(entry)
    })
    raw.instances.forEach(Object.freeze)
    raw.joints.forEach(Object.freeze)
    Object.freeze(raw.definitions)
    Object.freeze(raw.instances)
    Object.freeze(raw.joints)
    Object.freeze(raw)
    solved(raw)
    expect(raw).toEqual<unknown>(original)
  })
})
