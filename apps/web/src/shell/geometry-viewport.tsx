import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import {
  readDatumPlaneFeatureParameters,
  type SketchEntity,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import { appearancePresets } from "@vibeshape/domain/part-appearance"
import { useTranslations } from "@vibeshape/i18n"
import type { PrinterProfile } from "@vibeshape/protocol"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { Cuboid, Scan, X } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "@vibeshape/viewer/origin-planes"
import { renderProjectThumbnail } from "@vibeshape/viewer/project-thumbnail"
import { viewerSketchReferenceCandidateKey } from "@vibeshape/viewer/sketch-reference-identity"
import type {
  GeometryViewportOptions,
  GeometryViewport as GeometryViewportPort,
  ViewerAngularGizmo,
  ViewerAxialGizmo,
  ViewerFeatureHighlight,
  ViewerFrame,
  ViewerMesh,
  ViewerSection,
  ViewerSelection,
  ViewerSketch,
  ViewerSketchProfile,
  ViewerSketchProfileSelectionIntent,
  ViewerSketchReferenceCandidate,
  ViewerStandardView,
  ViewerToolPlane,
} from "@vibeshape/viewer/three-viewport"
import { viewerBodyKey, viewerSketchProfileKey } from "@vibeshape/viewer/three-viewport"
import {
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { OriginPlaneVisibilityControls } from "../components/origin-plane-visibility-controls"
import {
  type DocumentControllerState,
  saveActiveProjectThumbnail,
} from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import { effectiveHiddenSketchIds } from "../editor-session/sketch-visibility"
import { type ModelBodySelection, terminalModelBodies } from "../features/part-design/model-bodies"
import type { PrimitivePlacement } from "../features/part-design/primitive-placement"
import type {
  FeaturePreviewKind,
  FeaturePreviewState,
} from "../features/preview/use-feature-preview"
import { resolvePlanarFaceSupportLabel } from "../features/sketch/external-model-geometry"
import type { SketchProjectionStoreApi } from "../features/sketch/sketch-projection-store"
import { selectedSketchSupportFromController } from "../features/sketch/sketch-support"
import { SurfaceTextureViewportTools } from "../features/surface-texture/surface-texture-viewport-tools"
import { useTexturedMeshes } from "../features/surface-texture/use-textured-meshes"
import {
  PrintViewportStatus,
  usePrintViewportFactory,
  usePrintViewportSynchronization,
} from "../printing/print-viewport-presentation"
import { useReportApplicationError } from "./application-notices"
import { assistantCheckpointDisplayController } from "./assistant-checkpoint-display"
import {
  authoredBodyKey,
  authoredBodyKeys,
  currentAuthoredParts,
  currentAuthoredSnapshot,
} from "./authored-tree-state"
import {
  ModelEdgeViewportChrome,
  type ModelEdgeViewportSelection,
  useModelEdgeSelectOther,
  useModelEdgeViewport,
} from "./model-edge-viewport"
import { partForModelBody } from "./model-tree-selection"
import { ProjectLoadingProgress } from "./project-loading-progress"
import { ViewportLoadingSkeleton } from "./project-loading-skeleton"
import { SectionViewControls } from "./section-view-controls"
import {
  useSectionViewportFactory,
  useSectionViewportSynchronization,
} from "./section-viewport-presentation"
import { useBlockingViewport } from "./use-blocking-viewport"
import { useViewportCapture } from "./viewport-capture"
import {
  SAFE_VIEWPORT_CENTER,
  SAFE_VIEWPORT_LEFT,
  SAFE_VIEWPORT_REGION,
  SAFE_VIEWPORT_RIGHT,
} from "./viewport-chrome-styles"
import { ViewportContextTrigger, ViewportSelectionProperties } from "./viewport-context-target"
import { useWorkspaceTask } from "./workspace-task-context"

const EMPTY_IDS = [] as const

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
  onEdgePreparationError: () => void
}

export type GeometryViewportSketchContext = Readonly<{
  frame: ViewerFrame | null
  mode: "normal" | "orbit"
  pointerOrbit?: boolean
  onOrientationNavigationStart?: (() => void) | undefined
  projectionStore?: SketchProjectionStoreApi
  referenceSelection?: Readonly<{
    candidates: readonly ViewerSketchReferenceCandidate[]
    onSelect: (candidate: ViewerSketchReferenceCandidate) => void
    purpose?: "pierce" | "revolve-axis" | "edge-treatment" | "hole-point" | "use"
  }>
  faceIntersectionSelection?: Readonly<{
    onSelect: (selection: ViewerSelection) => void
    sourceMesh?: ViewerMesh
    excludedFeatureIds?: readonly string[]
    selectedFaces?: readonly ViewerSelection[]
    isCandidateEligible?: (selection: ViewerSelection) => boolean
    selectionMeshes?: readonly ViewerMesh[]
    consumeBackground?: boolean
    status?: string
  }>
}>

const ignoreOriginPlaneSelection = () => undefined
const ignoreOriginPlaneVisibilityChange = () => undefined

async function loadGeometryViewport(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas, options)
}

export function viewerMeshes(
  controller: DocumentControllerState,
  hiddenFeatureIds: readonly string[] = [],
  contextualHiddenFeatureIds: readonly string[] = [],
  partVisibilityOverrides?: PartVisibilityOverrides,
): readonly ViewerMesh[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const features = controller.report?.snapshot.features ?? []
  const bodies = terminalModelBodies(features, rebuild.response, contextualHiddenFeatureIds)
  if (!bodies) return []
  const authority = currentAuthoredSnapshot(controller)
  const hiddenParts = authority
    ? authoredBodyKeys(authority, true, partVisibilityOverrides)
    : new Set<string>()
  const hiddenIds = new Set([...hiddenFeatureIds, ...contextualHiddenFeatureIds])
  const parts = currentAuthoredParts(controller)
  const appearances = new Map(
    authority?.schemaVersion === 6
      ? authority.partAppearances.map((item) => [item.partId, item.appearance])
      : [],
  )
  const solidMeshes = bodies
    .filter(
      ({ geometry }) =>
        !hiddenIds.has(geometry.featureId) && !hiddenParts.has(authoredBodyKey(geometry)),
    )
    .map(({ geometry: body }) => {
      const owner = partForModelBody(parts, body)
      const appearance = owner ? appearances.get(owner.part.id) : undefined
      return {
        featureId: body.featureId,
        ...(body.outputRole === undefined ? {} : { outputRole: body.outputRole }),
        ...body.mesh,
        ...(appearance?.presetId ? { material: appearancePresets[appearance.presetId] } : {}),
        ...(appearance?.color ? { color: appearance.color } : {}),
      }
    })
  const datumIds = new Set<string>(
    features
      .filter((feature) => readDatumPlaneFeatureParameters(feature) !== null)
      .map(({ id }) => id),
  )
  const datumMeshes = rebuild.response.geometry
    .filter(({ featureId }) => datumIds.has(featureId) && !hiddenIds.has(featureId))
    .map(({ featureId, geometry }) => ({
      featureId,
      ...geometry.mesh,
      appearance: "datum" as const,
    }))
  return [...solidMeshes, ...datumMeshes]
}

export function viewerSketches(
  controller: DocumentControllerState,
  hiddenSketchIds: readonly string[] = [],
): readonly ViewerSketch[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const hiddenIds = new Set(hiddenSketchIds)
  return (rebuild.response.sketches ?? [])
    .filter(
      (sketch) =>
        !hiddenIds.has(sketch.sketchId) &&
        (sketch.curvePositions.length > 0 ||
          sketch.constructionCurvePositions.length > 0 ||
          sketch.pointPositions.length > 0 ||
          sketch.constructionPointPositions.length > 0 ||
          sketch.profiles.length > 0),
    )
    .map((display) =>
      viewerSketchDisplay(
        display,
        controller.report?.snapshot.sketches.find(({ id }) => id === display.sketchId),
      ),
    )
}

type SketchDisplayProfileLoop = SketchDisplayRecord["profiles"][number]["outerLoop"]

function sameProfileSample(
  left: readonly [number, number] | undefined,
  right: readonly [number, number] | undefined,
) {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1])
}

function viewerProfileLoopPositions(loop: SketchDisplayProfileLoop) {
  const points: [number, number][] = []
  for (const segment of loop.segments) {
    for (const sample of segment.samples) {
      if (sameProfileSample(points.at(-1), sample)) continue
      points.push([sample[0], sample[1]])
    }
  }
  if (points.length > 1 && sameProfileSample(points[0], points.at(-1))) points.pop()
  return new Float32Array(points.flat())
}

function solvedBezierPoles(
  curve: Extract<SketchEntity, { type: "cubic-bezier" }>,
  points: ReadonlyMap<string, readonly number[]>,
) {
  const start = points.get(curve.startPointId)
  const end = points.get(curve.endPointId)
  const control1 = points.get(curve.control1PointId)
  const control2 = points.get(curve.control2PointId)
  return start && end && control1 && control2 ? { start, end, control1, control2 } : null
}

function viewerSketchControls(
  display: SketchDisplayRecord,
  authored: Pick<SketchRecord, "id" | "entities"> | null | undefined,
): Pick<ViewerSketch, "controlPointPositions" | "controlHandlePositions"> {
  if (!authored || authored.id !== display.sketchId || !display.solvedPoints) return {}
  const points = new Map(display.solvedPoints.map(({ entityId, position }) => [entityId, position]))
  const controls = new Map<string, readonly number[]>()
  const handles: number[] = []
  for (const curve of authored.entities) {
    if (curve.type !== "cubic-bezier") continue
    const poles = solvedBezierPoles(curve, points)
    if (!poles) continue
    const { start, end, control1, control2 } = poles
    controls.set(curve.control1PointId, control1)
    controls.set(curve.control2PointId, control2)
    handles.push(...start, ...control1, ...end, ...control2)
  }
  return controls.size > 0
    ? {
        controlPointPositions: new Float32Array([...controls.values()].flat()),
        controlHandlePositions: new Float32Array(handles),
      }
    : {}
}

export function viewerSketchDisplay(
  sketch: SketchDisplayRecord,
  authored?: Pick<SketchRecord, "id" | "entities"> | null,
): ViewerSketch {
  return {
    ...sketch,
    ...viewerSketchControls(sketch, authored),
    profiles: sketch.profiles.flatMap((profile) => {
      const outerPositions = viewerProfileLoopPositions(profile.outerLoop)
      const holePositions = profile.holeLoops.map(viewerProfileLoopPositions)
      return outerPositions.length >= 6 && holePositions.every((positions) => positions.length >= 6)
        ? [
            {
              selector: profile.selector,
              outerPositions,
              holePositions,
            } satisfies ViewerSketchProfile,
          ]
        : []
    }),
  }
}

function selectedViewerSketchProfile(
  sketches: readonly ViewerSketch[],
  selected: SketchProfileSelector | null,
) {
  if (!selected) return null
  const expectedKey = viewerSketchProfileKey(selected)
  for (const sketch of sketches) {
    const profile = sketch.profiles?.find(
      ({ selector }) => viewerSketchProfileKey(selector) === expectedKey,
    )
    if (profile) return profile
  }
  return null
}

function selectedViewerSketchProfiles(
  sketches: readonly ViewerSketch[],
  selected: readonly SketchProfileSelector[],
) {
  return selected.flatMap((selector) => {
    const profile = selectedViewerSketchProfile(sketches, selector)
    return profile ? [profile] : []
  })
}

export function withActiveSketchDisplay(
  committed: readonly ViewerSketch[],
  active: ViewerSketch | null | undefined,
  includeActive = true,
): readonly ViewerSketch[] {
  if (!active || !includeActive) return committed
  return [...committed.filter(({ sketchId }) => sketchId !== active.sketchId), active]
}

function viewportMessage(
  controller: DocumentControllerState,
  rendererFailed: boolean,
  meshCount: number,
  originPlaneSelectionActive: boolean,
  copy: {
    loading: string
    loadFailed: string
    rebuildFailed: string
    unavailable: string
    empty: string
  },
) {
  if (rendererFailed && (meshCount > 0 || originPlaneSelectionActive)) {
    return { kind: "error" as const, text: copy.unavailable }
  }
  const documentMessage = documentViewportMessage(controller, copy)
  if (documentMessage) return documentMessage
  if (meshCount === 0 && !originPlaneSelectionActive) {
    return { kind: "status" as const, text: copy.empty }
  }
  return null
}

function documentViewportMessage(
  controller: DocumentControllerState,
  copy: { loading: string; loadFailed: string; rebuildFailed: string },
) {
  if (controller.status === "idle" || controller.status === "loading") {
    return controller.report ? null : { kind: "status" as const, text: copy.loading }
  }
  if (controller.status === "error") return { kind: "error" as const, text: copy.loadFailed }
  if (controller.report && !controller.report.rebuild.ok) {
    return { kind: "error" as const, text: copy.rebuildFailed }
  }
  return null
}

function orientationInsetOffsetElement(canvas: HTMLCanvasElement) {
  return (
    canvas.parentElement?.querySelector<HTMLElement>("[data-viewport-orientation-offset]") ?? null
  )
}

