import { describe, expect, it } from "vitest"
import {
  assemblyDefinitionIdSchema,
  assemblyDefinitionSchema,
  assemblyInstanceIdSchema,
  assemblyInstanceSchema,
  assemblyJointIdSchema,
  assemblyJointSchema,
  assemblyRigidPoseSchema,
  assemblySchema,
  assemblySourceSchema,
} from "./assembly"

const id = (number: number) => `01900000-0000-7000-8000-${number.toString(16).padStart(12, "0")}`
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const partSource = (number = 500) => ({
  kind: "part",
  partId: id(number),
  body: { schemaVersion: 0, featureId: id(600), outputRole: "split.negative" },
  contentHash: "a".repeat(64),
})
const definition = (number = 1) => ({
  schemaVersion: 1,
  id: id(number),
  name: "Bracket definition",
  sources: [partSource()],
  sourceFrame: pose,
})
const instance = (number = 10, grounded = true) => ({
  schemaVersion: 1,
  id: id(number),
  definitionId: id(1),
  name: "Bracket occurrence",
  grounded,
  ...(grounded ? { worldFrame: pose } : {}),
})
const fixedJoint = (number = 100, parent = 10, child = 20) => ({
  schemaVersion: 1,
  id: id(number),
  parentInstanceId: id(parent),
  childInstanceId: id(child),
  kind: "fixed",
  parentFrame: pose,
  childFrame: pose,
})
const assembly = () => ({
  schemaVersion: 1,
  definitions: [definition()],
  instances: [instance(), instance(20, false)],
  joints: [fixedJoint()],
})
function diagnosticCodes(raw: unknown) {
  const result = assemblySchema.safeParse(raw)
  expect(result.success).toBe(false)
  if (result.success) throw new Error("The fixture must be invalid.")
  return result.error.issues.map((issue) =>
    issue.code === "custom" ? issue.params?.assemblyCode : "invalid-assembly",
  )
}

describe("assembly rigid pose boundary", () => {
  it("normalizes non-unit quaternions and chooses the same canonical sign", () => {
    const positive = assemblyRigidPoseSchema.parse({ ...pose, quaternion: [1, 2, 3, 4] })
    const negative = assemblyRigidPoseSchema.parse({ ...pose, quaternion: [-1, -2, -3, -4] })
    expect(positive).toEqual(negative)
    expect(Math.hypot(...positive.quaternion)).toBeCloseTo(1, 15)
  })

  it("canonicalizes half-turns and signed zero without changing handedness", () => {
    const parsed = assemblyRigidPoseSchema.parse({
      translation: [-0, 0, -0],
      quaternion: [-2, -0, 0, -0],
    })
    expect(parsed).toEqual({ translation: [0, 0, 0], quaternion: [1, 0, 0, 0] })
    expect(parsed.quaternion.every((component) => !Object.is(component, -0))).toBe(true)
  })

  it("canonicalizes after negligible components underflow during normalization", () => {
    const parsed = assemblyRigidPoseSchema.parse({ ...pose, quaternion: [-1e308, 0, 0, 1e-308] })
    expect(parsed.quaternion).toEqual([1, 0, 0, 0])
  })

  it("keeps canonical quaternion reads idempotent across a finite scale matrix", () => {
    for (let i = 1; i <= 100; i += 1) {
      const canonical = assemblyRigidPoseSchema.parse({
        ...pose,
        quaternion: [i / 13, i / 17, i / 19, i / 23],
      })
      expect(assemblyRigidPoseSchema.parse(canonical)).toEqual(canonical)
    }
  })

  it.each([
    [0, 0, 0, 0],
    [1e-13, 0, 0, 0],
    [Infinity, 0, 0, 1],
    [NaN, 0, 0, 1],
    [1e308, 1e308, 1e308, 1e308],
  ])("rejects undefined or nonfinite quaternion directions %j", (...quaternion) => {
    expect(assemblyRigidPoseSchema.safeParse({ ...pose, quaternion }).success).toBe(false)
  })

  it.each([-100_001, 100_001, Infinity, NaN])(
    "rejects translation outside the finite budget %s",
    (x) => {
      expect(assemblyRigidPoseSchema.safeParse({ ...pose, translation: [x, 0, 0] }).success).toBe(
        false,
      )
    },
  )

  it("accepts closed coordinate boundaries and rejects matrices or extra fields", () => {
    expect(
      assemblyRigidPoseSchema.parse({ ...pose, translation: [-100_000, 100_000, 0] }).translation,
    ).toEqual([-100_000, 100_000, 0])
    expect(assemblyRigidPoseSchema.safeParse({ ...pose, matrix: [] }).success).toBe(false)
    expect(
      assemblyRigidPoseSchema.safeParse({ translation: [0, 0, 0], quaternion: [0, 0, 1] }).success,
    ).toBe(false)
  })
})

