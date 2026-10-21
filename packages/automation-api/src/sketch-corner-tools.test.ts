import { describe, expect, it } from "bun:test"
import { createAngleQuantity, createLengthQuantity } from "@vibeshape/domain/units"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import { remoteOperationSchema } from "./remote-session"
import {
  isLocalSketchCornerOperation,
  localSketchCornerInputs,
  sketchCornerOperationSchema,
} from "./sketch-corner-tools"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const envelope = { draftId: id(1), baseRevision: 3, commandId: id(2), sketchId: id(3) }
const lines = { firstLineId: id(4), secondLineId: id(5) }
const fillet = { ...lines, kind: "fillet", radius: createLengthQuantity(2, "mm", "#corner_size") }
const chamfer = {
  ...lines,
  kind: "chamfer",
  firstDistance: createLengthQuantity(0.1, "in", "#corner_size"),
  secondDistance: createLengthQuantity(3, "mm", "#corner_size + 1 mm"),
}

describe("named sketch corner tool contract", () => {
  it.each([fillet, chamfer])(
    "preserves $kind quantities and expressions in a strict draft envelope",
    (treatment) => {
      const value = { tool: "treat_sketch_corner", arguments: { ...envelope, treatment } }
      const operation = sketchCornerOperationSchema.parse(value)
      expect(operation).toEqual<unknown>(value)
      expect(localOperationSchema.parse(value)).toEqual<unknown>(value)
      expect(remoteOperationSchema.parse(value)).toEqual<unknown>(value)
      expect(isLocalSketchCornerOperation(operation)).toBe(true)
    },
  )

  it("returns the ordinary draft state and excludes unrelated validated operations", () => {
    const state = {
      schemaVersion: 1,
      draftId: id(1),
      documentId: id(6),
      baseRevision: 3,
      revision: 4,
      commandCount: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
    }
    expect(localToolOutputs.treat_sketch_corner.parse({ ok: true, value: state })).toEqual<unknown>(
      {
        ok: true,
        value: state,
      },
    )
    expect(
      isLocalSketchCornerOperation(
        localOperationSchema.parse({ tool: "create_draft", arguments: { baseRevision: 3 } }),
      ),
    ).toBe(false)
  })

  it("rejects invalid authority envelopes and caller-generated geometry or IDs", () => {
    for (const change of [
      { draftId: "foreign" },
      { baseRevision: -1 },
      { baseRevision: 1.5 },
      { commandId: null },
      { sketchId: undefined },
      { actor: { type: "ui" } },
      { solvedPoints: [] },
      { createEntityId: id(8) },
      { sketch: {} },
    ])
      expect(
        localSketchCornerInputs.treat_sketch_corner.safeParse({
          ...envelope,
          treatment: fillet,
          ...change,
        }).success,
      ).toBe(false)
    expect(
      sketchCornerOperationSchema.safeParse({
        tool: "execute",
        arguments: { ...envelope, treatment: fillet },
      }).success,
    ).toBe(false)
  })

  it("rejects unsupported, identical, malformed, nonfinite and nonpositive treatments", () => {
    for (const treatment of [
      null,
      { ...fillet, kind: "round" },
      { ...fillet, firstLineId: lines.secondLineId },
      { ...fillet, secondLineId: "line-2" },
      { ...fillet, radius: createLengthQuantity(0) },
      { ...fillet, radius: createLengthQuantity(-2) },
      { ...fillet, radius: { ...fillet.radius, value: Infinity } },
      { ...fillet, radius: { ...fillet.radius, value: NaN } },
      { ...fillet, radius: createAngleQuantity(1) },
      { ...fillet, radius: { ...fillet.radius, value: 3 } },
      { ...fillet, radius: { ...fillet.radius, schemaVersion: 9 } },
      { ...fillet, firstDistance: createLengthQuantity(1) },
      { ...chamfer, secondDistance: undefined },
      { ...chamfer, secondDistance: createLengthQuantity(-1) },
      { ...chamfer, radius: createLengthQuantity(1) },
    ])
      expect(
        localSketchCornerInputs.treat_sketch_corner.safeParse({ ...envelope, treatment }).success,
      ).toBe(false)
  })
})