async function initializeViewport(
  canvas: HTMLCanvasElement,
  createViewport: ViewportFactory,
  modelEdges: ReturnType<typeof useModelEdgeViewport>,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane | null) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
  onSelectionCandidateStackChange: (candidates: readonly ViewerSelection[]) => void,
  onSelectionCandidateStackCommit: (candidates: readonly ViewerSelection[]) => void,
  onSketchReferencePreselectionChange: (candidate: ViewerSketchReferenceCandidate | null) => void,
  onSketchReferenceCandidateStackChange: (
    candidates: readonly ViewerSketchReferenceCandidate[],
  ) => void,
  onSketchReferenceSelectionChange: (candidate: ViewerSketchReferenceCandidate) => void,
  onSketchProfileCandidateStackChange: (candidates: readonly ViewerSketchProfile[]) => void,
  onSketchProfileCandidateStackCommit: (candidates: readonly ViewerSketchProfile[]) => void,
  onSketchProfilePreselectionChange: (profile: ViewerSketchProfile | null) => void,
  onSketchProfileSelectionChange: (
    profile: ViewerSketchProfile | null,
    intent: ViewerSketchProfileSelectionIntent,
  ) => void,
  mount: ViewportMount,
  viewportRef: RefObject<GeometryViewportPort | null>,
  latestMeshesRef: RefObject<readonly ViewerMesh[]>,
  latestSketchesRef: RefObject<readonly ViewerSketch[]>,
  latestControllerRef: RefObject<DocumentControllerState>,
  latestOriginPlaneRef: RefObject<ViewerOriginPlane | null>,
  latestOriginPlaneSelectionActiveRef: RefObject<boolean>,
  latestOriginPlaneIdleSelectionEnabledRef: RefObject<boolean>,
  latestOriginPlaneVisibilityRef: RefObject<ViewerOriginPlaneVisibility>,
  latestFeaturePreselectionRef: RefObject<ViewerFeatureHighlight>,
  latestFeatureSelectionRef: RefObject<ViewerFeatureHighlight>,
  latestSketchContextRef: RefObject<GeometryViewportSketchContext | null>,
  latestSketchProfileSelectionRef: RefObject<GeometryViewportProps["sketchProfileSelection"]>,
  latestSketchProfilePreviewRef: RefObject<SketchProfileSelector | null | undefined>,
  latestAngularGizmoRef: RefObject<GeometryViewportProps["angularGizmo"]>,
  latestAxialGizmoRef: RefObject<GeometryViewportProps["axialGizmo"]>,
  latestAxialDistanceChangeRef: RefObject<((distance: number) => void) | undefined>,
  latestTranslationGizmoRef: RefObject<GeometryViewportProps["translationGizmo"]>,
  setRendererStatus: Dispatch<SetStateAction<"loading" | "ready" | "error">>,
) {
  try {
    const viewport = await createViewport(canvas, {
      onEdgePreparationError: () => {
        if (!mount.cancelled) mount.onEdgePreparationError()
      },
      orientationInsetOffsetElement: orientationInsetOffsetElement(canvas),
      orientationInputElement: () =>
        latestSketchContextRef.current?.projectionStore?.getState().navigationElement ?? null,
      onOrientationNavigationStart: () =>
        latestSketchContextRef.current?.onOrientationNavigationStart?.(),
      isSelectionCandidateEligible: (selection) => {
        const faceSelection = latestSketchContextRef.current?.faceIntersectionSelection
        if (faceSelection?.isCandidateEligible) return faceSelection.isCandidateEligible(selection)
        const source = faceSelection?.sourceMesh
        return source
          ? selection.featureId === source.featureId && selection.outputRole === source.outputRole
          : selectedSketchSupportFromController(latestControllerRef.current, selection) !== null
      },
      onOriginPlanePreselectionChange,
      onOriginPlaneSelectionChange,
      onSelectionChange,
      onSelectionCandidateStackChange,
      onSelectionCandidateStackCommit,
      onSketchReferenceCandidateStackChange,
      onSketchReferencePreselectionChange,
      onSketchReferenceSelectionChange,
      onSketchProfileCandidateStackChange,
      onSketchProfileCandidateStackCommit,
      onSketchProfilePreselectionChange,
      onSketchProfileSelectionChange,
      onEdgeSelectionChange: (candidate) => {
        if (!mount.cancelled) modelEdges.onSelectionChange(candidate)
      },
      onEdgePreselectionChange: (candidate) => {
        if (!mount.cancelled) modelEdges.onPreselectionChange(candidate)
      },
      onEdgeCandidateStackChange: (candidates) => {
        if (!mount.cancelled) modelEdges.onCandidateStackChange(candidates)
      },
      onTranslationGizmoPositionChange: (position) =>
        latestTranslationGizmoRef.current?.onPositionChange(position),
      onAxialGizmoDistanceChange: (distance) => latestAxialDistanceChangeRef.current?.(distance),
      onAngularGizmoAngleChange: (angle) => latestAngularGizmoRef.current?.onAngleChange(angle),
    })
    if (mount.cancelled) {
      viewport.dispose()
      return
    }
    mount.viewport = viewport
    viewportRef.current = viewport
    initializeViewportPresentation(viewport, {
      meshesRef: latestMeshesRef,
      sketchesRef: latestSketchesRef,
      originPlaneRef: latestOriginPlaneRef,
      originPlaneSelectionActiveRef: latestOriginPlaneSelectionActiveRef,
      originPlaneIdleSelectionEnabledRef: latestOriginPlaneIdleSelectionEnabledRef,
      originPlaneVisibilityRef: latestOriginPlaneVisibilityRef,
      featurePreselectionRef: latestFeaturePreselectionRef,
      featureSelectionRef: latestFeatureSelectionRef,
      sketchProfileSelectionRef: latestSketchProfileSelectionRef,
      sketchProfilePreviewRef: latestSketchProfilePreviewRef,
      angularGizmoRef: latestAngularGizmoRef,
      axialGizmoRef: latestAxialGizmoRef,
      translationGizmoRef: latestTranslationGizmoRef,
      sketchContextRef: latestSketchContextRef,
    })
    modelEdges.synchronize(viewport)
    setRendererStatus("ready")
  } catch {
    if (!mount.cancelled) setRendererStatus("error")
  }
}

function initializeViewportPresentation(
  viewport: GeometryViewportPort,
  latest: Pick<
    ReturnType<typeof useLatestViewportInputs>,
    | "meshesRef"
    | "sketchesRef"
    | "originPlaneRef"
    | "originPlaneSelectionActiveRef"
    | "originPlaneIdleSelectionEnabledRef"
    | "originPlaneVisibilityRef"
    | "featurePreselectionRef"
    | "featureSelectionRef"
    | "sketchProfileSelectionRef"
    | "sketchProfilePreviewRef"
    | "angularGizmoRef"
    | "axialGizmoRef"
    | "translationGizmoRef"
    | "sketchContextRef"
  >,
) {
  viewport.setMeshes(latest.meshesRef.current)
  viewport.setSketches(latest.sketchesRef.current)
  viewport.setSketchProfileSelections(
    selectedViewerSketchProfiles(
      latest.sketchesRef.current,
      latest.sketchProfileSelectionRef.current?.selectedProfiles ?? [],
    ),
  )
  viewport.setSketchProfilePreselection(
    selectedViewerSketchProfile(
      latest.sketchesRef.current,
      latest.sketchProfilePreviewRef.current ?? null,
    ),
  )
  viewport.setOriginPlaneVisibility(latest.originPlaneVisibilityRef.current)
  viewport.setOriginPlaneSelection(
    latest.originPlaneRef.current,
    latest.originPlaneSelectionActiveRef.current,
    latest.originPlaneIdleSelectionEnabledRef.current,
  )
  viewport.setFeatureSelection(latest.featureSelectionRef.current)
  viewport.setFeaturePreselection(latest.featurePreselectionRef.current)
  const angularGizmo = latest.angularGizmoRef.current
  const axialGizmo = latest.axialGizmoRef.current
  const translationGizmo = latest.translationGizmoRef.current
  if (angularGizmo) viewport.showAngularGizmo(angularGizmo)
  else if (axialGizmo) viewport.showAxialTranslationGizmo(axialGizmo)
  else if (translationGizmo) viewport.showTranslationGizmo(translationGizmo.position)
  viewport.fit()
  synchronizeViewportSketchContext(viewport, latest.sketchContextRef.current)
}

function synchronizeViewportSketchContext(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  const referenceSelection = orbitReferenceSelection(context)
  const faceSelection = orbitFaceIntersectionSelection(context)
  synchronizeViewportSelectedFaces(viewport, context)
  if (faceSelection?.sourceMesh) viewport.clearSelection()
  viewport.setSketchReferenceCandidates(referenceSelection?.candidates ?? [])
  viewport.setInteractionMode(
    viewportInteractionMode(
      context,
      referenceSelection !== undefined,
      orbitFaceIntersectionSelection(context) !== undefined,
    ),
  )
  synchronizeViewportSketchProjection(viewport, context)
  synchronizeViewportSketchNavigation(viewport, context)
  viewport.setPointerOrbit(context?.pointerOrbit === true)
}

function synchronizeViewportSelectedFaces(
  viewport: GeometryViewportPort | null,
  context: GeometryViewportSketchContext | null | undefined,
) {
  viewport?.setFaceSelections(context?.faceIntersectionSelection?.selectedFaces ?? [])
}

function activeSketchProjection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "normal") return null
  return context.projectionStore?.getState().projection ?? null
}

function synchronizeViewportSketchProjection(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  const projection = activeSketchProjection(context)
  if (context?.mode === "normal" && projection) {
    viewport.setSketchProjection(projection.frame, projection.bounds)
    return
  }
  viewport.clearSketchProjection()
  if (context?.mode === "normal" && context.frame) viewport.orientToFrame(context.frame)
}

function synchronizeViewportSketchNavigation(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  if (context?.mode !== "orbit") {
    viewport.setSketchPlaneProjection(null)
    viewport.setSketchNavigationElement(null)
    return
  }
  viewport.setSketchPlaneProjection(context.frame, (projection) =>
    context.projectionStore?.getState().publishCameraProjection(projection),
  )
  viewport.setSketchNavigationElement(context.projectionStore?.getState().navigationElement ?? null)
}

function orbitReferenceSelection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "orbit") return undefined
  return context.referenceSelection
}

function orbitFaceIntersectionSelection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "orbit") return undefined
  return context.faceIntersectionSelection
}

function routeViewportFaceSelection(
  selection: ViewerSelection | null,
  context: GeometryViewportSketchContext | null,
  onSelectionChange: (selection: ViewerSelection | null) => void,
) {
  const faceSelection = orbitFaceIntersectionSelection(context)
  if (faceSelection && (selection || faceSelection.sourceMesh || faceSelection.consumeBackground)) {
    if (
      selection &&
      (!faceSelection.isCandidateEligible || faceSelection.isCandidateEligible(selection))
    )
      faceSelection.onSelect(selection)
    return
  }
  onSelectionChange(selection)
}

function viewportInteractionMode(
  context: GeometryViewportSketchContext | null,
  referenceSelectionActive: boolean,
  faceIntersectionSelectionActive: boolean,
) {
  if (referenceSelectionActive) return "sketch-reference-select"
  if (faceIntersectionSelectionActive) return "face-select"
  return context ? "camera-only" : "select"
}

function retainAxialDistanceChange(
  callbackRef: { current: ((distance: number) => void) | undefined },
  axialGizmo: GeometryViewportProps["axialGizmo"],
  pending: boolean,
) {
  if (axialGizmo) callbackRef.current = axialGizmo.onDistanceChange
  else if (!pending) callbackRef.current = undefined
}

function useLatestViewportInputs({
  controller,
  featurePreselection,
  featureSelection,
  meshes,
  originPlaneSelection,
  originPlaneSelectionActive,
  originPlaneIdleSelectionEnabled,
  originPlaneVisibility,
  sketchContext,
  sketches,
  sketchProfileSelection,
  sketchProfilePreview,
  angularGizmo,
  axialGizmo,
  axialGizmoPending,
  translationGizmo,
  selectionCallbacks,
}: Readonly<{
  controller: DocumentControllerState
  featurePreselection: ViewerFeatureHighlight
  featureSelection: ViewerFeatureHighlight
  meshes: readonly ViewerMesh[]
  originPlaneSelection: ViewerOriginPlane | null
  originPlaneSelectionActive: boolean
  originPlaneIdleSelectionEnabled: boolean
  originPlaneVisibility: ViewerOriginPlaneVisibility
  sketchContext: GeometryViewportSketchContext | null
  sketches: readonly ViewerSketch[]
  sketchProfileSelection: GeometryViewportProps["sketchProfileSelection"]
  sketchProfilePreview: GeometryViewportProps["sketchProfilePreview"]
  angularGizmo: GeometryViewportProps["angularGizmo"]
  axialGizmo: GeometryViewportProps["axialGizmo"]
  axialGizmoPending: boolean
  translationGizmo: GeometryViewportProps["translationGizmo"]
  selectionCallbacks: Readonly<{
    onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void
    onOriginPlaneSelectionChange: (plane: ViewerOriginPlane | null) => void
    onSelectionChange: (selection: ViewerSelection | null) => void
  }>
}>) {
  const controllerRef = useRef(controller)
  const featureHighlightRefs = useRef({
    preselection: { current: featurePreselection },
    selection: { current: featureSelection },
    axialDistanceChange: { current: axialGizmo?.onDistanceChange },
  }).current
  const featurePreselectionRef = featureHighlightRefs.preselection
  const featureSelectionRef = featureHighlightRefs.selection
  const axialDistanceChangeRef = featureHighlightRefs.axialDistanceChange
  retainAxialDistanceChange(axialDistanceChangeRef, axialGizmo, axialGizmoPending)
  const selectionCallbacksRef = useRef(selectionCallbacks)
  const meshesRef = useRef(meshes)
  const originPlaneRef = useRef(originPlaneSelection)
  const originPlaneSelectionActiveRef = useRef(originPlaneSelectionActive)
  const originPlaneIdleSelectionEnabledRef = useRef(originPlaneIdleSelectionEnabled)
  const originPlaneVisibilityRef = useRef(originPlaneVisibility)
  const sketchContextRef = useRef(sketchContext)
  const sketchesRef = useRef(sketches)
  const sketchProfileSelectionRef = useRef(sketchProfileSelection)
  const sketchProfilePreviewRef = useRef(sketchProfilePreview)
  const angularGizmoRef = useRef(angularGizmo)
  const axialGizmoRef = useRef(axialGizmo)
  const translationGizmoRef = useRef(translationGizmo)
  controllerRef.current = controller
  selectionCallbacksRef.current = selectionCallbacks
  featurePreselectionRef.current = featurePreselection
  featureSelectionRef.current = featureSelection
  meshesRef.current = meshes
  originPlaneRef.current = originPlaneSelection
  originPlaneSelectionActiveRef.current = originPlaneSelectionActive
  originPlaneIdleSelectionEnabledRef.current = originPlaneIdleSelectionEnabled
  originPlaneVisibilityRef.current = originPlaneVisibility
  sketchContextRef.current = sketchContext
  sketchesRef.current = sketches
  sketchProfileSelectionRef.current = sketchProfileSelection
  sketchProfilePreviewRef.current = sketchProfilePreview
  angularGizmoRef.current = angularGizmo
  axialGizmoRef.current = axialGizmo
  translationGizmoRef.current = translationGizmo
  return {
    selectionCallbacksRef,
    controllerRef,
    featurePreselectionRef,
    featureSelectionRef,
    axialDistanceChangeRef,
    meshesRef,
    originPlaneRef,
    originPlaneSelectionActiveRef,
    originPlaneIdleSelectionEnabledRef,
    originPlaneVisibilityRef,
    sketchContextRef,
    sketchesRef,
    sketchProfileSelectionRef,
    sketchProfilePreviewRef,
    angularGizmoRef,
    axialGizmoRef,
    translationGizmoRef,
  }
}

function useViewportProfileInteractionState() {
  const [preselection, setPreselection] = useState<ViewerSketchProfile | null>(null)
  const [candidateStack, setCandidateStack] = useState<readonly ViewerSketchProfile[]>([])
  const [selectionRequest, setSelectionRequest] = useState<readonly ViewerSketchProfile[]>([])
  const dismissSelectionRequest = useCallback(() => setSelectionRequest([]), [])
  return {
    candidateStack,
    dismissSelectionRequest,
    preselection,
    selectionRequest,
    setCandidateStack,
    setPreselection,
    setSelectionRequest,
  }
}

function useViewportSketchReferenceInteractionState() {
  const [preselection, setPreselection] = useState<ViewerSketchReferenceCandidate | null>(null)
  const [candidateStack, setCandidateStack] = useState<readonly ViewerSketchReferenceCandidate[]>(
    [],
  )
  return { candidateStack, preselection, setCandidateStack, setPreselection }
}

function useViewportGizmoSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  angularGizmo: GeometryViewportProps["angularGizmo"],
  axialGizmo: GeometryViewportProps["axialGizmo"],
  translationGizmo: GeometryViewportProps["translationGizmo"],
  axialGizmoPending: boolean,
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (angularGizmo) {
      viewport.showAngularGizmo(angularGizmo)
      return
    }
    if (axialGizmo) {
      viewport.showAxialTranslationGizmo(axialGizmo)
      return
    }
    if (translationGizmo) {
      viewport.showTranslationGizmo(translationGizmo.position)
      return
    }
    viewport.hideTranslationGizmo({ preserveActiveGesture: axialGizmoPending })
    viewport.hideAngularGizmo()
  }, [angularGizmo, axialGizmo, axialGizmoPending, translationGizmo, viewportRef])
}

function useViewportRendererStatus() {
  const [rendererStatus, setRendererStatus] = useState<"loading" | "ready" | "error">("loading")
  const [edgePreparationFailed, setEdgePreparationFailed] = useState(false)
  const t = useTranslations("app.shell.viewport")
  useReportApplicationError(edgePreparationFailed ? t("edgePreparationFailed") : null)
  return {
    rendererFailed: rendererStatus === "error",
    rendererPending: rendererStatus === "loading",
    setRendererStatus,
    setEdgePreparationFailed,
  }
}

function routeViewportSketchProfileSelection(
  profile: ViewerSketchProfile | null,
  intent: ViewerSketchProfileSelectionIntent,
  selection: GeometryViewportProps["sketchProfileSelection"],
  sketches: readonly ViewerSketch[],
) {
  if (!selection) return
  if (!profile) {
    selection.onSelect(null, [], "replace")
    return
  }
  const source = sketches.find(({ sketchId }) => sketchId === profile.selector.sketchId)
  selection.onSelect(
    profile.selector as SketchProfileSelector,
    source?.profiles?.map(({ selector }) => selector as SketchProfileSelector) ?? [],
    intent,
  )
}

function useViewportModelSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  latest: ReturnType<typeof useLatestViewportInputs>,
  modelEdges: ReturnType<typeof useModelEdgeViewport>,
  dismissProfileSelectionRequest: () => void,
) {
  const meshes = latest.meshesRef.current
  const sketches = latest.sketchesRef.current
  useEffect(() => {
    viewportRef.current?.setMeshes(meshes)
    synchronizeViewportSelectedFaces(viewportRef.current, latest.sketchContextRef.current)
  }, [meshes, latest.sketchContextRef, viewportRef])

  useEffect(() => {
    modelEdges.synchronize(viewportRef.current)
  }, [modelEdges.candidates, modelEdges.synchronize, viewportRef])

  useEffect(() => {
    dismissProfileSelectionRequest()
    viewportRef.current?.setSketches(sketches)
  }, [dismissProfileSelectionRequest, sketches, viewportRef])

  useViewportProfileSelectionSynchronization(
    viewportRef,
    sketches,
    latest.sketchProfileSelectionRef.current,
    latest.sketchProfilePreviewRef.current,
  )
}

function useViewportRenderer(
  createViewport: ViewportFactory,
  controller: DocumentControllerState,
  meshes: readonly ViewerMesh[],
  sketches: readonly ViewerSketch[],
  originPlaneSelection: ViewerOriginPlane | null,
  originPlaneSelectionActive: boolean,
  originPlaneIdleSelectionEnabled: boolean,
  originPlaneVisibility: ViewerOriginPlaneVisibility,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane | null) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
  featurePreselection: ViewerFeatureHighlight,
  featureSelection: ViewerFeatureHighlight,
  sketchContext: GeometryViewportSketchContext | null,
  sketchProfileSelection: GeometryViewportProps["sketchProfileSelection"],
  sketchProfilePreview: GeometryViewportProps["sketchProfilePreview"],
  angularGizmo: GeometryViewportProps["angularGizmo"],
  axialGizmo: GeometryViewportProps["axialGizmo"],
  translationGizmo: GeometryViewportProps["translationGizmo"],
  axialGizmoPending: boolean,
  edgeSelection: ModelEdgeViewportSelection | undefined,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  useBlockingViewport(viewportRef)
  const modelEdges = useModelEdgeViewport(edgeSelection, meshes)
  const latest = useLatestViewportInputs({
    controller,
    featurePreselection,
    featureSelection,
    meshes,
    originPlaneSelection,
    originPlaneSelectionActive,
    originPlaneIdleSelectionEnabled,
    originPlaneVisibility,
    sketchContext,
    sketches,
    sketchProfileSelection,
    sketchProfilePreview,
    angularGizmo,
    axialGizmo,
    axialGizmoPending,
    translationGizmo,
    selectionCallbacks: {
      onOriginPlanePreselectionChange,
      onOriginPlaneSelectionChange,
      onSelectionChange,
    },
  })
  const { rendererFailed, rendererPending, setRendererStatus, setEdgePreparationFailed } =
    useViewportRendererStatus()
  const sketchReferenceInteraction = useViewportSketchReferenceInteractionState()
  const profileInteraction = useViewportProfileInteractionState()
  const selectionCandidates = useSelectionCandidateEvents(originPlaneSelectionActive)
  const shouldInitialize = true

  useEffect(() => {
    const canvas = canvasRef.current
    if (!shouldInitialize || !canvas) return
    setRendererStatus("loading")
    setEdgePreparationFailed(false)
    const mount: ViewportMount = {
      cancelled: false,
      viewport: null,
      onEdgePreparationError: () => setEdgePreparationFailed(true),
    }
    void initializeViewport(
      canvas,
      createViewport,
      modelEdges,
      (plane) => latest.selectionCallbacksRef.current.onOriginPlanePreselectionChange(plane),
      (plane) => {
        profileInteraction.dismissSelectionRequest()
        latest.selectionCallbacksRef.current.onOriginPlaneSelectionChange(plane)
      },
      (selection) => {
        profileInteraction.dismissSelectionRequest()
        routeViewportFaceSelection(
          selection,
          latest.sketchContextRef.current,
          latest.selectionCallbacksRef.current.onSelectionChange,
        )
      },
      selectionCandidates.onChange,
      selectionCandidates.onCommit,
      sketchReferenceInteraction.setPreselection,
      sketchReferenceInteraction.setCandidateStack,
      (candidate) => latest.sketchContextRef.current?.referenceSelection?.onSelect(candidate),
      profileInteraction.setCandidateStack,
      profileInteraction.setSelectionRequest,
      profileInteraction.setPreselection,
      (profile, intent) => {
        profileInteraction.dismissSelectionRequest()
        routeViewportSketchProfileSelection(
          profile,
          intent,
          latest.sketchProfileSelectionRef.current,
          latest.sketchesRef.current,
        )
      },
      mount,
      viewportRef,
      latest.meshesRef,
      latest.sketchesRef,
      latest.controllerRef,
      latest.originPlaneRef,
      latest.originPlaneSelectionActiveRef,
      latest.originPlaneIdleSelectionEnabledRef,
      latest.originPlaneVisibilityRef,
      latest.featurePreselectionRef,
      latest.featureSelectionRef,
      latest.sketchContextRef,
      latest.sketchProfileSelectionRef,
      latest.sketchProfilePreviewRef,
      latest.angularGizmoRef,
      latest.axialGizmoRef,
      latest.axialDistanceChangeRef,
      latest.translationGizmoRef,
      setRendererStatus,
    )
    return () => {
      mount.cancelled = true
      if (viewportRef.current === mount.viewport) viewportRef.current = null
      modelEdges.disconnect(mount.viewport)
      mount.viewport?.dispose()
    }
  }, [
    createViewport,
    profileInteraction.dismissSelectionRequest,
    selectionCandidates.onChange,
    selectionCandidates.onCommit,
    modelEdges.disconnect,
    modelEdges.onCandidateStackChange,
    modelEdges.onPreselectionChange,
    modelEdges.onSelectionChange,
    modelEdges.synchronize,
    shouldInitialize,
  ])

  useViewportModelSynchronization(
    viewportRef,
    latest,
    modelEdges,
    profileInteraction.dismissSelectionRequest,
  )

  useEffect(() => {
    viewportRef.current?.setOriginPlaneSelection(
      originPlaneSelection,
      originPlaneSelectionActive,
      originPlaneIdleSelectionEnabled,
    )
  }, [originPlaneIdleSelectionEnabled, originPlaneSelection, originPlaneSelectionActive])

  useEffect(() => {
    viewportRef.current?.setOriginPlaneVisibility(originPlaneVisibility)
  }, [originPlaneVisibility])

  useEffect(() => {
    const viewport = viewportRef.current
    viewport?.setFeatureSelection(featureSelection)
    viewport?.setFeaturePreselection(featurePreselection)
  }, [featurePreselection, featureSelection])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) synchronizeViewportSketchContext(viewport, sketchContext)
  }, [sketchContext])

  return {
    canvasRef,
    modelEdges,
    rendererFailed,
    rendererPending,
    selectionCandidateCommit: selectionCandidates.commit,
    selectionCandidateStack: selectionCandidates.stack,
    sketchPointPreselection: sketchReferenceInteraction.preselection,
    sketchProfileCandidateStack: profileInteraction.candidateStack,
    sketchProfilePreselection: profileInteraction.preselection,
    sketchProfileSelectionRequest: profileInteraction.selectionRequest,
    dismissSketchProfileSelectionRequest: profileInteraction.dismissSelectionRequest,
    sketchReferenceCandidateStack: sketchReferenceInteraction.candidateStack,
    viewportRef,
  }
}

function useViewportProfileSelectionSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  sketches: readonly ViewerSketch[],
  selection: GeometryViewportProps["sketchProfileSelection"],
  preview: GeometryViewportProps["sketchProfilePreview"],
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.setSketchProfileSelections(
      selectedViewerSketchProfiles(sketches, selection?.selectedProfiles ?? []),
    )
    viewport.setSketchProfilePreselection(selectedViewerSketchProfile(sketches, preview ?? null))
  }, [preview, selection?.selectedProfiles, sketches, viewportRef])
}

function useSelectionCandidateEvents(active: boolean) {
  const [stack, setStack] = useState<readonly ViewerSelection[]>([])
  const [commit, setCommit] = useState<
    Readonly<{ candidates: readonly ViewerSelection[]; id: number }> | undefined
  >()
  const commitIdRef = useRef(0)
  const onChange = useCallback((candidates: readonly ViewerSelection[]) => setStack(candidates), [])
  const onCommit = useCallback((candidates: readonly ViewerSelection[]) => {
    commitIdRef.current += 1
    setCommit({ candidates, id: commitIdRef.current })
  }, [])
  useEffect(() => {
    if (active) return
    setCommit(undefined)
    setStack([])
  }, [active])
  return { commit, onChange, onCommit, stack }
}

// Retained snapshots keep this deduplication alive across editor remounts without retaining projects.
const completedProjectThumbnails = new WeakSet<
  NonNullable<DocumentControllerState["report"]>["snapshot"]
>()

function useProjectThumbnail(
  controller: DocumentControllerState,
  meshes: readonly ViewerMesh[],
  enabled = true,
) {
  const retryCountRef = useRef(new Map<string, number>())
  const [retryAttempt, requestRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined
    const abort = new AbortController()
    const snapshot = controller.report?.snapshot
    if (!enabled || controller.status !== "ready" || !snapshot || meshes.length === 0) return
    const revisionKey = `${snapshot.id}:${snapshot.revision}`
    if (completedProjectThumbnails.has(snapshot)) return

    const retry = () => {
      const retryCount = retryCountRef.current.get(revisionKey) ?? 0
      if (cancelled || retryCount >= 1) return
      retryCountRef.current.set(revisionKey, retryCount + 1)
      retryTimer = window.setTimeout(() => requestRetry((attempt) => attempt + 1), 250)
    }

    const thumbnailTimer = window.setTimeout(() => {
      void renderProjectThumbnail(meshes, { signal: abort.signal })
        .then(async (thumbnail) => {
          if (cancelled) return
          if (!thumbnail) {
            completedProjectThumbnails.add(snapshot)
            return
          }
          const result = await saveActiveProjectThumbnail(snapshot.id, snapshot.revision, thumbnail)
          if (cancelled) return
          if (result.ok) {
            completedProjectThumbnails.add(snapshot)
            retryCountRef.current.delete(revisionKey)
          } else {
            retry()
          }
        })
        // A derived preview must never block the authoritative geometry viewport.
        .catch(retry)
    }, 250)

    return () => {
      cancelled = true
      abort.abort()
      window.clearTimeout(thumbnailTimer)
      window.clearTimeout(retryTimer)
    }
  }, [controller.report?.snapshot, controller.status, enabled, meshes, retryAttempt])
}