describe("versioned assembly declarations", () => {
  it("preserves ordered exact source pins and independent occurrences", () => {
    const raw = assembly()
    raw.definitions = [{ ...definition(), sources: [partSource(), partSource(501)] }]
    const parsed = assemblySchema.parse(raw)
    expect(
      parsed.definitions[0]?.sources.map((source) => source.kind === "part" && source.partId),
    ).toEqual([id(500), id(501)])
    expect(parsed.instances.map((entry) => entry.id)).toEqual([id(10), id(20)])
    expect(parsed.definitions[0]?.sources[0]).toEqual(partSource())
  })

  it("accepts an immutable source asset output pin", () => {
    const source = {
      kind: "asset-output",
      assetId: id(700),
      outputId: id(701),
      digest: "b".repeat(64),
    }
    expect(assemblySourceSchema.parse(source)).toEqual(source)
  })

  it.each([
    { kind: "part", partId: id(500) },
    { ...partSource(), contentHash: "A".repeat(64) },
    { ...partSource(), body: { schemaVersion: 0, featureId: id(600), outputRole: "Face 1" } },
    { kind: "asset-output", assetId: id(700), outputId: 0, digest: "b".repeat(64) },
    { ...partSource(), ordinal: 0 },
  ])("rejects unpinned, malformed or ordinal source identities %#", (source) => {
    expect(assemblySourceSchema.safeParse(source).success).toBe(false)
  })

  it("requires sources and rejects repeated source identities", () => {
    expect(assemblyDefinitionSchema.safeParse({ ...definition(), sources: [] }).success).toBe(false)
    expect(
      diagnosticCodes({
        ...assembly(),
        definitions: [{ ...definition(), sources: [partSource(), partSource()] }],
      }),
    ).toContain("duplicate-source")
  })

  it("requires independently authored definition and occurrence IDs", () => {
    const raw = assembly()
    raw.instances = [instance(500), instance(20, false)]
    raw.joints = [fixedJoint(100, 500, 20)]
    expect(diagnosticCodes(raw)).toContain("identity-reuse")
    expect(diagnosticCodes({ ...assembly(), definitions: [definition(500)] })).toContain(
      "identity-reuse",
    )
  })

  it.each([assemblyDefinitionIdSchema, assemblyInstanceIdSchema, assemblyJointIdSchema])(
    "uses lowercase UUIDv7 identity schemas %#",
    (schema) => {
      expect(schema.safeParse(id(1)).success).toBe(true)
      expect(schema.safeParse("01900000-0000-4000-8000-000000000001").success).toBe(false)
      expect(schema.safeParse("019AAAAA-0000-7000-8000-000000000001").success).toBe(false)
    },
  )

  it("version-checks all records and keeps grounded pose authority explicit", () => {
    expect(assemblySchema.safeParse({ ...assembly(), schemaVersion: 0 }).success).toBe(false)
    expect(assemblyDefinitionSchema.safeParse({ ...definition(), schemaVersion: 0 }).success).toBe(
      false,
    )
    expect(assemblyInstanceSchema.safeParse({ ...instance(), schemaVersion: 0 }).success).toBe(
      false,
    )
    expect(assemblyJointSchema.safeParse({ ...fixedJoint(), schemaVersion: 0 }).success).toBe(false)
    expect(
      assemblyInstanceSchema.safeParse({ ...instance(20, false), worldFrame: pose }).success,
    ).toBe(false)
    expect(assemblyInstanceSchema.safeParse({ ...instance(), worldFrame: undefined }).success).toBe(
      false,
    )
  })

  it("bounds definitions, occurrences, joints and per-definition sources", () => {
    expect(
      assemblySchema.safeParse({
        ...assembly(),
        definitions: Array.from({ length: 257 }, (_, i) => definition(i + 1)),
      }).success,
    ).toBe(false)
    expect(
      assemblySchema.safeParse({
        ...assembly(),
        instances: Array.from({ length: 257 }, (_, i) => instance(i + 10)),
      }).success,
    ).toBe(false)
    expect(
      assemblySchema.safeParse({
        ...assembly(),
        joints: Array.from({ length: 256 }, (_, i) => fixedJoint(i + 100)),
      }).success,
    ).toBe(false)
    expect(
      assemblyDefinitionSchema.safeParse({
        ...definition(),
        sources: Array.from({ length: 257 }, (_, i) => partSource(i + 500)),
      }).success,
    ).toBe(false)
  })

  it("bounds total pinned source bindings across definitions", () => {
    const definitions = Array.from({ length: 17 }, (_, i) => ({
      ...definition(i + 1),
      sources: Array.from({ length: 256 }, (_, j) => partSource(j + 500)),
    }))
    expect(diagnosticCodes({ schemaVersion: 1, definitions, instances: [], joints: [] })).toContain(
      "source-budget",
    )
  })

  it("permits an empty initial assembly", () => {
    expect(
      assemblySchema.parse({ schemaVersion: 1, definitions: [], instances: [], joints: [] }),
    ).toEqual({ schemaVersion: 1, definitions: [], instances: [], joints: [] })
  })
})

