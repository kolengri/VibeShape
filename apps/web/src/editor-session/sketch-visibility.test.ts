import { describe, expect, it } from "bun:test"
import {
  createEmptySketch,
  createLengthQuantity,
  documentIdSchema,
  extrusionFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchIdSchema,
  sketchProfileSelectorSchema,
} from "@vibeshape/domain"
import { createEditorSessionStore } from "./editor-session-store"
import {
  effectiveHiddenSketchIds,
  loadSketchVisibility,
  saveSketchVisibility,
} from "./sketch-visibility"

const id = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6101")
const documentId = documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6001")
const sketch = createEmptySketch({ id, label: "Profile", plane: "xy" })
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6201"),
  type: extrusionFeatureType.type,
  parameters: {
    profile: sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId: id,
      outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f6111"],
      holeBoundaryEntityIds: [],
    }),
    distance: createLengthQuantity(10),
    symmetric: false,
    operation: "new",
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Extrude",
})
function report(status: "succeeded" | "failed" | "blocked" | "suppressed" = "succeeded") {
  return {
    snapshot: { id: documentId, revision: 2, features: [feature], sketches: [sketch] },
    rebuild: {
      ok: true as const,
      response: {
        documentId,
        revision: 2,
        evaluation: { records: [{ featureId: feature.id, status }] },
      },
    },
  }
}

describe("consumed sketch visibility", () => {
  it("only auto hides after a successful current extrusion", () => {
    expect(effectiveHiddenSketchIds(report(), {}, true, null)).toEqual([id])
    for (const state of ["failed", "blocked", "suppressed"] as const)
      expect(effectiveHiddenSketchIds(report(state), {}, true, null)).toEqual([])
    const stale = report()
    stale.rebuild.response.revision = 1
    expect(effectiveHiddenSketchIds(stale, {}, true, null)).toEqual([])
    expect(effectiveHiddenSketchIds(report(), {}, false, null)).toEqual([])
  })
  it("restores automatic visibility on undo/suppression and retains any successful consumer", () => {
    const current = report()
    const second = { ...feature, id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6202") }
    current.snapshot.features.push(second)
    current.rebuild.response.evaluation.records.push({ featureId: second.id, status: "succeeded" })
    current.snapshot.features[0] = { ...feature, suppressed: true }
    expect(effectiveHiddenSketchIds(current, {}, true, null)).toEqual([id])
    current.snapshot.features.pop()
    expect(effectiveHiddenSketchIds(current, {}, true, null)).toEqual([])
    current.snapshot.features[0] = feature
    expect(effectiveHiddenSketchIds(current, {}, true, null)).toEqual([id])
    current.snapshot.features = []
    expect(effectiveHiddenSketchIds(current, {}, true, null)).toEqual([])
  })
  it("manual show survives rebuilds; editing temporarily reveals manual hide", () => {
    const store = createEditorSessionStore()
    store.getState().actions.setSketchVisibility(id, true)
    expect(
      effectiveHiddenSketchIds(report(), store.getState().sketchVisibilityOverrides, true, null),
    ).toEqual([])
    store.getState().actions.setSketchVisibility(id, false)
    expect(
      effectiveHiddenSketchIds(report(), store.getState().sketchVisibilityOverrides, true, id),
    ).toEqual([])
    expect(
      effectiveHiddenSketchIds(report(), store.getState().sketchVisibilityOverrides, true, null),
    ).toEqual([id])
  })
  it("Show all respects automatically hidden sketches and records explicit overrides", () => {
    const store = createEditorSessionStore()
    store.getState().actions.toggleAllSketchVisibility([id], [id])
    expect(store.getState().sketchVisibilityOverrides[id]).toBe(true)
    expect(
      effectiveHiddenSketchIds(report(), store.getState().sketchVisibilityOverrides, true, null),
    ).toEqual([])
    store.getState().actions.toggleAllSketchVisibility([id], [])
    expect(store.getState().sketchVisibilityOverrides[id]).toBe(false)
  })
  it("persists manual overrides per document and rejects malformed browser data", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    }
    saveSketchVisibility(storage, documentId, { [id]: true })
    expect(loadSketchVisibility(storage, documentId)).toEqual({ [id]: true })
    expect(loadSketchVisibility(storage, "different-document")).toEqual({})
    const key = [...data.keys()][0]
    if (!key) throw new Error("Expected persisted key")
    for (const raw of [
      '{"bad-id":true}',
      '{"__proto__":true}',
      "null",
      "invalid",
      "x".repeat(500001),
    ]) {
      data.set(key, raw)
      expect(loadSketchVisibility(storage, documentId)).toEqual({})
    }
  })
})