function ViewportMessage({
  message,
  title,
}: {
  message: ReturnType<typeof viewportMessage>
  title: string
}) {
  if (!message) return null
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 grid place-items-center px-6 text-center",
        SAFE_VIEWPORT_REGION,
      )}
    >
      <div className="max-w-sm rounded-md bg-background/85 p-3 shadow-sm backdrop-blur-sm">
        <p className="text-sm font-medium">{title}</p>
        {message.kind === "error" ? (
          <Alert className="mt-2">{message.text}</Alert>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}

function ViewportControls({
  viewControls,
  cameraLocked = false,
  clearLabel,
  fitLabel,
  selection,
  onBodyClear,
  onEdgeClear,
  viewportRef,
}: {
  viewControls?: ReactNode
  cameraLocked?: boolean
  clearLabel: string
  fitLabel: string
  onBodyClear?: (() => void) | undefined
  onEdgeClear?: (() => void) | undefined
  selection: ViewerSelection | ModelBodySelection | null
  viewportRef: RefObject<GeometryViewportPort | null>
}) {
  const t = useTranslations("app.shell.viewport")
  const standardViews = [
    ["isometric", t("viewIsometric")],
    ["front", t("viewFront")],
    ["back", t("viewBack")],
    ["left", t("viewLeft")],
    ["right", t("viewRight")],
    ["top", t("viewTop")],
    ["bottom", t("viewBottom")],
  ] as const satisfies readonly (readonly [ViewerStandardView, string])[]
  return (
    <div
      className={cn(
        "pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_RIGHT,
      )}
    >
      {viewControls}
      {selection || onEdgeClear ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={clearLabel}
              onClick={() => {
                if (onEdgeClear) onEdgeClear()
                else viewportRef.current?.clearSelection()
                onBodyClear?.()
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{clearLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={cameraLocked}
                aria-label={t("standardViews")}
                dropdown
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Cuboid aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("standardViews")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {standardViews.map(([view, label]) => (
            <DropdownMenuItem
              key={view}
              onSelect={() => viewportRef.current?.setStandardView(view)}
            >
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={fitLabel}
            disabled={cameraLocked}
            onClick={() => viewportRef.current?.fit()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Scan aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{fitLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function OriginPlaneSelectionOverlay({
  preselectedFaceLabel,
  preselectedPlane,
  selection,
}: {
  preselectedFaceLabel: string | null
  preselectedPlane: ViewerOriginPlane | null
  selection:
    | Readonly<{ mode: "create" | "replace"; selectedPlane: ViewerOriginPlane | null }>
    | undefined
}) {
  const t = useTranslations("app.shell.viewport")
  if (!selection) return null
  const planeLabels: Record<ViewerOriginPlane, string> = {
    xy: t("planeXy"),
    xz: t("planeXz"),
    yz: t("planeYz"),
  }
  const status = preselectedFaceLabel
    ? t(selection.mode === "replace" ? "preselectedReplacementFace" : "preselectedSketchFace", {
        face: preselectedFaceLabel,
      })
    : preselectedPlane
      ? t(selection.mode === "replace" ? "preselectedReplacementPlane" : "preselectedSketchPlane", {
          plane: planeLabels[preselectedPlane],
        })
      : selection.selectedPlane
        ? t("selectedSketchPlane", { plane: planeLabels[selection.selectedPlane] })
        : t("currentModelFaceSupport")
  const instruction =
    selection.mode === "replace" ? t("replaceSketchSupport") : t("selectSketchPlane")

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_CENTER,
      )}
    >
      <p className="text-xs font-medium">{instruction}</p>
      <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
        {status}
      </p>
    </div>
  )
}

type ActivePreviewStatus = Exclude<FeaturePreviewState["status"], "idle">
type PreviewMessageKey =
  | "holePreviewFailed"
  | "holePreviewLoading"
  | "holePreviewReady"
  | "edgeTreatmentPreviewFailed"
  | "edgeTreatmentPreviewLoading"
  | "edgeTreatmentPreviewReady"
  | "datumPreviewFailed"
  | "datumPreviewLoading"
  | "datumPreviewReady"
  | "previewFailed"
  | "previewLoading"
  | "previewReady"
  | "featurePreviewFailed"
  | "featurePreviewLoading"
  | "featurePreviewReady"

const PREVIEW_MESSAGE_KEYS: Readonly<
  Record<FeaturePreviewKind, Record<ActivePreviewStatus, PreviewMessageKey>>
> = {
  hole: { error: "holePreviewFailed", loading: "holePreviewLoading", ready: "holePreviewReady" },
  "edge-treatment": {
    error: "edgeTreatmentPreviewFailed",
    loading: "edgeTreatmentPreviewLoading",
    ready: "edgeTreatmentPreviewReady",
  },
  "datum-plane": {
    error: "datumPreviewFailed",
    loading: "datumPreviewLoading",
    ready: "datumPreviewReady",
  },
  extrusion: {
    error: "previewFailed",
    loading: "previewLoading",
    ready: "previewReady",
  },
  subtract: {
    error: "featurePreviewFailed",
    loading: "featurePreviewLoading",
    ready: "featurePreviewReady",
  },
  primitive: {
    error: "featurePreviewFailed",
    loading: "featurePreviewLoading",
    ready: "featurePreviewReady",
  },
  revolve: {
    error: "previewFailed",
    loading: "previewLoading",
    ready: "previewReady",
  },
}

function previewMessageKey(preview: FeaturePreviewState | undefined) {
  if (!preview || preview.status === "idle") return null
  if (preview.assistantDraft && hasFeaturePreviewGeometry(preview)) return "assistantPreviewUnsaved"
  return PREVIEW_MESSAGE_KEYS[preview.kind ?? "extrusion"][preview.status]
}

function ExtrusionErrorHint() {
  const t = useTranslations("app.shell.cadError")
  return t("viewportHint")
}

function hasExtrusionErrorDetails(preview: FeaturePreviewState | undefined) {
  return (
    preview?.status === "error" &&
    preview.kind === "extrusion" &&
    (preview.diagnostics?.length ?? 0) > 0
  )
}

function PreviewStatus({ preview }: { preview: FeaturePreviewState | undefined }) {
  const t = useTranslations("app.shell.viewport")
  useReportActivity(preview?.status === "loading")
  const messageKey = previewMessageKey(preview)
  if (!messageKey) return null
  const failed = preview?.status === "error"
  const detailedExtrusionError = hasExtrusionErrorDetails(preview)
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-14 max-w-sm",
        (!failed || detailedExtrusionError) &&
          "rounded-md border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_LEFT,
      )}
    >
      {failed && !detailedExtrusionError ? (
        <Alert aria-live="polite">{t(messageKey)}</Alert>
      ) : (
        <p className="text-xs text-muted-foreground" role="status">
          {detailedExtrusionError ? <ExtrusionErrorHint /> : t(messageKey)}
        </p>
      )}
    </div>
  )
}

type GeometryViewportProps = Readonly<{
  readOnlyPresentation?: boolean
  toolPlane?: ViewerToolPlane | null | undefined
  viewControls?: ReactNode
  activeSketchDisplay?: ViewerSketch | null
  axialGizmoPending?: boolean
  controller: DocumentControllerState
  section?: ViewerSection | null
  onSectionChange?: ((section: ViewerSection) => void) | undefined
  printerProfile?: PrinterProfile | null
  printBedVisible?: boolean
  groundGridVisible?: boolean
  createViewport?: ViewportFactory
  contextualHiddenFeatureIds?: readonly string[]
  featurePreview?: FeaturePreviewState
  hiddenFeatureIds?: readonly string[]
  partVisibilityOverrides?: PartVisibilityOverrides | undefined
  hiddenSketchIds?: readonly string[]
  idleOriginPlaneSelection?:
    | Readonly<{
        selectedPlane: ViewerOriginPlane | null
        onSelect: (plane: ViewerOriginPlane | null) => void
      }>
    | undefined
  originPlaneSelection?: Readonly<{
    mode: "create" | "replace"
    selectedPlane: ViewerOriginPlane | null
    onSelect: (plane: ViewerOriginPlane) => void
  }>
  originPlaneVisibility?: Readonly<{
    onChange: (plane: ViewerOriginPlane, visible: boolean) => void
    visibility: ViewerOriginPlaneVisibility
  }>
  preselectedSketchId?: string | null | undefined
  preselectedSketchIds?: readonly string[] | undefined
  selectedSketchIds?: readonly string[] | undefined
  preselectedBody?: ModelBodySelection | null
  preselectedBodies?: readonly ModelBodySelection[] | undefined
  selectedBodies?: readonly ModelBodySelection[] | undefined
  selectedBody?: ModelBodySelection | null
  onBodySelectionChange?: (body: ModelBodySelection | null) => void
  onBodyPreselectionChange?: (body: ModelBodySelection | null) => void
  preselectedFeatureId?: string | null
  selectedFeatureId?: string | null
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
  edgeSelection?: ModelEdgeViewportSelection | undefined
  sketchContext?: GeometryViewportSketchContext
  sketchProfileSelection?: Readonly<{
    keyboardPickerActive?: boolean
    excludedSketchIds?: readonly string[]
    selectedProfiles: readonly SketchProfileSelector[]
    onSelect: (
      profile: SketchProfileSelector | null,
      profiles: readonly SketchProfileSelector[],
      intent: ViewerSketchProfileSelectionIntent,
    ) => void
  }>
  sketchProfilePreview?: SketchProfileSelector | null
  angularGizmo?: ViewerAngularGizmo &
    Readonly<{
      featureId: string
      onAngleChange: (angle: number) => void
    }>
  axialGizmo?: ViewerAxialGizmo &
    Readonly<{
      featureId: string
      onDistanceChange: (distance: number) => void
      opposite?: Readonly<{
        distance: number
        onDistanceChange: (distance: number) => void
      }>
    }>
  translationGizmo?: Readonly<{
    featureId: string
    onPositionChange: (position: PrimitivePlacement) => void
    position: PrimitivePlacement
  }>
}>

function viewerFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
): ViewerMesh | null {
  if (!featureId || !controller.report?.rebuild.ok) return null
  const result = controller.report.rebuild.response.geometry.find(
    (candidate) => candidate.featureId === featureId,
  )
  return result ? ({ featureId, ...result.geometry.mesh } satisfies ViewerMesh) : null
}

function highlightedFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
  hiddenFeatureIds: readonly string[],
  preview: FeaturePreviewState | undefined,
) {
  if (!featureId || hiddenFeatureIds.includes(featureId)) return null
  if (hasFeaturePreviewGeometry(preview) && preview?.candidateMesh?.featureId === featureId) {
    return preview.candidateMesh
  }
  return viewerFeatureMesh(controller, featureId)
}

function useHighlightedFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
  hiddenFeatureIds: readonly string[],
  preview: FeaturePreviewState | undefined,
  hiddenBodies: ReadonlySet<string>,
) {
  return useMemo(() => {
    const candidate = highlightedFeatureMesh(controller, featureId, hiddenFeatureIds, preview)
    return candidate && !hiddenBodies.has(authoredBodyKey(candidate)) ? candidate : null
  }, [controller, featureId, hiddenFeatureIds, preview, hiddenBodies])
}

function hasFeaturePreviewGeometry(preview: FeaturePreviewState | undefined) {
  return preview?.status === "ready" || (preview?.status === "loading" && preview.retained === true)
}

function previewMeshes(
  preview: FeaturePreviewState | undefined,
  committedMeshes: readonly ViewerMesh[],
) {
  return hasFeaturePreviewGeometry(preview) && preview ? preview.meshes : committedMeshes
}

function selectedOriginPlane(
  selection: GeometryViewportProps["originPlaneSelection"],
  idleSelection: GeometryViewportProps["idleOriginPlaneSelection"],
) {
  return selection?.selectedPlane ?? idleSelection?.selectedPlane ?? null
}

function visibleOriginPlanes(
  originPlaneVisibility: GeometryViewportProps["originPlaneVisibility"],
) {
  return originPlaneVisibility?.visibility ?? defaultViewerOriginPlaneVisibility
}

function useOriginPlaneInteraction(
  selection: GeometryViewportProps["originPlaneSelection"],
  idleSelection: GeometryViewportProps["idleOriginPlaneSelection"],
) {
  const activeSelect = selection?.onSelect
  const idleSelect = idleSelection?.onSelect
  const onSelect = useCallback(
    (plane: ViewerOriginPlane | null) => {
      if (activeSelect) {
        if (plane) activeSelect(plane)
        return
      }
      const selectIdlePlane = idleSelect ?? ignoreOriginPlaneSelection
      selectIdlePlane(plane)
    },
    [activeSelect, idleSelect],
  )
  return {
    active: selection !== undefined,
    idleSelectionEnabled: idleSelection !== undefined,
    onSelect,
    selectedPlane: selectedOriginPlane(selection, idleSelection),
  }
}

function changeOriginPlaneVisibilityHandler(
  originPlaneVisibility: GeometryViewportProps["originPlaneVisibility"],
) {
  return originPlaneVisibility?.onChange ?? ignoreOriginPlaneVisibilityChange
}

function previewAllowsViewportMessage(preview: FeaturePreviewState | undefined) {
  return preview?.status !== "loading" && preview?.status !== "error"
}

function useClearInvalidSelection(
  meshes: readonly ViewerMesh[],
  selection: ViewerSelection | null,
  onSelectionChange: GeometryViewportProps["onSelectionChange"],
) {
  useEffect(() => {
    if (selection && !meshes.some((mesh) => viewerBodyKey(mesh) === viewerBodyKey(selection))) {
      onSelectionChange(null)
    }
  }, [meshes, onSelectionChange, selection])
}

function translatedViewportMessage(
  controller: DocumentControllerState,
  rendererFailed: boolean,
  meshes: readonly ViewerMesh[],
  sketches: readonly ViewerSketch[],
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"],
  preview: FeaturePreviewState | undefined,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
) {
  if (!previewAllowsViewportMessage(preview)) return null
  return viewportMessage(
    controller,
    rendererFailed,
    meshes.length + sketches.length,
    originPlaneSelection !== undefined,
    {
      loading: t("loading"),
      loadFailed: t("loadFailed"),
      rebuildFailed: t("rebuildFailed"),
      unavailable: t("unavailable"),
      empty: t("empty"),
    },
  )
}

function useSketchProjectionSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  sketchContext: GeometryViewportSketchContext | undefined,
) {
  const frameRequestRef = useRef<number | null>(null)
  useEffect(() => {
    const store = sketchContext?.projectionStore
    if (!store || sketchContext.mode !== "normal") return
    let projection = store.getState().projection
    const unsubscribe = store.subscribe((state) => {
      if (state.projection === projection) return
      projection = state.projection
      if (frameRequestRef.current !== null) return
      frameRequestRef.current = window.requestAnimationFrame(() => {
        frameRequestRef.current = null
        const viewport = viewportRef.current
        if (viewport) synchronizeViewportSketchProjection(viewport, sketchContext)
      })
    })
    return () => {
      unsubscribe()
      if (frameRequestRef.current === null) return
      window.cancelAnimationFrame(frameRequestRef.current)
      frameRequestRef.current = null
    }
  }, [sketchContext, viewportRef])
}

function useSketchNavigationSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  sketchContext: GeometryViewportSketchContext | undefined,
) {
  useEffect(() => {
    const store = sketchContext?.projectionStore
    if (!store || sketchContext.mode !== "orbit") return
    let navigationElement = store.getState().navigationElement
    const unsubscribe = store.subscribe((state) => {
      if (state.navigationElement === navigationElement) return
      navigationElement = state.navigationElement
      viewportRef.current?.setSketchNavigationElement(navigationElement)
    })
    return unsubscribe
  }, [sketchContext, viewportRef])
}

function withFacePickingSource(
  meshes: readonly ViewerMesh[],
  source: ViewerMesh | undefined,
  excludedFeatureIds: readonly string[],
  previewReady: boolean,
): readonly ViewerMesh[] {
  if (!source) return meshes
  const excluded = new Set(excludedFeatureIds)
  return [
    ...meshes.filter(
      (mesh) =>
        authoredBodyKey(mesh) !== authoredBodyKey(source) &&
        (previewReady || !excluded.has(mesh.featureId)),
    ),
    { ...source, appearance: previewReady ? "selection-source" : "model" },
  ]
}

function facePickingPresentation(context: GeometryViewportSketchContext | undefined) {
  return {
    sourceMesh: context?.faceIntersectionSelection?.sourceMesh,
    excludedFeatureIds: context?.faceIntersectionSelection?.excludedFeatureIds ?? EMPTY_IDS,
    selectionMeshes: context?.faceIntersectionSelection?.selectionMeshes,
  }
}

function useViewportMeshPresentation({
  contextualHiddenFeatureIds,
  controller,
  featurePreview,
  hiddenFeatureIds,
  partVisibilityOverrides,
  readOnlyPresentation,
  sketchContext,
}: Pick<
  GeometryViewportProps,
  | "contextualHiddenFeatureIds"
  | "controller"
  | "featurePreview"
  | "hiddenFeatureIds"
  | "partVisibilityOverrides"
  | "readOnlyPresentation"
  | "sketchContext"
>) {
  const contextualIds = contextualHiddenFeatureIds ?? EMPTY_IDS
  const hiddenIds = hiddenFeatureIds ?? EMPTY_IDS
  const authority = controller.authoredSnapshot
  const featureSnapshot = controller.report?.snapshot.features
  const rebuild = controller.report?.rebuild
  const rebuildResponse = rebuild?.ok ? rebuild.response : undefined
  const allCommittedMeshes = useMemo(
    () => viewerMeshes(controller).filter(({ appearance }) => appearance !== "datum"),
    [authority, featureSnapshot, rebuild?.ok, rebuildResponse],
  )
  const allHiddenFeatureIds = useMemo(
    () => [...new Set([...hiddenIds, ...contextualIds])],
    [contextualIds, hiddenIds],
  )
  const committedMeshes = useMemo(
    () => viewerMeshes(controller, hiddenIds, contextualIds, partVisibilityOverrides),
    [
      authority,
      contextualIds,
      featureSnapshot,
      hiddenIds,
      rebuild?.ok,
      rebuildResponse,
      partVisibilityOverrides,
    ],
  )
  const hiddenBodies = useMemo(() => {
    const authored = currentAuthoredSnapshot(controller)
    return authored ? authoredBodyKeys(authored, true, partVisibilityOverrides) : new Set<string>()
  }, [authority, partVisibilityOverrides])
  const { sourceMesh, excludedFeatureIds, selectionMeshes } = facePickingPresentation(sketchContext)
  const previewGeometry = previewMeshes(featurePreview, committedMeshes)
  const previewReady = hasFeaturePreviewGeometry(featurePreview)
  const meshes = useMemo(() => {
    const hidden = new Set(allHiddenFeatureIds)
    const presented = withFacePickingSource(
      selectionMeshes ?? previewGeometry,
      sourceMesh,
      excludedFeatureIds,
      previewReady,
    )
    return presented.filter(
      (mesh) => !hidden.has(mesh.featureId) && !hiddenBodies.has(authoredBodyKey(mesh)),
    )
  }, [
    authority,
    allHiddenFeatureIds,
    committedMeshes,
    excludedFeatureIds,
    previewGeometry,
    previewReady,
    sourceMesh,
    selectionMeshes,
    hiddenBodies,
  ])
  const texturedMeshes = useTexturedMeshes(controller, meshes, readOnlyPresentation)
  const presentedMeshes = useTaskMeshes(
    texturedMeshes,
    selectionMeshes !== undefined || readOnlyPresentation === true,
  )
  const visibleMeshes = useMemo(
    () => presentedMeshes.filter((mesh) => !hiddenBodies.has(authoredBodyKey(mesh))),
    [presentedMeshes, hiddenBodies],
  )
  return { allCommittedMeshes, allHiddenFeatureIds, hiddenBodies, meshes: visibleMeshes }
}

function useTaskMeshes(meshes: readonly ViewerMesh[], referencePicking = false) {
  const task = useWorkspaceTask()
  const source = task?.interaction?.sourceMesh
  const preview = task?.interaction?.picking ? null : task?.preview
  return useMemo(
    () =>
      referencePicking
        ? meshes
        : (preview?.meshes ?? withFacePickingSource(meshes, source, EMPTY_IDS, false)),
    [meshes, source, preview, referencePicking],
  )
}

function useViewportSketchPresentation({
  activeSketchDisplay,
  controller,
  hiddenSketchIds,
  sketchProfilePreview,
  sketchContext,
}: Pick<
  GeometryViewportProps,
  | "activeSketchDisplay"
  | "controller"
  | "hiddenSketchIds"
  | "sketchContext"
  | "sketchProfilePreview"
>) {
  const hiddenIds = hiddenSketchIds ?? EMPTY_IDS
  const hiddenIdsKey = hiddenIds.join("\u0000")
  const resolvedPreviewSketchId = resolvedSketchProfilePreviewId(controller, sketchProfilePreview)
  const previewSketchId =
    resolvedPreviewSketchId && hiddenIds.includes(resolvedPreviewSketchId)
      ? resolvedPreviewSketchId
      : null
  return useMemo(() => {
    const committed = viewerSketches(
      controller,
      previewSketchId ? hiddenIds.filter((id) => id !== previewSketchId) : hiddenIds,
    )
    return withActiveSketchDisplay(committed, activeSketchDisplay, sketchContext?.mode === "orbit")
  }, [activeSketchDisplay, controller, hiddenIdsKey, previewSketchId, sketchContext?.mode])
}

function resolvedSketchProfilePreviewId(
  controller: DocumentControllerState,
  selector: SketchProfileSelector | null | undefined,
) {
  if (!selector) return null
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return null
  const source = rebuild.response.sketches?.find(({ sketchId }) => sketchId === selector.sketchId)
  if (!source) return null
  const selectorKey = viewerSketchProfileKey(selector)
  return source.profiles.some(
    ({ selector: candidate }) => viewerSketchProfileKey(candidate) === selectorKey,
  )
    ? selector.sketchId
    : null
}

function selectedSketchProfileKey(selection: GeometryViewportProps["sketchProfileSelection"]) {
  return selection?.selectedProfiles.length === 1
    ? viewerSketchProfileKey(selection.selectedProfiles[0] as SketchProfileSelector)
    : null
}

function useClearInvalidBodyHighlight(
  selection: ModelBodySelection | null | undefined,
  mesh: ViewerMesh | null,
  onChange: ((body: ModelBodySelection | null) => void) | undefined,
) {
  useEffect(() => {
    if (selection && !mesh) onChange?.(null)
  }, [mesh, selection, onChange])
}

function bodyHighlightMeshes(
  meshes: readonly ViewerMesh[],
  bodies: readonly ModelBodySelection[] | undefined,
) {
  if (bodies === undefined) return undefined
  const keys = new Set(bodies.map(viewerBodyKey))
  return meshes.filter((mesh) => keys.has(viewerBodyKey(mesh)))
}

function useGeometryViewportScene(props: GeometryViewportProps) {
  const { controller, featurePreview, preselectedFeatureId, selectedFeatureId } = props
  const {
    allCommittedMeshes,
    allHiddenFeatureIds,
    hiddenBodies,
    meshes: sourceMeshes,
  } = useViewportMeshPresentation(props)
  // Shading follows geometry/texture work so changing this preference never recomputes geometry.
  const meshes = useMemo(
    () =>
      featurePreview?.assistantDraft
        ? sourceMeshes.map((mesh) =>
            mesh.appearance === "preview"
              ? {
                  ...mesh,
                  previewMaterial:
                    featurePreview.display === "changes"
                      ? ("highlight" as const)
                      : mesh.previewMaterial === "datum"
                        ? ("datum" as const)
                        : ("model" as const),
                }
              : mesh,
          )
        : sourceMeshes,
    [sourceMeshes, featurePreview?.assistantDraft, featurePreview?.display],
  )
  const baseSketches = useViewportSketchPresentation(props)
  const sketches = useMemo(
    () =>
      baseSketches.map((sketch) => {
        const selected = props.selectedSketchIds?.includes(sketch.sketchId)
        const preselected =
          props.preselectedSketchId === sketch.sketchId ||
          Boolean(props.preselectedSketchIds?.includes(sketch.sketchId))
        return selected || preselected
          ? { ...sketch, selected: Boolean(selected), preselected }
          : sketch
      }),
    [baseSketches, props.selectedSketchIds, props.preselectedSketchId, props.preselectedSketchIds],
  )
  const featurePreselection = useHighlightedFeatureMesh(
    controller,
    preselectedFeatureId,
    allHiddenFeatureIds,
    featurePreview,
    hiddenBodies,
  )
  const featureSelection = useHighlightedFeatureMesh(
    controller,
    selectedFeatureId,
    allHiddenFeatureIds,
    featurePreview,
    hiddenBodies,
  )
  const selectedBody = props.selectedBody
  const preselectedBody = props.preselectedBody
  const bodySelection = useMemo(
    () =>
      selectedBody
        ? (meshes.find((mesh) => viewerBodyKey(mesh) === viewerBodyKey(selectedBody)) ?? null)
        : null,
    [meshes, selectedBody],
  )
  const bodyPreselection = useMemo(
    () =>
      preselectedBody
        ? (meshes.find((mesh) => viewerBodyKey(mesh) === viewerBodyKey(preselectedBody)) ?? null)
        : null,
    [meshes, preselectedBody],
  )
  useClearInvalidBodyHighlight(selectedBody, bodySelection, props.onBodySelectionChange)
  useClearInvalidBodyHighlight(preselectedBody, bodyPreselection, props.onBodyPreselectionChange)
  const featurePreselections = useMemo(
    () => bodyHighlightMeshes(meshes, props.preselectedBodies),
    [meshes, props.preselectedBodies],
  )
  const featureSelections = useMemo(
    () => bodyHighlightMeshes(meshes, props.selectedBodies),
    [meshes, props.selectedBodies],
  )
  return {
    allCommittedMeshes,
    featurePreselections,
    featureSelections,
    featurePreselection: preselectedBody ? bodyPreselection : featurePreselection,
    featureSelection: selectedBody ? bodySelection : featureSelection,
    meshes,
    sketches,
  }
}

function useGeometryViewportPresentation(
  props: GeometryViewportProps,
  scene: ReturnType<typeof useGeometryViewportScene>,
) {
  const { createViewport = loadGeometryViewport } = props
  const printPresentation = usePrintViewportFactory(
    createViewport,
    scene.meshes,
    props.printerProfile,
    props.printBedVisible,
    props.groundGridVisible,
  )
  const sectionFactory = useSectionViewportFactory(
    printPresentation.factory,
    props.section ?? null,
    props.onSectionChange,
    props.toolPlane,
  )
  return { printPresentation, sectionFactory }
}

function useGeometryViewportDecorations(
  viewportRef: ReturnType<typeof useViewportRenderer>["viewportRef"],
  props: GeometryViewportProps,
  printPresentation: ReturnType<typeof usePrintViewportFactory>,
) {
  usePrintViewportSynchronization(viewportRef, printPresentation)
  useSectionViewportSynchronization(viewportRef, props.section ?? null)
  useEffect(() => {
    viewportRef.current?.setToolPlane(props.toolPlane ?? null)
  }, [props.toolPlane, viewportRef])
  useViewportGizmoSynchronization(
    viewportRef,
    props.angularGizmo,
    props.axialGizmo,
    props.translationGizmo,
    props.axialGizmoPending ?? false,
  )
}

function hasActiveModelingTool(props: GeometryViewportProps) {
  return Boolean(
    props.toolPlane ||
      props.angularGizmo ||
      props.axialGizmo ||
      props.translationGizmo ||
      (props.featurePreview && props.featurePreview.status !== "idle"),
  )
}

function ordinaryModelEdgeViewportSelection(props: GeometryViewportProps, taskPicking: boolean) {
  if (
    props.readOnlyPresentation ||
    props.sketchContext ||
    props.originPlaneSelection ||
    taskPicking ||
    hasActiveModelingTool(props)
  )
    return undefined
  return props.edgeSelection
}

function useGeometryViewportInteraction(
  props: GeometryViewportProps,
  scene: ReturnType<typeof useGeometryViewportScene>,
) {
  const {
    controller,
    idleOriginPlaneSelection,
    originPlaneSelection,
    originPlaneVisibility,
    onSelectionChange,
    sketchContext,
    sketchProfileSelection,
  } = props
  const task = useWorkspaceTask()
  const edgeSelection = ordinaryModelEdgeViewportSelection(
    props,
    Boolean(task?.interaction?.picking),
  )
  const { printPresentation, sectionFactory } = useGeometryViewportPresentation(props, scene)
  const [originPlanePreselection, setOriginPlanePreselection] = useState<ViewerOriginPlane | null>(
    null,
  )
  const originPlaneInteraction = useOriginPlaneInteraction(
    originPlaneSelection,
    idleOriginPlaneSelection,
  )
  const t = useTranslations("app.shell.viewport")
  const {
    canvasRef,
    modelEdges,
    rendererFailed,
    rendererPending,
    selectionCandidateCommit,
    selectionCandidateStack,
    dismissSketchProfileSelectionRequest,
    sketchPointPreselection,
    sketchProfileCandidateStack,
    sketchProfilePreselection,
    sketchProfileSelectionRequest,
    sketchReferenceCandidateStack,
    viewportRef,
  } = useViewportRenderer(
    sectionFactory,
    controller,
    scene.meshes,
    scene.sketches,
    originPlaneInteraction.selectedPlane,
    originPlaneInteraction.active,
    originPlaneInteraction.idleSelectionEnabled,
    visibleOriginPlanes(originPlaneVisibility),
    setOriginPlanePreselection,
    originPlaneInteraction.onSelect,
    onSelectionChange,
    scene.featurePreselections ?? scene.featurePreselection,
    scene.featureSelections ?? scene.featureSelection,
    sketchContext ?? null,
    sketchProfileSelection,
    props.sketchProfilePreview,
    props.angularGizmo,
    props.axialGizmo,
    props.translationGizmo,
    props.axialGizmoPending ?? false,
    edgeSelection,
  )
  useGeometryViewportDecorations(viewportRef, props, printPresentation)
  const supportFaceSelection = useSupportFaceSelection(
    selectionCandidateStack,
    selectionCandidateCommit,
    controller,
    t,
  )
  return {
    printReport: printPresentation.report,
    canvasRef,
    modelEdges,
    dismissSketchProfileSelectionRequest,
    originPlaneInteraction,
    originPlanePreselection,
    rendererFailed,
    rendererPending,
    sketchPointPreselection,
    sketchProfileCandidateStack,
    sketchProfilePreselection,
    sketchProfileSelectionRequest,
    sketchReferenceCandidateStack,
    supportFaceSelection,
    viewportRef,
  }
}

function viewportHighlightIdentity(scene: ReturnType<typeof useGeometryViewportScene>) {
  return {
    preselectedFeatureId: scene.featurePreselection?.featureId ?? null,
    preselectedBodyRole: scene.featurePreselection?.outputRole ?? null,
    selectedFeatureId: scene.featureSelection?.featureId ?? null,
    selectedBodyRole: scene.featureSelection?.outputRole ?? null,
  }
}

function useGeometryViewportModel(props: GeometryViewportProps) {
  const t = useTranslations("app.shell.viewport")
  const scene = useGeometryViewportScene(props)
  const interaction = useGeometryViewportInteraction(props, scene)
  useProjectThumbnail(props.controller, scene.allCommittedMeshes, !props.readOnlyPresentation)
  useClearInvalidSelection(scene.meshes, props.selection, props.onSelectionChange)
  useSketchProjectionSynchronization(interaction.viewportRef, props.sketchContext)
  useSketchNavigationSynchronization(interaction.viewportRef, props.sketchContext)
  const message = translatedViewportMessage(
    props.controller,
    interaction.rendererFailed,
    scene.meshes,
    scene.sketches,
    props.originPlaneSelection,
    props.featurePreview,
    t,
  )
  return {
    ...viewportHighlightIdentity(scene),
    rendererFailed: interaction.rendererFailed,
    rendererPending: interaction.rendererPending,
    printReport: interaction.printReport,
    canvasRef: interaction.canvasRef,
    modelEdges: interaction.modelEdges,
    meshes: scene.meshes,
    sketches: scene.sketches,
    message,
    originPlanePreselection: interaction.originPlanePreselection,
    supportFaceCandidates: interaction.supportFaceSelection.candidates,
    supportFaceSelectionRequest: interaction.supportFaceSelection.request,
    dismissSketchProfileSelectionRequest: interaction.dismissSketchProfileSelectionRequest,
    sketchPointPreselection: interaction.sketchPointPreselection,
    sketchProfileCandidateStack: interaction.sketchProfileCandidateStack,
    sketchProfilePreselection: interaction.sketchProfilePreselection,
    sketchProfileSelectionRequest: interaction.sketchProfileSelectionRequest,
    sketchReferenceCandidateStack: interaction.sketchReferenceCandidateStack,
    originPlaneVisibility: visibleOriginPlanes(props.originPlaneVisibility),
    onOriginPlaneVisibilityChange: changeOriginPlaneVisibilityHandler(props.originPlaneVisibility),
    viewportRef: interaction.viewportRef,
    selectedSketchProfileCount: props.sketchProfileSelection?.selectedProfiles.length ?? 0,
    selectedSketchProfileKey: selectedSketchProfileKey(props.sketchProfileSelection),
  }
}

function ViewportControlsSlot({
  viewControls,
  meshes,
  sketches,
  originPlaneSelection,
  originPlaneVisibility,
  onOriginPlaneVisibilityChange,
  selection,
  onBodyClear,
  onEdgeClear,
  viewportRef,
}: Readonly<{
  viewControls?: ReactNode
  meshes: readonly ViewerMesh[]
  sketches: readonly ViewerSketch[]
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  onBodyClear?: (() => void) | undefined
  onEdgeClear?: (() => void) | undefined
  selection: ViewerSelection | ModelBodySelection | null
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      <div className={cn("absolute left-3 top-3 max-sm:hidden", SAFE_VIEWPORT_LEFT)}>
        <OriginPlaneVisibilityControls
          onChange={onOriginPlaneVisibilityChange}
          visibility={originPlaneVisibility}
        />
      </div>
      {viewControls || meshes.length > 0 || sketches.length > 0 || originPlaneSelection ? (
        <ViewportControls
          viewControls={viewControls}
          clearLabel={t("clearSelection")}
          fitLabel={t("fit")}
          selection={selection}
          onBodyClear={onBodyClear}
          onEdgeClear={onEdgeClear}
          viewportRef={viewportRef}
        />
      ) : null}
    </>
  )
}

function WorldAxesLegend() {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      aria-label={t("worldAxes")}
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 aspect-square h-[clamp(0px,calc(100%_-_var(--workspace-chrome-top,0px)_-_var(--workspace-chrome-bottom,0px)_-_1rem),5rem)] rounded-md border border-border/70 bg-background/10 shadow-inner",
        SAFE_VIEWPORT_LEFT,
      )}
      role="img"
    />
  )
}

