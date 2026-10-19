import { describe, expect, it } from "bun:test"
import {
  createEmptySketch,
  partIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { createEditorSessionStore } from "./editor-session-store"
import { effectivePartVisibility } from "./part-visibility"

const partId = partIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3301")
const otherPartId = partIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3302")
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")

describe("session part visibility", () => {
  it("overrides either durable visibility value and falls back after an explicit clear", () => {
    const store = createEditorSessionStore()
    const actions = store.getState().actions
    const part = { id: partId, visible: true }
    expect(effectivePartVisibility(part, store.getState().partVisibilityOverrides)).toBe(true)
    actions.setPartVisibilityOverride(partId, false)
    actions.setPartVisibilityOverride(otherPartId, true)
    expect(effectivePartVisibility(part, store.getState().partVisibilityOverrides)).toBe(false)
    expect(
      effectivePartVisibility(
        { id: otherPartId, visible: false },
        store.getState().partVisibilityOverrides,
      ),
    ).toBe(true)
    actions.clearPartVisibilityOverride(partId)
    expect(effectivePartVisibility(part, store.getState().partVisibilityOverrides)).toBe(true)
    expect(store.getState().partVisibilityOverrides).toEqual({ [otherPartId]: true })
    expect(createEditorSessionStore().getState().partVisibilityOverrides).toEqual({})
  })

  it("keeps an active draft unchanged and retains visibility across Cancel and Apply", () => {
    const store = createEditorSessionStore()
    const actions = store.getState().actions
    const tool = {
      kind: "create-extrusion" as const,
      profiles: [
        {
          schemaVersion: 0 as const,
          sketchId,
          outerBoundaryEntityIds: [
            sketchEntityIdSchema.parse("0195b5ac-b221-7a2c-8c33-67a36a7f3201"),
          ],
          holeBoundaryEntityIds: [],
        },
      ],
    }
    actions.startPartDesignTool(tool)
    const activeTool = store.getState().activePartDesignTool
    const generation = store.getState().partDesignToolGeneration
    actions.setPartVisibilityOverride(partId, false)
    expect(store.getState().activePartDesignTool).toBe(activeTool)
    expect(store.getState().partDesignToolGeneration).toBe(generation)
    actions.closeActiveTool()
    expect(store.getState().partVisibilityOverrides).toEqual({ [partId]: false })
    actions.startPartDesignTool(tool)
    actions.completeActiveTool(store.getState().partDesignToolGeneration)
    expect(store.getState().partVisibilityOverrides).toEqual({ [partId]: false })
    actions.setPartVisibilityOverride(partId, true)
    expect(store.getState().partVisibilityOverrides).toEqual({ [partId]: true })
  })

  it("keeps sketch draft and Undo state unchanged while clearing the hidden Part selection", () => {
    const store = createEditorSessionStore()
    const actions = store.getState().actions
    actions.beginSketchEdit(createEmptySketch({ id: sketchId, label: "Sketch", plane: "xy" }))
    actions.setSelectedPart(partId)
    const sketch = store.getState().sketch
    actions.setPartVisibilityOverride(partId, false)
    expect(store.getState().sketch).toBe(sketch)
    expect(store.getState().selectedPartId).toBeNull()
    actions.closeActiveTool()
    expect(store.getState().partVisibilityOverrides[partId]).toBe(false)
  })
})
