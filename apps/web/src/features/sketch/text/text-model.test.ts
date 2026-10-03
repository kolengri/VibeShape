import { moveSketchPoint } from "@vibeshape/domain/sketch-edit"
import { detachSketchTextGroup } from "@vibeshape/domain/sketch-text-edit"
import { describe, expect, it, vi } from "vitest"
import {
  createSketchTextDraft,
  parseSketchTextValues,
  SketchTextOutlineError,
  sketchTextDraftUnchanged,
  sketchTextOutlineAltered,
  sketchTextValues,
} from "./text-model"
import {
  authoredTextSketch,
  emptyTextSketch,
  fontBytes,
  requireTextGroup,
  textId,
} from "./text-test-fixtures"

describe("sketch text form authority", () => {
  it("normalizes supported single-line text and retains explicit layout intent", () => {
    const result = parseSketchTextValues({
      ...sketchTextValues(),
      text: "Cafe\u0301 Ω Ж",
      height: "12.5",
      tracking: "-0.2",
      originX: "-20",
      originY: "30",
      horizontal: "right",
      vertical: "top",
      kerning: false,
    })
    expect(result).toMatchObject({
      ok: true,
      origin: [-20, 30],
      parameters: {
        text: "Café Ω Ж",
        heightMm: 12.5,
        trackingMm: -0.2,
        alignment: { horizontal: "right", vertical: "top" },
        kerning: false,
      },
    })
  })
  it.each(["", "A\nB", "A\u0000B", "\u0301", "مرحبا", "A".repeat(65)])(
    "rejects unsupported text before outline allocation: %j",
    (text) => {
      expect(parseSketchTextValues({ ...sketchTextValues(), text })).toMatchObject({
        ok: false,
        errors: { text: "invalidText" },
      })
    },
  )
  it.each([
    ["height", "", "invalidHeight"],
    ["height", "0", "invalidHeight"],
    ["height", "1001", "invalidHeight"],
    ["tracking", "1001", "invalidTracking"],
    ["originX", "Infinity", "invalidOrigin"],
    ["originY", "100001", "invalidOrigin"],
  ] as const)("validates the authored numeric field %s=%s", (field, value, error) => {
    expect(parseSketchTextValues({ ...sketchTextValues(), [field]: value })).toMatchObject({
      ok: false,
      errors: { [field]: error },
    })
  })
  it("creates pinned-font exact cubic outlines, regenerates fresh identities and detects manual edits", async () => {
    const before = emptyTextSketch()
    const authored = await authoredTextSketch()
    const group = requireTextGroup(authored)
    expect(authored.entities.some(({ type }) => type === "cubic-bezier")).toBe(true)
    expect(before.entities).toEqual([])
    expect(await sketchTextOutlineAltered(authored, group)).toBe(false)
    const parsed = parseSketchTextValues({ ...sketchTextValues(group), text: "C", originX: "20" })
    if (!parsed.ok) throw new Error("Expected valid form parameters.")
    let next = 1000
    const edited = await createSketchTextDraft(authored, {
      parameters: parsed.parameters,
      origin: parsed.origin,
      fontBytes,
      groupId: group.id,
      removeAttachedConstraints: false,
      createEntityId: () => textId(next++),
    })
    expect(requireTextGroup(edited)).toMatchObject({
      id: group.id,
      origin: [20, -8],
      parameters: { text: "C" },
    })
    expect(edited.entities.some(({ id }) => group.curveIds.includes(id))).toBe(false)
    expect(requireTextGroup(authored).parameters.text).toBe("O")
    const pointId = group.pointIds[0]
    if (!pointId) throw new Error("Expected a contour point.")
    const altered = moveSketchPoint(authored, pointId, { x: 25, y: -12 })
    expect(await sketchTextOutlineAltered(altered, group)).toBe(true)
    expect(sketchTextDraftUnchanged(authored, altered)).toBe(false)
    expect(sketchTextDraftUnchanged(authored, null)).toBe(false)
    expect(detachSketchTextGroup(altered, group.id).entities).toEqual(altered.entities)
  })
  it.each(["💡", "   "])(
    "reports unusable font outlines without allocating authority: %j",
    async (text) => {
      const parsed = parseSketchTextValues({ ...sketchTextValues(), text })
      if (!parsed.ok) throw new Error("Expected the outline engine to own this diagnostic.")
      const allocate = vi.fn(() => textId(1000))
      await expect(
        createSketchTextDraft(emptyTextSketch(), {
          parameters: parsed.parameters,
          origin: parsed.origin,
          fontBytes,
          removeAttachedConstraints: false,
          createEntityId: allocate,
        }),
      ).rejects.toBeInstanceOf(SketchTextOutlineError)
      expect(allocate).not.toHaveBeenCalled()
    },
  )
})