function consumeSelectOtherKey(event: ReactKeyboardEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function nextSelectOtherIndex(
  activeIndex: number | null,
  candidateCount: number,
  initialIndex: number,
  reverse: boolean,
) {
  if (activeIndex !== null) {
    return (activeIndex + (reverse ? -1 : 1) + candidateCount) % candidateCount
  }
  return Math.max(0, initialIndex)
}

function useSketchReferenceSelectOther({
  candidateStack,
  context,
  focusRef,
  preselection,
  viewportRef,
}: Readonly<{
  candidateStack: readonly ViewerSketchReferenceCandidate[]
  context: GeometryViewportSketchContext | null | undefined
  focusRef: RefObject<HTMLElement | null>
  preselection: ViewerSketchReferenceCandidate | null
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  useEffect(() => {
    setActiveIndex((current) => {
      if (current !== null) focusRef.current?.focus({ preventScroll: true })
      return null
    })
  }, [candidateStack, context?.mode, focusRef])
  const referenceSelection = context?.mode === "orbit" ? context.referenceSelection : undefined

  const preview = (index: number) => {
    const candidate = candidateStack[index]
    if (!candidate) return
    setActiveIndex(index)
    viewportRef.current?.setSketchReferencePreselection(candidate)
  }
  const close = () => {
    setActiveIndex(null)
    viewportRef.current?.setSketchReferencePreselection(candidateStack[0] ?? null)
    focusRef.current?.focus({ preventScroll: true })
  }
  const dismiss = () => {
    setActiveIndex(null)
    viewportRef.current?.setSketchReferencePreselection(null)
  }
  const choose = (candidate: ViewerSketchReferenceCandidate) => {
    setActiveIndex(null)
    focusRef.current?.focus({ preventScroll: true })
    referenceSelection?.onSelect(candidate)
  }
  const cycle = (event: ReactKeyboardEvent<HTMLElement>) => {
    consumeSelectOtherKey(event)
    const preselectedIdentity = preselection
      ? viewerSketchReferenceCandidateKey(preselection)
      : null
    const initialIndex = preselectedIdentity
      ? candidateStack.findIndex(
          (candidate) => viewerSketchReferenceCandidateKey(candidate) === preselectedIdentity,
        )
      : 0
    preview(nextSelectOtherIndex(activeIndex, candidateStack.length, initialIndex, event.shiftKey))
  }
  const accept = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (activeIndex === null || event.target !== event.currentTarget) return
    const candidate = candidateStack[activeIndex]
    if (!candidate) return
    consumeSelectOtherKey(event)
    choose(candidate)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!referenceSelection) return
    if (event.code === "Backquote") {
      if (candidateStack.length >= 2) cycle(event)
      return
    }
    if (event.key === "Escape" && activeIndex !== null) {
      consumeSelectOtherKey(event)
      close()
      return
    }
    if (event.key === "Enter") accept(event)
  }

  return {
    activeIndex,
    candidates: activeIndex === null ? [] : candidateStack,
    choose,
    dismiss,
    onKeyDown,
    preview,
  }
}

