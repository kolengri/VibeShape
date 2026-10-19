import { z } from "zod"
import { assemblyJointIdSchema } from "./assembly"
import { type AssemblyJointRecord, assemblyJointRecordSchema } from "./assembly-mates"
import { authoredItemNameSchema } from "./parts"

export const assemblyMotionStudyIdSchema = z
  .uuidv7()
  .regex(/^[0-9a-f-]+$/, "Motion identities must be lowercase UUIDv7 values.")
const assemblyMotionTrackSchema = z
  .object({
    id: assemblyMotionStudyIdSchema,
    jointId: assemblyJointIdSchema,
    coordinate: z.enum(["angle", "translation"]),
    keys: z
      .array(
        z
          .object({
            time: z.number().finite().min(0).max(3600),
            value: z.number().finite().min(-100000).max(100000),
          })
          .strict(),
      )
      .min(2)
      .max(256),
  })
  .strict()
  .superRefine((track, context) => {
    if (
      track.keys.some((key, index) => index > 0 && key.time <= (track.keys[index - 1]?.time ?? 0))
    )
      context.addIssue({ code: "custom", message: "Motion key times must be strictly increasing." })
  })
export const assemblyMotionStudySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: assemblyMotionStudyIdSchema,
    name: authoredItemNameSchema,
    duration: z.number().finite().positive().max(3600),
    tracks: z.array(assemblyMotionTrackSchema).min(1).max(64),
  })
  .strict()
  .superRefine((study, context) => {
    const coordinates = study.tracks.map((track) => `${track.jointId}:${track.coordinate}`)
    const ids = study.tracks.map((track) => track.id)
    if (new Set(coordinates).size !== coordinates.length || new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Motion tracks require unique IDs and joint coordinates.",
      })
    if (study.tracks.some((track) => track.keys.some((key) => key.time > study.duration)))
      context.addIssue({
        code: "custom",
        message: "Motion keys must lie within the study duration.",
      })
  })
export const assemblyMotionStudiesSchema = z
  .array(assemblyMotionStudySchema)
  .max(32)
  .superRefine((studies, context) => {
    const ids = studies.flatMap((study) => [study.id, ...study.tracks.map((track) => track.id)])
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Motion studies and tracks require distinct stable IDs.",
      })
    if (
      studies.reduce(
        (total, study) =>
          total + study.tracks.reduce((count, track) => count + track.keys.length, 0),
        0,
      ) > 16384
    )
      context.addIssue({
        code: "custom",
        message: "Motion studies exceed the document's 16384-key budget.",
      })
  })
export type AssemblyMotionStudy = z.infer<typeof assemblyMotionStudySchema>
export type AssemblyMotionTrack = z.infer<typeof assemblyMotionTrackSchema>

export function assemblyMotionTrackValue(track: AssemblyMotionTrack, time: number) {
  const first = track.keys[0],
    last = track.keys.at(-1)
  if (!first || !last || !Number.isFinite(time)) throw new Error("The motion time is invalid.")
  if (time <= first.time) return first.value
  if (time >= last.time) return last.value
  const rightIndex = track.keys.findIndex((key) => key.time >= time)
  const right = track.keys[rightIndex],
    left = track.keys[rightIndex - 1]
  if (!left || !right) throw new Error("The motion key interval is invalid.")
  if (time === right.time) return right.value
  return left.value + (right.value - left.value) * ((time - left.time) / (right.time - left.time))
}

function coordinateLimits(
  joint: AssemblyJointRecord,
  coordinate: AssemblyMotionTrack["coordinate"],
) {
  if (joint.kind === "cylindrical")
    return coordinate === "angle" ? joint.angleLimits : joint.translationLimits
  if (joint.kind === "revolute" && coordinate === "angle") return joint.limits
  if (joint.kind === "prismatic" && coordinate === "translation") return joint.limits
  throw new Error("The motion track coordinate does not belong to its joint.")
}
function drivenJoint(
  joint: AssemblyJointRecord,
  coordinate: AssemblyMotionTrack["coordinate"],
  value: number,
): AssemblyJointRecord {
  const limits = coordinateLimits(joint, coordinate)
  if (!Number.isFinite(value) || value < limits.min || value > limits.max)
    throw new Error("The motion value exceeds the joint limits.")
  if (joint.kind === "cylindrical") {
    return assemblyJointRecordSchema.parse({
      ...joint,
      ...(coordinate === "angle"
        ? { angle: value, rotationDriven: true }
        : { translation: value, translationDriven: true }),
    })
  }
  if (joint.kind === "revolute" || joint.kind === "prismatic") {
    return assemblyJointRecordSchema.parse({
      ...joint,
      value,
      ...(joint.schemaVersion === 2 ? { driven: true } : {}),
    })
  }
  throw new Error("The motion track coordinate does not belong to its joint.")
}

/** All tracks are sampled together; two cylindrical coordinates produce one joint update. */
export function assemblyMotionStudyChanges(
  studyInput: AssemblyMotionStudy,
  joints: readonly AssemblyJointRecord[],
  time: number,
) {
  const study = assemblyMotionStudySchema.parse(studyInput)
  if (!Number.isFinite(time) || time < 0 || time > study.duration)
    throw new Error("The motion time is outside the study duration.")
  const updated = new Map<string, AssemblyJointRecord>()
  for (const track of study.tracks) {
    const joint = updated.get(track.jointId) ?? joints.find(({ id }) => id === track.jointId)
    if (!joint) throw new Error("A motion study references a missing joint.")
    updated.set(
      joint.id,
      drivenJoint(joint, track.coordinate, assemblyMotionTrackValue(track, time)),
    )
  }
  return [...updated.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((joint) => ({ kind: "joint.update" as const, joint }))
}

export function validateAssemblyMotionStudies(
  studies: readonly AssemblyMotionStudy[],
  joints: readonly AssemblyJointRecord[],
) {
  for (const study of studies)
    for (const track of study.tracks) {
      const joint = joints.find(({ id }) => id === track.jointId)
      if (!joint)
        throw new Error(
          "A motion study references a missing joint; remove or repair its tracks first.",
        )
      for (const key of track.keys) drivenJoint(joint, track.coordinate, key.value)
    }
}

export function assemblyMotionTimes(duration: number, sampleCount = 13, reverse = false) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3600 ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 2 ||
    sampleCount > 256
  )
    throw new Error("Motion sampling requires a duration up to 3600 seconds and 2 to 256 samples.")
  const times = Array.from({ length: sampleCount }, (_, index) =>
    index === sampleCount - 1 ? duration : (duration * index) / (sampleCount - 1),
  )
  return reverse ? times.reverse() : times
}
