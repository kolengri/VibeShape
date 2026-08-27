import {
  createEmptySketch,
  featureIdSchema,
  type SketchProfileSelector,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { createEditorSessionStore } from "./editor-session-store"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")
const boundaryEntityId = sketchEntityIdSchema.parse("0195b5ac-b221-7a2c-8c33-67a36a7f3201")
const constraintId = sketchConstraintIdSchema.parse("0195b5ac-b222-7a2c-8c33-67a36a7f3201")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3202")
const referenceId = sketchExternalReferenceIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3203")

function createSketch(label = "Sketch 1") {
  return createEmptySketch({ id: sketchId, label, plane: "xy" })
}

function createProfile(): SketchProfileSelector {
  return {
    schemaVersion: 0,
    sketchId,
    outerBoundaryEntityIds: [boundaryEntityId],
    holeBoundaryEntityIds: [],
  }
}

describe("editor session store", () => {
  it("owns one external-reference repair mode and clears it with ordinary tool changes", () => {
    const store = createEditorSessionStore()
    const sketch = sketchRecordSchema.parse({
      ...createSketch(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: referenceId,
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "vertex",
            semanticRole: "primitive.box.vertex.x-min.y-min.z-min",
            signature: {
              kind: "vertex",
              geometryClass: "POINT",
              measure: 0,
              centroid: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: boundaryEntityId,
        },
      ],
    })

    store.getState().actions.beginSketchEdit(sketch)
    store.getState().actions.setSketchReferenceRepair(referenceId)
    expect(store.getState().sketch).toMatchObject({
      editorTool: "use",
      repairReferenceId: referenceId,
    })

    store.getState().actions.setSketchEditorTool("line")
    expect(store.getState().sketch.repairReferenceId).toBeNull()

    store.getState().actions.setSketchReferenceRepair(referenceId)
    store.getState().actions.setSketchReferenceRepair(null)
    expect(store.getState().sketch).toMatchObject({
      editorTool: "select",
      repairReferenceId: null,
    })
  })

  it("creates isolated editor sessions and preserves unrelated selector references", () => {
    const first = createEditorSessionStore()
    const second = createEditorSessionStore()
    const firstSketchState = first.getState().sketch

    first.getState().actions.setCommandPaletteOpen(true)
    first.getState().actions.setSelection({ featureId: "feature-1", faceId: 4, faceOrdinal: 2 })

    expect(first.getState().commandPaletteOpen).toBe(true)
    expect(first.getState().sketch).toBe(firstSketchState)
    expect(second.getState().commandPaletteOpen).toBe(false)
    expect(second.getState().selection).toBeNull()
  })

  it("keeps origin-plane visibility local to the editor session", () => {
    const first = createEditorSessionStore()
    const second = createEditorSessionStore()

    first.getState().actions.setOriginPlaneVisibility("xz", false)

    expect(first.getState().originPlaneVisibility).toEqual({ xy: true, xz: false, yz: true })
    expect(second.getState().originPlaneVisibility).toEqual({ xy: true, xz: true, yz: true })
  })

  it("keeps feature visibility local and clears selection when its feature is hidden", () => {
    const first = createEditorSessionStore()
    const second = createEditorSessionStore()
    first.getState().actions.setSelection({ featureId, faceId: 4, faceOrdinal: 2 })
    first.getState().actions.setFeatureVisibility(featureId, false)

    expect(first.getState().hiddenFeatureIds).toEqual([featureId])
    expect(first.getState().selection).toBeNull()
    expect(second.getState().hiddenFeatureIds).toEqual([])

    first.getState().actions.setFeatureVisibility(featureId, true)
    expect(first.getState().hiddenFeatureIds).toEqual([])
  })

  it("owns transient feature preselection and clears it when the feature is hidden", () => {
    const first = createEditorSessionStore()
    const second = createEditorSessionStore()

    first.getState().actions.setFeaturePreselection(featureId)
    expect(first.getState().preselectedFeatureId).toBe(featureId)
    expect(second.getState().preselectedFeatureId).toBeNull()

    first.getState().actions.setFeatureVisibility(featureId, false)
    expect(first.getState().preselectedFeatureId).toBeNull()
  })

  it("keeps saved sketch visibility local to the editor session", () => {
    const first = createEditorSessionStore()
    const second = createEditorSessionStore()

    first.getState().actions.setSketchVisibility(sketchId, false)
    expect(first.getState().hiddenSketchIds).toEqual([sketchId])
    expect(second.getState().hiddenSketchIds).toEqual([])

    first.getState().actions.setSketchVisibility(sketchId, true)
    expect(first.getState().hiddenSketchIds).toEqual([])
  })

  it("owns the create-sketch support-selection lifecycle without committing a document", () => {
    const store = createEditorSessionStore()
    const sketch = createSketch()

    store.getState().actions.beginSketchCreate(sketch)

    expect(store.getState()).toMatchObject({
      activePartDesignTool: null,
      selection: null,
      workspace: "model",
      sketch: {
        activeSketchId: sketchId,
        activeSketchTool: { kind: "select-sketch-plane" },
        draft: sketch,
        editorTool: "select",
      },
    })

    store.getState().actions.selectSketchPlane("xz")

    expect(store.getState()).toMatchObject({
      selection: null,
      workspace: "sketch",
      sketch: {
        activeSketchTool: { kind: "create-sketch" },
        draft: { plane: "xz" },
        editorTool: "line",
        undoStack: [],
      },
    })
  })

  it("starts a sketch directly on a selected planar feature face", () => {
    const store = createEditorSessionStore()
    const sketch = createSketch()
    const support = {
      plane: "xy" as const,
      support: {
        kind: "feature-face" as const,
        reference: {
          schemaVersion: 0 as const,
          featureId,
          kind: "face" as const,
          semanticRole: "extrusion.cap.end",
          signature: {
            kind: "face" as const,
            geometryClass: "PLANE" as const,
            measure: 400,
            centroid: [0, 0, 10] as [number, number, number],
            bounds: {
              min: [-10, -10, 10] as [number, number, number],
              max: [10, 10, 10] as [number, number, number],
            },
            direction: [0, 0, 1] as [number, number, number],
            directionMode: "oriented" as const,
            boundaryCount: 4,
            adjacentGeometryClasses: ["PLANE"],
          },
        },
      },
    }

    store.getState().actions.beginSketchCreate(sketch)
    store.getState().actions.selectSketchSupport(support)

    expect(store.getState()).toMatchObject({
      selection: null,
      workspace: "sketch",
      sketch: {
        activeSketchTool: { kind: "create-sketch" },
        draft: { support: support.support },
        editorTool: "line",
      },
    })
  })

  it("keeps sketch authoring state intact while camera mode changes and resets on close", () => {
    const store = createEditorSessionStore()
    const initial = createSketch("Initial")
    const changed = createSketch("Changed")
    const profile = createProfile()

    store.getState().actions.setSketchCameraMode("orbit")
    expect(store.getState().sketch.cameraMode).toBe("normal")

    store.getState().actions.beginSketchEdit(initial)
    store.getState().actions.setSketchDraft(changed)
    store.getState().actions.setSketchSelectedEntityIds([boundaryEntityId])
    store.getState().actions.setSketchProfiles([profile])
    store.getState().actions.setSketchCameraMode("orbit")

    expect(store.getState().sketch).toMatchObject({
      activeSketchTool: { kind: "edit-sketch", sketchId },
      cameraMode: "orbit",
      draft: changed,
      selectedEntityIds: [boundaryEntityId],
      selectedProfile: profile,
      undoStack: [initial],
    })

    store.getState().actions.setSketchCameraMode("normal")
    expect(store.getState().sketch.cameraMode).toBe("normal")
    expect(store.getState().sketch.draft).toBe(changed)

    store.getState().actions.closeActiveTool()
    expect(store.getState().sketch).toMatchObject({
      activeSketchTool: null,
      cameraMode: "normal",
      draft: null,
    })
  })

  it("shows final context only while editing a committed sketch and resets it between sessions", () => {
    const store = createEditorSessionStore()
    const sketch = createSketch("Initial")

    store.getState().actions.setSketchFinalContext(true)
    expect(store.getState().sketch.showFinalContext).toBe(false)

    store.getState().actions.beginSketchEdit(sketch)
    store.getState().actions.setSketchFinalContext(true)
    expect(store.getState().sketch.showFinalContext).toBe(true)

    store.getState().actions.saveSketch(sketch)
    expect(store.getState().sketch.showFinalContext).toBe(false)

    store.getState().actions.beginSketchEdit(sketch)
    store.getState().actions.setSketchFinalContext(true)
    store.getState().actions.closeActiveTool()
    expect(store.getState().sketch.showFinalContext).toBe(false)

    store.getState().actions.beginSketchCreate(sketch)
    store.getState().actions.setSketchFinalContext(true)
    expect(store.getState().sketch.showFinalContext).toBe(false)
  })

  it("records bounded local sketch history and clears selection on undo and redo", () => {
    const store = createEditorSessionStore()
    const initial = createSketch("Draft 0")
    store.getState().actions.beginSketchEdit(initial)

    for (let index = 1; index <= 105; index += 1) {
      store.getState().actions.setSketchDraft(createSketch(`Draft ${index}`))
    }
    store.getState().actions.setSketchSelectedEntityIds([boundaryEntityId])

    expect(store.getState().sketch.undoStack).toHaveLength(100)
    expect(store.getState().sketch.undoStack[0]?.label).toBe("Draft 5")

    store.getState().actions.undoSketchDraft()

    expect(store.getState().sketch.draft?.label).toBe("Draft 104")
    expect(store.getState().sketch.selectedEntityIds).toEqual([])
    expect(store.getState().sketch.redoStack).toHaveLength(1)

    store.getState().actions.redoSketchDraft()

    expect(store.getState().sketch.draft?.label).toBe("Draft 105")
    expect(store.getState().sketch.selectedEntityIds).toEqual([])
  })

  it("keeps entity and constraint selection mutually exclusive", () => {
    const store = createEditorSessionStore()
    store.getState().actions.beginSketchEdit(createSketch())

    store.getState().actions.setSketchSelectedEntityIds([boundaryEntityId])
    store.getState().actions.setSketchSelectedConstraintId(constraintId)
    expect(store.getState().sketch).toMatchObject({
      selectedConstraintId: constraintId,
      selectedEntityIds: [],
    })

    store.getState().actions.setSketchSelectedEntityIds([boundaryEntityId])
    expect(store.getState().sketch).toMatchObject({
      selectedConstraintId: null,
      selectedEntityIds: [boundaryEntityId],
    })
  })

  it("keeps the solved profile selected after a sketch is saved", () => {
    const store = createEditorSessionStore()
    const sketch = createSketch()
    const profile = createProfile()
    store.getState().actions.beginSketchEdit(sketch)
    store.getState().actions.setSketchProfiles([profile])

    store.getState().actions.saveSketch(sketch, { profiles: [profile], selectedProfile: profile })
    store.getState().actions.setSketchProfiles([])

    expect(store.getState().sketch).toMatchObject({
      activeSketchId: sketchId,
      activeSketchTool: null,
      draft: null,
      editorTool: "select",
      profiles: [profile],
      selectedProfile: profile,
      undoStack: [],
      redoStack: [],
    })
    expect(store.getState().workspace).toBe("model")
  })
})