type SketchReferenceSelectOtherState = ReturnType<typeof useSketchReferenceSelectOther>

type SupportFaceCandidate = Readonly<{
  key: string
  label: string
  selection: ViewerSelection
}>

type SupportFaceSelectionRequest =
  | Readonly<{ candidates: readonly SupportFaceCandidate[]; id: number }>
  | undefined

function supportFaceSelectionRequest(
  commit: Readonly<{ candidates: readonly ViewerSelection[]; id: number }> | undefined,
  controller: DocumentControllerState,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
): SupportFaceSelectionRequest {
  if (!commit) return undefined
  return {
    candidates: supportFaceCandidates(commit.candidates, controller, t),
    id: commit.id,
  }
}

function useSupportFaceSelection(
  stack: readonly ViewerSelection[],
  commit: Readonly<{ candidates: readonly ViewerSelection[]; id: number }> | undefined,
  controller: DocumentControllerState,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
) {
  const candidates = useMemo(
    () => supportFaceCandidates(stack, controller, t),
    [controller, stack, t],
  )
  const request = useMemo(
    () => supportFaceSelectionRequest(commit, controller, t),
    [commit, controller, t],
  )
  return { candidates, request }
}

function viewerSelectionKey(selection: ViewerSelection) {
  return `${viewerBodyKey(selection)}:${selection.faceId}`
}

function sameSupportFaceCandidates(
  left: readonly SupportFaceCandidate[],
  right: readonly SupportFaceCandidate[],
) {
  return (
    left.length === right.length &&
    left.every((candidate, index) => candidate.key === right[index]?.key)
  )
}

function supportFaceCandidates(
  selections: readonly ViewerSelection[],
  controller: DocumentControllerState,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
): readonly SupportFaceCandidate[] {
  const report = controller.report
  const rebuild = report?.rebuild
  if (!report || !rebuild?.ok) return []
  return selections.flatMap((selection) => {
    const support = selectedSketchSupportFromController(controller, selection)
    if (!support) return []
    const label = resolvePlanarFaceSupportLabel(
      rebuild.response.geometry,
      report.snapshot.features,
      support.support.reference,
      {
        face: (feature, ordinal) => t("externalModelFaceReference", { feature, ordinal }),
      },
    )
    return label ? [{ key: viewerSelectionKey(selection), label, selection }] : []
  })
}

function useSupportFaceSelectOther({
  candidateStack,
  focusRef,
  onSelectionChange,
  request,
  selectionActive,
  viewportRef,
}: Readonly<{
  candidateStack: readonly SupportFaceCandidate[]
  focusRef: RefObject<HTMLElement | null>
  onSelectionChange: (selection: ViewerSelection | null) => void
  request: SupportFaceSelectionRequest
  selectionActive: boolean
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const [activeCandidates, setActiveCandidates] = useState<readonly SupportFaceCandidate[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!selectionActive || !request || request.candidates.length < 2) return
    viewportRef.current?.setSelectionCandidateStackPreserved(true)
    setActiveCandidates(request.candidates)
    setActiveIndex(0)
    viewportRef.current?.setSelectionPreselection(request.candidates[0]?.selection ?? null)
  }, [request, selectionActive, viewportRef])

  useEffect(() => {
    if (selectionActive) return
    viewportRef.current?.setSelectionCandidateStackPreserved(false)
    setActiveCandidates([])
    setActiveIndex(null)
  }, [selectionActive])

  useEffect(() => {
    if (activeIndex === null || sameSupportFaceCandidates(activeCandidates, candidateStack)) return
    viewportRef.current?.setSelectionCandidateStackPreserved(false)
    setActiveCandidates([])
    setActiveIndex(null)
    viewportRef.current?.setSelectionPreselection(candidateStack[0]?.selection ?? null)
    focusRef.current?.focus({ preventScroll: true })
  }, [activeCandidates, activeIndex, candidateStack, focusRef, viewportRef])

  const preview = (index: number, candidates = activeCandidates) => {
    const candidate = candidates[index]
    if (!candidate) return
    viewportRef.current?.setSelectionCandidateStackPreserved(true)
    setActiveCandidates(candidates)
    setActiveIndex(index)
    viewportRef.current?.setSelectionPreselection(candidate.selection)
  }
  const close = () => {
    viewportRef.current?.setSelectionCandidateStackPreserved(false)
    setActiveCandidates([])
    setActiveIndex(null)
    viewportRef.current?.setSelectionPreselection(candidateStack[0]?.selection ?? null)
    focusRef.current?.focus({ preventScroll: true })
  }
  const choose = (candidate: SupportFaceCandidate) => {
    viewportRef.current?.setSelectionCandidateStackPreserved(false)
    setActiveCandidates([])
    setActiveIndex(null)
    viewportRef.current?.setSelectionPreselection(candidate.selection)
    focusRef.current?.focus({ preventScroll: true })
    onSelectionChange(candidate.selection)
  }
  const cycle = (event: ReactKeyboardEvent<HTMLElement>) => {
    const candidates = activeIndex === null ? candidateStack : activeCandidates
    if (candidates.length < 2) return
    consumeSelectOtherKey(event)
    preview(nextSelectOtherIndex(activeIndex, candidates.length, 0, event.shiftKey), candidates)
  }
  const accept = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (activeIndex === null || event.target !== event.currentTarget) return
    const candidate = activeCandidates[activeIndex]
    if (!candidate) return
    consumeSelectOtherKey(event)
    choose(candidate)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!selectionActive) return
    if (event.code === "Backquote") {
      cycle(event)
      return
    }
    if (event.key === "Escape" && activeIndex !== null) {
      consumeSelectOtherKey(event)
      close()
      return
    }
    if (event.key === "Enter") accept(event)
  }

  return {
    activeCandidate: activeIndex === null ? null : (activeCandidates[activeIndex] ?? null),
    activeCandidates,
    activeIndex,
    choose,
    close,
    onKeyDown,
    preview,
  }
}

type SupportFaceSelectOtherState = ReturnType<typeof useSupportFaceSelectOther>

function savedProfileNavigationReverse(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key === "ArrowUp") return true
  if (event.key === "ArrowDown") return false
  return event.code === "Backquote" ? event.shiftKey : null
}

function useSavedProfileSelectOther({
  candidates,
  controller,
  dismiss,
  focusRef,
  selection,
  sketches,
  viewportRef,
}: Readonly<{
  candidates: readonly ViewerSketchProfile[]
  controller: DocumentControllerState
  dismiss: () => void
  focusRef: RefObject<HTMLElement | null>
  selection: GeometryViewportProps["sketchProfileSelection"]
  sketches: readonly ViewerSketch[]
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  useEffect(() => {
    if (candidates.length < 2) {
      setActiveIndex(null)
      return
    }
    setActiveIndex(0)
    viewportRef.current?.setSketchProfilePreselection(candidates[0] ?? null)
  }, [candidates, viewportRef])
  const options = candidates.map((profile) => ({
    key: viewerSketchProfileKey(profile.selector),
    label:
      viewerSketchProfileLabel(controller, sketches, profile, (sketch, number) =>
        t("savedProfileLabel", { number, sketch }),
      ) ?? t("savedProfileUnknown"),
    profile,
  }))
  const close = () => {
    setActiveIndex(null)
    dismiss()
    viewportRef.current?.setSketchProfilePreselection(null)
    focusRef.current?.focus({ preventScroll: true })
  }
  const preview = (index: number) => {
    const option = options[index]
    if (!option) return
    setActiveIndex(index)
    viewportRef.current?.setSketchProfilePreselection(option.profile)
  }
  const choose = (profile: ViewerSketchProfile) => {
    const source = sketches.find(({ sketchId }) => sketchId === profile.selector.sketchId)
    const profiles =
      source?.profiles?.map(({ selector }) => selector as SketchProfileSelector) ?? []
    selection?.onSelect(profile.selector as SketchProfileSelector, profiles, "replace")
    viewportRef.current?.setSketchProfileSelections([profile])
    setActiveIndex(null)
    dismiss()
    focusRef.current?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (activeIndex === null || options.length < 2) return
    const reverse = savedProfileNavigationReverse(event)
    if (reverse !== null) {
      consumeSelectOtherKey(event)
      preview(nextSelectOtherIndex(activeIndex, options.length, 0, reverse))
      return
    }
    if (event.key === "Escape") {
      consumeSelectOtherKey(event)
      close()
      return
    }
    if (event.key !== "Enter" || event.target !== event.currentTarget) return
    const option = options[activeIndex]
    if (!option) return
    consumeSelectOtherKey(event)
    choose(option.profile)
  }
  return { activeIndex, choose, close, onKeyDown, options, preview }
}

type SavedProfileSelectOtherState = ReturnType<typeof useSavedProfileSelectOther>

function useActiveListboxFocus(activeIndex: number | null) {
  const listboxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIndex !== null) listboxRef.current?.focus({ preventScroll: true })
  }, [activeIndex])
  return listboxRef
}

function sketchReferenceInteraction(
  active: boolean,
  selection: SketchReferenceSelectOtherState,
): Readonly<{
  className?: string
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: () => void
  tabIndex?: number
}> {
  if (!active) return {}
  const focus = (event: ReactPointerEvent<HTMLElement>) =>
    event.currentTarget.focus({ preventScroll: true })
  return {
    className: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    onKeyDown: selection.onKeyDown,
    onPointerDown: focus,
    onPointerEnter: focus,
    onPointerLeave: selection.dismiss,
    tabIndex: 0,
  }
}

function supportFaceInteraction(
  active: boolean,
  selection: SupportFaceSelectOtherState,
): Readonly<{
  className?: string
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: () => void
  tabIndex?: number
}> {
  if (!active) return {}
  const focus = (event: ReactPointerEvent<HTMLElement>) =>
    event.currentTarget.focus({ preventScroll: true })
  return {
    className: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    onKeyDown: selection.onKeyDown,
    onPointerDown: focus,
    onPointerEnter: focus,
    tabIndex: 0,
  }
}

function viewportRegionInteraction(
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"],
  sketchContext: GeometryViewportSketchContext | undefined,
  supportSelection: SupportFaceSelectOtherState,
  sketchSelection: SketchReferenceSelectOtherState,
) {
  if (originPlaneSelection) return supportFaceInteraction(true, supportSelection)
  const sketchSelectionActive =
    sketchContext?.mode === "orbit" && sketchContext.referenceSelection !== undefined
  return sketchReferenceInteraction(sketchSelectionActive, sketchSelection)
}

function SketchReferenceSelectOtherOverlay({
  selection,
}: Readonly<{
  selection: SketchReferenceSelectOtherState
}>) {
  const t = useTranslations("app.shell.viewport")
  const listboxRef = useActiveListboxFocus(selection.activeIndex)
  if (selection.activeIndex === null || selection.candidates.length < 2) return null
  const activeOptionId = `sketch-reference-select-other-${selection.activeIndex}`
  return (
    <div
      aria-activedescendant={activeOptionId}
      aria-label={t("selectOtherReference")}
      className={cn(
        "pointer-events-auto absolute bottom-12 z-10 w-80 -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        SAFE_VIEWPORT_CENTER,
      )}
      data-sketch-reference-select-other
      onKeyDown={selection.onKeyDown}
      ref={listboxRef}
      role="listbox"
      tabIndex={-1}
    >
      <div className="px-2 pb-1 text-xs font-semibold">{t("selectOtherReference")}</div>
      <div className="grid gap-0.5">
        {selection.candidates.map((candidate, index) => (
          <Button
            aria-label={t("selectOtherReferenceOption", {
              count: selection.candidates.length,
              label: candidate.label,
              position: index + 1,
            })}
            aria-selected={selection.activeIndex === index}
            className="justify-start text-left"
            data-sketch-reference-select-other-active={
              selection.activeIndex === index ? "true" : undefined
            }
            id={`sketch-reference-select-other-${index}`}
            key={viewerSketchReferenceCandidateKey(candidate)}
            onClick={() => selection.choose(candidate)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="content"
            tabIndex={-1}
            type="button"
            variant={selection.activeIndex === index ? "secondary" : "ghost"}
          >
            <span className="w-10 shrink-0 font-mono text-muted-foreground">
              {t("selectOtherReferencePosition", {
                count: selection.candidates.length,
                position: index + 1,
              })}
            </span>
            <span className="truncate">{candidate.label}</span>
          </Button>
        ))}
      </div>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("selectOtherReferenceHint")}
      </div>
    </div>
  )
}

function SupportFaceSelectOtherOverlay({
  selection,
}: Readonly<{
  selection: SupportFaceSelectOtherState
}>) {
  const t = useTranslations("app.shell.viewport")
  const listboxRef = useActiveListboxFocus(selection.activeIndex)
  if (selection.activeIndex === null || selection.activeCandidates.length < 2) return null
  const activeOptionId = `support-face-select-other-${selection.activeIndex}`
  return (
    <div
      aria-activedescendant={activeOptionId}
      aria-label={t("selectOtherSupport")}
      className={cn(
        "pointer-events-auto absolute bottom-12 z-10 w-80 -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        SAFE_VIEWPORT_CENTER,
      )}
      data-support-face-select-other
      onKeyDown={selection.onKeyDown}
      ref={listboxRef}
      role="listbox"
      tabIndex={-1}
    >
      <div className="px-2 pb-1 text-xs font-semibold">{t("selectOtherSupport")}</div>
      <div className="grid gap-0.5">
        {selection.activeCandidates.map((candidate, index) => (
          <Button
            aria-label={t("selectOtherReferenceOption", {
              count: selection.activeCandidates.length,
              label: candidate.label,
              position: index + 1,
            })}
            aria-selected={selection.activeIndex === index}
            className="justify-start text-left"
            data-support-face-select-other-active={
              selection.activeIndex === index ? "true" : undefined
            }
            id={`support-face-select-other-${index}`}
            key={candidate.key}
            onClick={() => selection.choose(candidate)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="content"
            tabIndex={-1}
            type="button"
            variant={selection.activeIndex === index ? "secondary" : "ghost"}
          >
            <span className="w-10 shrink-0 font-mono text-muted-foreground">
              {t("selectOtherReferencePosition", {
                count: selection.activeCandidates.length,
                position: index + 1,
              })}
            </span>
            <span className="truncate">{candidate.label}</span>
          </Button>
        ))}
      </div>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("selectOtherSupportHint")}
      </div>
    </div>
  )
}

