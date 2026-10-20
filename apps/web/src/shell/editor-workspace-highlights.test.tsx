import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import type { DocumentSnapshot, FeatureId } from "@vibeshape/domain"
import type { GeometryViewport as GeometryViewportPort } from "@vibeshape/viewer"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { ModelTreeSelection } from "./model-tree-selection"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock)
vi.stubGlobal("AbortController", window.AbortController)
vi.stubGlobal("AbortSignal", window.AbortSignal)
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }),
})

const port: GeometryViewportPort = {
  clearSketchProjection: vi.fn(),
  setSurfaceTextureBrush: vi.fn(),
  orientToFrame: vi.fn(() => true),
  setSketchProjection: vi.fn(() => true),
  setSketchPlaneProjection: vi.fn(),
  setSketchNavigationElement: vi.fn(),
  setPointerOrbit: vi.fn(),
  setInteractionMode: vi.fn(),
  setFeaturePreselection: vi.fn(),
  setFeatureSelection: vi.fn(),
  setMeshes: vi.fn(),
  setSection: vi.fn(),
  setToolPlane: vi.fn(),
  setPrintBed: vi.fn(),
  setGroundGrid: vi.fn(),
  setSketchReferenceCandidates: vi.fn(),
  setSketchReferencePreselection: vi.fn(),
  setSketchProfilePreselection: vi.fn(),
  setSketchProfileSelection: vi.fn(),
  setSketchProfileSelections: vi.fn(),
  setSelectionCandidateStackPreserved: vi.fn(),
  setSelectionPreselection: vi.fn(),
  setFaceSelections: vi.fn(),
  setAnalysisOverlays: vi.fn(),
  setSketches: vi.fn(),
  setOriginPlaneSelection: vi.fn(),
  setOriginPlaneVisibility: vi.fn(),
  showTranslationGizmo: vi.fn(),
  showAxialTranslationGizmo: vi.fn(),
  showAngularGizmo: vi.fn(),
  hideTranslationGizmo: vi.fn(),
  hideAngularGizmo: vi.fn(),
  setStandardView: vi.fn(),
  fit: vi.fn(),
  clearSelection: vi.fn(),
  dispose: vi.fn(),
}
// Keep the workspace, task forms, History, and viewport composition real; replace browser render/worker ports.
const viewerModule = { ...(await import("@vibeshape/viewer/three-viewport")) }
mock.module("@vibeshape/viewer/three-viewport", () => ({
  ...viewerModule,
  createGeometryViewport: () => port,
}))
mock.module("@vibeshape/viewer/project-thumbnail", () => ({
  renderProjectThumbnail: async () => null,
}))
mock.module("@vibeshape/document-worker/session", () => ({
  createDocumentWorkerSession: () => ({
    rebuild: ({ document }: { document: DocumentSnapshot }) =>
      Promise.resolve(rebuild(document, true)),
    terminate: vi.fn(),
  }),
}))

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { useState } = await import("react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } = await import(
  "@vibeshape/protocol"
)
const { boxFeatureParametersSchema, createEmptySketch, sketchIdSchema } = await import(
  "@vibeshape/domain"
)
const { i18n } = await import("../i18n")
const { authoredTestBody, authoredTestId, authoredTreeFixture, requireAuthoredFixture } =
  await import("../test-support/authored-tree-fixture")
const { EditorWorkspace } = await import("./editor-workspace")
const { ViewerPreferencesProvider } = await import("./viewer-preferences")
const { WorkspaceLayoutPreferencesProvider } = await import("./workspace-layout-preferences")

type WorkspaceProps = ComponentProps<typeof EditorWorkspace>
const fixture = authoredTreeFixture()
const firstFeature = requireAuthoredFixture(fixture.snapshot.features[0])
const firstPart = requireAuthoredFixture(fixture.authority.parts[0])
const sample = authoredTestBody(firstPart)
const sketch = createEmptySketch({
  id: sketchIdSchema.parse(authoredTestId(700)),
  label: "Guide",
  plane: "xy",
})
const snapshot = { ...fixture.snapshot, sketches: [sketch] }
const authority = {
  ...fixture.authority,
  sketches: [sketch],
  history: [...fixture.authority.history, { kind: "sketch" as const, id: sketch.id }],
}

