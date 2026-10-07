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
  it.each([false, true])(
    "retains workspace tasks until their save explicitly succeeds (%s)",
    async (saved) => {
      const store = createEditorSessionStore()
      const navigation = createHistoryNavigation(store)
      const save = vi.fn(async () => saved)
      navigation.register(save, "lightweighting:quick")
      const activate = vi.fn()
      expect(await navigation.navigate(activate)).toBe(saved)
      expect(save).toHaveBeenCalledOnce()
      expect(activate).toHaveBeenCalledTimes(saved ? 1 : 0)
      if (!saved) {
        expect(await navigation.navigate(activate)).toBe(false)
        expect(save).toHaveBeenCalledTimes(2)
      }
    },
  )
  it("saves a workspace task once and activates only the latest History row", async () => {
    const navigation = createHistoryNavigation(createEditorSessionStore())
    let complete!: (saved: boolean) => void
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve
        }),
    )
    navigation.register(save, "lightweighting:structural")
    const firstRow = vi.fn()
    const lastRow = vi.fn()
    const first = navigation.navigate(firstRow)
    const last = navigation.navigate(lastRow)
    complete(true)
    expect(await first).toBe(false)
    expect(await last).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(firstRow).not.toHaveBeenCalled()
    expect(lastRow).toHaveBeenCalledOnce()
  })
  it.each(["same", "replacement"])(
    "preserves the mounted owner across a pending workspace save: %s",
    async (owner) => {
      const navigation = createHistoryNavigation(createEditorSessionStore())
      let complete!: (saved: boolean) => void
      navigation.register(
        () =>
          new Promise<boolean>((resolve) => {
            complete = resolve
          }),
        "lightweighting:quick",
        "original",
      )
      const activate = vi.fn()
      const saving = navigation.navigate(activate)
      const replacementSave = vi.fn(async () => false)
      navigation.register(
        replacementSave,
        "lightweighting:quick",
        owner === "same" ? "original" : "replacement",
      )
      complete(true)
      expect(await saving).toBe(owner === "same")
      expect(activate).toHaveBeenCalledTimes(owner === "same" ? 1 : 0)
      expect(replacementSave).not.toHaveBeenCalled()
      if (owner === "replacement") {
        expect(await navigation.navigate(activate)).toBe(false)
        expect(replacementSave).toHaveBeenCalledOnce()
      }
    },
  )
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
