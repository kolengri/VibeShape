import { describe, expect, it } from "bun:test"
import {
  assemblyAuthoritySchema,
  emptyAssemblyAuthority,
  projectAssemblyAuthority,
} from "./assembly-authority"
import { assemblyJointRecordSchema } from "./assembly-mates"
import {
  assemblyMotionStudyChanges,
  assemblyMotionStudySchema,
  assemblyMotionTimes,
  validateAssemblyMotionStudies,
} from "./assembly-motion-study"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const joint = assemblyJointRecordSchema.parse({
  schemaVersion: 2,
  id: id(1),
  kind: "cylindrical",
  parentInstanceId: id(2),
  childInstanceId: id(3),
  parentFrame: pose,
  childFrame: pose,
  axis: [0, 0, -1],
  angle: 0,
  angleLimits: { min: -1, max: 1 },
  rotationDriven: false,
  translation: 0,
  translationLimits: { min: -20, max: 20 },
  translationDriven: false,
})
const study = () =>
  assemblyMotionStudySchema.parse({
    schemaVersion: 1,
    id: id(4),
    name: "Slide and turn",
    duration: 10,
    tracks: [
      {
        id: id(5),
        jointId: id(1),
        coordinate: "angle",
        keys: [
          { time: 2, value: -1 },
          { time: 8, value: 1 },
        ],
      },
      {
        id: id(6),
        jointId: id(1),
        coordinate: "translation",
        keys: [
          { time: 0, value: 20 },
          { time: 10, value: -20 },
        ],
      },
    ],
  })
describe("assembly motion study authority", () => {
  it("evaluates independent joint tracks at one time and emits their merged replacements in stable identity order", () => {
    const input = study(),
      second = assemblyJointRecordSchema.parse({ ...joint, id: id(10), childInstanceId: id(11) })
    input.tracks.push({
      id: id(12),
      jointId: second.id,
      coordinate: "angle",
      keys: [
        { time: 0, value: -0.5 },
        { time: 10, value: 0.5 },
      ],
    })
    const changes = assemblyMotionStudyChanges(input, [second, joint], 2.5)
    expect(changes.map(({ joint }) => joint.id)).toEqual([joint.id, second.id])
    expect(changes[0]?.joint).toMatchObject({ angle: -5 / 6, translation: 10 })
    expect(changes[1]?.joint).toMatchObject({ angle: -0.25, translation: 0 })
    expect(second).toMatchObject({ angle: 0, translation: 0, rotationDriven: false })
  })
  it("holds key endpoints and interpolates simultaneous cylindrical coordinates in one mutation", () => {
    const input = study(),
      before = structuredClone(joint)
    expect(assemblyMotionStudyChanges(input, [joint], 0)).toEqual([
      {
        kind: "joint.update",
        joint: {
          ...assemblyJointRecordSchema.parse({
            ...joint,
            angle: -1,
            translation: 20,
            rotationDriven: true,
            translationDriven: true,
          }),
        },
      },
    ])
    expect(assemblyMotionStudyChanges(input, [joint], 5)).toEqual([
      {
        kind: "joint.update",
        joint: {
          ...assemblyJointRecordSchema.parse({
            ...joint,
            angle: 0,
            translation: 0,
            rotationDriven: true,
            translationDriven: true,
          }),
        },
      },
    ])
    expect(assemblyMotionStudyChanges(input, [joint], 10)[0]?.joint).toMatchObject({
      angle: 1,
      translation: -20,
    })
    expect(joint).toEqual(before)
  })
  it("fails closed for missing joints, incompatible coordinates, limits and invalid time", () => {
    expect(() => assemblyMotionStudyChanges(study(), [], 0)).toThrow("missing joint")
    const invalid = study()
    const key = invalid.tracks[0]?.keys[0]
    if (!key) throw new Error("The study fixture requires a key.")
    key.value = -2
    expect(() => validateAssemblyMotionStudies([invalid], [joint])).toThrow("limits")
    for (const time of [-1, 11, NaN, Infinity])
      expect(() => assemblyMotionStudyChanges(study(), [joint], time)).toThrow()
    const fixed = assemblyJointRecordSchema.parse({
      schemaVersion: 2,
      id: id(1),
      kind: "fixed",
      parentInstanceId: id(2),
      childInstanceId: id(3),
      parentFrame: pose,
      childFrame: pose,
    })
    expect(() => assemblyMotionStudyChanges(study(), [fixed], 5)).toThrow("coordinate")
  })
  it("rejects duplicate coordinates, unordered keys, excess durations and unknown fields", () => {
    const input = study(),
      first = input.tracks[0]
    if (!first) throw new Error("The study fixture requires a track.")
    for (const modified of [
      { ...input, tracks: [first, { ...first, id: id(7) }] },
      {
        ...input,
        tracks: [
          {
            ...first,
            keys: [
              { time: 3, value: 0 },
              { time: 2, value: 1 },
            ],
          },
        ],
      },
      { ...input, duration: 3601 },
      { ...input, extra: true },
      { ...input, duration: 1 },
    ])
      expect(assemblyMotionStudySchema.safeParse(modified).success).toBe(false)
  })
  it("preserves absent old-file authority and projects only solver-owned fields", () => {
    const legacy = emptyAssemblyAuthority()
    expect(assemblyAuthoritySchema.parse(legacy)).toEqual(legacy)
    expect(Object.hasOwn(assemblyAuthoritySchema.parse(legacy), "motionStudies")).toBe(false)
    expect(projectAssemblyAuthority({ ...legacy, motionStudies: [] })).toEqual({
      schemaVersion: 1,
      definitions: [],
      instances: [],
      joints: [],
    })
  })
  it("samples both exact endpoints in either direction with bounded cardinality", () => {
    expect(assemblyMotionTimes(7, 4)).toEqual([0, 7 / 3, 14 / 3, 7])
    expect(assemblyMotionTimes(7, 4, true)).toEqual([7, 14 / 3, 7 / 3, 0])
    for (const count of [1, 257, 2.5]) expect(() => assemblyMotionTimes(7, count)).toThrow()
  })
})
