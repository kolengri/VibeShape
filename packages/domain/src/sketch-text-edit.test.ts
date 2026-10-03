import { describe, expect, it } from "vitest"
import { sketchEntityIdSchema } from "./identifiers"
import { type SketchRecord, sketchRecordSchema } from "./sketch"
import { moveSketchPoint, removeSketchEntities } from "./sketch-edit"
import { BUNDLED_SKETCH_TEXT_FONT, sketchTextParametersSchema } from "./sketch-text"
import {
  applySketchTextOutline,
  detachSketchTextGroup,
  sketchTextGroupGeometryContent,
} from "./sketch-text-edit"

const id = (n: number) =>
  sketchEntityIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`)
const parameters = sketchTextParametersSchema.parse({
  schemaVersion: 0,
  text: "A",
  font: BUNDLED_SKETCH_TEXT_FONT,
  heightMm: 10,
  alignment: { horizontal: "left", vertical: "baseline" },
  trackingMm: 0,
  kerning: true,
  layoutEngine: "unicode-scalar-kerning-v1",
  outlineSdk: "opentype.js@2.0.0",
})
const segments = [
  { kind: "line", start: [0, 0], end: [10, 0] },
  { kind: "cubic-bezier", start: [10, 0], control1: [10, 5], control2: [5, 10], end: [0, 10] },
  { kind: "line", start: [0, 10], end: [0, 0] },
]
function empty() {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(1),
    label: "Text",
    plane: "xy",
    entities: [],
    constraints: [],
  })
}
function options(start = 10) {
  let next = start
  return {
    groupId: id(2),
    parameters,
    origin: [20, 30] as const,
    contours: [{ segments }],
    createEntityId: () => id(next++),
    hash: async () => "a".repeat(64),
  }
}
function requireGroup(sketch: SketchRecord) {
  const group = sketch.textGroups?.[0]
  if (!group) throw new Error("Missing text group")
  return group
}
function requireFirst<T>(values: readonly T[]) {
  const first = values[0]
  if (!first) throw new Error("Missing outline identity")
  return first
}
describe("editable text outline authority", () => {
  it("captures connected exact outlines and immutable font intent without changing old sketch bytes", async () => {
    const before = empty()
    expect(Object.hasOwn(before, "textGroups")).toBe(false)
    const authored = await applySketchTextOutline(before, options())
    const group = requireGroup(authored)
    expect(group).toMatchObject({
      id: id(2),
      parameters,
      origin: [20, 30],
      outlineDigest: "a".repeat(64),
    })
    expect(group?.curveIds).toHaveLength(3)
    expect(group?.pointIds).toHaveLength(5)
    expect(before.entities).toEqual([])
    expect(sketchTextGroupGeometryContent(authored, group)).toContain('"cubic-bezier"')
  })
  it("regenerates one group atomically while preserving its identity and unrelated geometry", async () => {
    const authored = await applySketchTextOutline(empty(), options())
    const original = requireGroup(authored)
    const updated = await applySketchTextOutline(authored, {
      ...options(100),
      replace: true,
      parameters: { ...parameters, text: "B" },
    })
    expect(updated.textGroups?.[0]?.id).toBe(original.id)
    expect(updated.textGroups?.[0]?.parameters.text).toBe("B")
    expect(updated.entities.some(({ id }) => original.curveIds.includes(id))).toBe(false)
    expect(authored.textGroups?.[0]?.parameters.text).toBe("A")
  })
  it("requires explicit attached-constraint removal and leaves failed replacement unchanged", async () => {
    const authored = await applySketchTextOutline(empty(), options())
    const pointId = requireFirst(requireGroup(authored).pointIds)
    const constrained = sketchRecordSchema.parse({
      ...authored,
      constraints: [{ schemaVersion: 0, id: id(300), type: "fixed", pointId }],
    })
    await expect(
      applySketchTextOutline(constrained, { ...options(100), replace: true }),
    ).rejects.toThrow("constraints")
    expect(constrained.constraints).toHaveLength(1)
    const replaced = await applySketchTextOutline(constrained, {
      ...options(100),
      replace: true,
      removeAttachedConstraints: true,
    })
    expect(replaced.constraints).toEqual([])
  })
  it("retains editable intent after point edits and explicitly detaches without deleting curves", async () => {
    const authored = await applySketchTextOutline(empty(), options())
    const group = requireGroup(authored)
    const moved = moveSketchPoint(authored, requireFirst(group.pointIds), { x: 21, y: 31 })
    expect(moved.textGroups).toEqual(authored.textGroups)
    expect(sketchTextGroupGeometryContent(moved, group)).not.toEqual(
      sketchTextGroupGeometryContent(authored, group),
    )
    const detached = detachSketchTextGroup(moved, group.id)
    expect(detached.entities).toEqual(moved.entities)
    expect(detached.textGroups).toEqual([])
    expect(removeSketchEntities(authored, [requireFirst(group.curveIds)]).textGroups).toEqual([])
  })
  it("rejects malformed contours, reused UUIDs and forged font or outline bindings", async () => {
    const before = empty()
    await expect(
      applySketchTextOutline(before, { ...options(), contours: [{ segments: [segments[0]] }] }),
    ).rejects.toThrow("closed")
    await expect(
      applySketchTextOutline(before, { ...options(), createEntityId: () => id(10) }),
    ).rejects.toThrow()
    const authored = await applySketchTextOutline(before, options())
    const group = requireGroup(authored)
    expect(
      sketchRecordSchema.safeParse({ ...authored, textGroups: [{ ...group, pointIds: [id(999)] }] })
        .success,
    ).toBe(false)
    expect(before.entities).toEqual([])
  })
})
