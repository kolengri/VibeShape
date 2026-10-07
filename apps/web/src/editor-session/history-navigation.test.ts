import { createEmptySketch, sketchIdSchema } from "@vibeshape/domain"
import { describe, expect, it, vi } from "vitest"
import { createEditorSessionStore } from "./editor-session-store"
import { createHistoryNavigation } from "./history-navigation"

function editing() {
  const store = createEditorSessionStore()
  const sketch = createEmptySketch({
    id: sketchIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2101"),
    label: "Profile",
    plane: "xy",
  })
  store.getState().actions.beginSketchEdit(sketch)
  return { store, sketch, navigation: createHistoryNavigation(store) }
}

describe("History navigation", () => {
  it("saves the active sketch before opening the next task", async () => {
    const { store, sketch, navigation } = editing()
    const activate = vi.fn(() => expect(store.getState().sketch.draft).toBeNull())
    const save = vi.fn(async () => store.getState().actions.saveSketch(sketch))
    navigation.register(save)
    expect(await navigation.navigate(activate)).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledOnce()
  })
  it("retains the draft and editor when validation or persistence fails", async () => {
    const { store, sketch, navigation } = editing()
    const activate = vi.fn()
    navigation.register(async () => {})
    expect(await navigation.navigate(activate)).toBe(false)
    expect(store.getState().sketch.draft).toEqual(sketch)
    navigation.register(async () => {
      throw new Error("Save failed")
    })
    expect(await navigation.navigate(activate)).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(store.getState().sketch.activeSketchTool?.kind).toBe("edit-sketch")
  })
  it("saves once during rapid navigation and opens only the latest requested destination", async () => {
    const { store, sketch, navigation } = editing()
    let complete!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    navigation.register(save)
    const first = vi.fn()
    const last = vi.fn()
    const initial = navigation.navigate(first)
    const latest = navigation.navigate(last)
    store.getState().actions.saveSketch(sketch)
    complete()
    expect(await initial).toBe(false)
    expect(await latest).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    expect(last).toHaveBeenCalledOnce()
  })
  it("returns to the current row when it is the last click during a pending save", async () => {
    const { store, sketch, navigation } = editing()
    let complete!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    navigation.register(save)
    const otherRow = vi.fn()
    const currentRow = vi.fn(() => store.getState().actions.beginSketchEdit(sketch))
    expect(await navigation.navigate(currentRow, true)).toBe(true)
    expect(save).not.toHaveBeenCalled()
    const first = navigation.navigate(otherRow)
    const last = navigation.navigate(currentRow, true)
    store.getState().actions.saveSketch(sketch)
    complete()
    expect(await first).toBe(false)
    expect(await last).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(otherRow).not.toHaveBeenCalled()
    expect(currentRow).toHaveBeenCalledOnce()
    expect(store.getState().sketch.draft?.id).toBe(sketch.id)
  })
  it("allows History activation from the non-editing measurement tool", async () => {
    const store = createEditorSessionStore()
    store.getState().actions.startPartDesignTool({ kind: "measure" })
    const activate = vi.fn(() =>
      store.getState().actions.startPartDesignTool({ kind: "create-box" }),
    )
    expect(await createHistoryNavigation(store).navigate(activate)).toBe(true)
    expect(activate).toHaveBeenCalledOnce()
    expect(store.getState().activePartDesignTool?.kind).toBe("create-box")
  })
  it("does not close a replacement task while a previous save finishes", async () => {
    const { store, navigation } = editing()
    let complete!: () => void
    navigation.register(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    const activate = vi.fn()
    const result = navigation.navigate(activate)
    store.getState().actions.startPartDesignTool({ kind: "create-box" })
    complete()
    expect(await result).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(store.getState().activePartDesignTool?.kind).toBe("create-box")
  })
})
