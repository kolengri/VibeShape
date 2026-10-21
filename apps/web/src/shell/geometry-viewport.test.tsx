import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import type { SketchProfileSelector } from "@vibeshape/domain"
import type {
  GeometryViewportOptions,
  GeometryViewport as GeometryViewportPort,
  ViewerSelection,
} from "@vibeshape/viewer"
import type { ViewerEdgeCandidate, ViewerToolPlane } from "@vibeshape/viewer/three-viewport"
import { surfaceTextureProjectFixture } from "../../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import {
  assistantCheckpointDisplayController,
  assistantCheckpointForController,
} from "./assistant-checkpoint-display"
import type { GeometryViewportSketchContext } from "./geometry-viewport"
import type { ModelEdgeViewportSelection } from "./model-edge-viewport"

type WorkspaceTask = Parameters<typeof WorkspaceTaskProvider>[0]["value"]

const { saveActiveProjectThumbnailMock, renderProjectThumbnailMock } = (() => ({
  saveActiveProjectThumbnailMock: vi.fn(),
  renderProjectThumbnailMock: vi.fn(),
}))()

const originalModule1 = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => {
  const actual = originalModule1
  return { ...actual, saveActiveProjectThumbnail: saveActiveProjectThumbnailMock }
})

mock.module("@vibeshape/viewer/project-thumbnail", () => ({
  renderProjectThumbnail: renderProjectThumbnailMock,
}))

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const {
  boxFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  featureIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} = await import("@vibeshape/domain")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { createSketchProjectionStore } = await import("../features/sketch/sketch-projection-store")
const { i18n } = await import("../i18n")
const surfaceTextures = await import("@vibeshape/application/surface-textures")
const { authoredTreeFixture, requireAuthoredFixture } = await import(
  "../test-support/authored-tree-fixture"
)
const {
  GeometryViewport,
  viewerMeshes,
  viewerSketchDisplay,
  viewerSketches,
  withActiveSketchDisplay,
} = await import("./geometry-viewport")
const { WorkspaceTaskProvider } = await import("./workspace-task-context")
const { ApplicationNoticesProvider } = await import("./application-notices")

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))

const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f2602"
const booleanId = "0195b5ac-b220-7a2c-8c33-67a36a7f2603"
const datumId = "0195b5ac-b220-7a2c-8c33-67a36a7f2604"
const mesh = {
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}
const taskPreviewMesh = {
  featureId: "task-preview",
  appearance: "preview" as const,
  ...mesh,
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
}
const sketchDisplay: SketchDisplayRecord = {
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f2605",
  frame: {
    origin: [0, 0, 0] as const,
    xAxis: [1, 0, 0] as const,
    yAxis: [0, 1, 0] as const,
    normal: [0, 0, 1] as const,
  },
  profiles: [],
  curvePositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionCurvePositions: new Float32Array(),
  pointPositions: new Float32Array([0, 0, 0, 20, 0, 0]),
  constructionPointPositions: new Float32Array(),
}

const firstProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2611")
const secondProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2612")
const thirdProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2613")
const fourthProfileBoundaryId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2614")
const profileBoundaryIds = [
  firstProfileBoundaryId,
  secondProfileBoundaryId,
  thirdProfileBoundaryId,
  fourthProfileBoundaryId,
]
const profileSelector: SketchProfileSelector = {
  schemaVersion: 0,
  sketchId: sketchIdSchema.parse(sketchDisplay.sketchId),
  outerBoundaryEntityIds: profileBoundaryIds,
  holeBoundaryEntityIds: [],
}
const profileSketchDisplay: SketchDisplayRecord = {
  ...sketchDisplay,
  profiles: [
    {
      selector: profileSelector,
      outerLoop: {
        segments: [
          {
            entityId: firstProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [0, 0],
              [10, 0],
            ],
          },
          {
            entityId: secondProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [10, 0],
              [10, 10],
            ],
          },
          {
            entityId: thirdProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [10, 10],
              [0, 10],
            ],
          },
          {
            entityId: fourthProfileBoundaryId,
            type: "line",
            reversed: false,
            samples: [
              [0, 10],
              [0, 0],
            ],
          },
        ],
      },
      holeLoops: [],
    },
  ],
}
const secondProfileSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2620")
const secondProfileSelector: SketchProfileSelector = {
  ...profileSelector,
  sketchId: secondProfileSketchId,
}
const secondProfileSketchDisplay: SketchDisplayRecord = {
  ...profileSketchDisplay,
  sketchId: secondProfileSketchId,
  profiles: profileSketchDisplay.profiles.map((profile) => ({
    ...profile,
    selector: secondProfileSelector,
  })),
}

function planarFaceCandidate(
  candidateId: string,
  meshFaceId: number,
  semanticRole: string,
  centroid: readonly [number, number, number],
) {
  return {
    candidateId,
    kind: "face" as const,
    lineageTokens: [],
    meshFaceId,
    referenceGeometry: { kind: "plane-face" as const, normal: [0, 0, 1] as const },
    semanticRole,
    signature: {
      adjacentGeometryClasses: [],
      boundaryCount: 4,
      bounds: { min: centroid, max: centroid },
      centroid,
      direction: [0, 0, 1] as const,
      directionMode: "oriented" as const,
      geometryClass: "PLANE" as const,
      kind: "face" as const,
      measure: 100,
    },
  }
}

function readyController(
  features: readonly { id: string; dependencies: readonly string[]; label?: string }[],
  geometry: readonly {
    featureId: string
    geometry: {
      mesh: typeof mesh
      topologyCandidates?: readonly ReturnType<typeof planarFaceCandidate>[]
    }
  }[],
  sketches: readonly SketchDisplayRecord[] = [],
) {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      snapshot: {
        features: features.map((feature) => ({
          type: boxFeatureType.type,
          parameters: {},
          references: [],
          suppressed: false,
          ...feature,
        })),
        sketches: sketches.map(({ sketchId }, index) => ({
          id: sketchId,
          label: `Sketch ${index + 1}`,
        })),
      },
      rebuild: {
        ok: true,
        response: {
          evaluation: {
            records: features.map(({ id }) =>
              geometry.some(({ featureId }) => featureId === id)
                ? { featureId: id, status: "succeeded", contentHash: "a".repeat(64) }
                : { featureId: id, status: "suppressed" },
            ),
            dirtyFeatureIds: [],
            evaluatedFeatureIds: geometry.map(({ featureId }) => featureId),
            reusedFeatureIds: [],
          },
          geometry: geometry.map((record) => ({
            ...record,
            contentHash: "a".repeat(64),
            meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
            geometry: {
              shape: {
                valid: true,
                volume: 1,
                surfaceArea: 1,
                solidCount: 1,
                faceCount: 1,
                edgeCount: 3,
                bounds: { min: [0, 0, 0], max: [1, 1, 1] },
              },
              topologyCandidates: [],
              ...record.geometry,
            },
          })),
          sketches,
        },
      },
    },
  } as unknown as DocumentControllerState
}

function checkpointViewportFixture() {
  const { authority, snapshot } = authoredTreeFixture()
  const source = readyController(
    snapshot.features.map(({ id, dependencies }) => ({ id, dependencies })),
    snapshot.features.map(({ id }) => ({ featureId: id, geometry: { mesh } })),
  )
  if (!source.report?.rebuild.ok) throw new Error("The baseline must have exact rebuilt geometry.")
  const baselineAuthority = {
    ...authority,
    parts: authority.parts.map((part, index) => ({ ...part, visible: index !== 1 })),
  }
  const head = { ...snapshot, revision: snapshot.revision + 1 }
  const current: DocumentControllerState = {
    ...source,
    authoredSnapshot: {
      ...authority,
      revision: head.revision,
      parts: authority.parts.map((part) => ({ ...part, visible: false })),
    },
    report: { ...source.report, snapshot: head },
  }
  const presentation = {
    kind: "assistant-checkpoint" as const,
    documentId: snapshot.id,
    baseRevision: head.revision,
    target: { snapshot, authority: baselineAuthority, targetRevision: snapshot.revision },
    rebuild: {
      ...source.report.rebuild.response,
      type: "documentRebuilt" as const,
      documentId: snapshot.id,
      revision: snapshot.revision,
    },
    assembly: null,
  }
  return {
    current,
    presentation,
    controller: { ...current, assistantCheckpointPresentation: presentation },
  }
}

function thumbnailController(revision: number) {
  const controller = readyController(
    [{ id: boxId, dependencies: [] }],
    [{ featureId: boxId, geometry: { mesh } }],
  )
  const snapshot = controller.report?.snapshot as { id: string; revision: number }
  snapshot.id = "project-thumbnail"
  snapshot.revision = revision
  return controller
}

function optionalProp<Value>(name: string, value: Value | undefined) {
  return value === undefined ? {} : { [name]: value }
}

function renderViewport(
  controller: DocumentControllerState,
  selection: ViewerSelection | null = null,
  originPlaneSelection?: Readonly<{
    mode: "create" | "replace"
    selectedPlane: "xy" | "xz" | "yz" | null
    onSelect: (plane: "xy" | "xz" | "yz") => void
  }>,
  featurePreview?: FeaturePreviewState,
  originPlaneVisibility?: Readonly<{
    visibility: { xy: boolean; xz: boolean; yz: boolean }
    onChange: (plane: "xy" | "xz" | "yz", visible: boolean) => void
  }>,
  featureHighlight?: Readonly<{
    edgeSelection?: ModelEdgeViewportSelection | undefined
    readOnlyPresentation?: boolean
    pendingViewport?: Promise<GeometryViewportPort>
    partVisibilityOverrides?: PartVisibilityOverrides
    preselectedFeatureId?: string
    selectedFeatureId?: string
    selectedBody?: ModelBodySelection
    preselectedBody?: ModelBodySelection
    selectedBodies?: readonly ModelBodySelection[]
    preselectedBodies?: readonly ModelBodySelection[]
    preselectedSketchId?: string
    preselectedSketchIds?: readonly string[]
    selectedSketchIds?: readonly string[]
    onBodySelectionChange?: (body: ModelBodySelection | null) => void
    onBodyPreselectionChange?: (body: ModelBodySelection | null) => void
  }>,
  sketchContext?: GeometryViewportSketchContext,
  idleOriginPlaneSelection?: Readonly<{
    selectedPlane: "xy" | "xz" | "yz" | null
    onSelect: (plane: "xy" | "xz" | "yz" | null) => void
  }>,
  sketchProfileSelection?: Readonly<{
    keyboardPickerActive?: boolean
    excludedSketchIds?: readonly string[]
    selectedProfiles: readonly SketchProfileSelector[]
    onSelect: (
      profile: SketchProfileSelector | null,
      profiles: readonly SketchProfileSelector[],
      intent: "replace" | "toggle",
    ) => void
  }>,
  translationGizmo?: Readonly<{
    featureId: string
    position: readonly [number, number, number]
    onPositionChange: (position: readonly [number, number, number]) => void
  }>,
  axialGizmo?: Readonly<{
    direction: readonly [number, number, number]
    distance: number
    featureId: string
    onDistanceChange: (distance: number) => void
    origin: readonly [number, number, number]
    opposite?: Readonly<{
      distance: number
      onDistanceChange: (distance: number) => void
    }>
  }>,
  angularGizmo?: Readonly<{
    angle: number
    axisDirection: readonly [number, number, number]
    axisOrigin: readonly [number, number, number]
    featureId: string
    onAngleChange: (angle: number) => void
    rotationOrigin: readonly [number, number, number]
  }>,
  sketchProfilePreview?: SketchProfileSelector | null,
  hiddenSketchIds: readonly string[] = [],
  axialGizmoPending = false,
  workspaceTask: WorkspaceTask = null,
  pendingViewport?: Promise<GeometryViewportPort>,
  toolPlane?: ViewerToolPlane | null,
) {
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
    setEdgeCandidates: vi.fn(),
    setEdgePreselection: vi.fn(),
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
  const onSelectionChange = vi.fn()
  const createViewport = vi.fn(
    (_canvas: HTMLCanvasElement, _options: GeometryViewportOptions) =>
      pendingViewport ?? featureHighlight?.pendingViewport ?? port,
  )
  const element = (
    nextController: DocumentControllerState,
    nextSketchContext = sketchContext,
    nextSketchProfilePreview = sketchProfilePreview,
    nextHiddenSketchIds = hiddenSketchIds,
    nextAxialGizmo: typeof axialGizmo | null = axialGizmo,
    nextAxialGizmoPending = axialGizmoPending,
    nextWorkspaceTask: WorkspaceTask = workspaceTask,
    nextPartVisibility = featureHighlight?.partVisibilityOverrides,
    nextFeaturePreview = featurePreview,
    nextToolPlane = toolPlane,
    edgeOptions: Readonly<{
      edgeSelection?: ModelEdgeViewportSelection | undefined
      readOnlyPresentation?: boolean
    }> = {},
  ) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ApplicationNoticesProvider>
          <WorkspaceTaskProvider value={nextWorkspaceTask}>
            <GeometryViewport
              controller={nextController}
              createViewport={createViewport}
              selection={selection}
              onSelectionChange={onSelectionChange}
              {...optionalProp("sketchContext", nextSketchContext)}
              {...featureHighlight}
              {...edgeOptions}
              partVisibilityOverrides={nextPartVisibility}
              {...optionalProp("featurePreview", nextFeaturePreview)}
              {...optionalProp("originPlaneSelection", originPlaneSelection)}
              {...optionalProp("originPlaneVisibility", originPlaneVisibility)}
              {...optionalProp("idleOriginPlaneSelection", idleOriginPlaneSelection)}
              {...optionalProp("sketchProfileSelection", sketchProfileSelection)}
              {...optionalProp("sketchProfilePreview", nextSketchProfilePreview)}
              hiddenSketchIds={nextHiddenSketchIds}
              {...optionalProp("translationGizmo", translationGizmo)}
              {...optionalProp("axialGizmo", nextAxialGizmo ?? undefined)}
              axialGizmoPending={nextAxialGizmoPending}
              {...optionalProp("angularGizmo", angularGizmo)}
              toolPlane={nextToolPlane}
            />
          </WorkspaceTaskProvider>
        </ApplicationNoticesProvider>
      </TooltipProvider>
    </I18nProvider>
  )
  const result = render(element(controller))
  return {
    ...result,
    createViewport,
    onSelectionChange,
    port,
    rerenderEdgeSelection: (
      edgeSelection: ModelEdgeViewportSelection | undefined,
      readOnlyPresentation = false,
    ) =>
      result.rerender(
        element(
          controller,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          axialGizmo,
          axialGizmoPending,
          workspaceTask,
          featureHighlight?.partVisibilityOverrides,
          featurePreview,
          toolPlane,
          { edgeSelection, readOnlyPresentation },
        ),
      ),
    rerenderToolPlane: (next: ViewerToolPlane | null) =>
      result.rerender(
        element(
          controller,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          axialGizmo,
          axialGizmoPending,
          workspaceTask,
          featureHighlight?.partVisibilityOverrides,
          featurePreview,
          next,
        ),
      ),
    rerenderPartVisibility: (overrides: PartVisibilityOverrides, preview = featurePreview) =>
      result.rerender(
        element(
          controller,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          axialGizmo,
          axialGizmoPending,
          workspaceTask,
          overrides,
          preview,
        ),
      ),
    rerenderWorkspaceTask: (nextTask: WorkspaceTask) =>
      result.rerender(
        element(
          controller,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          axialGizmo,
          axialGizmoPending,
          nextTask,
        ),
      ),
    rerenderController: (nextController: DocumentControllerState) =>
      result.rerender(element(nextController)),
    rerenderFeaturePreview: (
      nextPreview: FeaturePreviewState | undefined,
      nextController = controller,
    ) =>
      result.rerender(
        element(
          nextController,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          axialGizmo,
          axialGizmoPending,
          workspaceTask,
          featureHighlight?.partVisibilityOverrides,
          nextPreview,
        ),
      ),
    rerenderSketchProfilePreview: (
      nextPreview: SketchProfileSelector | null,
      nextHiddenSketchIds = hiddenSketchIds,
    ) => result.rerender(element(controller, sketchContext, nextPreview, nextHiddenSketchIds)),
    rerenderSketchContext: (nextSketchContext?: GeometryViewportSketchContext) =>
      result.rerender(element(controller, nextSketchContext)),
    rerenderAxialGizmo: (nextGizmo: typeof axialGizmo, pending: boolean) =>
      result.rerender(
        element(
          controller,
          sketchContext,
          sketchProfilePreview,
          hiddenSketchIds,
          nextGizmo ?? null,
          pending,
        ),
      ),
  }
}

