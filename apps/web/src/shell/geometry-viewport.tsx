import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import { readDatumPlaneFeatureParameters, type SketchProfileSelector } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
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
  ViewerAxialGizmo,
  ViewerFrame,
  ViewerMesh,
  ViewerSelection,
  ViewerSketch,
  ViewerSketchProfile,
  ViewerSketchProfileSelectionIntent,
  ViewerSketchReferenceCandidate,
  ViewerStandardView,
} from "@vibeshape/viewer/three-viewport"
import { viewerSketchProfileKey } from "@vibeshape/viewer/three-viewport"
import {
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
import { useDocumentDisplayUnits } from "../document/document-display-units"
import type { PrimitivePlacement } from "../features/part-design/primitive-placement"
import { terminalFeatureIds } from "../features/part-design/terminal-features"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import { resolvePlanarFaceSupportLabel } from "../features/sketch/external-model-geometry"
import type { SketchProjectionStoreApi } from "../features/sketch/sketch-projection-store"
import { selectedSketchSupportFromController } from "../features/sketch/sketch-support"

const EMPTY_IDS = [] as const

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
}

export type GeometryViewportSketchContext = Readonly<{
  frame: ViewerFrame | null
  mode: "normal" | "orbit"
  projectionStore?: SketchProjectionStoreApi
  referenceSelection?: Readonly<{
    candidates: readonly ViewerSketchReferenceCandidate[]
    onSelect: (candidate: ViewerSketchReferenceCandidate) => void
    purpose?: "pierce" | "revolve-axis" | "use"
  }>
  faceIntersectionSelection?: Readonly<{
    onSelect: (selection: ViewerSelection) => void
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
): readonly ViewerMesh[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const contextHiddenIds = new Set(contextualHiddenFeatureIds)
  const visibleContextFeatures = (controller.report?.snapshot.features ?? []).filter(
    ({ id }) => !contextHiddenIds.has(id),
  )
  const terminalIds = terminalFeatureIds(visibleContextFeatures)
  const datumIds = new Set<string>(
    visibleContextFeatures
      .filter((feature) => readDatumPlaneFeatureParameters(feature) !== null)
      .map(({ id }) => id),
  )
  const hiddenIds = new Set([...hiddenFeatureIds, ...contextualHiddenFeatureIds])
  return rebuild.response.geometry
    .filter(
      ({ featureId }) =>
        (terminalIds.has(featureId) || datumIds.has(featureId)) && !hiddenIds.has(featureId),
    )
    .map(({ featureId, geometry }) => ({
      featureId,
      ...geometry.mesh,
      ...(datumIds.has(featureId) ? { appearance: "datum" as const } : {}),
    }))
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
    .map(viewerSketchDisplay)
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

export function viewerSketchDisplay(sketch: SketchDisplayRecord): ViewerSketch {
  return {
    ...sketch,
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
    return { kind: "status" as const, text: copy.loading }
  }
  if (controller.status === "error") return { kind: "error" as const, text: copy.loadFailed }
  if (controller.report && !controller.report.rebuild.ok) {
    return { kind: "error" as const, text: copy.rebuildFailed }
  }
  return null
}

async function initializeViewport(
  canvas: HTMLCanvasElement,
  createViewport: ViewportFactory,
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
  latestFeaturePreselectionRef: RefObject<ViewerMesh | null>,
  latestFeatureSelectionRef: RefObject<ViewerMesh | null>,
  latestSketchContextRef: RefObject<GeometryViewportSketchContext | null>,
  latestSketchProfileSelectionRef: RefObject<GeometryViewportProps["sketchProfileSelection"]>,
  latestAxialGizmoRef: RefObject<GeometryViewportProps["axialGizmo"]>,
  latestTranslationGizmoRef: RefObject<GeometryViewportProps["translationGizmo"]>,
  setRendererFailed: Dispatch<SetStateAction<boolean>>,
) {
  try {
    const viewport = await createViewport(canvas, {
      isSelectionCandidateEligible: (selection) =>
        selectedSketchSupportFromController(latestControllerRef.current, selection) !== null,
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
      onTranslationGizmoPositionChange: (position) =>
        latestTranslationGizmoRef.current?.onPositionChange(position),
      onAxialGizmoDistanceChange: (distance) =>
        latestAxialGizmoRef.current?.onDistanceChange(distance),
    })
    if (mount.cancelled) {
      viewport.dispose()
      return
    }
    mount.viewport = viewport
    viewportRef.current = viewport
    viewport.setMeshes(latestMeshesRef.current)
    viewport.setSketches(latestSketchesRef.current)
    viewport.setSketchProfileSelections(
      selectedViewerSketchProfiles(
        latestSketchesRef.current,
        latestSketchProfileSelectionRef.current?.selectedProfiles ?? [],
      ),
    )
    viewport.setOriginPlaneVisibility(latestOriginPlaneVisibilityRef.current)
    viewport.setOriginPlaneSelection(
      latestOriginPlaneRef.current,
      latestOriginPlaneSelectionActiveRef.current,
      latestOriginPlaneIdleSelectionEnabledRef.current,
    )
    viewport.setFeatureSelection(latestFeatureSelectionRef.current)
    viewport.setFeaturePreselection(latestFeaturePreselectionRef.current)
    const axialGizmo = latestAxialGizmoRef.current
    const translationGizmo = latestTranslationGizmoRef.current
    if (axialGizmo) viewport.showAxialTranslationGizmo(axialGizmo)
    else if (translationGizmo) viewport.showTranslationGizmo(translationGizmo.position)
    viewport.fit()
    synchronizeViewportSketchContext(viewport, latestSketchContextRef.current)
    setRendererFailed(false)
  } catch {
    if (!mount.cancelled) setRendererFailed(true)
  }
}

function synchronizeViewportSketchContext(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  const referenceSelection = orbitReferenceSelection(context)
  viewport.setSketchReferenceCandidates(referenceSelection?.candidates ?? [])
  viewport.setInteractionMode(
    viewportInteractionMode(
      context,
      referenceSelection !== undefined,
      orbitFaceIntersectionSelection(context) !== undefined,
    ),
  )
  synchronizeViewportSketchProjection(viewport, context)
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

function orbitReferenceSelection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "orbit") return undefined
  return context.referenceSelection
}

function orbitFaceIntersectionSelection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "orbit") return undefined
  return context.faceIntersectionSelection
}