function rebuild(document: DocumentSnapshot, preview = false) {
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "workspace-highlight-test",
    generation: 1,
    documentId: document.id,
    revision: document.revision,
    evaluation: {
      records: document.features.map(({ id }) => ({
        featureId: id,
        status: "succeeded",
        contentHash: (preview ? "b" : "a").repeat(64),
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: document.features.map((feature) => {
      const width = boxFeatureParametersSchema.parse(feature.parameters).width.value
      const mesh = { ...sample.mesh, positions: new Float32Array([0, 0, 0, width, 0, 0, 0, 30, 0]) }
      return {
        featureId: feature.id,
        contentHash: (preview ? "b" : "a").repeat(64),
        meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
        geometry: {
          engine: {
            adapter: "replicad",
            adapterVersion: "test",
            replicadVersion: "0.23.1",
            opencascadePackageVersion: "0.23.0",
            opencascadeSourceRevision: null,
            wasmBytes: 1,
            initializedInMs: 1,
            featureContentEnvironment: {
              schemaVersion: 0,
              hostApiVersion: "0.1.0",
              geometry: {
                adapterId: "org.vibeshape.geometry.replicad",
                adapterVersion: "test",
                kernelId: "org.opencascade.occt",
                kernelVersion: "0.23.0",
                kernelSourceRevision: null,
              },
              modelingTolerancePolicyVersion: 1,
              provider: { kind: "built-in" },
            },
          },
          shape: sample.shape,
          mesh,
          topologyCandidates: [],
          bodies: [{ outputRole: "result", shape: sample.shape, mesh, topologyCandidates: [] }],
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      }
    }),
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("The fixture requires rebuild evidence.")
  return response
}
const controller: DocumentControllerState = {
  status: "ready",
  saveStatus: "saved",
  diagnostic: null,
  authoredSnapshot: authority,
  report: {
    status: "created",
    mode: "read-write",
    snapshot,
    historyItems: authority.history,
    rebuild: { ok: true, response: rebuild(snapshot) },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  },
}

const noop = () => undefined
function WorkspaceHarness({
  treeSelection,
  toolTargets,
  hiddenFeatureIds = [],
}: {
  treeSelection: readonly ModelTreeSelection[]
  toolTargets?: WorkspaceProps["assistantToolTargets"]
  hiddenFeatureIds?: WorkspaceProps["hiddenFeatureIds"]
}) {
  const [activeTool, setActiveTool] = useState<ActivePartDesignTool | null>(null)
  const [preselectedFeatureId, setPreselectedFeatureId] = useState<FeatureId | null>(null)
  const actions: WorkspaceProps["actions"] = {
    acknowledgeExtrusionDistance: noop,
    acknowledgeRevolveAngle: noop,
    beginSketchSupportReplacement: noop,
    closeTool: () => setActiveTool(null),
    completeTool: noop,
    createHole: noop,
    createFillet: noop,
    createChamfer: noop,
    createBox: noop,
    createCylinder: noop,
    createSphere: noop,
    createCone: noop,
    createPyramid: noop,
    createTorus: noop,
    createDatumPlane: noop,
    createExtrusion: async () => false,
    createRevolve: async () => false,
    createLoft: noop,
    createSweep: noop,
    createSketch: noop,
    createSubtract: noop,
    measure: noop,
    surfaceTexture: noop,
    editFeature: (featureId) => setActiveTool({ kind: "edit-box", featureId }),
    editSketch: noop,
    preselectFeature: setPreselectedFeatureId,
    select: noop,
    selectPart: noop,
    selectSavedSketchProfile: noop,
    selectOriginPlane: noop,
    selectSketchPlane: noop,
    redoSketchDraft: noop,
    setFeatureVisibility: noop,
    setExtrusionDistance: noop,
    setOriginPlaneVisibility: noop,
    setPrimitivePlacement: noop,
    setRevolveAngle: noop,
    setSketchVisibility: noop,
    toggleAllSketchVisibility: noop,
    setSketchConstruction: noop,
    setSketchDraft: noop,
    setSketchEditorTool: noop,
    setSketchFailedConstraintIds: noop,
    setSketchProfiles: noop,
    setSketchReferenceDimensionLabels: noop,
    setSketchReferenceRepair: noop,
    setSketchSelectedConstraintId: noop,
    setSketchSelectedEntityIds: noop,
    setSketchSelectedProfile: noop,
    sketchSaved: noop,
    switchWorkspace: noop,
    undoSketchDraft: noop,
  }
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ViewerPreferencesProvider>
          <WorkspaceLayoutPreferencesProvider>
            <EditorWorkspace
              actions={actions}
              activeTool={activeTool}
              activeSketchId={null}
              activeSketchTool={null}
              controller={controller}
              assistantToolTargets={toolTargets}
              hiddenFeatureIds={hiddenFeatureIds}
              hiddenSketchIds={[]}
              originPlaneVisibility={{ xy: true, xz: true, yz: true }}
              onSketchFinalContextChange={noop}
              preselectedFeatureId={preselectedFeatureId}
              modelTreeSelection={treeSelection}
              extrusionDistanceRequest={null}
              primitivePlacementRequest={null}
              revolveAngleRequest={null}
              selectedOriginPlane={null}
              selection={null}
              sketchConstruction={false}
              sketchCameraMode="normal"
              sketchFinalContext={false}
              sketchDraft={null}
              sketchEditorTool="select"
              sketchFailedConstraintIds={[]}
              sketchProfiles={[]}
              sketchReferenceDimensionLabels={{}}
              sketchRepairReferenceId={null}
              sketchSelectedConstraintId={null}
              sketchSelectedEntityIds={[]}
              sketchSelectedProfile={null}
              workspace="model"
            />
          </WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function historyRow() {
  return within(screen.getByRole("tree", { name: "Feature history" })).getByRole("treeitem", {
    name: "Box 1",
  })
}

describe("workspace body highlight composition", () => {
  it("links assistant targets to visible exact outputs and matching tree and History identities", async () => {
    const otherFeature = requireAuthoredFixture(snapshot.features[1])
    const toolTargets = {
      projectId: snapshot.id,
      featureIds: [firstFeature.id, otherFeature.id],
      sketchIds: [sketch.id],
    }
    const rendered = render(<WorkspaceHarness treeSelection={[]} toolTargets={toolTargets} />)
    await waitFor(() =>
      expect(port.setFeaturePreselection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: firstFeature.id, outputRole: "result" }),
        expect.objectContaining({ featureId: otherFeature.id, outputRole: "result" }),
      ]),
    )
    for (const id of [firstFeature.id, otherFeature.id, sketch.id]) {
      const row = screen
        .getByRole("tree", { name: "Feature history" })
        .querySelector(`[data-history-id="${id}"]`)
      expect(row?.getAttribute("data-history-source-highlighted")).toBe("true")
    }
    const leftTree = screen.getByRole("tree", { name: "Project features" })
    expect(
      within(leftTree)
        .getByRole("treeitem", { name: "Part Part 1" })
        .closest('[data-highlighted="true"]'),
    ).toBeTruthy()
    expect(
      within(leftTree)
        .getByRole("treeitem", { name: "Guide" })
        .closest('[data-highlighted="true"]'),
    ).toBeTruthy()
    expect(port.setFeatureSelection).toHaveBeenLastCalledWith(null)
    rendered.rerender(
      <WorkspaceHarness
        treeSelection={[]}
        toolTargets={toolTargets}
        hiddenFeatureIds={[firstFeature.id]}
      />,
    )
    await waitFor(() =>
      expect(port.setFeaturePreselection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: otherFeature.id }),
      ]),
    )
    rendered.rerender(<WorkspaceHarness treeSelection={[]} />)
    await waitFor(() => expect(port.setFeaturePreselection).toHaveBeenLastCalledWith(null))
  })

  it("ignores tool identities from another project even when feature IDs overlap", async () => {
    const otherProject = { ...snapshot, id: fixture.authority.parts[0]?.id }
    const { documentIdSchema } = await import("@vibeshape/domain")
    render(
      <WorkspaceHarness
        treeSelection={[]}
        toolTargets={{
          projectId: documentIdSchema.parse(otherProject.id),
          featureIds: [firstFeature.id],
          sketchIds: [sketch.id],
        }}
      />,
    )
    await waitFor(() => expect(port.setFeaturePreselection).toHaveBeenLastCalledWith(null))
    expect(historyRow().closest('[data-history-source-highlighted="true"]')).toBeNull()
  })

  it("projects authored feature selections to their exact rebuilt output roles", async () => {
    render(<WorkspaceHarness treeSelection={[{ kind: "feature", id: firstFeature.id }]} />)
    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: firstFeature.id, outputRole: "result" }),
      ]),
    )
  })

  it("keeps the opened History feature and its unsaved candidate highlighted after hover ends", async () => {
    render(<WorkspaceHarness treeSelection={[]} />)
    fireEvent.pointerEnter(historyRow().parentElement ?? historyRow())
    await waitFor(() =>
      expect(port.setFeaturePreselection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: firstFeature.id, outputRole: "result" }),
      ]),
    )
    fireEvent.click(historyRow())
    fireEvent.pointerLeave(historyRow().parentElement ?? historyRow())
    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          featureId: firstFeature.id,
          positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 30, 0]),
        }),
      ),
    )
    expect(port.setFeaturePreselection).toHaveBeenLastCalledWith(null)
    fireEvent.change(screen.getByRole("combobox", { name: "Width" }), {
      target: { value: "40 mm" },
    })
    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          featureId: firstFeature.id,
          positions: new Float32Array([0, 0, 0, 40, 0, 0, 0, 30, 0]),
        }),
      ),
    )
  })

  it("preserves explicit sketch-only and exact body-role projections, then restores active-feature semantics when deselected", async () => {
    const view = render(<WorkspaceHarness treeSelection={[]} />)
    fireEvent.click(historyRow())
    view.rerender(<WorkspaceHarness treeSelection={[{ kind: "sketch", id: sketch.id }]} />)
    await waitFor(() => expect(port.setFeatureSelection).toHaveBeenLastCalledWith([]))
    view.rerender(
      <WorkspaceHarness
        treeSelection={[{ kind: "body", featureId: firstFeature.id, outputRole: "another-output" }]}
      />,
    )
    await waitFor(() => expect(port.setFeatureSelection).toHaveBeenLastCalledWith([]))
    view.rerender(
      <WorkspaceHarness
        treeSelection={[{ kind: "body", featureId: firstFeature.id, outputRole: "result" }]}
      />,
    )
    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: firstFeature.id, outputRole: "result" }),
      ]),
    )
    view.rerender(<WorkspaceHarness treeSelection={[]} />)
    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ featureId: firstFeature.id }),
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(port.setFeatureSelection).toHaveBeenLastCalledWith(null))
  })
})