function SavedProfileKeyboardPicker({
  controller,
  selection,
}: Readonly<{
  controller: DocumentControllerState
  selection: GeometryViewportProps["sketchProfileSelection"]
}>) {
  const t = useTranslations("app.shell.viewport")
  if (!selection?.keyboardPickerActive) return null
  const sketchLabels = new Map<string, string>(
    (controller.report?.snapshot.sketches ?? []).map(({ id, label }) => [id, label]),
  )
  const rebuild = controller.report?.rebuild
  const sketches = rebuild?.ok ? (rebuild.response.sketches ?? []) : []
  const excludedIds = new Set(selection.excludedSketchIds)
  const options = sketches.flatMap((sketch) => {
    if (excludedIds.has(sketch.sketchId)) return []
    const label = sketchLabels.get(sketch.sketchId)
    const profiles = sketch.profiles ?? []
    if (!label) return []
    const selectors = profiles.map(({ selector }) => selector as SketchProfileSelector)
    return profiles.map((profile, index) => ({
      key: viewerSketchProfileKey(profile.selector),
      label: t("savedProfileLabel", { number: index + 1, sketch: label }),
      profile: profile.selector as SketchProfileSelector,
      selectors,
    }))
  })
  if (options.length === 0) return null
  return (
    <fieldset
      className={cn(
        "pointer-events-auto absolute left-3 top-3 z-10 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_LEFT,
      )}
    >
      <legend className="sr-only">{t("savedProfiles")}</legend>
      <NativeSelect
        aria-label={t("selectSavedProfile")}
        data-saved-profile-picker
        className="h-8 max-w-72 text-xs"
        onChange={(event) => {
          const option = options.find(({ key }) => key === event.currentTarget.value)
          if (option) selection.onSelect(option.profile, option.selectors, "toggle")
        }}
        value=""
      >
        <option value="">{t("chooseSavedProfile")}</option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </fieldset>
  )
}

function SavedProfileViewportChrome({
  controller,
  selection,
  profilePreselectionLabel,
  profileSelectOther,
}: Readonly<{
  profilePreselectionLabel: string | null
  profileSelectOther: SavedProfileSelectOtherState
  controller: DocumentControllerState
  selection: GeometryViewportProps["sketchProfileSelection"]
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      <SavedProfileKeyboardPicker controller={controller} selection={selection} />
      <SavedProfileSelectOtherOverlay selection={profileSelectOther} />
      {profilePreselectionLabel ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm",
            SAFE_VIEWPORT_CENTER,
          )}
          role="status"
        >
          {t("savedProfileCandidate", { label: profilePreselectionLabel })}
        </div>
      ) : null}
    </>
  )
}

function ModelViewportChrome({
  viewControls,
  featurePreview,
  message,
  meshes,
  onOriginPlaneVisibilityChange,
  originPlanePreselection,
  originPlaneSelection,
  originPlaneVisibility,
  profileChrome,
  selection,
  onBodyClear,
  onEdgeClear,
  supportFacePreselectionLabel,
  supportFaceSelectOther,
  sketches,
  viewportRef,
}: Readonly<{
  viewControls?: ReactNode
  featurePreview: FeaturePreviewState | undefined
  message: ReturnType<typeof translatedViewportMessage>
  meshes: readonly ViewerMesh[]
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  originPlanePreselection: ViewerOriginPlane | null
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  profileChrome: ReactNode
  onBodyClear?: (() => void) | undefined
  onEdgeClear?: (() => void) | undefined
  selection: ViewerSelection | ModelBodySelection | null
  supportFacePreselectionLabel: string | null
  supportFaceSelectOther: SupportFaceSelectOtherState
  sketches: readonly ViewerSketch[]
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      <ViewportMessage message={message} title={t("title")} />
      <PreviewStatus preview={featurePreview} />
      <ViewportControlsSlot
        viewControls={viewControls}
        meshes={meshes}
        sketches={sketches}
        originPlaneSelection={originPlaneSelection}
        originPlaneVisibility={originPlaneVisibility}
        onOriginPlaneVisibilityChange={onOriginPlaneVisibilityChange}
        selection={selection}
        onBodyClear={onBodyClear}
        onEdgeClear={onEdgeClear}
        viewportRef={viewportRef}
      />
      <OriginPlaneSelectionOverlay
        preselectedFaceLabel={supportFacePreselectionLabel}
        preselectedPlane={originPlanePreselection}
        selection={originPlaneSelection}
      />
      <SupportFaceSelectOtherOverlay selection={supportFaceSelectOther} />
      {profileChrome}
      <WorldAxesLegend />
    </>
  )
}

function SavedProfileSelectOtherOverlay({
  selection,
}: Readonly<{ selection: SavedProfileSelectOtherState }>) {
  const t = useTranslations("app.shell.viewport")
  const listboxRef = useActiveListboxFocus(selection.activeIndex)
  if (selection.activeIndex === null || selection.options.length < 2) return null
  return (
    <div
      aria-activedescendant={`saved-profile-select-other-${selection.activeIndex}`}
      aria-label={t("selectOtherProfile")}
      className={cn(
        "pointer-events-auto absolute bottom-12 z-20 w-80 -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        SAFE_VIEWPORT_CENTER,
      )}
      data-saved-profile-select-other
      onKeyDown={selection.onKeyDown}
      ref={listboxRef}
      role="listbox"
      tabIndex={-1}
    >
      <div className="px-2 pb-1 text-xs font-semibold">{t("selectOtherProfile")}</div>
      <div className="grid gap-0.5">
        {selection.options.map((option, index) => (
          <Button
            aria-label={t("selectOtherReferenceOption", {
              count: selection.options.length,
              label: option.label,
              position: index + 1,
            })}
            aria-selected={selection.activeIndex === index}
            className="justify-start text-left"
            id={`saved-profile-select-other-${index}`}
            key={option.key}
            onClick={() => selection.choose(option.profile)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="content"
            tabIndex={-1}
            type="button"
            variant={selection.activeIndex === index ? "secondary" : "ghost"}
          >
            <span className="w-10 shrink-0 font-mono text-muted-foreground">
              {t("selectOtherReferencePosition", {
                count: selection.options.length,
                position: index + 1,
              })}
            </span>
            <span className="truncate">{option.label}</span>
          </Button>
        ))}
      </div>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {t("selectOtherProfileHint")}
      </div>
    </div>
  )
}

type SketchReferencePurpose = "pierce" | "revolve-axis" | "edge-treatment" | "hole-point" | "use"

function referenceSelectionMessageKey(purpose: SketchReferencePurpose) {
  if (purpose === "hole-point") return "holePointSelection" as const
  if (purpose === "pierce") return "sketchPierceSelection" as const
  if (purpose === "revolve-axis") return "revolveAxisSelection" as const
  if (purpose === "edge-treatment") return "edgeTreatmentSelection" as const
  return "sketchReferenceSelection" as const
}

function referenceCandidateMessageKey(purpose: SketchReferencePurpose) {
  if (purpose === "hole-point") return "holePointCandidate" as const
  if (purpose === "pierce") return "sketchPierceCandidate" as const
  if (purpose === "revolve-axis") return "revolveAxisCandidate" as const
  if (purpose === "edge-treatment") return "edgeTreatmentCandidate" as const
  return "sketchReferenceCandidate" as const
}

function SketchReferenceSelectionStatus({
  purpose,
}: Readonly<{ purpose: SketchReferencePurpose }>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_LEFT,
      )}
      role="status"
    >
      {t(referenceSelectionMessageKey(purpose))}
    </div>
  )
}

function SketchReferencePreselectionStatus({
  preselection,
  purpose,
}: Readonly<{
  preselection: ViewerSketchReferenceCandidate
  purpose: SketchReferencePurpose
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_CENTER,
      )}
      role="status"
    >
      {t(referenceCandidateMessageKey(purpose), {
        label: preselection.label,
      })}
    </div>
  )
}