function renderTaskViewport(
  controller: DocumentControllerState,
  task: WorkspaceTask,
  pendingViewport?: Promise<GeometryViewportPort>,
) {
  return renderViewport(
    controller,
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    false,
    task,
    pendingViewport,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(() => {
  renderProjectThumbnailMock.mockReset()
  renderProjectThumbnailMock.mockResolvedValue({
    mediaType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71]),
  })
  saveActiveProjectThumbnailMock.mockReset()
  saveActiveProjectThumbnailMock.mockResolvedValue({ ok: true })
})

function assistantPreviewFixture() {
  const { snapshot } = authoredTreeFixture()
  const source = readyController([], [])
  if (!source.report) throw new Error("Expected an empty committed report.")
  const controller = {
    ...source,
    report: { ...source.report, snapshot: { ...snapshot, features: [], sketches: [] } },
  }
  const preview = {
    status: "ready",
    display: "result",
    assistantDraft: {
      documentId: snapshot.id,
      draftId: "assistant-draft",
      baseRevision: snapshot.revision,
    },
    meshes: [
      { ...taskPreviewMesh, previewMaterial: "model" },
      { ...taskPreviewMesh, featureId: datumId, previewMaterial: "datum" },
    ],
  } satisfies FeaturePreviewState
  return { controller, preview }
}