function viewportInteractionMode(
  context: GeometryViewportSketchContext | null,
  referenceSelectionActive: boolean,
  faceIntersectionSelectionActive: boolean,
) {
  if (referenceSelectionActive) return "sketch-reference-select"
  if (faceIntersectionSelectionActive) return "select"
  return context ? "camera-only" : "select"
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
  axialGizmo,
  translationGizmo,
}: Readonly<{
  controller: DocumentControllerState
  featurePreselection: ViewerMesh | null
  featureSelection: ViewerMesh | null
  meshes: readonly ViewerMesh[]
  originPlaneSelection: ViewerOriginPlane | null
  originPlaneSelectionActive: boolean
  originPlaneIdleSelectionEnabled: boolean
  originPlaneVisibility: ViewerOriginPlaneVisibility
  sketchContext: GeometryViewportSketchContext | null
  sketches: readonly ViewerSketch[]
  sketchProfileSelection: GeometryViewportProps["sketchProfileSelection"]
  axialGizmo: GeometryViewportProps["axialGizmo"]
  translationGizmo: GeometryViewportProps["translationGizmo"]
}>) {
  const controllerRef = useRef(controller)
  const featurePreselectionRef = useRef(featurePreselection)
  const featureSelectionRef = useRef(featureSelection)
  const meshesRef = useRef(meshes)
  const originPlaneRef = useRef(originPlaneSelection)
  const originPlaneSelectionActiveRef = useRef(originPlaneSelectionActive)
  const originPlaneIdleSelectionEnabledRef = useRef(originPlaneIdleSelectionEnabled)
  const originPlaneVisibilityRef = useRef(originPlaneVisibility)
  const sketchContextRef = useRef(sketchContext)
  const sketchesRef = useRef(sketches)
  const sketchProfileSelectionRef = useRef(sketchProfileSelection)
  const axialGizmoRef = useRef(axialGizmo)
  const translationGizmoRef = useRef(translationGizmo)
  controllerRef.current = controller
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
  axialGizmoRef.current = axialGizmo
  translationGizmoRef.current = translationGizmo
  return {
    controllerRef,
    featurePreselectionRef,
    featureSelectionRef,
    meshesRef,
    originPlaneRef,
    originPlaneSelectionActiveRef,
    originPlaneIdleSelectionEnabledRef,
    originPlaneVisibilityRef,
    sketchContextRef,
    sketchesRef,
    sketchProfileSelectionRef,
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
  axialGizmo: GeometryViewportProps["axialGizmo"],
  translationGizmo: GeometryViewportProps["translationGizmo"],
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (axialGizmo) {
      viewport.showAxialTranslationGizmo(axialGizmo)
      return
    }
    if (translationGizmo) {
      viewport.showTranslationGizmo(translationGizmo.position)
      return
    }
    viewport.hideTranslationGizmo()
  }, [axialGizmo, translationGizmo, viewportRef])
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
  featurePreselection: ViewerMesh | null,
  featureSelection: ViewerMesh | null,
  sketchContext: GeometryViewportSketchContext | null,
  sketchProfileSelection: GeometryViewportProps["sketchProfileSelection"],
  axialGizmo: GeometryViewportProps["axialGizmo"],
  translationGizmo: GeometryViewportProps["translationGizmo"],
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
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
    axialGizmo,
    translationGizmo,
  })
  const [rendererFailed, setRendererFailed] = useState(false)
  const sketchReferenceInteraction = useViewportSketchReferenceInteractionState()
  const profileInteraction = useViewportProfileInteractionState()
  const selectionCandidates = useSelectionCandidateEvents(originPlaneSelectionActive)
  const shouldInitialize = true

  useEffect(() => {
    const canvas = canvasRef.current
    if (!shouldInitialize || !canvas) return
    const mount: ViewportMount = { cancelled: false, viewport: null }
    void initializeViewport(
      canvas,
      createViewport,
      onOriginPlanePreselectionChange,
      (plane) => {
        profileInteraction.dismissSelectionRequest()
        onOriginPlaneSelectionChange(plane)
      },
      (selection) => {
        profileInteraction.dismissSelectionRequest()
        const faceSelection = orbitFaceIntersectionSelection(latest.sketchContextRef.current)
        if (selection && faceSelection) {
          faceSelection.onSelect(selection)
          return
        }
        onSelectionChange(selection)
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
        const selection = latest.sketchProfileSelectionRef.current
        if (!selection) return
        if (!profile) {
          selection.onSelect(null, [], "replace")
          return
        }
        const source = latest.sketchesRef.current.find(
          ({ sketchId }) => sketchId === profile.selector.sketchId,
        )
        selection.onSelect(
          profile.selector as SketchProfileSelector,
          source?.profiles?.map(({ selector }) => selector as SketchProfileSelector) ?? [],
          intent,
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
      latest.axialGizmoRef,
      latest.translationGizmoRef,
      setRendererFailed,
    )
    return () => {
      mount.cancelled = true
      if (viewportRef.current === mount.viewport) viewportRef.current = null
      mount.viewport?.dispose()
    }
  }, [
    createViewport,
    onOriginPlanePreselectionChange,
    onOriginPlaneSelectionChange,
    onSelectionChange,
    profileInteraction.dismissSelectionRequest,
    selectionCandidates.onChange,
    selectionCandidates.onCommit,
    shouldInitialize,
  ])

  useEffect(() => {
    viewportRef.current?.setMeshes(meshes)
  }, [meshes])

  useEffect(() => {
    profileInteraction.dismissSelectionRequest()
    viewportRef.current?.setSketches(sketches)
  }, [profileInteraction.dismissSelectionRequest, sketches])

  useEffect(() => {
    viewportRef.current?.setSketchProfileSelections(
      selectedViewerSketchProfiles(sketches, sketchProfileSelection?.selectedProfiles ?? []),
    )
  }, [sketchProfileSelection?.selectedProfiles, sketches])

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
    rendererFailed,
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

function useProjectThumbnail(controller: DocumentControllerState, meshes: readonly ViewerMesh[]) {
  const completedRevisionRef = useRef<string | null>(null)
  const inFlightRevisionRef = useRef<string | null>(null)
  const retryCountRef = useRef(new Map<string, number>())
  const [retryAttempt, requestRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const snapshot = controller.report?.snapshot
    if (controller.status !== "ready" || !snapshot || meshes.length === 0) return
    const revisionKey = `${snapshot.id}:${snapshot.revision}`
    if (
      completedRevisionRef.current === revisionKey ||
      inFlightRevisionRef.current === revisionKey
    ) {
      return
    }

    const retry = () => {
      const retryCount = retryCountRef.current.get(revisionKey) ?? 0
      if (cancelled || retryCount >= 1) return
      retryCountRef.current.set(revisionKey, retryCount + 1)
      window.setTimeout(() => {
        if (!cancelled) requestRetry((attempt) => attempt + 1)
      }, 250)
    }

    let thumbnail: ReturnType<typeof renderProjectThumbnail>
    try {
      thumbnail = renderProjectThumbnail(meshes)
    } catch {
      // A derived preview must never block the authoritative geometry viewport.
      return
    }

    if (!thumbnail) {
      completedRevisionRef.current = revisionKey
      return
    }

    inFlightRevisionRef.current = revisionKey
    void saveActiveProjectThumbnail(snapshot.id, snapshot.revision, thumbnail)
      .then((result) => {
        if (result.ok) {
          completedRevisionRef.current = revisionKey
          retryCountRef.current.delete(revisionKey)
          return
        }
        retry()
      })
      .catch(retry)
      .finally(() => {
        if (inFlightRevisionRef.current === revisionKey) inFlightRevisionRef.current = null
      })

    return () => {
      cancelled = true
    }
  }, [controller.report?.snapshot, controller.status, meshes, retryAttempt])
}

function ViewportMessage({
  message,
  title,
}: {
  message: ReturnType<typeof viewportMessage>
  title: string
}) {
  if (!message) return null
  const className =
    message.kind === "error"
      ? "mt-2 text-sm text-destructive"
      : "mt-2 text-sm text-muted-foreground"
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
      <div className="max-w-sm rounded-md bg-background/85 p-3 shadow-sm backdrop-blur-sm">
        <p className="text-sm font-medium">{title}</p>
        <p className={className} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      </div>
    </div>
  )
}