function SketchReferenceKeyboardPicker({
  selection,
}: Readonly<{
  selection: NonNullable<GeometryViewportSketchContext["referenceSelection"]>
}>) {
  const t = useTranslations("app.shell.viewport")
  const keys = {
    "hole-point": ["holePointKeyboardSelection", "holePointKeyboardPlaceholder"],
    use: ["sketchReferenceKeyboardSelection", "sketchReferenceKeyboardPlaceholder"],
    pierce: ["sketchPierceKeyboardSelection", "sketchPierceKeyboardPlaceholder"],
    "revolve-axis": ["revolveAxisKeyboardSelection", "revolveAxisKeyboardPlaceholder"],
    "edge-treatment": ["edgeTreatmentKeyboardSelection", "edgeTreatmentKeyboardPlaceholder"],
  } as const
  const [labelKey, placeholderKey] = keys[selection.purpose ?? "use"]
  if (selection.candidates.length === 0) return null
  return (
    <div
      className={cn(
        "sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-10 focus-within:grid focus-within:gap-1 focus-within:rounded-md focus-within:border focus-within:bg-background focus-within:p-2 focus-within:shadow-sm",
        SAFE_VIEWPORT_LEFT,
      )}
    >
      <span className="text-xs font-medium">{t(labelKey)}</span>
      <NativeSelect
        aria-label={t(labelKey)}
        className="h-8 max-w-72 text-xs"
        defaultValue=""
        onChange={(event) => {
          const candidate = selection.candidates[Number(event.currentTarget.value)]
          if (candidate) selection.onSelect(candidate)
          event.currentTarget.value = ""
        }}
      >
        <option value="">{t(placeholderKey)}</option>
        {selection.candidates.map((candidate, index) => (
          <option key={`${candidate.kind}:${candidate.label}:${index}`} value={index}>
            {candidate.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

function FaceIntersectionSelectionStatus({
  selection,
}: {
  selection: NonNullable<GeometryViewportSketchContext["faceIntersectionSelection"]>
}) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_LEFT,
      )}
      role="status"
    >
      {selection.status ??
        t(selection.sourceMesh ? "shellOpeningSelection" : "sketchIntersectionSelection")}
    </div>
  )
}

function SketchContextChrome({
  viewControls,
  context,
  preselection,
  selectOther,
  viewportRef,
}: Readonly<{
  viewControls?: ReactNode
  context: GeometryViewportSketchContext
  preselection: ViewerSketchReferenceCandidate | null
  selectOther: SketchReferenceSelectOtherState
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  if (context.mode !== "orbit")
    return (
      <ViewportControls
        cameraLocked
        viewControls={viewControls}
        clearLabel={t("clearSelection")}
        fitLabel={t("fit")}
        selection={null}
        viewportRef={viewportRef}
      />
    )
  const referenceSelection = context.referenceSelection
  const referencePurpose = referenceSelection?.purpose ?? "use"
  return (
    <>
      <WorldAxesLegend />
      <ViewportControls
        viewControls={viewControls}
        clearLabel={t("clearSelection")}
        fitLabel={t("fit")}
        selection={null}
        viewportRef={viewportRef}
      />
      <SketchReferenceSelectOtherOverlay selection={selectOther} />
      {referenceSelection ? <SketchReferenceSelectionStatus purpose={referencePurpose} /> : null}
      {context.faceIntersectionSelection ? (
        <FaceIntersectionSelectionStatus selection={context.faceIntersectionSelection} />
      ) : null}
      {preselection ? (
        <SketchReferencePreselectionStatus preselection={preselection} purpose={referencePurpose} />
      ) : null}
      {referenceSelection ? <SketchReferenceKeyboardPicker selection={referenceSelection} /> : null}
    </>
  )
}

function viewerSketchProfileLabel(
  controller: DocumentControllerState,
  sketches: readonly ViewerSketch[],
  profile: ViewerSketchProfile | null,
  format: (sketch: string, number: number) => string,
) {
  if (!profile) return null
  const sketch = sketches.find(({ sketchId }) => sketchId === profile.selector.sketchId)
  const index = sketch?.profiles?.findIndex(
    ({ selector }) => viewerSketchProfileKey(selector) === viewerSketchProfileKey(profile.selector),
  )
  const label = controller.report?.snapshot.sketches.find(
    ({ id }) => id === profile.selector.sketchId,
  )?.label
  return label && index !== undefined && index >= 0 ? format(label, index + 1) : null
}

function GeometryViewportContextChrome({
  viewControls,
  model,
  profileSelectOther,
  props,
  selectOther,
  supportFaceSelectOther,
}: Readonly<{
  viewControls?: ReactNode
  model: ReturnType<typeof useGeometryViewportModel>
  profileSelectOther: SavedProfileSelectOtherState
  props: GeometryViewportProps
  selectOther: SketchReferenceSelectOtherState
  supportFaceSelectOther: SupportFaceSelectOtherState
}>) {
  const { originPlaneSelection, sketchContext } = props
  if (sketchContext && !originPlaneSelection) {
    return (
      <SketchContextChrome
        viewControls={viewControls}
        context={sketchContext}
        preselection={model.sketchPointPreselection}
        selectOther={selectOther}
        viewportRef={model.viewportRef}
      />
    )
  }
  return (
    <ModelViewportContextChrome
      viewControls={viewControls}
      model={model}
      profileSelectOther={profileSelectOther}
      props={props}
      supportFaceSelectOther={supportFaceSelectOther}
    />
  )
}

function ModelViewportContextChrome({
  viewControls,
  model,
  profileSelectOther,
  props,
  supportFaceSelectOther,
}: Readonly<{
  viewControls?: ReactNode
  model: ReturnType<typeof useGeometryViewportModel>
  profileSelectOther: SavedProfileSelectOtherState
  props: GeometryViewportProps
  supportFaceSelectOther: SupportFaceSelectOtherState
}>) {
  const t = useTranslations("app.shell.viewport")
  const { featurePreview, originPlaneSelection, selection } = props
  return (
    <ModelViewportChrome
      viewControls={viewControls}
      featurePreview={featurePreview}
      message={model.message}
      meshes={model.meshes}
      onOriginPlaneVisibilityChange={model.onOriginPlaneVisibilityChange}
      originPlanePreselection={model.originPlanePreselection}
      originPlaneSelection={originPlaneSelection}
      originPlaneVisibility={model.originPlaneVisibility}
      profileChrome={
        <SavedProfileViewportChrome
          controller={props.controller}
          selection={props.sketchProfileSelection}
          profilePreselectionLabel={viewerSketchProfileLabel(
            props.controller,
            model.sketches,
            model.sketchProfilePreselection,
            (sketch, number) => t("savedProfileLabel", { number, sketch }),
          )}
          profileSelectOther={profileSelectOther}
        />
      }
      selection={props.selectedBody ?? selection}
      onBodyClear={props.selectedBody ? () => props.onBodySelectionChange?.(null) : undefined}
      onEdgeClear={model.modelEdges.hasSelection ? model.modelEdges.clearSelection : undefined}
      sketches={model.sketches}
      supportFacePreselectionLabel={
        supportFaceSelectOther.activeCandidate?.label ??
        model.supportFaceCandidates[0]?.label ??
        null
      }
      supportFaceSelectOther={supportFaceSelectOther}
      viewportRef={model.viewportRef}
    />
  )
}

function viewportOriginPlaneData(
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"],
  idleOriginPlaneSelection: GeometryViewportProps["idleOriginPlaneSelection"],
  model: ReturnType<typeof useGeometryViewportModel>,
) {
  return {
    "data-origin-plane-preselection": model.originPlanePreselection ?? undefined,
    "data-origin-plane-selection": selectedOriginPlane(
      originPlaneSelection,
      idleOriginPlaneSelection,
    ),
    "data-origin-plane-visibility": viewerOriginPlanes
      .filter((plane) => model.originPlaneVisibility[plane])
      .join(","),
  }
}

function viewportHighlightData(model: ReturnType<typeof useGeometryViewportModel>) {
  return {
    "data-preselected-feature": model.preselectedFeatureId ?? undefined,
    "data-selected-feature": model.selectedFeatureId ?? undefined,
    "data-selected-body-role": model.selectedBodyRole ?? undefined,
    "data-preselected-body-role": model.preselectedBodyRole ?? undefined,
  }
}

function viewportRenderData(
  passive: boolean,
  featurePreview: FeaturePreviewState | undefined,
  model: ReturnType<typeof useGeometryViewportModel>,
  sketchProfilePreview: SketchProfileSelector | null | undefined,
) {
  const resolvedPreview = selectedViewerSketchProfile(model.sketches, sketchProfilePreview ?? null)
  return {
    ...viewportHighlightData(model),
    "data-passive": passive ? "true" : undefined,
    "data-preview-feature-count": model.meshes.filter(({ appearance }) => appearance === "preview")
      .length,
    "data-preview-status": featurePreview?.status ?? "idle",
    "data-rendered-feature-count": model.meshes.length,
    "data-rendered-sketch-count": model.sketches.length,
    "data-rendered-sketch-profile-count": model.sketches.reduce(
      (total, sketch) => total + (sketch.profiles?.length ?? 0),
      0,
    ),
    "data-sketch-profile-candidate-count": model.sketchProfileCandidateStack.length,
    "data-preselected-sketch-profile": model.sketchProfilePreselection
      ? viewerSketchProfileKey(model.sketchProfilePreselection.selector)
      : undefined,
    "data-source-profile-preview": resolvedPreview
      ? viewerSketchProfileKey(resolvedPreview.selector)
      : undefined,
    "data-selected-sketch-profile-count": model.selectedSketchProfileCount,
    "data-selected-sketch-profile": model.selectedSketchProfileKey ?? undefined,
  }
}

function viewportSketchContextData(sketchContext: GeometryViewportSketchContext | undefined) {
  return {
    "data-sketch-context-mode": sketchContext?.mode,
    "data-sketch-reference-candidate-count":
      sketchContext?.referenceSelection?.candidates.length ?? 0,
  }
}

function viewportRegionClassNames(
  passive: boolean,
  interaction: ReturnType<typeof viewportRegionInteraction>,
  hasViewControls: boolean,
) {
  return {
    hidden: passive && !hasViewControls ? true : undefined,
    canvas: cn("absolute inset-0 size-full touch-none", passive && "pointer-events-none"),
    region: cn(
      "relative min-h-0 min-w-0 overflow-hidden bg-viewport-background",
      interaction.className,
      passive && "pointer-events-none",
    ),
  }
}

function useAxialGizmoSide(gizmo: GeometryViewportProps["axialGizmo"]) {
  const [selection, setSelection] = useState<{
    featureId: string | undefined
    side: "first" | "second"
  }>({ featureId: undefined, side: "first" })
  const side =
    selection.featureId === gizmo?.featureId && gizmo?.opposite ? selection.side : "first"
  const activeGizmo = useMemo(() => {
    if (!gizmo?.opposite || side === "first") return gizmo
    return {
      ...gizmo,
      direction: [-gizmo.direction[0], -gizmo.direction[1], -gizmo.direction[2]] as const,
      distance: gizmo.opposite.distance,
      onDistanceChange: gizmo.opposite.onDistanceChange,
    }
  }, [gizmo, side])
  return {
    gizmo: activeGizmo,
    side,
    select: (side: "first" | "second") => setSelection({ featureId: gizmo?.featureId, side }),
  }
}

function AxialGizmoSideControls({
  onSelect,
  side,
}: Readonly<{
  onSelect: (side: "first" | "second") => void
  side: "first" | "second"
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <fieldset
      className={cn(
        "absolute right-3 top-14 z-10 grid min-w-0 grid-cols-2 gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm",
        SAFE_VIEWPORT_RIGHT,
      )}
    >
      <legend className="sr-only">{t("extrusionDepthSelection")}</legend>
      {(["first", "second"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          size="content"
          className="min-w-0"
          variant={side === value ? "secondary" : "ghost"}
          aria-pressed={side === value}
          onClick={() => onSelect(value)}
        >
          {t(value === "first" ? "extrusionFirstDepth" : "extrusionSecondDepth")}
        </Button>
      ))}
    </fieldset>
  )
}

function sectionDuringModeling(section: ViewerSection | null, props: GeometryViewportProps) {
  return props.sketchContext?.mode === "normal" ? null : section
}

function viewportGizmoData(
  props: GeometryViewportProps,
  axial: ReturnType<typeof useAxialGizmoSide>,
) {
  return {
    "data-angular-gizmo-angle": props.angularGizmo?.angle,
    "data-angular-gizmo-feature": props.angularGizmo?.featureId,
    "data-axial-gizmo-distance": axial.gizmo?.distance,
    "data-axial-gizmo-feature": props.axialGizmo?.featureId,
    "data-axial-gizmo-side": props.axialGizmo ? axial.side : undefined,
    "data-translation-gizmo-feature": props.translationGizmo?.featureId,
    "data-translation-gizmo-position": props.translationGizmo?.position.join(","),
    "data-tool-plane-origin": props.toolPlane?.origin.join(","),
    "data-tool-plane-normal": props.toolPlane?.normal.join(","),
  }
}

function viewportAdditionalControls(
  controls: ReactNode,
  sectionProps: ComponentProps<typeof SectionViewControls>,
) {
  if (!controls && (sectionProps.disabled || sectionProps.meshes.length === 0)) return null
  return (
    <>
      {controls}
      <ViewportSelectionProperties />
      <SectionViewControls {...sectionProps} />
    </>
  )
}

function TaskGeometryViewport(props: GeometryViewportProps) {
  const task = useWorkspaceTask()
  const checkpoint = props.controller.assistantCheckpointPresentation
  const displayController = useMemo(
    () => assistantCheckpointDisplayController(props.controller),
    [checkpoint, props.controller.report],
  )
  const hiddenSketchIds = useMemo(
    () => effectiveHiddenSketchIds(displayController?.report ?? null, {}, true, null),
    [displayController],
  )
  const interaction = task?.interaction
  const selectFace = useCallback(
    (selection: ViewerSelection | null) => {
      if (interaction?.picking && interaction.onFacePick(selection)) return
      props.onSelectionChange(selection)
    },
    [interaction, props.onSelectionChange],
  )
  if (displayController) {
    return (
      <GeometryViewport
        controller={displayController}
        readOnlyPresentation
        createViewport={props.createViewport ?? loadGeometryViewport}
        viewControls={props.viewControls}
        printerProfile={props.printerProfile ?? null}
        printBedVisible={props.printBedVisible ?? false}
        groundGridVisible={props.groundGridVisible ?? true}
        hiddenSketchIds={hiddenSketchIds}
        sketchContext={CHECKPOINT_NAVIGATION_CONTEXT}
        selection={null}
        onSelectionChange={ignoreViewportSelection}
      />
    )
  }
  return <GeometryViewport {...props} onSelectionChange={selectFace} />
}

const CHECKPOINT_NAVIGATION_CONTEXT = { frame: null, mode: "orbit" } as const
const ignoreViewportSelection = () => undefined

function useAnalysisOverlays(
  viewportRef: RefObject<GeometryViewportPort | null>,
  overlays: readonly import("@vibeshape/viewer/three-viewport").ViewerAnalysisOverlay[] | undefined,
  rendererFailed: boolean,
) {
  useEffect(() => {
    if (rendererFailed) return
    viewportRef.current?.setAnalysisOverlays(overlays ?? null)
    return () => viewportRef.current?.setAnalysisOverlays(null)
  }, [overlays, viewportRef, rendererFailed])
}

function useTaskAnalysisOverlays(
  viewportRef: RefObject<GeometryViewportPort | null>,
  rendererFailed: boolean,
  enabled: boolean,
) {
  const task = useWorkspaceTask()
  useAnalysisOverlays(
    viewportRef,
    enabled ? task?.interaction?.overlays : undefined,
    rendererFailed,
  )
  useTaskPreviewReadiness(viewportRef, rendererFailed, enabled)
}

function useTaskPreviewReadiness(
  viewportRef: RefObject<GeometryViewportPort | null>,
  rendererFailed: boolean,
  enabled: boolean,
) {
  const task = useWorkspaceTask()
  const preview = !enabled || task?.interaction?.picking ? null : task?.preview
  useEffect(() => {
    if (!preview?.onReady) return
    const onReady = preview.onReady
    onReady(false)
    let frame: number | undefined
    const check = () => {
      if (rendererFailed) return
      if (viewportRef.current) onReady(true)
      else frame = requestAnimationFrame(check)
    }
    check()
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      onReady(false)
    }
  }, [preview, viewportRef, rendererFailed])
}

function useGeometryViewportHost(props: GeometryViewportProps) {
  const { onSelectionChange, originPlaneSelection, sketchContext } = props
  const passive = sketchContext?.mode === "normal" && !originPlaneSelection
  const sketchReferenceRegionRef = useRef<HTMLElement>(null)
  const axial = useAxialGizmoSide(props.axialGizmo)
  const [section, setSection] = useState<ViewerSection | null>(null)
  const activeSection = sectionDuringModeling(section, props)
  const viewportProps = {
    ...props,
    section: activeSection,
    onSectionChange: setSection,
    ...(axial.gizmo ? { axialGizmo: axial.gizmo } : {}),
  }
  const model = useGeometryViewportModel(viewportProps)
  const { sketchReferenceCandidateStack, sketchPointPreselection, viewportRef } = model
  useTaskAnalysisOverlays(viewportRef, model.rendererFailed, !props.readOnlyPresentation)
  const selectOther = useSketchReferenceSelectOther({
    candidateStack: sketchReferenceCandidateStack,
    context: sketchContext,
    focusRef: sketchReferenceRegionRef,
    preselection: sketchPointPreselection,
    viewportRef,
  })
  const supportFaceSelectOther = useSupportFaceSelectOther({
    candidateStack: model.supportFaceCandidates,
    focusRef: sketchReferenceRegionRef,
    onSelectionChange,
    request: model.supportFaceSelectionRequest,
    selectionActive: originPlaneSelection !== undefined,
    viewportRef,
  })
  const profileSelectOther = useSavedProfileSelectOther({
    candidates: model.sketchProfileSelectionRequest,
    controller: props.controller,
    dismiss: model.dismissSketchProfileSelectionRequest,
    focusRef: sketchReferenceRegionRef,
    selection: props.sketchProfileSelection,
    sketches: model.sketches,
    viewportRef,
  })
  const referenceInteraction = viewportRegionInteraction(
    originPlaneSelection,
    sketchContext,
    supportFaceSelectOther,
    selectOther,
  )
  const modelEdgeSelectOther = useModelEdgeSelectOther(model.modelEdges, sketchReferenceRegionRef)
  const regionInteraction: ReturnType<typeof viewportRegionInteraction> = model.rendererPending
    ? {}
    : model.modelEdges.active
      ? modelEdgeSelectOther.regionInteraction
      : referenceInteraction
  const regionClassNames = viewportRegionClassNames(
    passive,
    regionInteraction,
    Boolean(props.viewControls),
  )
  return {
    passive,
    axial,
    section,
    setSection,
    activeSection,
    viewportProps,
    model,
    sketchReferenceRegionRef,
    selectOther,
    supportFaceSelectOther,
    profileSelectOther,
    modelEdgeSelectOther,
    referenceInteraction: regionInteraction,
    regionClassNames,
  }
}

function GeometryViewport(props: GeometryViewportProps) {
  const { featurePreview, idleOriginPlaneSelection, originPlaneSelection, sketchContext } = props
  const t = useTranslations("app.shell.viewport")
  const {
    passive,
    axial,
    section,
    setSection,
    activeSection,
    viewportProps,
    model,
    sketchReferenceRegionRef,
    selectOther,
    supportFaceSelectOther,
    profileSelectOther,
    modelEdgeSelectOther,
    referenceInteraction,
    regionClassNames,
  } = useGeometryViewportHost(props)
  const { canvasRef, viewportRef } = model
  const capturePort = useViewportCapture()
  useEffect(
    () =>
      capturePort?.register(async () => {
        const region = sketchReferenceRegionRef.current
        if (
          !region ||
          region.getAttribute("aria-hidden") === "true" ||
          region.getClientRects().length === 0
        )
          return null
        return (await viewportRef.current?.captureImage?.()) ?? null
      }),
    [capturePort, sketchReferenceRegionRef, viewportRef],
  )
  return (
    <section
      ref={sketchReferenceRegionRef}
      aria-label={t("ariaLabel")}
      aria-busy={model.rendererPending || props.controller.status === "loading"}
      aria-hidden={regionClassNames.hidden}
      className={regionClassNames.region}
      {...viewportOriginPlaneData(originPlaneSelection, idleOriginPlaneSelection, model)}
      {...viewportRenderData(passive, featurePreview, model, props.sketchProfilePreview)}
      {...viewportSketchContextData(sketchContext)}
      data-section-axis={activeSection?.axis}
      data-section-offset={activeSection?.offset}
      data-assistant-checkpoint-revision={
        props.readOnlyPresentation ? props.controller.report?.snapshot.revision : undefined
      }
      {...viewportGizmoData(props, axial)}
      onKeyDown={referenceInteraction.onKeyDown}
      onPointerDown={referenceInteraction.onPointerDown}
      onPointerEnter={referenceInteraction.onPointerEnter}
      onPointerLeave={referenceInteraction.onPointerLeave}
      tabIndex={referenceInteraction.tabIndex ?? -1}
    >
      <div
        className="contents bg-inherit"
        inert={model.rendererPending}
        aria-hidden={model.rendererPending}
      >
        <ViewportContextTrigger
          viewportRef={viewportRef}
          selection={props.selection}
          onSelect={props.onSelectionChange}
        >
          <canvas
            tabIndex={props.readOnlyPresentation ? undefined : 0}
            aria-label={t("ariaLabel")}
            aria-hidden={passive ? true : undefined}
            ref={canvasRef}
            className={cn("peer", regionClassNames.canvas)}
          />
        </ViewportContextTrigger>
        <PrintViewportStatus
          profile={props.printerProfile}
          visible={props.printBedVisible}
          report={model.printReport}
          count={model.meshes.length}
        />
        {!props.readOnlyPresentation && <SurfaceTextureViewportTools viewportRef={viewportRef} />}
        <div
          aria-hidden="true"
          data-viewport-orientation-offset
          className="pointer-events-none absolute left-0 top-0 box-content h-[var(--workspace-chrome-bottom,0px)] w-[var(--workspace-chrome-left,0px)] pt-[var(--workspace-chrome-top,0px)]"
        />
        <GeometryViewportContextChrome
          viewControls={viewportAdditionalControls(props.viewControls, {
            disabled: passive || activeSection !== section,
            section,
            onChange: setSection,
            meshes: model.meshes,
          })}
          model={model}
          profileSelectOther={profileSelectOther}
          props={viewportProps}
          selectOther={selectOther}
          supportFaceSelectOther={supportFaceSelectOther}
        />
        <ViewportAxialControls props={props} axial={axial} />
        <ModelEdgeViewportChrome edges={model.modelEdges} selectOther={modelEdgeSelectOther} />
      </div>
      {model.rendererPending && <ViewportLoadingSkeleton />}
      {(model.rendererPending || props.controller.status === "loading") && (
        <ProjectLoadingProgress
          phase={props.controller.status === "loading" ? "refining" : "viewport"}
        />
      )}
    </section>
  )
}

function ViewportAxialControls({
  props,
  axial,
}: {
  props: GeometryViewportProps
  axial: ReturnType<typeof useAxialGizmoSide>
}) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      {props.axialGizmo ? (
        <p
          role="status"
          className={cn(
            "pointer-events-none absolute left-3 top-24 hidden w-72 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm peer-data-[axial-gizmo-drag-available=false]:block",
            SAFE_VIEWPORT_LEFT,
          )}
        >
          {t("extrusionDepthViewHint")}
        </p>
      ) : null}
      {props.axialGizmo?.opposite ? (
        <AxialGizmoSideControls onSelect={axial.select} side={axial.side} />
      ) : null}{" "}
    </>
  )
}

export { TaskGeometryViewport as GeometryViewport }