describe("assistant draft preview display", () => {
  it("consumes Result and Changes as presentation only while retaining unsaved authority and geometry", async () => {
    const { controller, preview } = assistantPreviewFixture()
    const snapshot = controller.report.snapshot
    const rendered = renderViewport(controller, null, undefined, preview)
    const { port, createViewport } = rendered
    await waitFor(() => expect(port.setMeshes).toHaveBeenCalled())
    expect(screen.getByText("Agent preview · not saved yet")).toBeTruthy()
    expect(screen.queryByRole("radio", { name: "Result" })).toBeNull()
    expect(screen.queryByRole("radio", { name: "Changes" })).toBeNull()
    expect(port.setMeshes).toHaveBeenLastCalledWith(preview.meshes)
    const fits = vi.mocked(port.fit).mock.calls.length
    rendered.rerenderFeaturePreview({ ...preview, display: "changes" })
    const highlighted = vi.mocked(port.setMeshes).mock.lastCall?.[0]
    expect(highlighted?.map(({ previewMaterial }) => previewMaterial)).toEqual([
      "highlight",
      "highlight",
    ])
    for (const [index, presented] of (highlighted ?? []).entries()) {
      const original = preview.meshes[index]
      if (!original) throw new Error("Expected the original draft mesh.")
      expect(presented.appearance).toBe("preview")
      expect(presented.positions).toBe(original.positions)
      expect(presented.normals).toBe(original.normals)
      expect(presented.indices).toBe(original.indices)
    }
    rendered.rerenderFeaturePreview({ ...preview, display: "result" })
    expect(port.setMeshes).toHaveBeenLastCalledWith(preview.meshes)
    expect(controller.report.snapshot).toBe(snapshot)
    expect(preview.meshes[0]?.previewMaterial).toBe("model")
    expect(port.fit).toHaveBeenCalledTimes(fits)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    expect(saveActiveProjectThumbnailMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull()
  })

  it("does not change ordinary feature previews when they carry a display preference", async () => {
    const { controller } = assistantPreviewFixture()
    const preview: FeaturePreviewState = {
      status: "ready",
      kind: "primitive",
      display: "result",
      meshes: [taskPreviewMesh],
    }
    const rendered = renderViewport(controller, null, undefined, preview)
    await waitFor(() => expect(rendered.port.setMeshes).toHaveBeenLastCalledWith(preview.meshes))
    expect(screen.getByText("Unsaved feature preview")).toBeTruthy()
    expect(screen.queryByText("Agent preview · not saved yet")).toBeNull()
    rendered.rerenderFeaturePreview({ ...preview, display: "changes" })
    expect(rendered.port.setMeshes).toHaveBeenLastCalledWith(preview.meshes)
  })

  it("does not recompute surface texture geometry when only the draft display mode changes", async () => {
    const { controller, preview } = assistantPreviewFixture()
    const { snapshot, layer } = surfaceTextureProjectFixture()
    const texturedController: DocumentControllerState = {
      ...controller,
      authoredSnapshot: { ...snapshot, schemaVersion: 3, surfaceTextures: [layer] },
      report: {
        ...controller.report,
        snapshot: { ...controller.report.snapshot, id: snapshot.id, revision: snapshot.revision },
      },
    }
    const draftPreview: FeaturePreviewState = {
      ...preview,
      assistantDraft: { ...preview.assistantDraft, documentId: snapshot.id },
    }
    const compute = vi.spyOn(surfaceTextures, "previewSurfaceTextureRelief").mockResolvedValue([])
    vi.useFakeTimers()
    try {
      const rendered = renderViewport(texturedController, null, undefined, draftPreview)
      await act(async () => vi.advanceTimersByTimeAsync(150))
      expect(compute).toHaveBeenCalledTimes(1)
      rendered.rerenderFeaturePreview({ ...draftPreview, display: "changes" })
      await act(async () => vi.advanceTimersByTimeAsync(150))
      rendered.rerenderFeaturePreview({ ...draftPreview, display: "result" })
      await act(async () => vi.advanceTimersByTimeAsync(150))
      expect(compute).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("GeometryViewport", () => {
  it("selects section planes with labeled radio tiles and recenters the cut on the model", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const rendered = renderViewport(controller)
    await userEvent.click(screen.getByRole("button", { name: "Section view" }))
    const xy = screen.getByRole("radio", { name: "XY plane, normal Z" }) as HTMLInputElement
    expect(xy.checked).toBe(true)
    // Plane choice is available before enabling sectioning.
    await userEvent.click(screen.getByRole("radio", { name: "YZ plane, normal X" }))
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(null)
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable section view" }))
    expect(rendered.port.setSection).toHaveBeenLastCalledWith({
      axis: "x",
      offset: 10,
      flipped: false,
    })
    await userEvent.click(screen.getByRole("checkbox", { name: "Keep the opposite side" }))
    await userEvent.click(screen.getByRole("radio", { name: "XZ plane, normal Y" }))
    expect(rendered.port.setSection).toHaveBeenLastCalledWith({
      axis: "y",
      offset: 10,
      flipped: true,
    })
    await userEvent.click(xy)
    expect(rendered.port.setSection).toHaveBeenLastCalledWith({
      axis: "z",
      offset: 0,
      flipped: true,
    })
    await userEvent.keyboard("{Escape}")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Section view" }))
  })

  it("retains Section clipping through orbit reference picking and feature previews", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const rendered = renderViewport(controller)
    await waitFor(() => expect(rendered.port.setMeshes).toHaveBeenCalled())
    await userEvent.click(screen.getByRole("button", { name: "Section view" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Enable section view" }))
    await userEvent.keyboard("{Escape}")
    const section = { axis: "z", offset: 0, flipped: false }
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(section)
    rendered.rerenderSketchContext({
      frame: null,
      mode: "orbit",
      faceIntersectionSelection: { onSelect: vi.fn() },
    })
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(section)
    rendered.rerenderFeaturePreview({
      status: "ready",
      kind: "primitive",
      meshes: [taskPreviewMesh],
    })
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(section)
    rendered.rerenderSketchContext({ frame: null, mode: "normal" })
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(null)
    rendered.rerenderSketchContext({ frame: null, mode: "orbit" })
    expect(rendered.port.setSection).toHaveBeenLastCalledWith(section)
    expect(rendered.createViewport).toHaveBeenCalledTimes(1)
    expect(rendered.port.dispose).not.toHaveBeenCalled()
  })

  it("reports outline preparation failure outside the viewport without disabling surfaces or selection", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const { port, createViewport, onSelectionChange, unmount } = renderViewport(controller)
    await waitFor(() => expect(port.setMeshes).toHaveBeenCalled())
    const options = createViewport.mock.calls[0]?.[1]
    if (!options?.onEdgePreparationError) throw new Error("Expected outline failure reporting.")
    act(() => options.onEdgePreparationError?.(new Error("Fixture worker failure")))
    expect(screen.getByRole("alert").textContent).toContain("Model outlines could not be prepared")
    expect(
      screen.getByRole("region", { name: "3D viewport" }).querySelector('[role="alert"]'),
    ).toBeNull()
    expect(screen.queryByText(/WebGL2 is unavailable/)).toBeNull()
    act(() => options.onSelectionChange?.({ featureId: boxId, faceId: 1, faceOrdinal: 1 }))
    expect(onSelectionChange).toHaveBeenCalledWith({ featureId: boxId, faceId: 1, faceOrdinal: 1 })
    unmount()
    act(() => options.onEdgePreparationError?.(new Error("Late fixture failure")))
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("renders baseline authority and visibility without current previews, selection, or persistence", async () => {
    const { controller, current, presentation } = checkpointViewportFixture()
    const firstPart = requireAuthoredFixture(presentation.target.authority.parts[0])
    const bodyChange = vi.fn()
    const { port, createViewport, onSelectionChange, rerenderController } = renderViewport(
      controller,
      { featureId: boxId, faceId: 1, faceOrdinal: 1 },
      undefined,
      { status: "ready", meshes: [taskPreviewMesh] },
      undefined,
      {
        partVisibilityOverrides: { [firstPart.id]: false },
        selectedFeatureId: boxId,
        onBodySelectionChange: bodyChange,
      },
    )
    await waitFor(() => expect(port.setMeshes).toHaveBeenCalled())
    const visible = vi.mocked(port.setMeshes).mock.calls.at(-1)?.[0]
    expect(visible?.map(({ featureId }) => featureId)).toEqual([
      requireAuthoredFixture(presentation.target.snapshot.features[0]).id,
      requireAuthoredFixture(presentation.target.snapshot.features[2]).id,
    ])
    expect(visible?.[0]?.positions).toBe(presentation.rebuild.geometry[0]?.geometry.mesh.positions)
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("camera-only")
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSelectionChange?.({ featureId: boxId, faceId: 1, faceOrdinal: 1 }))
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(bodyChange).not.toHaveBeenCalled()
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    expect(saveActiveProjectThumbnailMock).not.toHaveBeenCalled()
    expect(controller.report).toBe(current.report)
    expect(controller.authoredSnapshot).toBe(current.authoredSnapshot)
    const fits = vi.mocked(port.fit).mock.calls.length
    rerenderController(current)
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("select")
    expect(port.setMeshes).toHaveBeenLastCalledWith([taskPreviewMesh])
    expect(port.fit).toHaveBeenCalledTimes(fits)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("ignores current task meshes and readiness callbacks while viewing the baseline", async () => {
    const { controller } = checkpointViewportFixture()
    const onReady = vi.fn()
    const onFacePick = vi.fn(() => true)
    const overlays = [
      { kind: "face" as const, mesh: taskPreviewMesh, faceIds: [1], role: "load" as const },
    ]
    const { port } = renderTaskViewport(controller, {
      activityKey: "lightweighting",
      panel: null,
      interaction: { sourceMesh: taskPreviewMesh, picking: false, onFacePick, overlays },
      preview: { meshes: [taskPreviewMesh], onReady },
    })
    await waitFor(() => expect(port.setMeshes).toHaveBeenCalled())
    expect(vi.mocked(port.setMeshes).mock.calls.at(-1)?.[0]).toHaveLength(2)
    expect(onReady).not.toHaveBeenCalled()
    expect(port.setAnalysisOverlays).not.toHaveBeenCalledWith(overlays)
  })

  it("rejects stale checkpoint heads and mismatched baseline rebuilds", () => {
    const { controller, presentation } = checkpointViewportFixture()
    const display = assistantCheckpointDisplayController(controller)
    expect(display?.report?.mode).toBe("read-only")
    expect(display?.report?.rebuild.ok && display.report.rebuild.response).toBe(
      presentation.rebuild,
    )
    expect(display?.authoredSnapshot).toBe(presentation.target.authority)
    for (const invalid of [
      { ...presentation, baseRevision: presentation.baseRevision + 1 },
      { ...presentation, documentId: "another-project" },
      {
        ...presentation,
        rebuild: { ...presentation.rebuild, revision: presentation.rebuild.revision + 1 },
      },
    ]) {
      expect(
        assistantCheckpointForController({
          ...controller,
          assistantCheckpointPresentation: invalid,
        }),
      ).toBeNull()
    }
  })

  it("filters an active preview and clears picking without changing its authority or draft", async () => {
    const { authority, snapshot } = authoredTreeFixture()
    const first = requireAuthoredFixture(authority.parts[0])
    const firstBinding = requireAuthoredFixture(first.bodyHistory[0])
    const source = readyController(
      snapshot.features.map(({ id, dependencies }) => ({ id, dependencies })),
      snapshot.features.map(({ id }) => ({ featureId: id, geometry: { mesh } })),
    )
    if (!source.report) throw new Error("Expected fixture report.")
    const controller = {
      ...source,
      report: { ...source.report, snapshot },
      authoredSnapshot: authority,
    }
    const preview = {
      status: "ready" as const,
      kind: "extrusion" as const,
      meshes: snapshot.features.map(({ id }) => ({
        featureId: id,
        appearance: "preview" as const,
        ...mesh,
      })),
    }
    const selected = { featureId: firstBinding.featureId, faceId: 1, faceOrdinal: 1 }
    const { port, onSelectionChange, rerenderPartVisibility } = renderViewport(
      controller,
      selected,
      undefined,
      preview,
      undefined,
      { partVisibilityOverrides: { [first.id]: false }, selectedFeatureId: firstBinding.featureId },
    )
    await waitFor(() => expect(port.setMeshes).toHaveBeenLastCalledWith(preview.meshes.slice(1)))
    expect(onSelectionChange).toHaveBeenCalledWith(null)
    expect(port.setFeatureSelection).toHaveBeenLastCalledWith(null)
    expect(screen.getByText("Unsaved feature preview")).toBeTruthy()
    expect(controller.report.snapshot).toBe(snapshot)
    expect(controller.authoredSnapshot.revision).toBe(authority.revision)
    expect(preview.meshes).toHaveLength(3)
    rerenderPartVisibility({ [first.id]: true })
    await waitFor(() => expect(port.setMeshes).toHaveBeenLastCalledWith(preview.meshes))
    rerenderPartVisibility({ [first.id]: false }, { status: "idle", meshes: [] })
    await waitFor(() =>
      expect(
        vi.mocked(port.setMeshes).mock.lastCall?.[0].map(({ featureId }) => featureId),
      ).toEqual(snapshot.features.slice(1).map(({ id }) => id)),
    )
  })

  it("hides only the chosen output role from a producer with two authored Parts", () => {
    const { authority, snapshot } = authoredTreeFixture()
    const first = requireAuthoredFixture(authority.parts[0])
    const second = requireAuthoredFixture(authority.parts[1])
    const feature = requireAuthoredFixture(snapshot.features[0])
    const old = requireAuthoredFixture(first.bodyHistory[0])
    const source = readyController(
      snapshot.features.map(({ id, dependencies }) => ({ id, dependencies })),
      snapshot.features.map(({ id }) => ({ featureId: id, geometry: { mesh } })),
    )
    if (!source.report?.rebuild?.ok) throw new Error("Expected fixture rebuild.")
    const response = source.report.rebuild.response
    const parts = [
      { ...first, bodyHistory: [{ ...old, featureId: feature.id, outputRole: "left" }] },
      { ...second, bodyHistory: [{ ...old, featureId: feature.id, outputRole: "right" }] },
    ]
    const controller = {
      ...source,
      authoredSnapshot: { ...authority, parts },
      report: {
        ...source.report,
        snapshot,
        rebuild: {
          ok: true as const,
          response: {
            ...response,
            geometry: response.geometry.map((record) =>
              record.featureId !== feature.id
                ? record
                : {
                    ...record,
                    geometry: {
                      ...record.geometry,
                      bodies: ["left", "right"].map((outputRole) => ({
                        outputRole,
                        shape: record.geometry.shape,
                        mesh: record.geometry.mesh,
                        topologyCandidates: record.geometry.topologyCandidates,
                      })),
                    },
                  },
            ),
          },
        },
      },
    }
    expect(
      viewerMeshes(controller, [], [], { [first.id]: false })
        .filter(({ featureId }) => featureId === feature.id)
        .map(({ outputRole }) => outputRole),
    ).toEqual(["right"])
    expect(
      viewerMeshes(controller, [], [], { [second.id]: false })
        .filter(({ featureId }) => featureId === feature.id)
        .map(({ outputRole }) => outputRole),
    ).toEqual(["left"])
    expect(controller.authoredSnapshot.parts[0]?.visible).toBe(true)
    expect(controller.report.snapshot).toBe(snapshot)
  })

  it("applies authored part visibility without mutating feature visibility or model history", () => {
    const { authority, snapshot } = authoredTreeFixture()
    const first = requireAuthoredFixture(authority.parts[0])
    const controller = readyController(
      snapshot.features.map(({ id, dependencies }) => ({ id, dependencies })),
      snapshot.features.map(({ id }) => ({ featureId: id, geometry: { mesh } })),
    )
    if (!controller.report) throw new Error("Expected fixture report.")
    const visible = {
      ...controller,
      report: { ...controller.report, snapshot },
      authoredSnapshot: authority,
    }
    const hidden = {
      ...visible,
      authoredSnapshot: {
        ...authority,
        parts: authority.parts.map((part) =>
          part.id === first.id ? { ...part, visible: false } : part,
        ),
      },
    }
    expect(viewerMeshes(visible)).toHaveLength(3)
    expect(viewerMeshes(hidden).map(({ featureId }) => featureId)).toEqual(
      snapshot.features.slice(1).map(({ id }) => id),
    )
    expect(hidden.report.snapshot).toBe(snapshot)
    expect(hidden.authoredSnapshot.history).toBe(authority.history)
    expect(viewerMeshes(visible)).toHaveLength(3)
  })

  it("shows primitive translation and forwards world-space position changes", async () => {
    const onPositionChange = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { featureId: boxId, position: [1, 2, 3], onPositionChange },
    )

    await waitFor(() => expect(port.showTranslationGizmo).toHaveBeenCalledWith([1, 2, 3]))
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-translation-gizmo-feature"),
    ).toBe(boxId)
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onTranslationGizmoPositionChange?.([4, 5, 6]))
    expect(onPositionChange).toHaveBeenCalledWith([4, 5, 6])
  })

  it("shows an axial feature gizmo and forwards scalar distance changes", async () => {
    const onDistanceChange = vi.fn()
    const axialGizmo = {
      direction: [0, 0, 1] as const,
      distance: 12,
      featureId: boxId,
      onDistanceChange,
      origin: [2, 3, 4] as const,
    }
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      axialGizmo,
    )

    await waitFor(() => expect(port.showAxialTranslationGizmo).toHaveBeenCalledWith(axialGizmo))
    expect(
      screen.getByRole("region", { name: "3D viewport" }).getAttribute("data-axial-gizmo-distance"),
    ).toBe("12")
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onAxialGizmoDistanceChange?.(18))
    expect(onDistanceChange).toHaveBeenCalledWith(18)
  })

  it("moves the selected extrusion endpoint and routes each depth independently", async () => {
    const onFirstDistanceChange = vi.fn()
    const onSecondDistanceChange = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        direction: [0, 0, -1],
        distance: 12,
        origin: [2, 3, 4],
        featureId: boxId,
        onDistanceChange: onFirstDistanceChange,
        opposite: { distance: 7, onDistanceChange: onSecondDistanceChange },
      },
    )
    await waitFor(() => expect(port.showAxialTranslationGizmo).toHaveBeenCalled())
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onAxialGizmoDistanceChange?.(18))
    expect(onFirstDistanceChange).toHaveBeenCalledWith(18)
    expect(onSecondDistanceChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Second depth" }))
    await waitFor(() =>
      expect(port.showAxialTranslationGizmo).toHaveBeenLastCalledWith(
        expect.objectContaining({
          direction: [expect.closeTo(0), expect.closeTo(0), 1],
          distance: 7,
          origin: [2, 3, 4],
        }),
      ),
    )
    act(() => options?.onAxialGizmoDistanceChange?.(9))
    expect(onSecondDistanceChange).toHaveBeenCalledWith(9)
    expect(onFirstDistanceChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Second depth" }).getAttribute("aria-pressed")).toBe(
      "true",
    )

    fireEvent.click(screen.getByRole("button", { name: "First depth" }))
    await waitFor(() =>
      expect(port.showAxialTranslationGizmo).toHaveBeenLastCalledWith(
        expect.objectContaining({ direction: [0, 0, -1], distance: 12 }),
      ),
    )
    act(() => options?.onAxialGizmoDistanceChange?.(20))
    expect(onFirstDistanceChange).toHaveBeenLastCalledWith(20)
    expect(onSecondDistanceChange).toHaveBeenCalledTimes(1)
    expect(createViewport).toHaveBeenCalledTimes(1)
  })

  it("retains drag callbacks during pending preview resolution and clears them when the tool closes", async () => {
    const onDistanceChange = vi.fn()
    const { createViewport, port, rerenderAxialGizmo } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { direction: [0, 0, 1], distance: 10, origin: [0, 0, 0], featureId: boxId, onDistanceChange },
    )
    await waitFor(() => expect(port.showAxialTranslationGizmo).toHaveBeenCalled())
    const options = createViewport.mock.calls[0]?.[1]
    rerenderAxialGizmo(undefined, true)
    await waitFor(() =>
      expect(port.hideTranslationGizmo).toHaveBeenLastCalledWith({ preserveActiveGesture: true }),
    )
    act(() => options?.onAxialGizmoDistanceChange?.(17))
    expect(onDistanceChange).toHaveBeenCalledWith(17)
    rerenderAxialGizmo(undefined, false)
    await waitFor(() =>
      expect(port.hideTranslationGizmo).toHaveBeenLastCalledWith({ preserveActiveGesture: false }),
    )
    act(() => options?.onAxialGizmoDistanceChange?.(22))
    expect(onDistanceChange).toHaveBeenCalledTimes(1)
    expect(createViewport).toHaveBeenCalledTimes(1)
  })

  it("shows an angular feature gizmo and forwards scalar angle changes", async () => {
    const onAngleChange = vi.fn()
    const angularGizmo = {
      angle: Math.PI,
      axisDirection: [0, 1, 0] as const,
      axisOrigin: [2, 3, 4] as const,
      featureId: boxId,
      onAngleChange,
      rotationOrigin: [8, 3, 4] as const,
    }
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      angularGizmo,
    )

    await waitFor(() => expect(port.showAngularGizmo).toHaveBeenCalledWith(angularGizmo))
    expect(
      screen.getByRole("region", { name: "3D viewport" }).getAttribute("data-angular-gizmo-angle"),
    ).toBe(Math.PI.toString())
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onAngularGizmoAngleChange?.(Math.PI / 2))
    expect(onAngleChange).toHaveBeenCalledWith(Math.PI / 2)
  })

  it("updates and clears the tool plane without replacing meshes or viewport", async () => {
    const { port, createViewport, rerenderToolPlane } = renderViewport(readyController([], []))
    await waitFor(() => expect(port.setToolPlane).toHaveBeenCalledWith(null))
    const meshes = vi.mocked(port.setMeshes)
    const meshCalls = meshes.mock.calls.length
    const plane = { origin: [4, 5, 6], normal: [0, -1, 0], size: 30 } as const
    rerenderToolPlane(plane)
    await waitFor(() => expect(port.setToolPlane).toHaveBeenLastCalledWith(plane))
    rerenderToolPlane(null)
    await waitFor(() => expect(port.setToolPlane).toHaveBeenLastCalledWith(null))
    expect(meshes.mock.calls.length).toBe(meshCalls)
    expect(createViewport).toHaveBeenCalledTimes(1)
  })

  it("adapts bounded saved profile loops to one stable viewer region", () => {
    const [sketch] = viewerSketches(readyController([], [], [profileSketchDisplay]))

    expect(Array.from(sketch?.profiles?.[0]?.outerPositions ?? [])).toEqual([
      0, 0, 10, 0, 10, 10, 0, 10,
    ])
    expect(sketch?.profiles?.[0]?.selector).toEqual(profileSelector)
  })

  it("previews the exact hidden profile selector and clears it without changing selection", async () => {
    const onSelect = vi.fn()
    const controller = readyController([], [], [profileSketchDisplay])
    const { port, rerenderSketchProfilePreview } = renderViewport(
      controller,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect },
      undefined,
      undefined,
      undefined,
      profileSelector,
      [sketchDisplay.sketchId],
    )
    await waitFor(() => expect(port.setSketchProfilePreselection).toHaveBeenCalled())
    const shown = vi.mocked(port.setSketches).mock.calls.at(-1)?.[0] ?? []
    const profile = shown.flatMap((sketch) => sketch.profiles ?? [])[0]
    expect(profile?.selector).toEqual(profileSelector)
    expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(profile)
    expect(port.setSketchProfileSelections).toHaveBeenLastCalledWith([])
    expect(onSelect).not.toHaveBeenCalled()

    rerenderSketchProfilePreview(null)
    await waitFor(() => expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(null))
    expect(vi.mocked(port.setSketches).mock.calls.at(-1)?.[0]).toEqual([])
  })

  it("fails closed when the preview selector is stale", async () => {
    const staleSelector = {
      ...profileSelector,
      holeBoundaryEntityIds: [[fourthProfileBoundaryId]],
    }
    const { port } = renderViewport(
      readyController([], [], [profileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
      undefined,
      undefined,
      undefined,
      staleSelector,
      [sketchDisplay.sketchId],
    )
    await waitFor(() => expect(port.setSketchProfilePreselection).toHaveBeenCalled())
    expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(null)
    expect(port.setSketches).toHaveBeenLastCalledWith([])
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-source-profile-preview"),
    ).toBeNull()
  })

  it("does not resend sketches for visible hover or profile changes within one hidden sketch", async () => {
    const alternateSelector: SketchProfileSelector = {
      ...profileSelector,
      outerBoundaryEntityIds: [
        firstProfileBoundaryId,
        secondProfileBoundaryId,
        thirdProfileBoundaryId,
      ],
    }
    const baseProfile = profileSketchDisplay.profiles[0]
    if (!baseProfile) throw new Error("The saved-profile fixture must contain one profile.")
    const controller = readyController(
      [],
      [],
      [
        {
          ...profileSketchDisplay,
          profiles: [baseProfile, { ...baseProfile, selector: alternateSelector }],
        },
      ],
    )
    const { port, rerenderSketchProfilePreview } = renderViewport(
      controller,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
      undefined,
      undefined,
      undefined,
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const initialCallCount = vi.mocked(port.setSketches).mock.calls.length

    rerenderSketchProfilePreview(profileSelector, [])
    await waitFor(() =>
      expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(
        expect.objectContaining({ selector: profileSelector }),
      ),
    )
    expect(port.setSketches).toHaveBeenCalledTimes(initialCallCount)

    rerenderSketchProfilePreview(null, [])
    await waitFor(() => expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(null))
    expect(port.setSketches).toHaveBeenCalledTimes(initialCallCount)

    rerenderSketchProfilePreview({ ...alternateSelector }, [])
    await waitFor(() =>
      expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(
        expect.objectContaining({ selector: alternateSelector }),
      ),
    )
    expect(port.setSketches).toHaveBeenCalledTimes(initialCallCount)

    rerenderSketchProfilePreview(profileSelector, [sketchDisplay.sketchId])
    await waitFor(() => expect(port.setSketches).toHaveBeenCalledTimes(initialCallCount + 1))
    rerenderSketchProfilePreview({ ...alternateSelector }, [sketchDisplay.sketchId])
    await waitFor(() =>
      expect(port.setSketchProfilePreselection).toHaveBeenLastCalledWith(
        expect.objectContaining({ selector: alternateSelector }),
      ),
    )
    expect(port.setSketches).toHaveBeenCalledTimes(initialCallCount + 1)
  })

  it("reports saved profile hover and selection through semantic selectors", async () => {
    const onSelect = vi.fn()
    const controller = readyController([], [], [profileSketchDisplay])
    const { createViewport, port } = renderViewport(
      controller,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [profileSelector], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const renderedSketches = vi.mocked(port.setSketches).mock.calls.at(-1)?.[0] ?? []
    const profile = renderedSketches[0]?.profiles?.[0]
    expect(profile).toBeDefined()
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith([profile])

    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfilePreselectionChange?.(profile ?? null))
    expect(screen.getByRole("status").textContent).toContain("Select profile: Sketch 1 · Profile 1")

    act(() => options?.onSketchProfileSelectionChange?.(profile ?? null, "replace"))
    expect(onSelect).toHaveBeenCalledWith(profileSelector, [profileSelector], "replace")
  })

  it("renders every selected profile and forwards additive selection intent", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [profileSelector, secondProfileSelector], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const renderedProfiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith(renderedProfiles)
    act(() =>
      createViewport.mock.calls[0]?.[1].onSketchProfileSelectionChange?.(
        renderedProfiles[1] ?? null,
        "toggle",
      ),
    )
    expect(onSelect).toHaveBeenCalledWith(secondProfileSelector, [secondProfileSelector], "toggle")
  })

  it("keeps the model viewport free of a duplicate saved-profile menu", async () => {
    const onSelect = vi.fn()
    const { port, rerenderSketchProfilePreview } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], excludedSketchIds: [secondProfileSketchId], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    expect(screen.queryByRole("combobox", { name: "Select saved profile" })).toBeNull()
    expect(screen.queryByText("Choose a saved profile")).toBeNull()
    rerenderSketchProfilePreview(null, [sketchDisplay.sketchId, secondProfileSketchId])
    await waitFor(() => expect(port.setSketches).toHaveBeenLastCalledWith([]))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("offers eligible hidden profiles through the active task's keyboard picker", async () => {
    const onSelect = vi.fn()
    const { port, rerenderSketchProfilePreview } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        keyboardPickerActive: true,
        selectedProfiles: [profileSelector],
        excludedSketchIds: [secondProfileSketchId],
        onSelect,
      },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    rerenderSketchProfilePreview(null, [sketchDisplay.sketchId, secondProfileSketchId])
    await waitFor(() => expect(port.setSketches).toHaveBeenLastCalledWith([]))
    const picker = screen.getByRole("combobox", { name: "Select saved profile" })
    picker.focus()
    expect(document.activeElement).toBe(picker)
    const option = screen.getByRole("option", { name: "Sketch 1 · Profile 1" })
    expect(screen.queryByRole("option", { name: /Sketch 2/ })).toBeNull()
    await userEvent.selectOptions(picker, option)
    expect(onSelect).toHaveBeenLastCalledWith(profileSelector, [profileSelector], "toggle")
    await userEvent.selectOptions(picker, option)
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it("keeps the maximum supported profile set in one compact active-task picker", async () => {
    const baseProfile = profileSketchDisplay.profiles[0]
    if (!baseProfile) throw new Error("The saved-profile fixture must contain one profile.")
    const profiles = Array.from({ length: 2_000 }, (_, index) => ({
      ...baseProfile,
      selector: {
        ...profileSelector,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse(
            `0195b5ac-b220-7a2c-8c33-${String(index + 3_000).padStart(12, "0")}`,
          ),
        ],
      },
    }))
    renderViewport(
      readyController([], [], [{ ...profileSketchDisplay, profiles }]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { keyboardPickerActive: true, selectedProfiles: [], onSelect: vi.fn() },
    )

    expect(await screen.findAllByRole("combobox", { name: "Select saved profile" })).toHaveLength(1)
    expect(screen.getAllByRole("option")).toHaveLength(2_001)
  })

  it("requires an explicit choice when saved profiles overlap", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    expect(profiles).toHaveLength(2)

    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfileCandidateStackCommit?.(profiles))
    const chooser = await screen.findByRole("listbox", { name: "Select profile" })
    expect(chooser.querySelectorAll('[role="option"]')).toHaveLength(2)
    fireEvent.keyDown(chooser, { key: "ArrowDown" })
    fireEvent.keyDown(chooser, { key: "Enter" })

    expect(onSelect).toHaveBeenCalledWith(secondProfileSelector, [secondProfileSelector], "replace")
    expect(port.setSketchProfileSelections).toHaveBeenCalledWith([profiles[1]])
  })

  it("dismisses an overlapping-profile chooser when rendered sketches change", async () => {
    const { createViewport, port, rerenderController } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    act(() => createViewport.mock.calls[0]?.[1].onSketchProfileCandidateStackCommit?.(profiles))
    await screen.findByRole("listbox", { name: "Select profile" })

    rerenderController(readyController([], [], [profileSketchDisplay]))
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Select profile" })).toBeNull(),
    )
  })

  it("dismisses an overlapping-profile chooser after another canvas selection", async () => {
    const { createViewport, port } = renderViewport(
      readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay]),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { selectedProfiles: [], onSelect: vi.fn() },
    )
    await waitFor(() => expect(port.setSketches).toHaveBeenCalled())
    const profiles =
      vi
        .mocked(port.setSketches)
        .mock.calls.at(-1)?.[0]
        .flatMap((sketch) => sketch.profiles ?? []) ?? []
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchProfileCandidateStackCommit?.(profiles))
    await screen.findByRole("listbox", { name: "Select profile" })

    act(() => options?.onSketchProfileSelectionChange?.(profiles[0] ?? null, "replace"))
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Select profile" })).toBeNull(),
    )
  })

  it("replaces the committed sketch display with the active unsaved display", () => {
    const committedDisplay = viewerSketchDisplay(sketchDisplay)
    const activeDisplay = {
      ...committedDisplay,
      curvePositions: new Float32Array([5, 0, 0, 25, 0, 0]),
    }

    expect(withActiveSketchDisplay([committedDisplay], activeDisplay)).toEqual([activeDisplay])
    expect(withActiveSketchDisplay([committedDisplay], null)).toEqual([committedDisplay])
  })

  it("uses solved world coordinates for Bezier handles in saved and active previews", () => {
    const pointIds = profileBoundaryIds
    const authored = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchDisplay.sketchId,
      label: "Spline",
      plane: "xz",
      entities: [
        ...pointIds.map((id, index) => ({
          schemaVersion: 0,
          id,
          type: "point",
          x: index,
          y: index,
        })),
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f2615",
          type: "cubic-bezier",
          startPointId: pointIds[0],
          control1PointId: pointIds[1],
          control2PointId: pointIds[2],
          endPointId: pointIds[3],
        },
      ],
      constraints: [],
    })
    const solved: SketchDisplayRecord = {
      ...sketchDisplay,
      solvedPoints: pointIds.map((entityId, index) => ({
        entityId,
        position: [10 + index, 20, 30 + index],
      })),
    }
    const expectedControls = new Float32Array([11, 20, 31, 12, 20, 32])
    const expectedHandles = new Float32Array([10, 20, 30, 11, 20, 31, 13, 20, 33, 12, 20, 32])
    const active = viewerSketchDisplay(solved, authored)
    expect(active.controlPointPositions).toEqual(expectedControls)
    expect(active.controlHandlePositions).toEqual(expectedHandles)
    expect(active.curvePositions).toBe(solved.curvePositions)
    expect(active.pointPositions).toBe(solved.pointPositions)
    const controller = readyController([], [], [solved])
    if (!controller.report) throw new Error("The saved document must have a report.")
    const savedController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { ...controller.report.snapshot, sketches: [authored] },
      },
    }
    expect(viewerSketches(savedController)[0]).toEqual(active)

    expect(viewerSketchDisplay(solved).controlHandlePositions).toBeUndefined()
    expect(viewerSketchDisplay(sketchDisplay, authored).controlHandlePositions).toBeUndefined()
    expect(
      viewerSketchDisplay(solved, { ...authored, id: sketchIdSchema.parse(boxId) })
        .controlHandlePositions,
    ).toBeUndefined()
    expect(
      viewerSketchDisplay({ ...solved, solvedPoints: solved.solvedPoints?.slice(1) }, authored)
        .controlHandlePositions,
    ).toBeUndefined()
  })

  it("keeps the active 3D sketch display out of the normal 2D editor", () => {
    const committedDisplay = viewerSketchDisplay(sketchDisplay)
    const activeDisplay = {
      ...committedDisplay,
      curvePositions: new Float32Array([5, 0, 0, 25, 0, 0]),
    }

    expect(withActiveSketchDisplay([], activeDisplay, false)).toEqual([])
    expect(withActiveSketchDisplay([], activeDisplay, true)).toEqual([activeDisplay])
  })

  it("preserves the viewer and camera while passive context disables chrome and input", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const frame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } as const
    const { container, createViewport, port, rerenderSketchContext, unmount } =
      renderViewport(controller)
    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }]),
    )
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.fit).toHaveBeenCalledTimes(1)

    rerenderSketchContext({
      frame,
      mode: "normal",
      referenceSelection: {
        candidates: [
          {
            kind: "model-point",
            label: "Box · Vertex 1",
            featureId: boxId,
            candidateId: "vertex-1",
            position: [0, 0, 0],
          },
        ],
        onSelect: vi.fn(),
      },
    })
    const viewport = container.querySelector<HTMLElement>("[data-passive='true']")
    expect(viewport).not.toBeNull()
    if (!viewport) return
    expect(viewport.getAttribute("data-passive")).toBe("true")
    expect(viewport.getAttribute("aria-hidden")).toBe("true")
    expect(viewport.className).toContain("pointer-events-none")
    expect(viewport.querySelector("canvas")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "3D viewport" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Fit view" })).toBeNull()
    expect(screen.queryByRole("img", { name: "World axes" })).toBeNull()
    expect(screen.queryByText("XYZ · mm")).toBeNull()
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("camera-only")
    expect(port.setSketchReferenceCandidates).toHaveBeenLastCalledWith([])
    expect(port.orientToFrame).toHaveBeenCalledTimes(1)
    expect(port.orientToFrame).toHaveBeenCalledWith(frame)
    expect(port.dispose).not.toHaveBeenCalled()

    rerenderSketchContext({ frame, mode: "orbit" })
    const orbitViewport = container.querySelector<HTMLElement>("[data-sketch-context-mode='orbit']")
    expect(orbitViewport?.className).not.toContain("pointer-events-none")
    expect(screen.getByRole("button", { name: "Standard views" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Fit view" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "World axes" })).toBeTruthy()
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("camera-only")
    expect(port.orientToFrame).toHaveBeenCalledTimes(1)

    rerenderSketchContext({ frame, mode: "normal" })
    expect(port.orientToFrame).toHaveBeenCalledTimes(2)

    rerenderSketchContext()
    expect(screen.getByRole("region", { name: "3D viewport" })).toBeTruthy()
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("select")
    expect(port.dispose).not.toHaveBeenCalled()

    unmount()
    expect(port.dispose).toHaveBeenCalledTimes(1)
  })

  it("does not replace viewer meshes for save-status-only controller updates", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const { port, rerenderController } = renderViewport(controller)
    await waitFor(() => expect(port.setMeshes).toHaveBeenCalledTimes(1))

    for (const saveStatus of ["saving", "saved", "error"] as const) {
      vi.mocked(port.setMeshes).mockClear()
      rerenderController({ ...controller, saveStatus } as DocumentControllerState)
      await act(async () => {})
      expect(port.setMeshes).not.toHaveBeenCalled()
    }

    const replacementMesh = {
      ...mesh,
      positions: new Float32Array([0, 0, 0, 30, 0, 0, 0, 30, 0]),
    }
    const replacement = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh: replacementMesh } }],
    )
    rerenderController(replacement)
    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...replacementMesh }]),
    )
  })

  it("applies sketch projection updates imperatively without remounting the viewer", async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const frame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } as const
    const store = createSketchProjectionStore()
    const firstBounds = { minX: -100, minY: -75, width: 200, height: 150 }
    store.getState().publish({ frame, bounds: firstBounds })
    const { createViewport, port, rerenderSketchContext } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      { frame, mode: "normal", projectionStore: store },
    )

    await waitFor(() => expect(port.setSketchProjection).toHaveBeenCalledWith(frame, firstBounds))
    expect(createViewport).toHaveBeenCalledTimes(1)
    const referenceCandidateCalls = vi.mocked(port.setSketchReferenceCandidates).mock.calls.length
    const interactionModeCalls = vi.mocked(port.setInteractionMode).mock.calls.length
    const secondBounds = { minX: -50, minY: -40, width: 100, height: 80 }
    const latestBounds = { minX: -40, minY: -30, width: 80, height: 60 }
    act(() => store.getState().publish({ frame, bounds: secondBounds }))
    act(() => store.getState().publish({ frame, bounds: latestBounds }))
    expect(frames).toHaveLength(1)
    expect(port.setSketchProjection).toHaveBeenCalledTimes(1)
    const projectionFrame = frames.shift()
    if (!projectionFrame) throw new Error("The latest sketch projection must schedule a frame.")
    act(() => projectionFrame(0))
    expect(port.setSketchProjection).toHaveBeenLastCalledWith(frame, latestBounds)
    expect(port.setSketchReferenceCandidates).toHaveBeenCalledTimes(referenceCandidateCalls)
    expect(port.setInteractionMode).toHaveBeenCalledTimes(interactionModeCalls)
    act(() => store.getState().publishCameraProjection({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }))
    expect(frames).toHaveLength(0)

    rerenderSketchContext({ frame, mode: "orbit", projectionStore: store })
    expect(port.clearSketchProjection).toHaveBeenCalled()
    const callsBeforeOrbitUpdate = vi.mocked(port.setSketchProjection).mock.calls.length
    act(() => store.getState().publish({ frame, bounds: firstBounds }))
    expect(vi.mocked(port.setSketchProjection).mock.calls).toHaveLength(callsBeforeOrbitUpdate)

    rerenderSketchContext({ frame, mode: "normal", projectionStore: store })
    expect(port.setSketchProjection).toHaveBeenLastCalledWith(frame, firstBounds)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("routes normal-sketch inset navigation through the current input and camera-mode callback", async () => {
    const store = createSketchProjectionStore()
    const drawing = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    store.getState().setNavigationElement(drawing)
    const onOrientationNavigationStart = vi.fn()
    const { createViewport, port, rerenderSketchContext } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      { frame: null, mode: "normal", projectionStore: store, onOrientationNavigationStart },
    )
    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    const options = createViewport.mock.calls[0]?.[1]
    if (!options) throw new Error("The viewer must receive its orientation input callbacks.")
    expect(options.orientationInputElement?.()).toBe(drawing)
    expect(port.setSketchNavigationElement).toHaveBeenLastCalledWith(null)
    act(() => options.onOrientationNavigationStart?.())
    expect(onOrientationNavigationStart).toHaveBeenCalledTimes(1)

    const replacement = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    act(() => store.getState().setNavigationElement(replacement))
    expect(options.orientationInputElement?.()).toBe(replacement)
    rerenderSketchContext({ frame: null, mode: "orbit", projectionStore: store })
    act(() => options.onOrientationNavigationStart?.())
    expect(onOrientationNavigationStart).toHaveBeenCalledTimes(1)
    expect(port.setSketchNavigationElement).toHaveBeenLastCalledWith(replacement)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("observes the orbit sketch plane without aligning the camera and forwards its navigation element", async () => {
    const frame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } as const
    const store = createSketchProjectionStore()
    const navigationElement = document.createElement("div")
    store.getState().setNavigationElement(navigationElement)
    const { port, rerenderSketchContext } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      { frame, mode: "orbit", projectionStore: store },
    )

    await waitFor(() =>
      expect(port.setSketchPlaneProjection).toHaveBeenCalledWith(frame, expect.any(Function)),
    )
    expect(port.setSketchNavigationElement).toHaveBeenCalledWith(navigationElement)
    expect(port.orientToFrame).not.toHaveBeenCalled()

    const projection = { a: 1, b: 0, c: 0, d: 1, e: 0.5, f: 0.5 }
    const onProjectionChange = vi.mocked(port.setSketchPlaneProjection).mock.calls.at(-1)?.[1]
    onProjectionChange?.(projection)
    expect(store.getState().cameraProjection).toEqual(projection)
    const planeProjectionCalls = vi.mocked(port.setSketchPlaneProjection).mock.calls.length

    act(() => store.getState().setNavigationElement(null))
    expect(port.setSketchNavigationElement).toHaveBeenLastCalledWith(null)
    expect(port.setSketchPlaneProjection).toHaveBeenCalledTimes(planeProjectionCalls)

    rerenderSketchContext({ frame, mode: "orbit", pointerOrbit: true })
    expect(port.setPointerOrbit).toHaveBeenLastCalledWith(true)
    expect(port.setSketchNavigationElement).toHaveBeenLastCalledWith(null)

    rerenderSketchContext({ frame, mode: "normal", projectionStore: store })
    expect(port.setPointerOrbit).toHaveBeenLastCalledWith(false)
    expect(port.setSketchPlaneProjection).toHaveBeenLastCalledWith(null)
    expect(port.setSketchNavigationElement).toHaveBeenLastCalledWith(null)
  })

  it("routes graphical sketch-reference hover and selection through the persistent 3D viewer", async () => {
    const candidate = {
      kind: "point" as const,
      label: "Source · Point",
      position: [2, 3, 0] as const,
      sourcePointId: "point-1",
      sourceSketchId: "sketch-1",
    }
    const lineCandidate = {
      kind: "line" as const,
      label: "Source · Line",
      start: [0, 0, 0] as const,
      end: [10, 0, 0] as const,
      sourceLineId: "line-1",
      sourceSketchId: "sketch-1",
    }
    const modelPointCandidate = {
      kind: "model-point" as const,
      label: "Box · Vertex 1",
      featureId: boxId,
      candidateId: "vertex-1",
      position: [2, 3, 4] as const,
    }
    const modelLineCandidate = {
      kind: "model-line" as const,
      label: "Box · Edge 1",
      featureId: boxId,
      candidateId: "edge-1",
      start: [0, 0, 0] as const,
      end: [10, 0, 0] as const,
    }
    const modelCurveCandidate = {
      kind: "model-curve" as const,
      label: "Cylinder · Circular edge 1",
      featureId: boxId,
      candidateId: "circle-1",
      points: [
        [5, 0, 0],
        [0, 5, 0],
        [-5, 0, 0],
        [0, -5, 0],
        [5, 0, 0],
      ] as const,
      sourceType: "circle" as const,
    }
    const onSelect = vi.fn()
    const controller = readyController([], [])
    const { createViewport, port } = renderViewport(
      controller,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        frame: null,
        mode: "orbit",
        referenceSelection: {
          candidates: [
            candidate,
            lineCandidate,
            modelPointCandidate,
            modelLineCandidate,
            modelCurveCandidate,
          ],
          onSelect,
        },
      },
    )

    await waitFor(() =>
      expect(port.setSketchReferenceCandidates).toHaveBeenCalledWith([
        candidate,
        lineCandidate,
        modelPointCandidate,
        modelLineCandidate,
        modelCurveCandidate,
      ]),
    )
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("sketch-reference-select")
    const options = createViewport.mock.calls[0]?.[1]
    act(() => options?.onSketchReferencePreselectionChange?.(candidate))
    expect(screen.getByText("Use reference: Source · Point", { exact: true }).textContent).toBe(
      "Use reference: Source · Point",
    )

    act(() =>
      options?.onSketchReferenceCandidateStackChange?.([
        candidate,
        lineCandidate,
        modelPointCandidate,
      ]),
    )
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    const selectOther = screen.getByRole("listbox", { name: "Select other reference" })
    expect(document.activeElement).toBe(selectOther)
    expect(selectOther.getAttribute("aria-activedescendant")).toBe(
      "sketch-reference-select-other-0",
    )
    expect(
      screen.getByRole("option", { name: "1/3 Source · Point" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(candidate)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    expect(
      screen.getByRole("option", { name: "2/3 Source · Line" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(selectOther.getAttribute("aria-activedescendant")).toBe(
      "sketch-reference-select-other-1",
    )
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(lineCandidate)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`", shiftKey: true })
    expect(
      screen.getByRole("option", { name: "1/3 Source · Point" }).getAttribute("aria-selected"),
    ).toBe("true")
    fireEvent.keyDown(viewport, { key: "Enter" })
    expect(onSelect).toHaveBeenLastCalledWith(candidate)
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.keyDown(viewport, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(candidate)

    fireEvent.pointerLeave(viewport)
    expect(port.setSketchReferencePreselection).toHaveBeenLastCalledWith(null)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.click(screen.getByRole("option", { name: "3/3 Box · Vertex 1" }))
    expect(onSelect).toHaveBeenLastCalledWith(modelPointCandidate)
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Select other reference" }),
    )
    act(() => options?.onSketchReferenceCandidateStackChange?.([]))
    expect(screen.queryByRole("listbox", { name: "Select other reference" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    options?.onSketchReferenceSelectionChange?.(candidate)
    expect(onSelect).toHaveBeenCalledWith(candidate)
    act(() => options?.onSketchReferencePreselectionChange?.(lineCandidate))
    expect(screen.getByText("Use reference: Source · Line", { exact: true })).toBeTruthy()
    options?.onSketchReferenceSelectionChange?.(lineCandidate)
    expect(onSelect).toHaveBeenCalledWith(lineCandidate)
    options?.onSketchReferenceSelectionChange?.(modelPointCandidate)
    options?.onSketchReferenceSelectionChange?.(modelLineCandidate)
    options?.onSketchReferenceSelectionChange?.(modelCurveCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelPointCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelLineCandidate)
    expect(onSelect).toHaveBeenCalledWith(modelCurveCandidate)

    fireEvent.change(
      screen.getByRole("combobox", { name: "Select a reference with the keyboard" }),
      {
        target: { value: "4" },
      },
    )
    expect(onSelect).toHaveBeenLastCalledWith(modelCurveCandidate)
  })

  it("uses exact transient reference eligibility for curved hits and consumes background clicks", async () => {
    const selected = { featureId: boxId, outputRole: "right", faceId: 42, faceOrdinal: 1 }
    const onSelect = vi.fn()
    const allowed = (hit: ViewerSelection) =>
      hit.featureId === boxId && hit.outputRole === "right" && hit.faceId === 42
    const committed = { featureId: boxId, outputRole: "right", ...mesh }
    const disposable = { featureId: booleanId, appearance: "preview" as const, ...mesh }
    const { createViewport, onSelectionChange, port, rerenderSketchContext } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      ),
      null,
      undefined,
      { status: "ready", kind: "extrusion", meshes: [disposable] },
      undefined,
      undefined,
      {
        frame: null,
        mode: "orbit",
        faceIntersectionSelection: {
          consumeBackground: true,
          isCandidateEligible: allowed,
          selectionMeshes: [committed],
          status: "Select an end face",
          onSelect,
        },
      },
    )
    await waitFor(() => expect(port.setMeshes).toHaveBeenLastCalledWith([committed]))
    expect(port.setInteractionMode).toHaveBeenLastCalledWith("face-select")
    const options = createViewport.mock.calls[0]?.[1]
    expect(options?.isSelectionCandidateEligible?.(selected)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.({ ...selected, outputRole: "left" })).toBe(false)
    act(() => {
      options?.onSelectionChange?.({ ...selected, outputRole: "left" })
      options?.onSelectionChange?.(null)
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
    act(() => options?.onSelectionChange?.(selected))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(selected)
    expect(screen.getByText("Select an end face")).toBeTruthy()
    rerenderSketchContext({ frame: null, mode: "orbit" })
    await waitFor(() => expect(port.setMeshes).toHaveBeenLastCalledWith([disposable]))
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("routes planar-face intersection selection through eligible face-only picking in orbit mode", async () => {
    const selection = { featureId: boxId, faceId: 17, faceOrdinal: 3 }
    const onSelect = vi.fn()
    const { createViewport, onSelectionChange, port } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      ),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        frame: null,
        mode: "orbit",
        faceIntersectionSelection: { onSelect },
      },
    )

    await waitFor(() => expect(port.setInteractionMode).toHaveBeenLastCalledWith("face-select"))
    expect(screen.getByText("Intersection · Select one planar model face")).toBeTruthy()
    const options = createViewport.mock.calls[0]?.[1]
    options?.onSelectionChange?.(selection)
    expect(onSelect).toHaveBeenCalledWith(selection)
    expect(onSelectionChange).not.toHaveBeenCalled()

    options?.onSelectionChange?.(null)
    expect(onSelectionChange).toHaveBeenCalledWith(null)
  })

  it("keeps structured Extrude preview diagnostics as a compact status instead of a duplicate alert", () => {
    renderViewport(readyController([], []), null, undefined, {
      status: "error",
      kind: "extrusion",
      meshes: [],
      diagnostics: [
        {
          entity: { kind: "feature", id: featureIdSchema.parse(boxId) },
          code: "org.vibeshape.feature.sketch-profile-missing",
          values: {},
          action: "inspect-feature",
        },
      ],
    })
    expect(screen.getByRole("status").textContent).toBe(
      "Preview unavailable. Open the task panel for details.",
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("retains a preview failure alert when no structured error details are available", () => {
    renderViewport(readyController([], []), null, undefined, {
      status: "error",
      kind: "extrusion",
      meshes: [],
    })
    expect(screen.getByRole("alert").textContent).toBe(
      "The unsaved feature could not be previewed. Adjust its parameters or target.",
    )
  })

  it("renders exact unsaved meshes as a distinct preview state", async () => {
    const previewMesh = { featureId: boxId, appearance: "preview" as const, ...mesh }
    const { port } = renderViewport(readyController([], []), null, undefined, {
      status: "ready",
      meshes: [previewMesh],
    })

    await waitFor(() => expect(port.setMeshes).toHaveBeenCalledWith([previewMesh]))
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-preview-status")).toBe("ready")
    expect(viewport.getAttribute("data-preview-feature-count")).toBe("1")
    expect(screen.getByRole("status").textContent).toBe("Unsaved feature preview")
  })

  it("keeps the last exact Placement pose visible while its replacement is pending", async () => {
    const previewMesh = { featureId: boxId, appearance: "preview" as const, ...mesh }
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const { port } = renderViewport(controller, null, undefined, {
      status: "loading",
      retained: true,
      meshes: [previewMesh],
    })
    await waitFor(() => expect(port.setMeshes).toHaveBeenLastCalledWith([previewMesh]))
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-preview-status")).toBe("loading")
    expect(viewport.getAttribute("data-preview-feature-count")).toBe("1")
  })

  it("displays only disposable task meshes and marks them ready after the viewer receives them", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const previewMeshes = [taskPreviewMesh]
    const onReady = vi.fn()
    let resolveViewport: (viewport: GeometryViewportPort) => void = () => {
      throw new Error("The deferred viewer is not initialized.")
    }
    const pendingViewport = new Promise<GeometryViewportPort>((resolve) => {
      resolveViewport = resolve
    })
    const { createViewport, port, unmount } = renderTaskViewport(
      controller,
      {
        activityKey: "lightweighting",
        panel: null,
        interaction: null,
        preview: { meshes: previewMeshes, onReady },
      },
      pendingViewport,
    )
    expect(createViewport).toHaveBeenCalledTimes(1)
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(onReady).toHaveBeenLastCalledWith(false)
    expect(onReady).not.toHaveBeenCalledWith(true)
    expect(port.setMeshes).not.toHaveBeenCalled()
    await act(async () => resolveViewport(port))
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true))
    expect(port.setMeshes).toHaveBeenLastCalledWith(previewMeshes)
    expect(
      vi
        .mocked(port.setMeshes)
        .mock.calls.every(([meshes]) =>
          meshes.every(({ featureId }) => featureId === "task-preview"),
        ),
    ).toBe(true)
    const firstReadyIndex = onReady.mock.calls.findIndex(([ready]) => ready === true)
    const readyOrder = onReady.mock.invocationCallOrder[firstReadyIndex]
    const meshesOrder = vi.mocked(port.setMeshes).mock.invocationCallOrder[0]
    if (readyOrder === undefined || meshesOrder === undefined)
      throw new Error("Both presentation and readiness callbacks are required.")
    expect(readyOrder).toBeGreaterThan(meshesOrder)
    unmount()
    expect(onReady).toHaveBeenLastCalledWith(false)
    expect(port.dispose).toHaveBeenCalledTimes(1)
  })

  it.each(["cancel", "invalidate"])(
    "restores committed meshes and releases preview readiness on task %s",
    async (reason) => {
      const controller = readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      )
      const onReady = vi.fn()
      const task = {
        activityKey: "lightweighting",
        panel: null,
        interaction: null,
        preview: {
          meshes: [taskPreviewMesh],
          onReady,
        },
      }
      const { port, rerenderWorkspaceTask } = renderTaskViewport(controller, task)
      await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true))
      rerenderWorkspaceTask(reason === "cancel" ? null : { ...task, preview: null })
      await waitFor(() =>
        expect(port.setMeshes).toHaveBeenLastCalledWith([{ featureId: boxId, ...mesh }]),
      )
      expect(onReady).toHaveBeenLastCalledWith(false)
      expect(port.dispose).not.toHaveBeenCalled()
    },
  )

  it("uses the pristine source for task face picking and hides the disposable preview", async () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )
    const onReady = vi.fn()
    const onFacePick = vi.fn(() => true)
    const sourceMesh = { featureId: boxId, ...mesh }
    const task = {
      activityKey: "lightweighting",
      panel: null,
      interaction: { sourceMesh, picking: false, onFacePick, overlays: [] },
      preview: {
        meshes: [taskPreviewMesh],
        onReady,
      },
    }
    const { port, createViewport, onSelectionChange, rerenderWorkspaceTask } = renderTaskViewport(
      controller,
      task,
    )
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true))
    rerenderWorkspaceTask({ ...task, interaction: { ...task.interaction, picking: true } })
    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenLastCalledWith([
        { featureId: booleanId, ...mesh },
        { ...sourceMesh, appearance: "model" },
      ]),
    )
    expect(onReady).toHaveBeenLastCalledWith(false)
    const selection = { featureId: boxId, faceId: 1, faceOrdinal: 1 }
    act(() => createViewport.mock.calls[0]?.[1].onSelectionChange?.(selection))
    expect(onFacePick).toHaveBeenCalledWith(selection)
    expect(onSelectionChange).not.toHaveBeenCalled()
    const presentedSource = vi
      .mocked(port.setMeshes)
      .mock.lastCall?.[0].find(({ featureId }) => featureId === boxId)
    expect(presentedSource?.positions).toBe(mesh.positions)
    expect(presentedSource?.positions).not.toBe(taskPreviewMesh.positions)
  })

  it.each([
    ["loading", "Rebuilding unsaved feature preview…"],
    ["ready", "Unsaved feature preview"],
    ["error", "The unsaved feature could not be previewed. Adjust its dimensions or placement."],
  ] as const)("labels exact primitive preview %s", (status, label) => {
    renderViewport(readyController([], []), null, undefined, {
      status,
      kind: "primitive",
      meshes: [],
    })
    expect(screen.getByText(label).getAttribute("role")).toBe(
      status === "error" ? "alert" : "status",
    )
  })

  it("owns the imperative viewer lifecycle and exposes fit for rebuilt terminal geometry", async () => {
    const user = userEvent.setup()
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const selection = { featureId: boxId, faceId: 7, faceOrdinal: 2 }
    const { createViewport, onSelectionChange, port, unmount } = renderViewport(
      controller,
      selection,
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    expect(createViewport).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ onSelectionChange: expect.any(Function) }),
    )
    createViewport.mock.calls[0]?.[1].onSelectionChange?.(selection)
    expect(onSelectionChange).toHaveBeenCalledWith(selection)
    expect(port.setMeshes).toHaveBeenCalledWith([{ featureId: boxId, ...mesh }])
    expect(port.setOriginPlaneVisibility).toHaveBeenCalledWith({ xy: true, xz: true, yz: true })
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith(null, false, false)
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-rendered-feature-count"),
    ).toBe("1")
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("img", { name: "World axes" }).textContent).toBe("")
    expect(screen.queryByText("XYZ · mm")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Fit view" }))
    expect(port.fit).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole("button", { name: "Standard views" }))
    await user.click(screen.getByRole("menuitem", { name: "Front" }))
    expect(port.setStandardView).toHaveBeenCalledWith("front")
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(port.clearSelection).toHaveBeenCalledTimes(1)

    unmount()
    expect(port.dispose).toHaveBeenCalledTimes(1)
  })

  it("preserves the camera when rebuilt geometry replaces the displayed mesh", async () => {
    const firstController = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const updatedMesh = {
      ...mesh,
      positions: new Float32Array([0, 0, 0, 30, 0, 0, 0, 30, 0]),
    }
    const { port, rerenderController } = renderViewport(firstController)

    await waitFor(() => expect(port.fit).toHaveBeenCalledTimes(1))
    rerenderController(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh: updatedMesh } }],
      ),
    )

    await waitFor(() =>
      expect(port.setMeshes).toHaveBeenLastCalledWith([{ featureId: boxId, ...updatedMesh }]),
    )
    expect(port.fit).toHaveBeenCalledTimes(1)
  })

  it("keeps the viewer mounted when sketch plane callbacks change and forwards the latest actions", async () => {
    const controller = readyController([], [])
    const port = renderViewport(controller).port
    await waitFor(() => expect(port.fit).toHaveBeenCalledTimes(1))
    cleanup()
    vi.mocked(port.fit).mockClear()
    vi.mocked(port.dispose).mockClear()
    const createViewport = vi.fn(
      async (_canvas: HTMLCanvasElement, _options: GeometryViewportOptions) => port,
    )
    const idlePlaneSelect = vi.fn()
    const createPlaneSelect = vi.fn()
    const initialSelection = vi.fn()
    const currentSelection = vi.fn()
    const element = (creating: boolean) => (
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <GeometryViewport
            controller={controller}
            createViewport={createViewport}
            onSelectionChange={creating ? currentSelection : initialSelection}
            selection={null}
            {...(creating
              ? {
                  originPlaneSelection: {
                    mode: "create" as const,
                    selectedPlane: null,
                    onSelect: createPlaneSelect,
                  },
                }
              : { idleOriginPlaneSelection: { selectedPlane: null, onSelect: idlePlaneSelect } })}
          />
        </TooltipProvider>
      </I18nProvider>
    )
    const { rerender } = render(element(false))
    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    const options = createViewport.mock.calls[0]?.[1] as GeometryViewportOptions | undefined
    options?.onOriginPlaneSelectionChange?.("xy")
    expect(idlePlaneSelect).toHaveBeenCalledWith("xy")
    rerender(element(true))
    options?.onOriginPlaneSelectionChange?.("xz")
    options?.onSelectionChange?.({ featureId: boxId, faceId: 7, faceOrdinal: 2 })
    expect(createPlaneSelect).toHaveBeenCalledWith("xz")
    expect(currentSelection).toHaveBeenCalledTimes(1)
    expect(initialSelection).not.toHaveBeenCalled()
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
  })

  it("preserves the current standard view through history navigation and failed or empty rebuilds", async () => {
    const first = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const { createViewport, port, rerenderController, rerenderSketchContext } =
      renderViewport(first)
    await waitFor(() => expect(port.fit).toHaveBeenCalledTimes(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Standard views" }))
    await user.click(screen.getByRole("menuitem", { name: "Isometric" }))
    expect(port.setStandardView).toHaveBeenLastCalledWith("isometric")

    const frame = sketchDisplay.frame
    rerenderSketchContext({ frame, mode: "orbit" })
    expect(port.setSketchPlaneProjection).toHaveBeenLastCalledWith(frame, expect.any(Function))
    rerenderSketchContext({ frame: null, mode: "orbit" })
    rerenderSketchContext()
    for (const controller of [
      readyController([], []),
      { ...first, status: "loading" as const },
      { ...first, report: { ...first.report, rebuild: { ok: false } } } as DocumentControllerState,
      first,
    ]) {
      rerenderController(controller)
    }
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()
    expect(port.fit).toHaveBeenCalledTimes(1)
    expect(port.setStandardView).toHaveBeenCalledTimes(1)
    expect(port.orientToFrame).not.toHaveBeenCalled()
    expect(port.setSketchProjection).not.toHaveBeenCalled()
  })

  it("renders only terminal feature geometry and retains origin-plane context for an empty model", async () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )
    expect(viewerMeshes(controller)).toEqual([{ featureId: booleanId, ...mesh }])
    expect(viewerMeshes(controller, [booleanId])).toEqual([])

    const empty = renderViewport(readyController([], []))
    await waitFor(() => expect(empty.createViewport).toHaveBeenCalledTimes(1))
    expect(screen.getByText("Create a feature to display its rebuilt geometry.").textContent).toBe(
      "Create a feature to display its rebuilt geometry.",
    )
  })

  it("highlights hovered and opened features by exact identity, including historical geometry", async () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )
    const { port } = renderViewport(controller, null, undefined, undefined, undefined, {
      preselectedFeatureId: booleanId,
      selectedFeatureId: boxId,
    })

    await waitFor(() =>
      expect(port.setFeatureSelection).toHaveBeenLastCalledWith({ featureId: boxId, ...mesh }),
    )
    expect(port.setFeaturePreselection).toHaveBeenLastCalledWith({
      featureId: booleanId,
      ...mesh,
    })
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-selected-feature")).toBe(boxId)
    expect(viewport.getAttribute("data-preselected-feature")).toBe(booleanId)
  })

  it("uses the unsaved candidate mesh for an opened feature highlight", async () => {
    const previewMesh = {
      featureId: boxId,
      appearance: "preview" as const,
      ...mesh,
      positions: new Float32Array([0, 0, 0, 40, 0, 0, 0, 40, 0]),
    }
    const { port } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
      ),
      null,
      undefined,
      { status: "ready", meshes: [previewMesh], candidateMesh: previewMesh },
      undefined,
      { selectedFeatureId: boxId },
    )

    await waitFor(() => expect(port.setFeatureSelection).toHaveBeenLastCalledWith(previewMesh))
  })

  it("renders exact saved sketches with the model and filters hidden sketch identities", async () => {
    const controller = readyController([], [], [sketchDisplay])
    expect(viewerSketches(controller)).toEqual<unknown>([sketchDisplay])
    expect(viewerSketches(controller, [sketchDisplay.sketchId])).toEqual([])

    const { port } = renderViewport(controller)
    await waitFor(() => expect(port.setSketches).toHaveBeenCalledWith([sketchDisplay]))
    expect(
      screen
        .getByRole("region", { name: "3D viewport" })
        .getAttribute("data-rendered-sketch-count"),
    ).toBe("1")
    expect(screen.queryByText("Create a feature to display its rebuilt geometry.")).toBeNull()
  })

  it("renders datum planes as reference geometry while keeping them independently hideable", () => {
    const datumFeature = {
      schemaVersion: 0,
      id: datumId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(10),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }
    const controller = readyController(
      [{ id: boxId, dependencies: [] }, datumFeature],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: datumId, geometry: { mesh } },
      ],
    )

    expect(viewerMeshes(controller)).toEqual([
      { featureId: boxId, ...mesh },
      { featureId: datumId, appearance: "datum", ...mesh },
    ])
    expect(viewerMeshes(controller, [datumId])).toEqual([{ featureId: boxId, ...mesh }])
  })

  it("reveals the previous terminal body only for transient sketch-edit rollback", () => {
    const controller = readyController(
      [
        { id: boxId, dependencies: [] },
        { id: booleanId, dependencies: [boxId] },
      ],
      [
        { featureId: boxId, geometry: { mesh } },
        { featureId: booleanId, geometry: { mesh } },
      ],
    )

    expect(viewerMeshes(controller)).toEqual([{ featureId: booleanId, ...mesh }])
    expect(viewerMeshes(controller, [booleanId])).toEqual([])
    expect(viewerMeshes(controller, [], [booleanId])).toEqual([{ featureId: boxId, ...mesh }])
  })

  it("initializes an empty 3D viewport for origin-plane preselection and selection", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(readyController([], []), null, {
      mode: "create",
      selectedPlane: "xz",
      onSelect,
    })

    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    expect(port.setMeshes).toHaveBeenCalledWith([])
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith("xz", true, false)
    expect(screen.queryByText("Create a feature to display its rebuilt geometry.")).toBeNull()
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-selection")).toBe("xz")

    const options = createViewport.mock.calls[0]?.[1]
    options?.onOriginPlanePreselectionChange?.("yz")
    await waitFor(() => expect(viewport.getAttribute("data-origin-plane-preselection")).toBe("yz"))
    expect(screen.getByText("Click to sketch on YZ plane").textContent).toBe(
      "Click to sketch on YZ plane",
    )
    options?.onOriginPlaneSelectionChange?.("xy")
    expect(onSelect).toHaveBeenCalledWith("xy")
  })

  it("keeps an idle origin-plane selection visible without activating support selection", async () => {
    const onSelect = vi.fn()
    const { createViewport, port } = renderViewport(
      readyController([], []),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        selectedPlane: "yz",
        onSelect,
      },
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    expect(port.setOriginPlaneSelection).toHaveBeenCalledWith("yz", false, true)
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-selection")).toBe("yz")

    const options = createViewport.mock.calls[0]?.[1]
    options?.onOriginPlaneSelectionChange?.("xz")
    expect(onSelect).toHaveBeenCalledWith("xz")
    options?.onOriginPlaneSelectionChange?.(null)
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("explains graphical support replacement without highlighting a false origin plane", async () => {
    const { port } = renderViewport(readyController([], []), null, {
      mode: "replace",
      selectedPlane: null,
      onSelect: vi.fn(),
    })

    await waitFor(() =>
      expect(port.setOriginPlaneSelection).toHaveBeenCalledWith(null, true, false),
    )
    expect(
      screen.getByText(
        "Select an earlier origin plane, datum plane, or supported planar model face to replace the sketch support.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("Current support: model face")).toBeTruthy()
  })

  it("labels and disambiguates overlapping model faces for sketch support", async () => {
    const boxSelection = { featureId: boxId, faceId: 3, faceOrdinal: 99 }
    const extrusionSelection = { featureId: booleanId, faceId: 7, faceOrdinal: 88 }
    const extrusionSideSelection = { featureId: booleanId, faceId: 9, faceOrdinal: 77 }
    const unsupportedSelection = { featureId: booleanId, faceId: 11, faceOrdinal: 66 }
    const { createViewport, onSelectionChange, port } = renderViewport(
      readyController(
        [
          { id: boxId, dependencies: [], label: "Box 1" },
          { id: booleanId, dependencies: [], label: "Extrusion 1" },
        ],
        [
          {
            featureId: boxId,
            geometry: {
              mesh,
              topologyCandidates: [
                planarFaceCandidate("box-face", 3, "primitive.box.cap.end", [0, 0, 0]),
              ],
            },
          },
          {
            featureId: booleanId,
            geometry: {
              mesh,
              topologyCandidates: [
                planarFaceCandidate("extrusion-cap", 7, "extrusion.cap.end", [0, 0, 10]),
                planarFaceCandidate("extrusion-wall", 9, "extrusion.side.1", [10, 0, 5]),
                planarFaceCandidate("unknown-wall", 11, "generated.face", [-10, 0, 5]),
              ],
            },
          },
        ],
      ),
      null,
      { mode: "create", selectedPlane: "xy", onSelect: vi.fn() },
    )

    await waitFor(() => expect(createViewport).toHaveBeenCalledTimes(1))
    const options = createViewport.mock.calls[0]?.[1]
    expect(options?.isSelectionCandidateEligible?.(boxSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(extrusionSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(extrusionSideSelection)).toBe(true)
    expect(options?.isSelectionCandidateEligible?.(unsupportedSelection)).toBe(false)
    act(() =>
      options?.onSelectionCandidateStackChange?.([
        unsupportedSelection,
        boxSelection,
        extrusionSelection,
      ]),
    )
    expect(screen.getByText("Click to sketch on Box 1 · Face 1")).toBeTruthy()

    act(() => options?.onSelectionCandidateStackCommit?.([boxSelection, extrusionSelection]))
    const listbox = await screen.findByRole("listbox", { name: "Select sketch support" })
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole("option", { name: "1/2 Box 1 · Face 1" })).toBeTruthy()
    const extrusionOption = screen.getByRole("option", { name: "2/2 Extrusion 1 · Face 1" })
    fireEvent.pointerEnter(extrusionOption)
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(extrusionSelection)
    expect(screen.getByText("Click to sketch on Extrusion 1 · Face 1")).toBeTruthy()

    fireEvent.click(extrusionOption)
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(false)
    expect(onSelectionChange).toHaveBeenLastCalledWith(extrusionSelection)
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    const keyboardListbox = screen.getByRole("listbox", { name: "Select sketch support" })
    fireEvent.keyDown(keyboardListbox, { code: "Backquote", key: "`" })
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(extrusionSelection)
    fireEvent.keyDown(keyboardListbox, { code: "Backquote", key: "`", shiftKey: true })
    expect(port.setSelectionPreselection).toHaveBeenLastCalledWith(boxSelection)
    fireEvent.keyDown(keyboardListbox, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    expect(document.activeElement).toBe(viewport)

    act(() => options?.onSelectionCandidateStackCommit?.([boxSelection, extrusionSelection]))
    await screen.findByRole("listbox", { name: "Select sketch support" })
    act(() => options?.onSelectionCandidateStackChange?.([boxSelection]))
    expect(screen.queryByRole("listbox", { name: "Select sketch support" })).toBeNull()
    expect(port.setSelectionCandidateStackPreserved).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(viewport)

    act(() => options?.onSelectionCandidateStackChange?.([boxSelection, extrusionSelection]))
    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Select sketch support" }), {
      key: "Enter",
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(boxSelection)
    expect(listbox).not.toBe(document.activeElement)
  })

  it("forwards individual origin-plane visibility and exposes accessible toggles", async () => {
    const onChange = vi.fn()
    const visibility = { xy: true, xz: false, yz: true }
    const { port } = renderViewport(readyController([], []), null, undefined, undefined, {
      visibility,
      onChange,
    })

    await waitFor(() => expect(port.setOriginPlaneVisibility).toHaveBeenCalledWith(visibility))
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    expect(viewport.getAttribute("data-origin-plane-visibility")).toBe("xy,yz")

    fireEvent.click(screen.getByRole("button", { name: "Hide XY plane" }))
    fireEvent.click(screen.getByRole("button", { name: "Show XZ plane" }))

    expect(onChange).toHaveBeenNthCalledWith(1, "xy", false)
    expect(onChange).toHaveBeenNthCalledWith(2, "xz", true)
    expect(document.querySelector('[data-plane-symbol="XY"]')).toBeTruthy()
    expect(document.querySelector('[data-plane-symbol="XZ"]')).toBeTruthy()
    expect(document.querySelector('[data-plane-symbol="YZ"]')).toBeTruthy()
  })

  it("contains renderer initialization failures as a localized viewport state", async () => {
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const createViewport = vi.fn(async () => {
      throw new Error("WebGL2 is unavailable.")
    })
    const onSelectionChange = vi.fn()

    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <GeometryViewport
            controller={controller}
            createViewport={createViewport}
            selection={null}
            onSelectionChange={onSelectionChange}
          />
        </TooltipProvider>
      </I18nProvider>,
    )

    expect(
      (
        await screen.findByText(
          "WebGL2 is unavailable in this browser or device. Modeling data remains saved.",
        )
      ).textContent,
    ).toBe("WebGL2 is unavailable in this browser or device. Modeling data remains saved.")
  })

  it("discards a thumbnail render that finishes after its viewport was unmounted", async () => {
    vi.useFakeTimers()
    let finish: ((value: { mediaType: "image/png"; bytes: Uint8Array }) => void) | undefined
    renderProjectThumbnailMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const viewport = renderViewport(controller)
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(1)
    const signal = renderProjectThumbnailMock.mock.calls[0]?.[1]?.signal as AbortSignal
    viewport.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => finish?.({ mediaType: "image/png", bytes: new Uint8Array([1]) }))
    expect(saveActiveProjectThumbnailMock).not.toHaveBeenCalled()
  })

  it("cancels thumbnail preparation when the viewport unmounts during the debounce", async () => {
    vi.useFakeTimers()
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    const viewport = renderViewport(controller)
    await act(async () => vi.advanceTimersByTimeAsync(249))
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    viewport.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    expect(saveActiveProjectThumbnailMock).not.toHaveBeenCalled()
  })

  it("prepares only the latest settled revision and skips save-status-only updates", async () => {
    vi.useFakeTimers()
    const viewport = renderViewport(thumbnailController(1))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    const latest = thumbnailController(2)
    viewport.rerenderController(latest)
    await act(async () => vi.advanceTimersByTimeAsync(249))
    expect(renderProjectThumbnailMock).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(1)
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledWith("project-thumbnail", 2, {
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    })
    viewport.rerenderController({ ...latest, saveStatus: "saving" })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(1)
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
  })

  it("aborts an obsolete thumbnail and never saves its late result over the newer revision", async () => {
    vi.useFakeTimers()
    let finish: ((value: { mediaType: "image/png"; bytes: Uint8Array }) => void) | undefined
    renderProjectThumbnailMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const viewport = renderViewport(thumbnailController(1))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    const oldSignal = renderProjectThumbnailMock.mock.calls[0]?.[1]?.signal as AbortSignal
    viewport.rerenderController(thumbnailController(2))
    expect(oldSignal.aborted).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(2)
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
    expect(saveActiveProjectThumbnailMock.mock.calls[0]?.slice(0, 2)).toEqual([
      "project-thumbnail",
      2,
    ])
    await act(async () => finish?.({ mediaType: "image/png", bytes: new Uint8Array([1]) }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(2)
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
  })

  it("retries a rejected thumbnail render without blocking the viewport", async () => {
    vi.useFakeTimers()
    renderProjectThumbnailMock.mockRejectedValueOnce(new Error("WebGL2 context was lost"))
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    renderViewport(controller)
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(250))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
    expect(renderProjectThumbnailMock).toHaveBeenCalledTimes(2)
  })

  it("retries one failed derived thumbnail write before marking the revision complete", async () => {
    vi.useFakeTimers()
    saveActiveProjectThumbnailMock
      .mockResolvedValueOnce({
        ok: false,
        diagnostic: { code: "storage-unavailable", message: "Preview storage was unavailable." },
      })
      .mockResolvedValueOnce({ ok: true })
    const controller = readyController(
      [{ id: boxId, dependencies: [] }],
      [{ featureId: boxId, geometry: { mesh } }],
    )
    ;(controller.report?.snapshot as { id: string; revision: number }).id = "project-1"
    ;(controller.report?.snapshot as { id: string; revision: number }).revision = 3

    renderViewport(controller)

    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(250))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(saveActiveProjectThumbnailMock).toHaveBeenCalledTimes(2)
  })
})

function bodyController(roles = ["pattern.instance.0", "pattern.instance.1"]) {
  const controller = readyController(
    [{ id: boxId, dependencies: [] }],
    [{ featureId: boxId, geometry: { mesh } }],
  )
  const report = controller.report
  if (!report?.rebuild.ok) throw new Error("Expected fixture geometry.")
  const geometry = report.rebuild.response.geometry.map((record) => ({
    ...record,
    geometry: {
      ...record.geometry,
      shape: { ...record.geometry.shape, solidCount: roles.length, volume: roles.length },
      bodies: roles.map((outputRole) => ({
        outputRole,
        shape: record.geometry.shape,
        mesh: record.geometry.mesh,
        topologyCandidates: [],
      })),
    },
  }))
  return {
    ...controller,
    report: {
      ...report,
      rebuild: {
        ...report.rebuild,
        response: { ...report.rebuild.response, geometry },
      },
    },
  }
}

function modelEdge(
  candidateId: string,
  outputRole?: string,
  label = `Box · Edge ${candidateId}`,
): ViewerEdgeCandidate {
  return {
    featureId: boxId,
    outputRole,
    candidateId,
    label,
    points: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  }
}

function renderModelEdges(
  selection: ModelEdgeViewportSelection,
  controller = readyController(
    [{ id: boxId, dependencies: [] }],
    [{ featureId: boxId, geometry: { mesh } }],
  ),
  pendingViewport?: Promise<GeometryViewportPort>,
) {
  return renderViewport(controller, null, undefined, undefined, undefined, {
    edgeSelection: selection,
    ...(pendingViewport ? { pendingViewport } : {}),
  })
}

describe("ordinary model-edge viewport bridge", () => {
  it("initializes current edge inputs after meshes when the renderer resolves asynchronously", async () => {
    const initial = modelEdge("1")
    const current = modelEdge("2")
    let resolveViewport: (viewport: GeometryViewportPort) => void = () => undefined
    const pending = new Promise<GeometryViewportPort>((resolve) => {
      resolveViewport = resolve
    })
    const firstSelect = vi.fn()
    const rendered = renderModelEdges(
      { candidates: [initial], onSelect: firstSelect },
      undefined,
      pending,
    )
    const secondSelect = vi.fn()
    rendered.rerenderEdgeSelection({ candidates: [current], onSelect: secondSelect })
    const initializationOrder: string[] = []
    vi.mocked(rendered.port.setMeshes).mockImplementation(() => initializationOrder.push("meshes"))
    vi.mocked(rendered.port.setEdgeCandidates).mockImplementation(() =>
      initializationOrder.push("edges"),
    )
    await act(async () => resolveViewport(rendered.port))
    expect(initializationOrder).toEqual(["meshes", "edges"])
    expect(rendered.port.setEdgeCandidates).toHaveBeenLastCalledWith([current])
    const callbacks = rendered.createViewport.mock.calls[0]?.[1]
    act(() => callbacks?.onEdgeSelectionChange?.(current))
    expect(secondSelect).toHaveBeenLastCalledWith(current)
    expect(firstSelect).not.toHaveBeenCalled()
    expect(rendered.createViewport).toHaveBeenCalledTimes(1)
  })

  it("updates candidates and selection without recreating the renderer and dispatches fresh callbacks", async () => {
    const edge = modelEdge("1")
    const firstSelect = vi.fn()
    const rendered = renderModelEdges({ candidates: [edge], onSelect: firstSelect })
    const { port, createViewport } = rendered
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([edge]))
    const callbacks = createViewport.mock.calls[0]?.[1]
    act(() => callbacks?.onEdgeSelectionChange?.(edge))
    expect(firstSelect).toHaveBeenLastCalledWith(edge)

    const selected = { ...edge, label: "Updated edge", selected: true }
    const secondSelect = vi.fn()
    rendered.rerenderEdgeSelection({ candidates: [selected], onSelect: secondSelect })
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([selected])
    act(() => callbacks?.onEdgeSelectionChange?.(edge))
    expect(secondSelect).toHaveBeenLastCalledWith(selected)
    expect(firstSelect).toHaveBeenCalledTimes(1)
    act(() => callbacks?.onEdgeSelectionChange?.(null))
    expect(secondSelect).toHaveBeenLastCalledWith(null)
    expect(createViewport).toHaveBeenCalledTimes(1)
    expect(port.dispose).not.toHaveBeenCalled()

    rendered.rerenderEdgeSelection(undefined)
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([])
    act(() => callbacks?.onEdgeSelectionChange?.(edge))
    expect(secondSelect).toHaveBeenCalledTimes(2)
    rendered.unmount()
    expect(port.dispose).toHaveBeenCalledTimes(1)
    act(() => callbacks?.onEdgeSelectionChange?.(edge))
    expect(secondSelect).toHaveBeenCalledTimes(2)
  })

  it("matches exact output ownership and never widens an unscoped edge to a modern body", async () => {
    const first = modelEdge("shared", "pattern.instance.0", "First body edge")
    const second = modelEdge("shared", "pattern.instance.1", "Second body edge")
    const unscoped = modelEdge("shared")
    const missing = modelEdge("shared", "result")
    const onSelect = vi.fn()
    const { port } = renderModelEdges(
      { candidates: [first, second, unscoped, missing], onSelect },
      bodyController(),
    )
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([first, second]))
    const picker = screen.getByRole("combobox", { name: "Model edge" })
    const firstOption = screen.getByRole("option", { name: first.label }) as HTMLOptionElement
    const secondOption = screen.getByRole("option", { name: second.label }) as HTMLOptionElement
    expect(firstOption.value).not.toBe(secondOption.value)
    expect(screen.queryByRole("option", { name: unscoped.label })).toBeNull()
    fireEvent.change(picker, { target: { value: secondOption.value } })
    expect(onSelect).toHaveBeenLastCalledWith(second)
    expect(port.clearSelection).toHaveBeenCalledTimes(1)
  })

  it("limits ordinary picking to idle 3D and restores it without restarting the renderer", async () => {
    const edge = modelEdge("1")
    const onSelect = vi.fn()
    const selection = { candidates: [edge], onSelect }
    const rendered = renderModelEdges(selection)
    const { port, createViewport } = rendered
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([edge]))
    const callbacks = createViewport.mock.calls[0]?.[1]
    for (const context of [
      { mode: "normal", frame: null },
      { mode: "orbit", frame: null },
      {
        mode: "orbit",
        frame: null,
        referenceSelection: { candidates: [], onSelect: vi.fn() },
      },
    ] satisfies GeometryViewportSketchContext[]) {
      rendered.rerenderSketchContext(context)
      expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([])
      expect(screen.queryByRole("combobox", { name: "Model edge" })).toBeNull()
      act(() => callbacks?.onEdgeSelectionChange?.(edge))
    }
    expect(onSelect).not.toHaveBeenCalled()
    rendered.rerenderEdgeSelection(selection, true)
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([])
    expect(screen.queryByRole("combobox", { name: "Model edge" })).toBeNull()
    rendered.rerenderEdgeSelection(selection)
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([edge])

    rendered.rerenderToolPlane({ origin: [0, 0, 0], normal: [0, 0, 1], size: 20 })
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([])
    rendered.rerenderFeaturePreview({ status: "loading", meshes: [] })
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([])
    rendered.rerenderEdgeSelection(selection)
    expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([edge])
    expect(createViewport).toHaveBeenCalledTimes(1)
  })

  it("offers a keyboard picker and transient hover label without a permanent task banner", async () => {
    const first = modelEdge("1")
    const second = modelEdge("2")
    const onSelect = vi.fn()
    const { createViewport, port } = renderModelEdges({ candidates: [first, second], onSelect })
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenCalled())
    expect(screen.queryByText(first.label)).toBeTruthy()
    expect(screen.queryAllByRole("status").some((node) => node.textContent === first.label)).toBe(
      false,
    )
    const picker = screen.getByRole("combobox", { name: "Model edge" })
    const pickerContainer = picker.closest(".sr-only")
    expect(pickerContainer).toBeTruthy()
    expect(pickerContainer?.classList.contains("focus-within:not-sr-only")).toBe(true)
    const option = screen.getByRole("option", { name: second.label }) as HTMLOptionElement
    fireEvent.keyDown(picker, { code: "Backquote", key: "`" })
    expect(screen.queryByRole("listbox")).toBeNull()
    fireEvent.change(picker, { target: { value: option.value } })
    expect(onSelect).toHaveBeenLastCalledWith(second)
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "3D viewport" }))

    const callbacks = createViewport.mock.calls[0]?.[1]
    act(() => callbacks?.onEdgePreselectionChange?.(first))
    expect(screen.getAllByRole("status").some((node) => node.textContent === first.label)).toBe(
      true,
    )
    act(() => callbacks?.onEdgePreselectionChange?.(null))
    expect(screen.queryAllByRole("status").some((node) => node.textContent === first.label)).toBe(
      false,
    )
  })

  it("keeps ordinary model-edge picking available alongside the saved-profile keyboard picker", async () => {
    const edge = modelEdge("1")
    const onSelect = vi.fn()
    const onProfileSelect = vi.fn()
    const { port } = renderViewport(
      readyController(
        [{ id: boxId, dependencies: [] }],
        [{ featureId: boxId, geometry: { mesh } }],
        [profileSketchDisplay],
      ),
      null,
      undefined,
      undefined,
      undefined,
      { edgeSelection: { candidates: [edge], onSelect } },
      undefined,
      undefined,
      { keyboardPickerActive: true, selectedProfiles: [], onSelect: onProfileSelect },
    )
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenLastCalledWith([edge]))
    expect(screen.getByRole("combobox", { name: "Model edge" })).toBeTruthy()
    const profilePicker = screen.getByRole("combobox", { name: "Select saved profile" })
    const profileOption = screen.getByRole("option", {
      name: "Sketch 1 · Profile 1",
    }) as HTMLOptionElement
    fireEvent.change(profilePicker, { target: { value: profileOption.value } })
    expect(onProfileSelect).toHaveBeenLastCalledWith(profileSelector, [profileSelector], "toggle")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("clears an edge-only keyboard selection through Clear, Escape and background callbacks", async () => {
    const edge = modelEdge("1")
    const selected = { ...edge, selected: true }
    const onSelect = vi.fn()
    const rendered = renderModelEdges({ candidates: [edge], onSelect })
    await waitFor(() => expect(rendered.port.setEdgeCandidates).toHaveBeenCalled())
    const picker = screen.getByRole("combobox", { name: "Model edge" })
    const option = screen.getByRole("option", { name: edge.label }) as HTMLOptionElement
    fireEvent.change(picker, { target: { value: option.value } })
    expect(onSelect).toHaveBeenLastCalledWith(edge)

    rendered.rerenderEdgeSelection({ candidates: [selected], onSelect })
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(rendered.port.clearSelection).toHaveBeenCalledTimes(2)
    expect(rendered.onSelectionChange).not.toHaveBeenCalled()

    rendered.rerenderEdgeSelection({ candidates: [selected], onSelect })
    fireEvent.keyDown(screen.getByRole("region", { name: "3D viewport" }), { key: "Escape" })
    expect(onSelect).toHaveBeenCalledTimes(3)
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(rendered.port.clearSelection).toHaveBeenCalledTimes(3)

    const callbacks = rendered.createViewport.mock.calls[0]?.[1]
    act(() => callbacks?.onEdgeSelectionChange?.(null))
    expect(onSelect).toHaveBeenCalledTimes(4)
    expect(onSelect).toHaveBeenLastCalledWith(null)
    rendered.rerenderEdgeSelection({ candidates: [edge], onSelect })
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull()
    expect(rendered.onSelectionChange).not.toHaveBeenCalled()
  })

  it("cycles a bounded overlap stack with Backquote, Shift+Backquote, Enter and Escape", async () => {
    const first = modelEdge("shared", "pattern.instance.0", "First body edge")
    const second = modelEdge("shared", "pattern.instance.1", "Second body edge")
    const edges = [
      first,
      second,
      ...Array.from({ length: 8 }, (_, index) => modelEdge(`${index + 2}`, "pattern.instance.0")),
    ]
    const onSelect = vi.fn()
    const { createViewport, port } = renderModelEdges(
      { candidates: edges, onSelect },
      bodyController(),
    )
    await waitFor(() => expect(port.setEdgeCandidates).toHaveBeenLastCalledWith(edges))
    const callbacks = createViewport.mock.calls[0]?.[1]
    act(() => {
      callbacks?.onEdgeCandidateStackChange?.([first, first, ...edges.slice(1)])
      callbacks?.onEdgePreselectionChange?.(first)
    })
    const viewport = screen.getByRole("region", { name: "3D viewport" })
    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    let chooser = screen.getByRole("listbox", { name: "Select other reference" })
    expect(document.activeElement).toBe(chooser)
    expect(chooser.querySelectorAll('[role="option"]').length).toBe(8)
    fireEvent.keyDown(chooser, { code: "Backquote", key: "`" })
    expect(port.setEdgePreselection).toHaveBeenLastCalledWith(second)
    fireEvent.keyDown(chooser, { code: "Backquote", key: "`", shiftKey: true })
    expect(port.setEdgePreselection).toHaveBeenLastCalledWith(first)
    fireEvent.keyDown(chooser, { code: "Backquote", key: "`", shiftKey: true })
    expect(port.setEdgePreselection).toHaveBeenLastCalledWith(edges[7])
    fireEvent.keyDown(chooser, { key: "Enter" })
    expect(onSelect).toHaveBeenLastCalledWith(edges[7])
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    chooser = screen.getByRole("listbox", { name: "Select other reference" })
    fireEvent.keyDown(chooser, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { code: "Backquote", key: "`" })
    act(() => callbacks?.onEdgeSelectionChange?.(second))
    expect(onSelect).toHaveBeenLastCalledWith(second)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(viewport)
  })
})