describe("grounded directed forest validation", () => {
  it("accepts multiple independent grounded trees", () => {
    const raw = assembly()
    raw.instances.push(instance(30))
    expect(assemblySchema.safeParse(raw).success).toBe(true)
  })

  it.each([
    { ...assembly(), definitions: [definition(), definition()] },
    { ...assembly(), instances: [instance(), instance(), instance(20, false)] },
    { ...assembly(), joints: [fixedJoint(), fixedJoint()] },
  ])("rejects duplicate collection identities %#", (raw) => {
    expect(diagnosticCodes(raw)).toContain("duplicate-id")
  })

  it("rejects missing definitions and joint endpoints", () => {
    expect(diagnosticCodes({ ...assembly(), definitions: [] })).toContain("missing-definition")
    expect(diagnosticCodes({ ...assembly(), joints: [fixedJoint(100, 10, 99)] })).toContain(
      "missing-instance",
    )
  })

  it("rejects self joints", () => {
    expect(diagnosticCodes({ ...assembly(), joints: [fixedJoint(100, 10, 10)] })).toContain(
      "self-joint",
    )
  })

  it("rejects floating roots and grounded children", () => {
    expect(diagnosticCodes({ ...assembly(), joints: [] })).toContain("ungrounded-root")
    expect(diagnosticCodes({ ...assembly(), instances: [instance(), instance(20)] })).toContain(
      "grounded-child",
    )
  })

  it("rejects different parents and redundant constraints on the same child", () => {
    const raw = assembly()
    raw.instances.push(instance(30))
    raw.joints.push(fixedJoint(101, 30, 20))
    expect(diagnosticCodes(raw)).toContain("multiple-parents")
    raw.joints[1] = fixedJoint(101, 10, 20)
    expect(diagnosticCodes(raw)).toContain("multiple-parents")
  })

  it("rejects an ungrounded cycle with otherwise valid endpoints", () => {
    const raw = assembly()
    raw.instances = [instance(10, false), instance(20, false), instance(30, false)]
    raw.joints = [fixedJoint(100, 10, 20), fixedJoint(101, 20, 30), fixedJoint(102, 30, 10)]
    expect(diagnosticCodes(raw)).toContain("cycle")
  })
})

describe("static joint drive boundary", () => {
  const revolute = () => ({
    ...fixedJoint(),
    kind: "revolute",
    axis: [0, 0, -10],
    value: -Math.PI,
    limits: { min: -Math.PI, max: Math.PI },
  })
  const prismatic = () => ({
    ...fixedJoint(),
    kind: "prismatic",
    axis: [1, 1, 0],
    value: 100_000,
    limits: { min: -100_000, max: 100_000 },
  })

  it("normalizes local axes without reversing their signs and accepts inclusive limits", () => {
    expect(assemblyJointSchema.parse(revolute())).toMatchObject({
      axis: [0, 0, -1],
      value: -Math.PI,
    })
    const parsed = assemblyJointSchema.parse(prismatic())
    expect(parsed.kind).toBe("prismatic")
    if (parsed.kind !== "prismatic") throw new Error("Expected a prismatic joint.")
    expect(parsed.axis[0]).toBeCloseTo(1 / Math.SQRT2, 15)
    expect(parsed.value).toBe(100_000)
  })

  it.each([
    [0, 0, 0],
    [1e-13, 0, 0],
    [NaN, 0, 1],
    [Infinity, 0, 1],
  ])("rejects invalid axes %j", (...axis) => {
    expect(assemblyJointSchema.safeParse({ ...revolute(), axis }).success).toBe(false)
  })

  it("rejects nonfinite drives, out-of-budget limits and drive-limit violations", () => {
    expect(assemblyJointSchema.safeParse({ ...revolute(), value: Infinity }).success).toBe(false)
    expect(assemblyJointSchema.safeParse({ ...revolute(), value: 3 * Math.PI }).success).toBe(false)
    expect(
      assemblyJointSchema.safeParse({ ...prismatic(), limits: { min: -100_001, max: 100_000 } })
        .success,
    ).toBe(false)
    expect(
      assemblyJointSchema.safeParse({ ...revolute(), limits: { min: 1, max: -1 } }).success,
    ).toBe(false)
    expect(
      diagnosticCodes({ ...assembly(), joints: [{ ...revolute(), value: -Math.PI - 0.1 }] }),
    ).toContain("drive-limit")
  })

  it("rejects redundant degrees of freedom on a fixed joint", () => {
    expect(assemblyJointSchema.safeParse({ ...fixedJoint(), value: 0 }).success).toBe(false)
  })
})
