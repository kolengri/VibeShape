import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type SketchEntityId, sketchEntityIdSchema } from "./identifiers"
import { type SketchEntity, type SketchRecord, sketchRecordSchema } from "./sketch"
import { sketchConstraintEntityIds } from "./sketch-edit"
import { type SketchTextParameters, sketchTextParametersSchema } from "./sketch-text"
import type { SketchTextGroup } from "./sketch-text-groups"

const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate])
const line = z.object({ kind: z.literal("line"), start: point, end: point }).strict()
const cubic = z
  .object({
    kind: z.literal("cubic-bezier"),
    start: point,
    control1: point,
    control2: point,
    end: point,
  })
  .strict()
const contoursSchema = z
  .array(
    z
      .object({
        segments: z
          .array(z.discriminatedUnion("kind", [line, cubic]))
          .min(1)
          .max(2000),
      })
      .strip(),
  )
  .min(1)
  .max(2000)
type Segment = z.infer<typeof line> | z.infer<typeof cubic>

export function sketchTextGroupGeometryContent(sketch: SketchRecord, group: SketchTextGroup) {
  const owned = new Set<string>([...group.curveIds, ...group.pointIds])
  return canonicalJson(sketch.entities.filter(({ id }) => owned.has(id)))
}

function detachedSketch(sketch: SketchRecord, groupId: string, removeConstraints: boolean) {
  const group = sketch.textGroups?.find(({ id }) => id === groupId)
  if (!group) throw new Error("The edited text group no longer exists.")
  const owned = new Set<string>([...group.curveIds, ...group.pointIds])
  const attached = sketch.constraints.filter((constraint) =>
    sketchConstraintEntityIds(constraint).some((id) => owned.has(id)),
  )
  if (attached.length && !removeConstraints)
    throw new Error("Detach attached constraints explicitly before replacing a text outline.")
  return sketchRecordSchema.parse({
    ...sketch,
    entities: sketch.entities.filter(({ id }) => !owned.has(id)),
    constraints: sketch.constraints.filter((constraint) => !attached.includes(constraint)),
    textGroups: sketch.textGroups?.filter(({ id }) => id !== groupId),
  })
}

function createContourEntities(
  segments: readonly Segment[],
  origin: readonly [number, number],
  createId: () => SketchEntityId,
) {
  const entities: SketchEntity[] = []
  const endpoints = new Map<string, SketchEntityId>()
  const makePoint = (position: readonly [number, number], shared: boolean) => {
    const key = canonicalJson(position)
    const existing = shared ? endpoints.get(key) : undefined
    if (existing) return existing
    const id = sketchEntityIdSchema.parse(createId())
    entities.push({
      schemaVersion: 0,
      id,
      type: "point",
      x: position[0] + origin[0],
      y: position[1] + origin[1],
      construction: false,
    })
    if (shared) endpoints.set(key, id)
    return id
  }
  for (const [index, segment] of segments.entries()) {
    const next = segments[(index + 1) % segments.length]
    if (!next || canonicalJson(segment.end) !== canonicalJson(next.start))
      throw new Error("A text contour must be exactly connected and closed.")
    const startPointId = makePoint(segment.start, true)
    const endPointId = makePoint(segment.end, segments.length !== 1)
    const id = sketchEntityIdSchema.parse(createId())
    if (segment.kind === "line") {
      entities.push({
        schemaVersion: 0,
        id,
        type: "line",
        startPointId,
        endPointId,
        construction: false,
      })
    } else {
      const control1PointId = makePoint(segment.control1, false)
      const control2PointId = makePoint(segment.control2, false)
      entities.push({
        schemaVersion: 0,
        id,
        type: "cubic-bezier",
        startPointId,
        control1PointId,
        control2PointId,
        endPointId,
        construction: false,
      })
    }
  }
  return entities
}

/** Replacing text is one ordinary sketch mutation; UUIDs and font intent remain authored authority. */
export async function applySketchTextOutline(
  input: SketchRecord,
  options: {
    groupId: SketchEntityId
    parameters: SketchTextParameters
    origin: readonly [number, number]
    contours: unknown
    createEntityId: () => SketchEntityId
    hash: (content: string) => Promise<string>
    replace?: boolean
    removeAttachedConstraints?: boolean
  },
): Promise<SketchRecord> {
  const parameters = sketchTextParametersSchema.parse(options.parameters)
  const origin = point.parse(options.origin)
  const contours = contoursSchema.parse(options.contours)
  if (contours.reduce((count, contour) => count + contour.segments.length, 0) > 2000)
    throw new Error("The text outline exceeds its segment budget.")
  const base = options.replace
    ? detachedSketch(input, options.groupId, options.removeAttachedConstraints === true)
    : input
  const additions = contours.flatMap(({ segments }) =>
    createContourEntities(segments, origin, options.createEntityId),
  )
  const generated = sketchRecordSchema.parse({
    ...base,
    entities: [...base.entities, ...additions],
  })
  const group: SketchTextGroup = {
    schemaVersion: 0,
    id: options.groupId,
    parameters,
    origin,
    curveIds: additions.filter(({ type }) => type !== "point").map(({ id }) => id),
    pointIds: additions.filter(({ type }) => type === "point").map(({ id }) => id),
    outlineDigest: await options.hash(canonicalJson(additions)),
  }
  return sketchRecordSchema.parse({ ...generated, textGroups: [...(base.textGroups ?? []), group] })
}

export function detachSketchTextGroup(sketch: SketchRecord, groupId: SketchEntityId): SketchRecord {
  return sketchRecordSchema.parse({
    ...sketch,
    textGroups: sketch.textGroups?.filter(({ id }) => id !== groupId),
  })
}