describe("constituent viewport projection", () => {
  it("preselects every visible sketch linked to an assistant group without selecting them", async () => {
    const controller = readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay])
    const { port } = renderViewport(controller, null, undefined, undefined, undefined, {
      preselectedSketchIds: [
        profileSketchDisplay.sketchId,
        secondProfileSketchDisplay.sketchId,
        "missing",
      ],
    })
    await waitFor(() =>
      expect(port.setSketches).toHaveBeenCalledWith([
        expect.objectContaining({
          sketchId: profileSketchDisplay.sketchId,
          preselected: true,
          selected: false,
        }),
        expect.objectContaining({
          sketchId: secondProfileSketchDisplay.sketchId,
          preselected: true,
          selected: false,
        }),
      ]),
    )
  })

  it("projects independent exact sketch selection and hover into the existing renderer", async () => {
    const controller = readyController([], [], [profileSketchDisplay, secondProfileSketchDisplay])
    const { port } = renderViewport(controller, null, undefined, undefined, undefined, {
      selectedSketchIds: [profileSketchDisplay.sketchId],
      preselectedSketchId: secondProfileSketchDisplay.sketchId,
    })
    await waitFor(() =>
      expect(port.setSketches).toHaveBeenCalledWith([
        expect.objectContaining({
          sketchId: profileSketchDisplay.sketchId,
          selected: true,
          preselected: false,
        }),
        expect.objectContaining({
          sketchId: secondProfileSketchDisplay.sketchId,
          selected: false,
          preselected: true,
        }),
      ]),
    )
  })

  it("highlights every selected output without substituting a sibling for a missing role", async () => {
    const selectedBodies = ["pattern.instance.0", "pattern.instance.1", "missing"].map(
      (outputRole) => ({
        featureId: featureIdSchema.parse(boxId),
        outputRole,
      }),
    )
    const rendered = renderViewport(bodyController(), null, undefined, undefined, undefined, {
      selectedBodies,
    })
    await waitFor(() =>
      expect(rendered.port.setFeatureSelection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: boxId, outputRole: "pattern.instance.0" }),
        expect.objectContaining({ featureId: boxId, outputRole: "pattern.instance.1" }),
      ]),
    )
  })

  it("highlights all current output bindings involved in a History hover", async () => {
    const preselectedBodies = ["pattern.instance.0", "pattern.instance.1"].map((outputRole) => ({
      featureId: featureIdSchema.parse(boxId),
      outputRole,
    }))
    const rendered = renderViewport(bodyController(), null, undefined, undefined, undefined, {
      preselectedBodies,
    })
    await waitFor(() =>
      expect(rendered.port.setFeaturePreselection).toHaveBeenLastCalledWith([
        expect.objectContaining({ featureId: boxId, outputRole: "pattern.instance.0" }),
        expect.objectContaining({ featureId: boxId, outputRole: "pattern.instance.1" }),
      ]),
    )
  })

  it("highlights an exact body and a different hovered sibling", async () => {
    const selectedBody = {
      featureId: featureIdSchema.parse(boxId),
      outputRole: "pattern.instance.0",
    }
    const preselectedBody = { ...selectedBody, outputRole: "pattern.instance.1" }
    const controller = bodyController()
    expect(viewerMeshes(controller).map(({ outputRole }) => outputRole)).toEqual([
      "pattern.instance.0",
      "pattern.instance.1",
    ])
    const rendered = renderViewport(controller, null, undefined, undefined, undefined, {
      selectedBody,
      preselectedBody,
    })
    await waitFor(() =>
      expect(rendered.port.setFeatureSelection).toHaveBeenCalledWith(
        expect.objectContaining(selectedBody),
      ),
    )
    expect(rendered.port.setFeaturePreselection).toHaveBeenCalledWith(
      expect.objectContaining(preselectedBody),
    )
  })

  it("clears a removed body role without selecting its surviving sibling", async () => {
    const selectedBody = {
      featureId: featureIdSchema.parse(boxId),
      outputRole: "pattern.instance.1",
    }
    const onBodySelectionChange = vi.fn()
    const rendered = renderViewport(bodyController(), null, undefined, undefined, undefined, {
      selectedBody,
      onBodySelectionChange,
    })
    await waitFor(() =>
      expect(rendered.port.setFeatureSelection).toHaveBeenCalledWith(
        expect.objectContaining(selectedBody),
      ),
    )
    rendered.rerenderController(bodyController(["pattern.instance.0"]))
    await waitFor(() => expect(onBodySelectionChange).toHaveBeenCalledWith(null))
    expect(rendered.port.setFeatureSelection).toHaveBeenLastCalledWith(null)
  })

  it("clears a removed hovered role without highlighting its surviving sibling", async () => {
    const preselectedBody = {
      featureId: featureIdSchema.parse(boxId),
      outputRole: "pattern.instance.1",
    }
    const onBodyPreselectionChange = vi.fn()
    const rendered = renderViewport(bodyController(), null, undefined, undefined, undefined, {
      preselectedBody,
      onBodyPreselectionChange,
    })
    await waitFor(() =>
      expect(rendered.port.setFeaturePreselection).toHaveBeenCalledWith(
        expect.objectContaining(preselectedBody),
      ),
    )
    expect(onBodyPreselectionChange).not.toHaveBeenCalled()
    rendered.rerenderController(bodyController(["pattern.instance.0"]))
    await waitFor(() => expect(onBodyPreselectionChange).toHaveBeenCalledWith(null))
    expect(rendered.port.setFeaturePreselection).toHaveBeenLastCalledWith(null)
  })

  it("clears a body through the visible clear-selection control", async () => {
    const selectedBody = {
      featureId: featureIdSchema.parse(boxId),
      outputRole: "pattern.instance.0",
    }
    const onBodySelectionChange = vi.fn()
    renderViewport(bodyController(), null, undefined, undefined, undefined, {
      selectedBody,
      onBodySelectionChange,
    })
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(onBodySelectionChange).toHaveBeenCalledTimes(1)
    expect(onBodySelectionChange).toHaveBeenCalledWith(null)
  })

  it("clears a removed face role even while its producing feature remains visible", async () => {
    const selection = {
      featureId: boxId,
      outputRole: "pattern.instance.1",
      faceId: 1,
      faceOrdinal: 1,
    }
    const rendered = renderViewport(bodyController(["pattern.instance.0"]), selection)
    await waitFor(() => expect(rendered.onSelectionChange).toHaveBeenCalledWith(null))
  })
})