function ViewportControls({
  clearLabel,
  fitLabel,
  selection,
  viewportRef,
}: {
  clearLabel: string
  fitLabel: string
  selection: ViewerSelection | null
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
    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
      {selection ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={clearLabel}
              onClick={() => viewportRef.current?.clearSelection()}
              size="icon-xs"
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
              <Button aria-label={t("standardViews")} size="icon-xs" type="button" variant="ghost">
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
            onClick={() => viewportRef.current?.fit()}
            size="icon-xs"
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
    <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur-sm">
      <p className="text-xs font-medium">{instruction}</p>
      <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
        {status}
      </p>
    </div>
  )
}

type ActivePreviewStatus = Exclude<FeaturePreviewState["status"], "idle">
type PreviewMessageKey =
  | "datumPreviewFailed"
  | "datumPreviewLoading"
  | "datumPreviewReady"
  | "previewFailed"
  | "previewLoading"
  | "previewReady"

const PREVIEW_MESSAGE_KEYS: Readonly<
  Record<
    "datum-plane" | "extrusion" | "primitive" | "revolve",
    Record<ActivePreviewStatus, PreviewMessageKey>
  >
> = {
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
  primitive: {
    error: "previewFailed",
    loading: "previewLoading",
    ready: "previewReady",
  },
  revolve: {
    error: "previewFailed",
    loading: "previewLoading",
    ready: "previewReady",
  },
}

function previewMessageKey(preview: FeaturePreviewState | undefined) {
  if (!preview || preview.status === "idle") return null
  return PREVIEW_MESSAGE_KEYS[preview.kind ?? "extrusion"][preview.status]
}

function PreviewStatus({ preview }: { preview: FeaturePreviewState | undefined }) {
  const t = useTranslations("app.shell.viewport")
  const messageKey = previewMessageKey(preview)
  if (!messageKey) return null
  const failed = preview?.status === "error"
  return (
    <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm">
      <p
        className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        role={failed ? "alert" : "status"}
        aria-live="polite"
      >
        {t(messageKey)}
      </p>
    </div>
  )
}

type GeometryViewportProps = Readonly<{
  activeSketchDisplay?: ViewerSketch | null
  controller: DocumentControllerState
  createViewport?: ViewportFactory
  contextualHiddenFeatureIds?: readonly string[]
  featurePreview?: FeaturePreviewState
  hiddenFeatureIds?: readonly string[]
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
  preselectedFeatureId?: string | null
  selectedFeatureId?: string | null
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
  sketchContext?: GeometryViewportSketchContext
  sketchProfileSelection?: Readonly<{
    selectedProfiles: readonly SketchProfileSelector[]
    onSelect: (
      profile: SketchProfileSelector | null,
      profiles: readonly SketchProfileSelector[],
      intent: ViewerSketchProfileSelectionIntent,
    ) => void
  }>
  axialGizmo?: ViewerAxialGizmo &
    Readonly<{
      featureId: string
      onDistanceChange: (distance: number) => void
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
) {
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
  if (preview?.status === "ready" && preview.candidateMesh?.featureId === featureId) {
    return preview.candidateMesh
  }
  return viewerFeatureMesh(controller, featureId)
}

function useHighlightedFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
  hiddenFeatureIds: readonly string[],
  preview: FeaturePreviewState | undefined,
) {
  return useMemo(
    () => highlightedFeatureMesh(controller, featureId, hiddenFeatureIds, preview),
    [controller, featureId, hiddenFeatureIds, preview],
  )
}

function previewMeshes(
  preview: FeaturePreviewState | undefined,
  committedMeshes: readonly ViewerMesh[],
) {
  return preview?.status === "ready" ? preview.meshes : committedMeshes
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
    if (selection && !meshes.some(({ featureId }) => featureId === selection.featureId)) {
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
    const unsubscribe = store.subscribe(() => {
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

function useViewportMeshPresentation({
  contextualHiddenFeatureIds,
  controller,
  featurePreview,
  hiddenFeatureIds,
}: Pick<
  GeometryViewportProps,
  "contextualHiddenFeatureIds" | "controller" | "featurePreview" | "hiddenFeatureIds"
>) {
  const contextualIds = contextualHiddenFeatureIds ?? EMPTY_IDS
  const hiddenIds = hiddenFeatureIds ?? EMPTY_IDS
  const allCommittedMeshes = useMemo(
    () => viewerMeshes(controller).filter(({ appearance }) => appearance !== "datum"),
    [controller],
  )
  const allHiddenFeatureIds = useMemo(
    () => [...new Set([...hiddenIds, ...contextualIds])],
    [contextualIds, hiddenIds],
  )
  const committedMeshes = useMemo(
    () => viewerMeshes(controller, hiddenIds, contextualIds),
    [contextualIds, controller, hiddenIds],
  )
  const meshes = useMemo(() => {
    const hidden = new Set(allHiddenFeatureIds)
    return previewMeshes(featurePreview, committedMeshes).filter(
      ({ featureId }) => !hidden.has(featureId),
    )
  }, [allHiddenFeatureIds, committedMeshes, featurePreview])
  return { allCommittedMeshes, allHiddenFeatureIds, meshes }
}

function useViewportSketchPresentation({
  activeSketchDisplay,
  controller,
  hiddenSketchIds,
  sketchContext,
}: Pick<
  GeometryViewportProps,
  "activeSketchDisplay" | "controller" | "hiddenSketchIds" | "sketchContext"
>) {
  const hiddenIds = hiddenSketchIds ?? EMPTY_IDS
  return useMemo(() => {
    const committed = viewerSketches(controller, hiddenIds)
    return withActiveSketchDisplay(committed, activeSketchDisplay, sketchContext?.mode === "orbit")
  }, [activeSketchDisplay, controller, hiddenIds, sketchContext?.mode])
}

function selectedSketchProfileKey(selection: GeometryViewportProps["sketchProfileSelection"]) {
  return selection?.selectedProfiles.length === 1
    ? viewerSketchProfileKey(selection.selectedProfiles[0] as SketchProfileSelector)
    : null
}

function useGeometryViewportScene(props: GeometryViewportProps) {
  const { controller, featurePreview, preselectedFeatureId, selectedFeatureId } = props
  const { allCommittedMeshes, allHiddenFeatureIds, meshes } = useViewportMeshPresentation(props)
  const sketches = useViewportSketchPresentation(props)
  const featurePreselection = useHighlightedFeatureMesh(
    controller,
    preselectedFeatureId,
    allHiddenFeatureIds,
    featurePreview,
  )
  const featureSelection = useHighlightedFeatureMesh(
    controller,
    selectedFeatureId,
    allHiddenFeatureIds,
    featurePreview,
  )
  return { allCommittedMeshes, featurePreselection, featureSelection, meshes, sketches }
}

function useGeometryViewportInteraction(
  props: GeometryViewportProps,
  scene: ReturnType<typeof useGeometryViewportScene>,
) {
  const {
    controller,
    createViewport = loadGeometryViewport,
    idleOriginPlaneSelection,
    originPlaneSelection,
    originPlaneVisibility,
    onSelectionChange,
    sketchContext,
    sketchProfileSelection,
  } = props
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
    rendererFailed,
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
    createViewport,
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
    scene.featurePreselection,
    scene.featureSelection,
    sketchContext ?? null,
    sketchProfileSelection,
    props.axialGizmo,
    props.translationGizmo,
  )
  useViewportGizmoSynchronization(viewportRef, props.axialGizmo, props.translationGizmo)
  const supportFaceSelection = useSupportFaceSelection(
    selectionCandidateStack,
    selectionCandidateCommit,
    controller,
    t,
  )
  return {
    canvasRef,
    dismissSketchProfileSelectionRequest,
    originPlaneInteraction,
    originPlanePreselection,
    rendererFailed,
    sketchPointPreselection,
    sketchProfileCandidateStack,
    sketchProfilePreselection,
    sketchProfileSelectionRequest,
    sketchReferenceCandidateStack,
    supportFaceSelection,
    viewportRef,
  }
}

function useGeometryViewportModel(props: GeometryViewportProps) {
  const t = useTranslations("app.shell.viewport")
  const scene = useGeometryViewportScene(props)
  const interaction = useGeometryViewportInteraction(props, scene)
  useProjectThumbnail(props.controller, scene.allCommittedMeshes)
  useClearInvalidSelection(scene.meshes, props.selection, props.onSelectionChange)
  useSketchProjectionSynchronization(interaction.viewportRef, props.sketchContext)
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
    canvasRef: interaction.canvasRef,
    preselectedFeatureId: scene.featurePreselection?.featureId ?? null,
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
    selectedFeatureId: scene.featureSelection?.featureId ?? null,
    selectedSketchProfileCount: props.sketchProfileSelection?.selectedProfiles.length ?? 0,
    selectedSketchProfileKey: selectedSketchProfileKey(props.sketchProfileSelection),
  }
}

function ViewportControlsSlot({
  meshes,
  sketches,
  originPlaneSelection,
  originPlaneVisibility,
  onOriginPlaneVisibilityChange,
  selection,
  viewportRef,
}: Readonly<{
  meshes: readonly ViewerMesh[]
  sketches: readonly ViewerSketch[]
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  selection: GeometryViewportProps["selection"]
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div className="flex items-center gap-1">
      <OriginPlaneVisibilityControls
        onChange={onOriginPlaneVisibilityChange}
        visibility={originPlaneVisibility}
      />
      {meshes.length > 0 || sketches.length > 0 || originPlaneSelection ? (
        <ViewportControls
          clearLabel={t("clearSelection")}
          fitLabel={t("fit")}
          selection={selection}
          viewportRef={viewportRef}
        />
      ) : null}
    </div>
  )
}

function WorldAxesLegend() {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      aria-label={t("worldAxes")}
      className="pointer-events-none absolute bottom-2 left-2 size-20 rounded-md border border-border/70 bg-background/10 shadow-inner"
      role="img"
    >
      <div className="absolute bottom-1 right-1 flex gap-1 rounded-sm bg-background/75 px-1 font-mono text-[10px] font-semibold">
        <span className="text-axis-x">X</span>
        <span className="text-axis-y">Y</span>
        <span className="text-axis-z">Z</span>
      </div>
    </div>
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
  return `${selection.featureId}:${selection.faceId}`
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
      className="pointer-events-auto absolute bottom-12 left-1/2 z-10 w-80 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
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
            className="h-auto min-h-8 justify-start gap-2 px-2 py-1 text-left text-xs"
            data-sketch-reference-select-other-active={
              selection.activeIndex === index ? "true" : undefined
            }
            id={`sketch-reference-select-other-${index}`}
            key={viewerSketchReferenceCandidateKey(candidate)}
            onClick={() => selection.choose(candidate)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="sm"
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
      className="pointer-events-auto absolute bottom-12 left-1/2 z-10 w-80 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
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
            className="h-auto min-h-8 justify-start gap-2 px-2 py-1 text-left text-xs"
            data-support-face-select-other-active={
              selection.activeIndex === index ? "true" : undefined
            }
            id={`support-face-select-other-${index}`}
            key={candidate.key}
            onClick={() => selection.choose(candidate)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="sm"
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

function SavedProfileViewportChrome({
  controller,
  profilePreselectionLabel,
  profileSelectOther,
  profileSelection,
  selectedSketchProfileKey,
  sketches,
}: Readonly<{
  controller: DocumentControllerState
  profilePreselectionLabel: string | null
  profileSelectOther: SavedProfileSelectOtherState
  profileSelection: GeometryViewportProps["sketchProfileSelection"]
  selectedSketchProfileKey: string | null
  sketches: readonly ViewerSketch[]
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      <SavedProfileSelectOtherOverlay selection={profileSelectOther} />
      <SavedProfileKeyboardPicker
        controller={controller}
        selectedKey={selectedSketchProfileKey}
        selection={profileSelection}
        sketches={sketches}
      />
      {profilePreselectionLabel ? (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
          role="status"
        >
          {t("savedProfileCandidate", { label: profilePreselectionLabel })}
        </div>
      ) : null}
    </>
  )
}

function ModelViewportChrome({
  displayUnit,
  featurePreview,
  message,
  meshes,
  onOriginPlaneVisibilityChange,
  originPlanePreselection,
  originPlaneSelection,
  originPlaneVisibility,
  profileChrome,
  selection,
  supportFacePreselectionLabel,
  supportFaceSelectOther,
  sketches,
  viewportRef,
}: Readonly<{
  displayUnit: string
  featurePreview: FeaturePreviewState | undefined
  message: ReturnType<typeof translatedViewportMessage>
  meshes: readonly ViewerMesh[]
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  originPlanePreselection: ViewerOriginPlane | null
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  profileChrome: ReactNode
  selection: ViewerSelection | null
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
        meshes={meshes}
        sketches={sketches}
        originPlaneSelection={originPlaneSelection}
        originPlaneVisibility={originPlaneVisibility}
        onOriginPlaneVisibilityChange={onOriginPlaneVisibilityChange}
        selection={selection}
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
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XYZ", unit: displayUnit })}
      </div>
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
      className="pointer-events-auto absolute bottom-12 left-1/2 z-20 w-80 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
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
            className="h-auto min-h-8 justify-start gap-2 px-2 py-1 text-left text-xs"
            id={`saved-profile-select-other-${index}`}
            key={option.key}
            onClick={() => selection.choose(option.profile)}
            onPointerEnter={() => selection.preview(index)}
            role="option"
            size="sm"
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

function SavedProfileKeyboardPicker({
  controller,
  selectedKey,
  selection,
  sketches,
}: Readonly<{
  controller: DocumentControllerState
  selectedKey: string | null
  selection: GeometryViewportProps["sketchProfileSelection"]
  sketches: readonly ViewerSketch[]
}>) {
  const t = useTranslations("app.shell.viewport")
  if (!selection) return null
  const sketchLabels = new Map<string, string>(
    (controller.report?.snapshot.sketches ?? []).map(({ id, label }) => [id, label]),
  )
  const options = sketches.flatMap((sketch) => {
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
    <fieldset className="pointer-events-auto absolute left-3 top-3 z-10 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
      <legend className="sr-only">{t("savedProfiles")}</legend>
      <NativeSelect
        aria-label={t("selectSavedProfile")}
        className="h-8 max-w-72 text-xs"
        onChange={(event) => {
          const option = options.find(({ key }) => key === event.currentTarget.value)
          if (option) selection.onSelect(option.profile, option.selectors, "replace")
        }}
        value={selectedKey ?? ""}
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

type SketchReferencePurpose = "pierce" | "revolve-axis" | "use"

function referenceSelectionMessageKey(purpose: SketchReferencePurpose) {
  if (purpose === "pierce") return "sketchPierceSelection" as const
  if (purpose === "revolve-axis") return "revolveAxisSelection" as const
  return "sketchReferenceSelection" as const
}

function referenceCandidateMessageKey(purpose: SketchReferencePurpose) {
  if (purpose === "pierce") return "sketchPierceCandidate" as const
  if (purpose === "revolve-axis") return "revolveAxisCandidate" as const
  return "sketchReferenceCandidate" as const
}

function SketchReferenceSelectionStatus({
  purpose,
}: Readonly<{ purpose: SketchReferencePurpose }>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
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
      className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
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
  const pierce = selection.purpose === "pierce"
  const revolveAxis = selection.purpose === "revolve-axis"
  if (selection.candidates.length === 0) return null
  return (
    <div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-10 focus-within:grid focus-within:gap-1 focus-within:rounded-md focus-within:border focus-within:bg-background focus-within:p-2 focus-within:shadow-sm">
      <span className="text-xs font-medium">
        {t(
          pierce
            ? "sketchPierceKeyboardSelection"
            : revolveAxis
              ? "revolveAxisKeyboardSelection"
              : "sketchReferenceKeyboardSelection",
        )}
      </span>
      <NativeSelect
        aria-label={t(
          pierce
            ? "sketchPierceKeyboardSelection"
            : revolveAxis
              ? "revolveAxisKeyboardSelection"
              : "sketchReferenceKeyboardSelection",
        )}
        className="h-8 max-w-72 text-xs"
        defaultValue=""
        onChange={(event) => {
          const candidate = selection.candidates[Number(event.currentTarget.value)]
          if (candidate) selection.onSelect(candidate)
          event.currentTarget.value = ""
        }}
      >
        <option value="">
          {t(
            pierce
              ? "sketchPierceKeyboardPlaceholder"
              : revolveAxis
                ? "revolveAxisKeyboardPlaceholder"
                : "sketchReferenceKeyboardPlaceholder",
          )}
        </option>
        {selection.candidates.map((candidate, index) => (
          <option key={`${candidate.kind}:${candidate.label}:${index}`} value={index}>
            {candidate.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

function SketchContextChrome({
  context,
  preselection,
  selectOther,
  viewportRef,
}: Readonly<{
  context: GeometryViewportSketchContext
  preselection: ViewerSketchReferenceCandidate | null
  selectOther: SketchReferenceSelectOtherState
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  if (context.mode !== "orbit") return null
  const referenceSelection = context.referenceSelection
  const referencePurpose = referenceSelection?.purpose ?? "use"
  return (
    <>
      <WorldAxesLegend />
      <ViewportControls
        clearLabel={t("clearSelection")}
        fitLabel={t("fit")}
        selection={null}
        viewportRef={viewportRef}
      />
      <SketchReferenceSelectOtherOverlay selection={selectOther} />
      {referenceSelection ? <SketchReferenceSelectionStatus purpose={referencePurpose} /> : null}
      {context.faceIntersectionSelection ? (
        <div
          className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
          role="status"
        >
          {t("sketchIntersectionSelection")}
        </div>
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
  displayUnit,
  model,
  profileSelectOther,
  props,
  selectOther,
  supportFaceSelectOther,
}: Readonly<{
  displayUnit: string
  model: ReturnType<typeof useGeometryViewportModel>
  profileSelectOther: SavedProfileSelectOtherState
  props: GeometryViewportProps
  selectOther: SketchReferenceSelectOtherState
  supportFaceSelectOther: SupportFaceSelectOtherState
}>) {
  const t = useTranslations("app.shell.viewport")
  const { featurePreview, originPlaneSelection, selection, sketchContext } = props
  if (sketchContext && !originPlaneSelection) {
    return (
      <SketchContextChrome
        context={sketchContext}
        preselection={model.sketchPointPreselection}
        selectOther={selectOther}
        viewportRef={model.viewportRef}
      />
    )
  }
  return (
    <ModelViewportChrome
      displayUnit={displayUnit}
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
          profilePreselectionLabel={viewerSketchProfileLabel(
            props.controller,
            model.sketches,
            model.sketchProfilePreselection,
            (sketch, number) => t("savedProfileLabel", { number, sketch }),
          )}
          profileSelectOther={profileSelectOther}
          profileSelection={props.sketchProfileSelection}
          selectedSketchProfileKey={model.selectedSketchProfileKey}
          sketches={model.sketches}
        />
      }
      selection={selection}
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

function viewportRenderData(
  passive: boolean,
  featurePreview: FeaturePreviewState | undefined,
  model: ReturnType<typeof useGeometryViewportModel>,
) {
  return {
    "data-passive": passive ? "true" : undefined,
    "data-preselected-feature": model.preselectedFeatureId ?? undefined,
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
    "data-selected-feature": model.selectedFeatureId ?? undefined,
    "data-preselected-sketch-profile": model.sketchProfilePreselection
      ? viewerSketchProfileKey(model.sketchProfilePreselection.selector)
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
) {
  return {
    canvas: cn("absolute inset-0 size-full touch-none", passive && "pointer-events-none"),
    region: cn(
      "relative min-h-0 overflow-hidden bg-viewport-background",
      interaction.className,
      passive && "pointer-events-none",
    ),
  }
}

export function GeometryViewport(props: GeometryViewportProps) {
  const {
    featurePreview,
    idleOriginPlaneSelection,
    onSelectionChange,
    originPlaneSelection,
    sketchContext,
  } = props
  const passive = sketchContext?.mode === "normal" && !originPlaneSelection
  const displayUnits = useDocumentDisplayUnits()
  const sketchReferenceRegionRef = useRef<HTMLElement>(null)
  const t = useTranslations("app.shell.viewport")
  const model = useGeometryViewportModel(props)
  const { canvasRef, sketchReferenceCandidateStack, sketchPointPreselection, viewportRef } = model
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
  const regionClassNames = viewportRegionClassNames(passive, referenceInteraction)
  return (
    <section
      ref={sketchReferenceRegionRef}
      aria-label={t("ariaLabel")}
      aria-hidden={passive ? true : undefined}
      className={regionClassNames.region}
      {...viewportOriginPlaneData(originPlaneSelection, idleOriginPlaneSelection, model)}
      {...viewportRenderData(passive, featurePreview, model)}
      {...viewportSketchContextData(sketchContext)}
      data-axial-gizmo-distance={props.axialGizmo?.distance}
      data-axial-gizmo-feature={props.axialGizmo?.featureId}
      data-translation-gizmo-feature={props.translationGizmo?.featureId}
      data-translation-gizmo-position={props.translationGizmo?.position.join(",")}
      onKeyDown={referenceInteraction.onKeyDown}
      onPointerDown={referenceInteraction.onPointerDown}
      onPointerEnter={referenceInteraction.onPointerEnter}
      onPointerLeave={referenceInteraction.onPointerLeave}
      tabIndex={referenceInteraction.tabIndex ?? -1}
    >
      <canvas ref={canvasRef} className={regionClassNames.canvas} />
      <GeometryViewportContextChrome
        displayUnit={displayUnits.length}
        model={model}
        profileSelectOther={profileSelectOther}
        props={props}
        selectOther={selectOther}
        supportFaceSelectOther={supportFaceSelectOther}
      />
    </section>
  )
}
