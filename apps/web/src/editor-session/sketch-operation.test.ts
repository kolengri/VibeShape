import { describe, expect, it } from "bun:test"
import { createEmptySketch, sketchIdSchema } from "@vibeshape/domain"
import { sketchOperationActive } from "./sketch-operation"

const draft = createEmptySketch({
  id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2603"),
  label: "Profile",
  plane: "xy",
})

describe("sketch operation state", () => {
  it("treats a finished, still-selected sketch as idle", () => {
    expect(sketchOperationActive({ activeSketchTool: null, draft: null })).toBe(false)
  })

  it("treats an unsaved sketch draft as active even without a sketch tool", () => {
    expect(sketchOperationActive({ activeSketchTool: null, draft })).toBe(true)
  })

  it("treats an active sketch tool as active", () => {
    expect(
      sketchOperationActive({ activeSketchTool: { kind: "select-sketch-plane" }, draft: null }),
    ).toBe(true)
  })
})
