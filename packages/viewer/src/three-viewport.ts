import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  type Intersection,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  ShapeUtils,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { TransformControls } from "three/addons/controls/TransformControls.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { AnalysisOverlayDecoration, type ViewerAnalysisOverlay } from "./analysis-overlays"
import { createBrowserEdgePreparation } from "./edge-preparation-browser"
import { EdgePresentation } from "./edge-presentation"
import { FaceHighlightPresentation } from "./face-highlights"
import { FeatureHighlightPresentation } from "./feature-highlights"
import { InfiniteGridDecoration } from "./infinite-grid"
import { createLatestFramePublisher } from "./latest-frame-publisher"
import { viewerBodyKey } from "./mesh-geometry"
import {
  createFaceHighlightGeometry,
  firstViewerSelectionHit,
  sameViewerSelection as sameSelection,
  viewerSelectionFromSource,
} from "./mesh-selection"
import { ModelMeshPresentation } from "./model-meshes"
import { preserveOrbitPivot } from "./orbit-pivot"
import { orientationInsetPlacement } from "./orientation-inset"
import { OrientationInsetInteraction } from "./orientation-inset-interaction"
import { OrientationMarker, type OrientationMarkerAxis } from "./orientation-marker"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "./origin-planes"
import { PointerHoverPicking } from "./pointer-hover"
import { PrintBedDecoration, type ViewerPrintBed } from "./print-bed"
import {
  sameViewerSection,
  sectionClipPlanes,
  sectionPointVisible,
  type ViewerSection,
} from "./section-view"
import { SectionViewDecoration } from "./section-view-decoration"
import { ToolPlaneDecoration, type ViewerToolPlane } from "./tool-plane-decoration"
import { captureViewportImage } from "./viewport-image"

export type { ViewerToolPlane } from "./tool-plane-decoration"

import { viewerSketchReferenceCandidateKey } from "./sketch-reference-identity"

export type { ViewerAnalysisOverlay } from "./analysis-overlays"
export { viewerFaceSurfaceGeometry } from "./face-surface-geometry"
export { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
export {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "./origin-planes"

const DEFAULT_VIEW_HEIGHT = 100
const FIT_PADDING = 1.35
const MAX_PIXEL_RATIO = 2
const ORIGIN_PLANE_SIZE = 64
const ORIGIN_PLANE_COLOR = "#7196bf"
const ORIGIN_PLANE_OPACITY = {
  idle: { fill: 0.04, edge: 0.25 },
  selected: { fill: 0.12, edge: 0.7 },
  preselected: { fill: 0.2, edge: 0.9 },
} as const
const MIN_AXIAL_GIZMO_DISTANCE = 0.01
const orientationAxisViews = {
  X: "right",
  "-X": "left",
  Y: "back",
  "-Y": "front",
  Z: "top",
  "-Z": "bottom",
} as const satisfies Record<OrientationMarkerAxis, ViewerStandardView>

function isFiniteViewerVector3(position: ViewerVector3): boolean {
  return position.length === 3 && position.every((value) => Number.isFinite(value))
}

function sameViewerSketchPlaneProjection(
  left: ViewerSketchPlaneProjection | null | undefined,
  right: ViewerSketchPlaneProjection | null,
) {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.a === right.a &&
    left.b === right.b &&
    left.c === right.c &&
    left.d === right.d &&
    left.e === right.e &&
    left.f === right.f
  )
}

export { createLatestFramePublisher } from "./latest-frame-publisher"
export { viewerFaceOrdinal } from "./mesh-selection"

export type ViewerMesh = Readonly<{
  textureSource?: Omit<ViewerMesh, "textureSource">
  appearance?: "datum" | "model" | "preview" | "selection-source"
  /** Changes preview shading without granting committed picking authority. */
  previewMaterial?: "highlight" | "model" | "datum"
  featureId: string
  outputRole?: string
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  triangleFaceIds: Uint32Array
}>

export type ViewerFeatureHighlight = ViewerMesh | readonly ViewerMesh[] | null

export function viewerHighlightMeshes(source: ViewerFeatureHighlight): readonly ViewerMesh[] {
  return source === null ? [] : "featureId" in source ? [source] : source
}

export type ViewerSketch = Readonly<{
  selected?: boolean
  preselected?: boolean
  sketchId: string
  frame?: ViewerFrame
  profiles?: readonly ViewerSketchProfile[]
  curvePositions: Float32Array
  constructionCurvePositions: Float32Array
  pointPositions: Float32Array
  constructionPointPositions: Float32Array
  controlPointPositions?: Float32Array
  controlHandlePositions?: Float32Array
}>

/** Durable profile identity; boundary entity ordering is part of the selector contract. */
export type ViewerSketchProfileSelector = Readonly<{
  schemaVersion: 0
  sketchId: string
  outerBoundaryEntityIds: readonly string[]
  holeBoundaryEntityIds: readonly (readonly string[])[]
}>

export type ViewerSketchProfile = Readonly<{
  selector: ViewerSketchProfileSelector
  outerPositions: Float32Array
  holePositions: readonly Float32Array[]
}>

export type ViewerSketchProfileSelectionIntent = "replace" | "toggle"

export type ViewerSketchPointCandidate = Readonly<{
  kind?: "point"
  selected?: boolean
  label: string
  position: ViewerVector3
  sourcePointId: string
  sourceSketchId: string
}>

export type ViewerSketchLineCandidate = Readonly<{
  kind: "line"
  label: string
  start: ViewerVector3
  end: ViewerVector3
  sourceLineId: string
  sourceSketchId: string
}>

export type ViewerSketchCurveCandidate = Readonly<{
  kind: "curve"
  label: string
  points: readonly ViewerVector3[]
  sourceEntityId: string
  sourceSketchId: string
  sourceType: "arc" | "circle" | "ellipse" | "elliptical-arc"
}>

export type ViewerModelPointCandidate = Readonly<{
  kind: "model-point"
  label: string
  featureId: string
  candidateId: string
  position: ViewerVector3
}>

export type ViewerModelLineCandidate = Readonly<{
  kind: "model-line"
  label: string
  featureId: string
  candidateId: string
  start: ViewerVector3
  end: ViewerVector3
}>

export type ViewerModelCurveCandidate = Readonly<{
  kind: "model-curve"
  selected?: boolean
  label: string
  featureId: string
  candidateId: string
  points: readonly ViewerVector3[]
  sourceType: "arc" | "circle" | "ellipse" | "elliptical-arc" | "edge"
}>

export type ViewerSketchReferenceCandidate =
  | ViewerSketchPointCandidate
  | ViewerSketchLineCandidate
  | ViewerSketchCurveCandidate
  | ViewerModelPointCandidate
  | ViewerModelLineCandidate
  | ViewerModelCurveCandidate

export type ViewerVector3 = readonly [number, number, number]

/** Disposable exact-kernel edge samples; the host resolves durable topology references. */
export type ViewerEdgeCandidate = Readonly<{
  featureId: string
  outputRole?: string | undefined
  candidateId: string
  label: string
  points: readonly ViewerVector3[]
  selected?: boolean
}>

export type ViewerAxialGizmo = Readonly<{
  direction: ViewerVector3
  distance: number
  distanceRange?: Readonly<{ min: number; max: number }>
  origin: ViewerVector3
}>

export type ViewerAngularGizmo = Readonly<{
  angle: number
  axisDirection: ViewerVector3
  axisOrigin: ViewerVector3
  maxAngle?: number
  minAngle?: number
  rotationOrigin: ViewerVector3
}>

type ViewerAngularGizmoFrame = Readonly<{
  axis: Vector3
  origin: Vector3
  radial: Vector3
  radius: number
}>

function normalizedViewerDirection(direction: ViewerVector3): Vector3 | null {
  if (!isFiniteViewerVector3(direction)) return null
  const result = new Vector3(...direction)
  return result.lengthSq() > 0 ? result.normalize() : null
}

export function viewerAxialGizmoHandlePosition(gizmo: ViewerAxialGizmo): ViewerVector3 | null {
  const direction = normalizedViewerDirection(gizmo.direction)
  if (!direction || !isFiniteViewerVector3(gizmo.origin) || !Number.isFinite(gizmo.distance)) {
    return null
  }
  const position = direction.multiplyScalar(gizmo.distance).add(new Vector3(...gizmo.origin))
  return [position.x, position.y, position.z]
}

export function viewerAxialGizmoDistance(
  gizmo: Pick<ViewerAxialGizmo, "direction" | "origin">,
  position: ViewerVector3,
): number | null {
  const direction = normalizedViewerDirection(gizmo.direction)
  if (!direction || !isFiniteViewerVector3(gizmo.origin) || !isFiniteViewerVector3(position)) {
    return null
  }
  const distance = new Vector3(...position).sub(new Vector3(...gizmo.origin)).dot(direction)
  return Number.isFinite(distance) ? distance : null
}

/** Extrusion retains its positive minimum unless a tool explicitly supplies a finite range. */
export function viewerAxialGizmoDragDistance(
  gizmo: Pick<ViewerAxialGizmo, "distanceRange">,
  rawDistance: number,
): number | null {
  if (!Number.isFinite(rawDistance)) return null
  const range = gizmo.distanceRange
  if (!range) return Math.max(MIN_AXIAL_GIZMO_DISTANCE, rawDistance)
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max)
    return null
  return Math.min(range.max, Math.max(range.min, rawDistance))
}

function viewerAngularGizmoFrame(gizmo: ViewerAngularGizmo): ViewerAngularGizmoFrame | null {
  const axis = normalizedViewerDirection(gizmo.axisDirection)
  if (
    !axis ||
    !isFiniteViewerVector3(gizmo.axisOrigin) ||
    !isFiniteViewerVector3(gizmo.rotationOrigin)
  ) {
    return null
  }
  const origin = new Vector3(...gizmo.axisOrigin)
  const radial = new Vector3(...gizmo.rotationOrigin).sub(origin)
  radial.addScaledVector(axis, -radial.dot(axis))
  const radius = radial.length()
  return Number.isFinite(radius) && radius > Number.EPSILON
    ? { axis, origin, radial: radial.normalize(), radius }
    : null
}

export function viewerAngularGizmoPoint(
  gizmo: ViewerAngularGizmo,
  angle = gizmo.angle,
): ViewerVector3 | null {
  const frame = viewerAngularGizmoFrame(gizmo)
  if (!frame || !Number.isFinite(angle)) return null
  const tangent = new Vector3().crossVectors(frame.axis, frame.radial)
  const point = frame.origin
    .clone()
    .addScaledVector(frame.radial, Math.cos(angle) * frame.radius)
    .addScaledVector(tangent, Math.sin(angle) * frame.radius)
  return [point.x, point.y, point.z]
}

export function viewerAngularGizmoAngle(
  gizmo: ViewerAngularGizmo,
  point: ViewerVector3,
  nearAngle = gizmo.angle,
): number | null {
  const frame = viewerAngularGizmoFrame(gizmo)
  if (!frame || !isFiniteViewerVector3(point) || !Number.isFinite(nearAngle)) return null
  const radial = new Vector3(...point).sub(frame.origin)
  radial.addScaledVector(frame.axis, -radial.dot(frame.axis))
  if (radial.lengthSq() <= Number.EPSILON) return null
  radial.normalize()
  const wrapped = Math.atan2(
    frame.axis.dot(new Vector3().crossVectors(frame.radial, radial)),
    frame.radial.dot(radial),
  )
  const positive = wrapped < 0 ? wrapped + Math.PI * 2 : wrapped
  const turns = Math.round((nearAngle - positive) / (Math.PI * 2))
  const unwrapped = positive + turns * Math.PI * 2
  const minAngle = gizmo.minAngle ?? Math.PI / 180
  const maxAngle = gizmo.maxAngle ?? Math.PI * 2
  return Math.min(maxAngle, Math.max(minAngle, unwrapped))
}

function viewerAngularGizmoLinePositions(gizmo: ViewerAngularGizmo): Float32Array | null {
  const frame = viewerAngularGizmoFrame(gizmo)
  const end = viewerAngularGizmoPoint(gizmo)
  if (!frame || !end || !Number.isFinite(gizmo.angle)) return null
  const positions: number[] = []
  const appendSegment = (start: Vector3, finish: Vector3) => {
    positions.push(start.x, start.y, start.z, finish.x, finish.y, finish.z)
  }
  const start = frame.origin.clone().addScaledVector(frame.radial, frame.radius)
  const endPoint = new Vector3(...end)
  appendSegment(frame.origin, start)
  appendSegment(frame.origin, endPoint)
  const segments = Math.max(12, Math.ceil((64 * Math.abs(gizmo.angle)) / (Math.PI * 2)))
  let previous = start
  for (let index = 1; index <= segments; index += 1) {
    const point = viewerAngularGizmoPoint(gizmo, gizmo.angle * (index / segments))
    if (!point) return null
    const current = new Vector3(...point)
    appendSegment(previous, current)
    previous = current
  }
  const endRadial = endPoint.clone().sub(frame.origin).normalize()
  const tangent = new Vector3()
    .crossVectors(frame.axis, endRadial)
    .normalize()
    .multiplyScalar(gizmo.angle < 0 ? -1 : 1)
  const arrowLength = frame.radius * 0.12
  const arrowBase = endPoint.clone().addScaledVector(tangent, -arrowLength)
  appendSegment(endPoint, arrowBase.clone().addScaledVector(endRadial, arrowLength * 0.45))
  appendSegment(endPoint, arrowBase.clone().addScaledVector(endRadial, -arrowLength * 0.45))
  return new Float32Array(positions)
}

function normalizedViewerAngularGizmo(gizmo: ViewerAngularGizmo): ViewerAngularGizmo | null {
  const frame = viewerAngularGizmoFrame(gizmo)
  const minAngle = gizmo.minAngle ?? Math.PI / 180
  const maxAngle = gizmo.maxAngle ?? Math.PI * 2
  const validRange = Number.isFinite(minAngle) && Number.isFinite(maxAngle) && maxAngle > minAngle
  if (!frame || !Number.isFinite(gizmo.angle) || !validRange) return null
  return {
    ...gizmo,
    angle: Math.min(maxAngle, Math.max(minAngle, gizmo.angle)),
    axisDirection: [frame.axis.x, frame.axis.y, frame.axis.z],
  }
}

/** A finite, orthonormal, right-handed sketch coordinate frame. */
export type ViewerFrame = Readonly<{
  origin: ViewerVector3
  xAxis: ViewerVector3
  yAxis: ViewerVector3
  normal: ViewerVector3
}>

/** Maps sketch-local coordinates to normalized viewport coordinates. */
export type ViewerSketchPlaneProjection = Readonly<{
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}>

/** Orthographic camera basis and frustum size used by sketch-plane projection. */
export type ViewerProjectionCamera = Readonly<{
  right: ViewerVector3
  up: ViewerVector3
  target: ViewerVector3
  viewWidth: number
  viewHeight: number
}>

function validSketchProjectionCamera(camera: ViewerProjectionCamera) {
  return (
    [camera.right, camera.up, camera.target].every(finiteVector) &&
    [camera.viewWidth, camera.viewHeight].every((size) => Number.isFinite(size) && size > 0) &&
    Math.abs(dot(camera.right, camera.right) - 1) <= FRAME_TOLERANCE &&
    Math.abs(dot(camera.up, camera.up) - 1) <= FRAME_TOLERANCE &&
    Math.abs(dot(camera.right, camera.up)) <= FRAME_TOLERANCE
  )
}

function canonicalProjectionCoordinate(value: number) {
  return value === 0 ? 0 : value
}

/** Computes a stable normalized viewport transform for a sketch plane and orthographic camera. */
export function viewerSketchPlaneProjection(
  frame: ViewerFrame,
  camera: ViewerProjectionCamera,
): ViewerSketchPlaneProjection | null {
  if (!isValidViewerFrame(frame) || !validSketchProjectionCamera(camera)) return null
  const right = new Vector3(...camera.right)
  const up = new Vector3(...camera.up)
  const origin = new Vector3(...frame.origin).sub(new Vector3(...camera.target))
  const a = right.dot(new Vector3(...frame.xAxis)) / camera.viewWidth
  const c = right.dot(new Vector3(...frame.yAxis)) / camera.viewWidth
  const b = -up.dot(new Vector3(...frame.xAxis)) / camera.viewHeight
  const d = -up.dot(new Vector3(...frame.yAxis)) / camera.viewHeight
  const e = 0.5 + right.dot(origin) / camera.viewWidth
  const f = 0.5 - up.dot(origin) / camera.viewHeight
  const relativeDeterminant = Math.abs((a * d - b * c) * camera.viewWidth * camera.viewHeight)
  const values = [a, b, c, d, e, f]
  if (
    !values.every(Number.isFinite) ||
    !Number.isFinite(relativeDeterminant) ||
    relativeDeterminant < 1e-3
  ) {
    return null
  }
  return {
    a: canonicalProjectionCoordinate(a),
    b: canonicalProjectionCoordinate(b),
    c: canonicalProjectionCoordinate(c),
    d: canonicalProjectionCoordinate(d),
    e: canonicalProjectionCoordinate(e),
    f: canonicalProjectionCoordinate(f),
  }
}

export type ViewerCameraPose = Readonly<{
  position: ViewerVector3
  target: ViewerVector3
  up: ViewerVector3
}>

export type ViewerStandardView =
  | "back"
  | "bottom"
  | "front"
  | "isometric"
  | "left"
  | "right"
  | "top"

export type ViewerInteractionMode =
  | "select"
  | "camera-only"
  | "sketch-reference-select"
  | "face-select"

export type OrthographicFrustum = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

export type ViewerSketchProjectionBounds = Readonly<{
  minX: number
  minY: number
  width: number
  height: number
}>

export type { ViewerSection } from "./section-view"

export type GeometryViewport = Readonly<{
  captureImage?: () => Promise<Blob>
  setSurfaceTextureBrush: (brush: ViewerSurfaceTextureBrush | null, active?: boolean) => void
  clearSketchProjection: () => void
  orientToFrame: (frame: ViewerFrame) => boolean
  setSketchProjection: (frame: ViewerFrame, bounds: ViewerSketchProjectionBounds) => boolean
  setSketchPlaneProjection: (
    frame: ViewerFrame | null,
    onChange?: (projection: ViewerSketchPlaneProjection | null) => void,
  ) => void
  setSketchNavigationElement: (element: HTMLElement | SVGSVGElement | null) => void
  setPointerOrbit: (enabled: boolean) => void
  setInteractionMode: (mode: ViewerInteractionMode) => void
  setFeaturePreselection: (mesh: ViewerFeatureHighlight) => void
  setFeatureSelection: (mesh: ViewerFeatureHighlight) => void
  setSection: (section: ViewerSection | null) => void
  setToolPlane: (plane: ViewerToolPlane | null) => void
  setPrintBed: (bed: ViewerPrintBed | null) => void
  setGroundGrid: (enabled: boolean) => void
  setMeshes: (meshes: readonly ViewerMesh[]) => void
  setEdgeCandidates: (candidates: readonly ViewerEdgeCandidate[]) => void
  setEdgePreselection: (candidate: ViewerEdgeCandidate | null) => void
  setSketchReferenceCandidates: (candidates: readonly ViewerSketchReferenceCandidate[]) => void
  setSketchReferencePreselection: (candidate: ViewerSketchReferenceCandidate | null) => void
  setSketchProfilePreselection: (profile: ViewerSketchProfile | null) => void
  setSketchProfileSelection: (profile: ViewerSketchProfile | null) => void
  setSketchProfileSelections: (profiles: readonly ViewerSketchProfile[]) => void
  setSketches: (sketches: readonly ViewerSketch[]) => void
  setOriginPlaneSelection: (
    selectedPlane: ViewerOriginPlane | null,
    active?: boolean,
    idleSelectionEnabled?: boolean,
  ) => void
  setSelectionCandidateStackPreserved: (preserved: boolean) => void
  setSelectionPreselection: (selection: ViewerSelection | null) => void
  setFaceSelections: (selections: readonly ViewerSelection[]) => void
  setAnalysisOverlays: (overlays: readonly ViewerAnalysisOverlay[] | null) => void
  setOriginPlaneVisibility: (visibility: ViewerOriginPlaneVisibility) => void
  showTranslationGizmo: (position: ViewerVector3) => void
  showAxialTranslationGizmo: (gizmo: ViewerAxialGizmo) => void
  showAngularGizmo: (gizmo: ViewerAngularGizmo) => void
  hideTranslationGizmo: (options?: Readonly<{ preserveActiveGesture?: boolean }>) => void
  hideAngularGizmo: () => void
  setStandardView: (view: ViewerStandardView) => void
  fit: () => void
  clearSelection: () => void
  dispose: () => void
}>

export type ViewerSelection = Readonly<{
  featureId: string
  outputRole?: string
  faceId: number
  faceOrdinal: number
}>

export type ViewerSurfaceTextureDab = Readonly<{
  center: [number, number, number]
  normal: [number, number, number]
  selection: ViewerSelection
  erase: boolean
}>

export type ViewerSurfaceTextureBrush = Readonly<{
  featureId: string | null
  outputRole: string | null
  mode: "faces" | "paint" | "erase"
  radiusMm: number
  hardness: number
  onStart: () => void
  onDab: (dab: ViewerSurfaceTextureDab) => void
  onEnd: (cancelled: boolean) => void
}>

export type ViewerSelectionHit = Readonly<{
  selection: ViewerSelection
  distance: number
}>

const MAX_SELECTION_CANDIDATES = 8

/** Deduplicates and deterministically orders face hits for support selection. */
export function orderedUniqueViewerSelections(
  hits: readonly ViewerSelectionHit[],
  limit = MAX_SELECTION_CANDIDATES,
): readonly ViewerSelection[] {
  const safeLimit = Math.max(0, Math.floor(limit))
  const sorted = [...hits].sort((left, right) => {
    const leftDistance = Number.isFinite(left.distance) ? left.distance : Number.POSITIVE_INFINITY
    const rightDistance = Number.isFinite(right.distance)
      ? right.distance
      : Number.POSITIVE_INFINITY
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    const bodyOrder =
      viewerBodyKey(left.selection) < viewerBodyKey(right.selection)
        ? -1
        : viewerBodyKey(left.selection) > viewerBodyKey(right.selection)
          ? 1
          : 0
    if (bodyOrder !== 0) return bodyOrder
    if (left.selection.faceOrdinal !== right.selection.faceOrdinal) {
      return left.selection.faceOrdinal - right.selection.faceOrdinal
    }
    return left.selection.faceId - right.selection.faceId
  })
  const seen = new Set<string>()
  const selections: ViewerSelection[] = []
  for (const hit of sorted) {
    const { selection } = hit
    const key = `${viewerBodyKey(selection)}\u0000${selection.faceId}`
    if (seen.has(key)) continue
    seen.add(key)
    selections.push(selection)
    if (selections.length >= safeLimit) break
  }
  return selections
}

/** Filters support eligibility before applying the bounded face-hit ordering. */
export function orderedEligibleViewerSelections(
  hits: readonly ViewerSelectionHit[],
  isEligible: (selection: ViewerSelection) => boolean,
  limit = MAX_SELECTION_CANDIDATES,
) {
  return orderedUniqueViewerSelections(
    hits.filter(({ selection }) => isEligible(selection)),
    limit,
  )
}

export type GeometryViewportOptions = Readonly<{
  /** Reports asynchronous display-edge failures; surfaces and picking remain usable. */
  onEdgePreparationError?: (error: Error) => void
  /** The element's width reserves a left safe area for the orientation scene. */
  orientationInsetOffsetElement?: HTMLElement | null
  /** Additional drawing surface above the canvas whose inset owns navigation input. */
  orientationInputElement?: () => HTMLElement | SVGSVGElement | null
  /** Runs before a marker drag's first rotation or a valid axis click's view change. */
  onOrientationNavigationStart?: () => void
  /** Filters face/support candidates, independently of ordinary body activation. */
  isSelectionCandidateEligible?: (selection: ViewerSelection) => boolean
  onOriginPlanePreselectionChange?: (plane: ViewerOriginPlane | null) => void
  onOriginPlaneSelectionChange?: (plane: ViewerOriginPlane | null) => void
  onSelectionChange?: (selection: ViewerSelection | null) => void
  onEdgeSelectionChange?: (candidate: ViewerEdgeCandidate | null) => void
  onEdgePreselectionChange?: (candidate: ViewerEdgeCandidate | null) => void
  onEdgeCandidateStackChange?: (candidates: readonly ViewerEdgeCandidate[]) => void
  onSelectionCandidateStackChange?: (candidates: readonly ViewerSelection[]) => void
  onSelectionCandidateStackCommit?: (candidates: readonly ViewerSelection[]) => void
  onSketchReferenceCandidateStackChange?: (
    candidates: readonly ViewerSketchReferenceCandidate[],
  ) => void
  onSketchReferencePreselectionChange?: (candidate: ViewerSketchReferenceCandidate | null) => void
  onSketchReferenceSelectionChange?: (candidate: ViewerSketchReferenceCandidate) => void
  onSketchProfileCandidateStackChange?: (candidates: readonly ViewerSketchProfile[]) => void
  onSketchProfileCandidateStackCommit?: (candidates: readonly ViewerSketchProfile[]) => void
  onSketchProfilePreselectionChange?: (profile: ViewerSketchProfile | null) => void
  onSketchProfileSelectionChange?: (
    profile: ViewerSketchProfile | null,
    intent: ViewerSketchProfileSelectionIntent,
  ) => void
  onTranslationGizmoPositionChange?: (position: ViewerVector3) => void
  onAxialGizmoDistanceChange?: (distance: number) => void
  onAngularGizmoAngleChange?: (angle: number) => void
  onSectionChange?: (section: ViewerSection) => void
}>

function viewerSelectionStackCallback(
  callback: ((candidates: readonly ViewerSelection[]) => void) | undefined,
) {
  return callback ?? (() => undefined)
}

function viewerSelectionEligibilityCallback(
  callback: ((selection: ViewerSelection) => boolean) | undefined,
) {
  return callback ?? (() => true)
}

function viewerSketchProfileCallbacks(options: GeometryViewportOptions) {
  const ignoreProfileChange = (
    _profile: ViewerSketchProfile | null,
    _intent?: ViewerSketchProfileSelectionIntent,
  ) => undefined
  const ignoreProfileStackChange = (_profiles: readonly ViewerSketchProfile[]) => undefined
  return {
    candidateStackChange: options.onSketchProfileCandidateStackChange ?? ignoreProfileStackChange,
    candidateStackCommit: options.onSketchProfileCandidateStackCommit ?? ignoreProfileStackChange,
    preselection: options.onSketchProfilePreselectionChange ?? ignoreProfileChange,
    selection: options.onSketchProfileSelectionChange ?? ignoreProfileChange,
  }
}

export function orthographicFrustum(viewHeight: number, aspect: number): OrthographicFrustum {
  const safeHeight =
    Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : DEFAULT_VIEW_HEIGHT
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const halfHeight = safeHeight / 2
  const halfWidth = halfHeight * safeAspect
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}

function viewerViewHeightForBounds(
  currentViewHeight: number,
  target: ViewerVector3,
  boundsCenter: ViewerVector3,
  boundsRadius: number,
) {
  const targetDistance = Math.hypot(
    target[0] - boundsCenter[0],
    target[1] - boundsCenter[1],
    target[2] - boundsCenter[2],
  )
  const radius = Number.isFinite(boundsRadius) ? Math.max(boundsRadius, 0) : 0
  return Math.max(currentViewHeight, (targetDistance + radius) * 2 * FIT_PADDING, 1)
}

const FRAME_TOLERANCE = 1e-6

function finiteVector(vector: unknown): vector is ViewerVector3 {
  return Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)
}

function dot(left: ViewerVector3, right: ViewerVector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

/** Returns false for malformed, non-finite, non-orthonormal, or left-handed frames. */
export function isValidViewerFrame(frame: ViewerFrame): boolean {
  if (!frame || !finiteVector(frame.origin)) return false
  if (!finiteVector(frame.xAxis) || !finiteVector(frame.yAxis) || !finiteVector(frame.normal)) {
    return false
  }
  const { xAxis, yAxis, normal } = frame
  const unit = (vector: ViewerVector3) => Math.abs(dot(vector, vector) - 1) <= FRAME_TOLERANCE
  if (!unit(xAxis) || !unit(yAxis) || !unit(normal)) return false
  if (
    Math.abs(dot(xAxis, yAxis)) > FRAME_TOLERANCE ||
    Math.abs(dot(xAxis, normal)) > FRAME_TOLERANCE ||
    Math.abs(dot(yAxis, normal)) > FRAME_TOLERANCE
  ) {
    return false
  }
  const handedness =
    (xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1]) * normal[0] +
    (xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2]) * normal[1] +
    (xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0]) * normal[2]
  return handedness >= 1 - FRAME_TOLERANCE
}

export function isValidViewerProjectionBounds(bounds: ViewerSketchProjectionBounds): boolean {
  return (
    !!bounds &&
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

/** Returns the orthographic height required by SVG's xMidYMid meet behavior. */
export function viewerSketchProjectionViewHeight(
  bounds: ViewerSketchProjectionBounds,
  aspect: number,
): number {
  if (!isValidViewerProjectionBounds(bounds)) return DEFAULT_VIEW_HEIGHT
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return Math.max(bounds.height, bounds.width / safeAspect)
}

export function viewerSketchProjectionTarget(
  frame: ViewerFrame,
  bounds: ViewerSketchProjectionBounds,
): ViewerVector3 | null {
  if (!isValidViewerFrame(frame) || !isValidViewerProjectionBounds(bounds)) return null
  const centerX = bounds.minX + bounds.width / 2
  const centerY = bounds.minY + bounds.height / 2
  return [
    frame.origin[0] + frame.xAxis[0] * centerX + frame.yAxis[0] * centerY,
    frame.origin[1] + frame.xAxis[1] * centerX + frame.yAxis[1] * centerY,
    frame.origin[2] + frame.xAxis[2] * centerX + frame.yAxis[2] * centerY,
  ]
}

/** Derives an orthographic camera pose without mutating a renderer or camera. */
export function viewerCameraPoseForFrame(
  frame: ViewerFrame,
  distance: number,
): ViewerCameraPose | null {
  if (!isValidViewerFrame(frame) || !Number.isFinite(distance) || distance <= 0) return null
  return {
    position: [
      frame.origin[0] + frame.normal[0] * distance,
      frame.origin[1] + frame.normal[1] * distance,
      frame.origin[2] + frame.normal[2] * distance,
    ],
    target: [...frame.origin],
    up: [...frame.yAxis],
  }
}

const standardViewDirections = {
  back: [0, 1, 0],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  isometric: [1, -1, 0.8],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
} as const satisfies Record<ViewerStandardView, ViewerVector3>

/** Preserves the orbit target and distance while deriving a deterministic Z-up standard view. */
export function viewerCameraPoseForStandardView(
  view: ViewerStandardView,
  target: ViewerVector3,
  distance: number,
): ViewerCameraPose | null {
  if (!target.every(Number.isFinite) || !Number.isFinite(distance) || distance <= 0) {
    return null
  }
  const [x, y, z] = standardViewDirections[view]
  const directionLength = Math.hypot(x, y, z)
  const direction = [x / directionLength, y / directionLength, z / directionLength] as const
  return {
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    target: [...target],
    up: view === "top" || view === "bottom" ? [0, 1, 0] : [0, 0, 1],
  }
}

export function createViewerSketchGeometry(positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function viewerSketchProfileKey(selector: ViewerSketchProfileSelector) {
  return `${selector.schemaVersion}:${selector.sketchId}:${selector.outerBoundaryEntityIds.join(",")}|${selector.holeBoundaryEntityIds.map((hole) => hole.join(",")).join("|")}`
}

/** Triangulates a local XY profile and places its vertices in the supplied sketch frame. */
export function createViewerSketchProfileGeometry(
  profile: ViewerSketchProfile,
  frame: ViewerFrame,
): BufferGeometry | null {
  if (!isValidViewerFrame(frame)) return null
  const contours = [profile.outerPositions, ...profile.holePositions]
  if (contours.some((positions) => positions.length < 6 || positions.length % 2 !== 0)) return null
  const vectors = contours.map((positions) => {
    const points: Vector2[] = []
    for (let index = 0; index < positions.length; index += 2) {
      const x = positions[index]
      const y = positions[index + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      points.push(new Vector2(x, y))
    }
    return points
  })
  if (vectors.some((points) => points === null)) return null
  const points = vectors as Vector2[][]
  const triangles = ShapeUtils.triangulateShape(points[0] ?? [], points.slice(1))
  if (triangles.length === 0) return null
  const vertexCount = contours.reduce((total, positions) => total + positions.length / 2, 0)
  const worldPositions = new Float32Array(vertexCount * 3)
  let vertexOffset = 0
  for (const positions of contours) {
    for (let index = 0; index < positions.length; index += 2) {
      const x = positions[index] ?? 0
      const y = positions[index + 1] ?? 0
      const offset = (vertexOffset + index / 2) * 3
      worldPositions[offset] = frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y
      worldPositions[offset + 1] = frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y
      worldPositions[offset + 2] = frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y
    }
    vertexOffset += positions.length / 2
  }
  const indices = new Uint32Array(triangles.length * 3)
  triangles.forEach((triangle, index) => {
    indices.set(triangle, index * 3)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(worldPositions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export { createFaceHighlightGeometry } from "./mesh-selection"

function setCameraFrustum(camera: OrthographicCamera, viewHeight: number, aspect: number) {
  const frustum = orthographicFrustum(viewHeight, aspect)
  camera.left = frustum.left
  camera.right = frustum.right
  camera.top = frustum.top
  camera.bottom = frustum.bottom
  camera.updateProjectionMatrix()
}

function sketchPointMask(shape: "circle" | "diamond") {
  const size = 32
  const data = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (2 * (column + 0.5)) / size - 1
      const y = (2 * (row + 0.5)) / size - 1
      const inside = shape === "diamond" ? Math.abs(x) + Math.abs(y) <= 1 : x * x + y * y <= 1
      const offset = (row * size + column) * 4
      data.fill(inside ? 255 : 0, offset, offset + 3)
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size)
  texture.needsUpdate = true
  return texture
}

function disposeModelGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    if (child instanceof Mesh || child instanceof LineSegments || child instanceof Points) {
      child.geometry.dispose()
    }
  }
}

function sameSelectionStack(left: readonly ViewerSelection[], right: readonly ViewerSelection[]) {
  return (
    left.length === right.length &&
    left.every((selection, index) => sameSelection(selection, right[index] ?? null))
  )
}

function sameSketchProfileStack(
  left: readonly ViewerSketchProfile[],
  right: readonly ViewerSketchProfile[],
) {
  return (
    left.length === right.length &&
    left.every((profile, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        viewerSketchProfileKey(profile.selector) === viewerSketchProfileKey(other.selector)
      )
    })
  )
}

function isViewerSketchPointCandidate(
  candidate: ViewerSketchReferenceCandidate,
): candidate is ViewerSketchPointCandidate | ViewerModelPointCandidate {
  return candidate.kind === "point" || candidate.kind === "model-point"
}

/** Positions for the persistent selected-point overlay; candidate hit targets remain transparent. */
export function selectedViewerSketchPointPositions(
  candidates: readonly ViewerSketchReferenceCandidate[],
) {
  const positions = candidates.flatMap((candidate) =>
    candidate.kind === "point" && candidate.selected ? candidate.position : [],
  )
  return new Float32Array(positions)
}

function isViewerSketchLineCandidate(
  candidate: ViewerSketchReferenceCandidate,
): candidate is
  | ViewerSketchLineCandidate
  | ViewerSketchCurveCandidate
  | ViewerModelLineCandidate
  | ViewerModelCurveCandidate {
  return (
    candidate.kind === "line" ||
    candidate.kind === "curve" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  )
}

function sketchReferenceEntityId(
  candidate:
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate,
) {
  if (candidate.kind === "line") return candidate.sourceLineId
  if (candidate.kind === "curve") return candidate.sourceEntityId
  return candidate.candidateId
}

function sketchReferenceLinePositions(
  candidate:
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate,
) {
  if (candidate.kind === "line" || candidate.kind === "model-line") {
    return new Float32Array([...candidate.start, ...candidate.end])
  }
  const positions: number[] = []
  for (let index = 1; index < candidate.points.length; index += 1) {
    const start = candidate.points[index - 1]
    const end = candidate.points[index]
    if (start && end) positions.push(...start, ...end)
  }
  return new Float32Array(positions)
}

function sameSketchReferenceCandidate(
  left: ViewerSketchReferenceCandidate | null,
  right: ViewerSketchReferenceCandidate | null,
) {
  return viewerSketchReferenceCandidateKey(left) === viewerSketchReferenceCandidateKey(right)
}

function sameSketchReferenceCandidateStack(
  left: readonly ViewerSketchReferenceCandidate[],
  right: readonly ViewerSketchReferenceCandidate[],
) {
  return (
    left.length === right.length &&
    left.every(
      (candidate, index) =>
        viewerSketchReferenceCandidateKey(candidate) ===
        viewerSketchReferenceCandidateKey(right[index] ?? null),
    )
  )
}

type SketchReferenceHit = Readonly<{
  candidate: ViewerSketchReferenceCandidate
  distance: number
}>

export type ViewerSketchProfileHit = Readonly<{
  profile: ViewerSketchProfile
  distance: number
}>

type IdleSelectionTarget =
  | Readonly<{ kind: "edge"; candidate: ViewerEdgeCandidate }>
  | Readonly<{ kind: "profile"; profiles: readonly ViewerSketchProfile[] }>
  | Readonly<{ kind: "model"; selection: ViewerSelection }>
  | Readonly<{ kind: "empty" }>

function viewerEdgeCallbacks(options: GeometryViewportOptions) {
  return {
    selection: options.onEdgeSelectionChange ?? (() => undefined),
    preselection: options.onEdgePreselectionChange ?? (() => undefined),
    stack: options.onEdgeCandidateStackChange ?? (() => undefined),
  }
}

export function orderedUniqueViewerSketchProfiles(
  hits: readonly ViewerSketchProfileHit[],
  limit = MAX_SELECTION_CANDIDATES,
) {
  const safeLimit = Math.max(0, Math.floor(limit))
  const sorted = [...hits].sort(
    (left, right) =>
      (Number.isFinite(left.distance) ? left.distance : Infinity) -
        (Number.isFinite(right.distance) ? right.distance : Infinity) ||
      viewerSketchProfileKey(left.profile.selector).localeCompare(
        viewerSketchProfileKey(right.profile.selector),
      ),
  )
  const seen = new Set<string>()
  const profiles: ViewerSketchProfile[] = []
  for (const hit of sorted) {
    const key = viewerSketchProfileKey(hit.profile.selector)
    if (seen.has(key)) continue
    seen.add(key)
    profiles.push(hit.profile)
    if (profiles.length >= safeLimit) break
  }
  return profiles
}

function orderedUniqueSketchReferenceCandidates(hits: SketchReferenceHit[]) {
  hits.sort(
    (left, right) =>
      left.distance - right.distance ||
      viewerSketchReferenceCandidateKey(left.candidate).localeCompare(
        viewerSketchReferenceCandidateKey(right.candidate),
      ),
  )
  const candidates: ViewerSketchReferenceCandidate[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const key = viewerSketchReferenceCandidateKey(hit.candidate)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(hit.candidate)
  }
  return candidates
}

function orientOriginPlane(mesh: Mesh, plane: ViewerOriginPlane) {
  if (plane === "xz") mesh.rotation.x = Math.PI / 2
  if (plane === "yz") mesh.rotation.y = Math.PI / 2
}

class ThreeGeometryViewport implements GeometryViewport {
  readonly #canvas: HTMLCanvasElement
  readonly #renderer: WebGLRenderer
  readonly #scene = new Scene()
  readonly #camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10_000)
  #surfaceTextureBrush: ViewerSurfaceTextureBrush | null = null
  #surfaceTextureBrushActive = false
  #surfaceTexturePointer: number | null = null
  #surfaceTextureLastPoint: Vector3 | null = null
  #surfaceTextureControlsEnabled = true
  readonly #orientationScene = new Scene()
  readonly #orientationCamera = new PerspectiveCamera(35, 1, 0.1, 10)
  readonly #orientationMarker = new OrientationMarker()
  readonly #orientationInteraction: OrientationInsetInteraction
  #controls: OrbitControls
  readonly #translationControls: TransformControls
  readonly #translationObject = new Object3D()
  readonly #translationHelper: Object3D
  readonly #angularGizmoGroup = new Group()
  readonly #angularGizmoLineMaterial = new LineBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    depthWrite: false,
  })
  readonly #angularGizmoHandleMaterial = new PointsMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    depthWrite: false,
    size: 10,
    sizeAttenuation: false,
  })
  #sectionPlanes: Plane[] | null = null
  #section: ViewerSection | null = null
  readonly #sectionDecoration: SectionViewDecoration
  readonly #toolPlaneDecoration = new ToolPlaneDecoration()
  readonly #printDecoration = new PrintBedDecoration(() => this.#render())
  readonly #infiniteGrid = new InfiniteGridDecoration(() => this.#render())
  readonly #analysisDecoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry, () =>
    this.#render(),
  )
  readonly #sketchGroup = new Group()
  readonly #sketchProfileGroup = new Group()
  readonly #sketchProfilePreselectionGroup = new Group()
  readonly #sketchProfileSelectionGroup = new Group()
  readonly #sketchPointCandidateGroup = new Group()
  readonly #sketchPointPreselectionGroup = new Group()
  readonly #originPlaneGroup = new Group()
  readonly #featurePreselectionGroup = new Group()
  readonly #featureSelectionGroup = new Group()
  readonly #preselectionGroup = new Group()
  readonly #selectionGroup = new Group()
  readonly #faceSelectionGroup = new Group()
  readonly #raycaster = new Raycaster()
  readonly #pointer = new Vector2()
  readonly #meshSources = new Map<string, ViewerMesh>()
  readonly #surfaceMeshes: Mesh[] = []
  readonly #textureSourceMeshes = new Map<string, { surface: Mesh; source: ViewerMesh }>()
  readonly #originPlaneMeshes = new Map<Mesh, ViewerOriginPlane>()
  readonly #originPlaneMeshesByPlane = new Map<ViewerOriginPlane, Mesh>()
  readonly #originPlaneEdges = new Map<LineSegments, ViewerOriginPlane>()
  readonly #originPlaneEdgesByPlane = new Map<
    ViewerOriginPlane,
    LineSegments<BufferGeometry, LineBasicMaterial>
  >()
  readonly #originPlaneMaterials = new Map<ViewerOriginPlane, MeshBasicMaterial>()
  readonly #originPlaneEdgeMaterials: LineBasicMaterial[] = []
  readonly #sketchCurveMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    transparent: true,
    opacity: 0.96,
  })
  readonly #sketchConstructionCurveMaterial = new LineDashedMaterial({
    color: new Color("#65a9ee"),
    dashSize: 4,
    depthTest: false,
    gapSize: 3,
    transparent: true,
    opacity: 0.55,
  })
  readonly #sketchVertexMask = sketchPointMask("circle")
  readonly #sketchControlMask = sketchPointMask("diamond")
  readonly #sketchControlHandleMaterial = new LineDashedMaterial({
    color: new Color("#65a9ee"),
    dashSize: 0.7,
    gapSize: 0.5,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.65,
  })
  readonly #sketchControlPointMaterial = new PointsMaterial({
    color: new Color("#65a9ee"),
    alphaMap: this.#sketchControlMask,
    alphaTest: 0.5,
    depthTest: false,
    depthWrite: false,
    size: 10,
    sizeAttenuation: false,
  })
  readonly #sketchPointMaterial = new PointsMaterial({
    color: new Color("#d7ebff"),
    alphaMap: this.#sketchVertexMask,
    alphaTest: 0.5,
    depthTest: false,
    size: 5,
    sizeAttenuation: false,
  })
  readonly #sketchConstructionPointMaterial = new PointsMaterial({
    color: new Color("#65a9ee"),
    alphaMap: this.#sketchVertexMask,
    alphaTest: 0.5,
    depthTest: false,
    opacity: 0.55,
    size: 4,
    sizeAttenuation: false,
    transparent: true,
  })
  readonly #sketchPointCandidateMaterial = new PointsMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    size: 10,
    sizeAttenuation: false,
    transparent: true,
  })
  readonly #sketchPointPreselectionMaterial = new PointsMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    size: 14,
    sizeAttenuation: false,
  })
  readonly #sketchLineCandidateMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    transparent: true,
  })
  readonly #sketchLinePreselectionMaterial = new LineBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
  })
  readonly #selectedReferenceEdgeMaterial = new LineMaterial({
    color: new Color("#f59e0b"),
    linewidth: 4,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  readonly #hoveredReferenceEdgeMaterial = new LineMaterial({
    color: new Color("#65a9ee"),
    linewidth: 6,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  readonly #previewSurfaceMaterial = new MeshBasicMaterial({
    color: new Color("#4c8dff"),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #previewEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.9,
  })
  readonly #datumSurfaceMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #datumEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.8,
  })
  readonly #onEdgePreparationError: GeometryViewportOptions["onEdgePreparationError"]
  readonly #edgePreparation = createBrowserEdgePreparation((error) =>
    (this.#onEdgePreparationError ?? console.error)(error),
  )
  readonly #modelPresentation = new ModelMeshPresentation(
    {
      preview: { surface: this.#previewSurfaceMaterial, edges: this.#previewEdgeMaterial },
      datum: { surface: this.#datumSurfaceMaterial, edges: this.#datumEdgeMaterial },
    },
    this.#edgePreparation,
    () => this.#render(),
  )
  readonly #modelGroup = this.#modelPresentation.group
  readonly #preselectionMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: DoubleSide,
  })
  readonly #selectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    side: DoubleSide,
  })
  readonly #sketchProfileMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #sketchProfilePreselectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #sketchProfileSelectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #featurePreselectionMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0.14,
    side: DoubleSide,
    transparent: true,
  })
  readonly #featurePreselectionEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    opacity: 0.76,
    transparent: true,
  })
  readonly #featureSelectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    depthWrite: false,
    opacity: 0.22,
    side: DoubleSide,
    transparent: true,
  })
  readonly #featureSelectionEdgeMaterial = new LineBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    opacity: 0.96,
    transparent: true,
  })
  readonly #faceSelectionPresentation = new FaceHighlightPresentation(
    this.#faceSelectionGroup,
    this.#selectionMaterial,
    this.#meshSources,
  )
  readonly #featurePreselectionPresentation = new FeatureHighlightPresentation(
    this.#featurePreselectionGroup,
    this.#modelPresentation,
    this.#featurePreselectionMaterial,
    this.#featurePreselectionEdgeMaterial,
    2,
  )
  readonly #featureSelectionPresentation = new FeatureHighlightPresentation(
    this.#featureSelectionGroup,
    this.#modelPresentation,
    this.#featureSelectionMaterial,
    this.#featureSelectionEdgeMaterial,
    3,
  )
  readonly #hoverPicking = new PointerHoverPicking((event) => {
    if (!this.#disposed) this.#updatePointerPreselection(event)
  })
  readonly #resizeObserver: ResizeObserver
  readonly #orientationInsetOffsetElement: GeometryViewportOptions["orientationInsetOffsetElement"]
  readonly #onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void
  readonly #onOriginPlaneSelectionChange: (plane: ViewerOriginPlane | null) => void
  readonly #onSelectionChange: (selection: ViewerSelection | null) => void
  readonly #onEdgeSelectionChange: (candidate: ViewerEdgeCandidate | null) => void
  readonly #edgePresentation: EdgePresentation
  #edgeSelection: ViewerEdgeCandidate | null = null
  readonly #onSelectionCandidateStackChange: (candidates: readonly ViewerSelection[]) => void
  readonly #onSelectionCandidateStackCommit: (candidates: readonly ViewerSelection[]) => void
  readonly #onSketchReferenceCandidateStackChange: (
    candidates: readonly ViewerSketchReferenceCandidate[],
  ) => void
  readonly #onSketchReferencePreselectionChange: (
    candidate: ViewerSketchReferenceCandidate | null,
  ) => void
  readonly #onSketchReferenceSelectionChange: (candidate: ViewerSketchReferenceCandidate) => void
  readonly #onSketchProfileCandidateStackChange: (
    candidates: readonly ViewerSketchProfile[],
  ) => void
  readonly #onSketchProfileCandidateStackCommit: (
    candidates: readonly ViewerSketchProfile[],
  ) => void
  readonly #onSketchProfilePreselectionChange: (profile: ViewerSketchProfile | null) => void
  readonly #onSketchProfileSelectionChange: (
    profile: ViewerSketchProfile | null,
    intent: ViewerSketchProfileSelectionIntent,
  ) => void
  readonly #onTranslationGizmoPositionChange: ((position: ViewerVector3) => void) | undefined
  readonly #onAxialGizmoDistanceChange: ((distance: number) => void) | undefined
  readonly #onAngularGizmoAngleChange: ((angle: number) => void) | undefined
  readonly #translationPositionPublisher: ReturnType<
    typeof createLatestFramePublisher<ViewerVector3>
  >
  readonly #axialDistancePublisher: ReturnType<typeof createLatestFramePublisher<number>>
  readonly #angularAnglePublisher: ReturnType<typeof createLatestFramePublisher<number>>
  readonly #isSelectionCandidateEligible: (selection: ViewerSelection) => boolean
  #viewHeight = DEFAULT_VIEW_HEIGHT
  #controlsNavigationOrientation: Quaternion | null = null
  #controlsNavigationPivot: Vector3 | null = null
  #pointerOrbitPivot: Vector3 | null = null
  #disposed = false
  #pointerDown: Readonly<{ x: number; y: number; pointerId: number }> | null = null
  #originPlaneSelection: ViewerOriginPlane | null = null
  #originPlaneSelectionActive = false
  #originPlaneIdleSelectionEnabled = false
  #originPlanePreselection: ViewerOriginPlane | null = null
  #originPlaneVisibility: ViewerOriginPlaneVisibility = defaultViewerOriginPlaneVisibility
  #featurePreselection: ViewerFeatureHighlight = null
  #featureSelection: ViewerFeatureHighlight = null
  #preselection: ViewerSelection | null = null
  #selectionCandidateStack: readonly ViewerSelection[] = []
  #selectionCandidateStackPreserved = false
  #selection: ViewerSelection | null = null
  #sketchProfiles = new Map<Mesh, ViewerSketchProfile>()
  #sketchProfilePreselection: ViewerSketchProfile | null = null
  #sketchProfileSelections: readonly ViewerSketchProfile[] = []
  #sketchProfileCandidateStack: readonly ViewerSketchProfile[] = []
  #sketchPointCandidates: readonly (ViewerSketchPointCandidate | ViewerModelPointCandidate)[] = []
  #sketchReferenceCandidateStack: readonly ViewerSketchReferenceCandidate[] = []
  #sketchPointObject: Points | null = null
  #sketchLineObjects = new Map<
    LineSegments,
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate
  >()
  #sketchPointPreselection: ViewerSketchReferenceCandidate | null = null
  #interactionMode: ViewerInteractionMode = "select"
  #sketchProjection: Readonly<{ bounds: ViewerSketchProjectionBounds }> | null = null
  #sketchPlaneFrame: ViewerFrame | null = null
  #sketchPlaneProjectionCallback:
    | ((projection: ViewerSketchPlaneProjection | null) => void)
    | undefined
  #lastSketchPlaneProjection: ViewerSketchPlaneProjection | null | undefined
  #sketchNavigationElement: HTMLElement | SVGSVGElement | null = null
  #sketchContextMenuControlsEnabled: boolean | null = null
  #sketchNavigationControlsEnabledBeforePointer: boolean | null = null
  #sketchNavigationPointerId: number | null = null
  #pointerOrbit = false
  #pointerOrbitPosition: Vector2 | null = null
  #translationGizmoInteracting = false
  #translationGizmoHidePending = false
  #translationGizmoPointerId: number | null = null
  #axialGizmo: ViewerAxialGizmo | null = null
  #angularGizmo: ViewerAngularGizmo | null = null
  #angularGizmoHandle: Points | null = null
  #angularGizmoInteracting = false
  #angularGizmoStartAngle = 0
  #angularGizmoPointerId: number | null = null
  #skipTranslationGizmoPointerUp = false
  #orbitControlsEnabledBeforeTranslation = true

  constructor(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
    this.#canvas = canvas
    this.#onEdgePreparationError = options.onEdgePreparationError
    this.#orientationInsetOffsetElement = options.orientationInsetOffsetElement
    const sketchProfileCallbacks = viewerSketchProfileCallbacks(options)
    this.#isSelectionCandidateEligible = viewerSelectionEligibilityCallback(
      options.isSelectionCandidateEligible,
    )
    this.#onOriginPlanePreselectionChange =
      options.onOriginPlanePreselectionChange ?? (() => undefined)
    this.#onOriginPlaneSelectionChange = options.onOriginPlaneSelectionChange ?? (() => undefined)
    this.#onSelectionChange = options.onSelectionChange ?? (() => undefined)
    const edgeCallbacks = viewerEdgeCallbacks(options)
    this.#onEdgeSelectionChange = edgeCallbacks.selection
    this.#edgePresentation = new EdgePresentation({
      preselection: edgeCallbacks.preselection,
      stack: edgeCallbacks.stack,
      changed: () => this.#render(),
    })
    this.#onSelectionCandidateStackChange = viewerSelectionStackCallback(
      options.onSelectionCandidateStackChange,
    )
    this.#onSelectionCandidateStackCommit = viewerSelectionStackCallback(
      options.onSelectionCandidateStackCommit,
    )
    this.#onSketchReferenceCandidateStackChange =
      options.onSketchReferenceCandidateStackChange ?? (() => undefined)
    this.#onSketchReferencePreselectionChange =
      options.onSketchReferencePreselectionChange ?? (() => undefined)
    this.#onSketchReferenceSelectionChange =
      options.onSketchReferenceSelectionChange ?? (() => undefined)
    this.#onSketchProfileCandidateStackChange = sketchProfileCallbacks.candidateStackChange
    this.#onSketchProfileCandidateStackCommit = sketchProfileCallbacks.candidateStackCommit
    this.#onSketchProfilePreselectionChange = sketchProfileCallbacks.preselection
    this.#onSketchProfileSelectionChange = sketchProfileCallbacks.selection
    this.#onTranslationGizmoPositionChange = options.onTranslationGizmoPositionChange
    this.#onAxialGizmoDistanceChange = options.onAxialGizmoDistanceChange
    this.#onAngularGizmoAngleChange = options.onAngularGizmoAngleChange
    this.#translationPositionPublisher = createLatestFramePublisher((position: ViewerVector3) =>
      this.#onTranslationGizmoPositionChange?.(position),
    )
    this.#axialDistancePublisher = createLatestFramePublisher((distance: number) =>
      this.#onAxialGizmoDistanceChange?.(distance),
    )
    this.#angularAnglePublisher = createLatestFramePublisher((angle: number) =>
      this.#onAngularGizmoAngleChange?.(angle),
    )
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    })
    if (!context) throw new Error("WebGL2 is unavailable.")
    this.#renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true })
    this.#renderer.localClippingEnabled = true
    this.#renderer.setClearAlpha(0)
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.#scene.add(this.#printDecoration.bed, this.#infiniteGrid.mesh)
    this.#scene.add(this.#analysisDecoration.group)
    this.#scene.add(this.#modelGroup)
    this.#scene.add(this.#edgePresentation.group)
    this.#scene.add(this.#sketchGroup)
    this.#scene.add(this.#sketchProfileGroup)
    this.#scene.add(this.#sketchProfilePreselectionGroup)
    this.#scene.add(this.#sketchProfileSelectionGroup)
    this.#scene.add(this.#sketchPointCandidateGroup)
    this.#scene.add(this.#sketchPointPreselectionGroup)
    this.#createOriginPlanes()
    this.#scene.add(this.#originPlaneGroup)
    this.#scene.add(this.#featurePreselectionGroup)
    this.#scene.add(this.#featureSelectionGroup)
    this.#scene.add(this.#preselectionGroup)
    this.#scene.add(this.#selectionGroup)
    this.#scene.add(this.#faceSelectionGroup)
    this.#scene.add(this.#translationObject)
    this.#scene.add(this.#angularGizmoGroup)
    this.#orientationScene.add(this.#orientationMarker.group)
    this.#scene.add(new AmbientLight(0xffffff, 1.6))
    const keyLight = new DirectionalLight(0xffffff, 2.8)
    keyLight.position.set(3, -4, 6)
    this.#scene.add(keyLight)
    const fillLight = new DirectionalLight(0x8eb8df, 1.2)
    fillLight.position.set(-4, 2, 3)
    this.#scene.add(fillLight)

    this.#camera.up.set(0, 0, 1)
    this.#camera.position.set(80, -80, 65)
    // Claim gizmo pointer-downs before OrbitControls can start tracking the same gesture.
    this.#translationControls = new TransformControls(this.#camera, canvas)
    this.#translationControls.setMode("translate")
    this.#translationControls.setSpace("world")
    this.#translationHelper = this.#translationControls.getHelper()
    this.#translationHelper.visible = false
    this.#scene.add(this.#translationHelper)
    this.#controls = this.#createOrbitControls(new Vector3(), true)
    this.#orientationInteraction = new OrientationInsetInteraction({
      canvas,
      placement: () => this.#orientationInsetPlacement(),
      inputElement: () => options.orientationInputElement?.() ?? null,
      navigationEnabled: () => this.#controls.enabled,
      setNavigationEnabled: (enabled) => {
        if (!enabled) this.#hoverPicking.cancel()
        this.#controls.enabled = enabled
      },
      onStart: () => {
        this.#edgePresentation.clearPicking()
        this.#pointerOrbitPivot = this.#modelOrbitPivot()
        this.#pointerDown = null
        this.#onNavigationStart()
      },
      onNavigationStart: () => {
        this.#sketchProjection = null
        options.onOrientationNavigationStart?.()
      },
      rotate: (dx, dy) => this.#rotatePointerOrbit(dx, dy),
      axisAt: ({ x, y }) => {
        this.#updateOrientationCamera()
        return this.#orientationMarker.axisAt(new Vector2(x, y), this.#orientationCamera)
      },
      activate: (axis) => this.setStandardView(orientationAxisViews[axis]),
    })
    this.#sectionDecoration = new SectionViewDecoration({
      canvas,
      camera: this.#camera,
      canInteract: () =>
        this.#interactionMode === "select" &&
        !this.#pointerOrbit &&
        !this.#translationGizmoInteracting &&
        !this.#angularGizmoInteracting &&
        !this.#surfaceTextureBrush,
      navigationEnabled: () => this.#controls.enabled,
      setNavigationEnabled: (enabled) => {
        if (!enabled) this.#hoverPicking.cancel()
        this.#controls.enabled = enabled
      },
      onChange: (section) => {
        this.setSection(section)
        options.onSectionChange?.(section)
      },
      render: this.#render,
    })
    this.#scene.add(this.#sectionDecoration.group)
    this.#scene.add(this.#toolPlaneDecoration.group)
    this.#translationControls.addEventListener("change", this.#onTranslationControlsChange)
    this.#translationControls.addEventListener("objectChange", this.#onTranslationObjectChange)
    this.#translationControls.addEventListener("mouseDown", this.#onTranslationControlsMouseDown)
    this.#translationControls.addEventListener("mouseUp", this.#onTranslationControlsMouseUp)
    this.#raycaster.params.Points.threshold = 2
    this.#raycaster.params.Line.threshold = 2
    canvas.addEventListener("pointerdown", this.#onPointerDown, true)
    canvas.addEventListener("pointermove", this.#onPointerMove)
    document.addEventListener("pointermove", this.#onPointerOrbitMove)
    window.addEventListener("blur", this.#onNavigationBlur)
    window.addEventListener("pointerup", this.#onTranslationPointerUpCapture, true)
    canvas.addEventListener("pointerup", this.#onPointerUp)
    canvas.addEventListener("pointerleave", this.#onPointerLeave)
    canvas.addEventListener("pointercancel", this.#cancelSurfaceTextureStroke)
    canvas.addEventListener("lostpointercapture", this.#cancelSurfaceTextureStroke)
    document.addEventListener("keydown", this.#surfaceTextureKeyDown, true)
    window.addEventListener("blur", this.#cancelSurfaceTextureStroke)
    canvas.addEventListener("pointercancel", this.#onTranslationGestureCancel)
    canvas.addEventListener("lostpointercapture", this.#onTranslationCaptureLost)
    document.addEventListener("keydown", this.#onTranslationGestureKeyDown, true)
    window.addEventListener("blur", this.#cancelTranslationGesture)

    this.#resizeObserver = this.#observeLayout(canvas)
  }

  #createOrbitControls(target: Vector3, enabled: boolean) {
    this.#onControlsEnd()
    const position = this.#camera.position.clone()
    const controls = new OrbitControls(this.#camera, null)
    controls.enableDamping = false
    controls.zoomToCursor = true
    controls.mouseButtons.LEFT = MOUSE.ROTATE
    controls.mouseButtons.MIDDLE = MOUSE.ROTATE
    controls.mouseButtons.RIGHT = MOUSE.PAN
    controls.target.copy(target)
    this.#camera.position.copy(position)
    controls.enabled = enabled
    controls.connect(this.#canvas)
    controls.update()
    controls.addEventListener("change", this.#onControlsChange)
    controls.addEventListener("start", this.#onControlsStart)
    controls.addEventListener("end", this.#onControlsEnd)
    return controls
  }

  #setCameraUp(up: ViewerVector3) {
    if (this.#camera.up.equals(new Vector3(...up))) return
    const target = this.#controls.target.clone()
    const navigationElement = this.#sketchNavigationElement
    this.#removeSketchNavigationPointerGuard()
    const enabled = this.#controls.enabled
    this.#controls.removeEventListener("change", this.#onControlsChange)
    this.#controls.removeEventListener("start", this.#onControlsStart)
    this.#controls.removeEventListener("end", this.#onControlsEnd)
    this.#controls.dispose()
    this.#camera.up.set(...up)
    // OrbitControls caches its orbit-axis transform at construction.
    this.#controls = this.#createOrbitControls(target, enabled)
    this.#sketchNavigationElement = null
    if (navigationElement) this.setSketchNavigationElement(navigationElement)
  }

  #observeLayout(canvas: HTMLCanvasElement) {
    const observer = new ResizeObserver((entries) => {
      const canvasEntry = entries.find((entry) => entry.target === canvas)
      if (canvasEntry) this.#resize(canvasEntry.contentRect.width, canvasEntry.contentRect.height)
      else this.#render()
    })
    observer.observe(canvas)
    if (this.#orientationInsetOffsetElement) {
      observer.observe(this.#orientationInsetOffsetElement)
    }
    return observer
  }

  setToolPlane(plane: ViewerToolPlane | null) {
    if (this.#disposed) return
    this.#toolPlaneDecoration.setPlane(plane)
    this.#render()
  }

  captureImage() {
    if (this.#disposed) throw new Error("The viewport is unavailable.")
    const background = this.#canvas.parentElement
      ? getComputedStyle(this.#canvas.parentElement).backgroundColor
      : "transparent"
    return captureViewportImage(this.#canvas, this.#renderNow, background)
  }

  setSection(section: ViewerSection | null) {
    if (this.#disposed) return
    if (sameViewerSection(this.#section, section)) return
    this.#hoverPicking.cancel()
    this.#sectionPlanes = sectionClipPlanes(section)
    this.#section = section
    this.#sectionDecoration.setSection(section)
    this.#edgePresentation.setClipping(this.#sectionPlanes)
    this.#clearEdgeSelection()
    this.clearSelection()
    this.#applySectionClipping()
    this.#setPreselection(null)
    this.#render()
  }

  setPrintBed(bed: ViewerPrintBed | null) {
    if (this.#disposed) return
    this.#printDecoration.setBed(bed)
    this.#render()
  }

  setGroundGrid(enabled: boolean) {
    if (this.#disposed) return
    this.#infiniteGrid.setEnabled(enabled)
    this.#render()
  }

  setMeshes(meshes: readonly ViewerMesh[]) {
    this.#hoverPicking.cancel()
    if (this.#disposed) return
    this.#selectionCandidateStackPreserved = false
    this.#clearSelectionCandidateStack()
    this.clearSelection()
    this.#faceSelectionPresentation.clear()
    this.#setPreselection(null)
    this.#clearEdgeSelection()
    this.#surfaceMeshes.length = 0
    this.#textureSourceMeshes.clear()
    this.#meshSources.clear()
    const entries = this.#modelPresentation.setMeshes(meshes)
    this.#edgePresentation.setBodies(entries)
    const sectionBounds = new Box3()
    for (const { source, surface, textureSource } of entries) {
      if (
        source.appearance !== "datum" &&
        source.appearance !== "selection-source" &&
        surface.geometry.boundingBox
      )
        sectionBounds.union(surface.geometry.boundingBox)
      if (source.appearance === "preview") continue
      this.#meshSources.set(viewerBodyKey(source), source)
      this.#surfaceMeshes.push(surface)
      if (textureSource) this.#textureSourceMeshes.set(viewerBodyKey(source), textureSource)
    }
    this.#sectionDecoration.setMeshes(meshes, sectionBounds)
    this.#featureSelectionPresentation.setMeshes(viewerHighlightMeshes(this.#featureSelection))
    this.#featurePreselectionPresentation.setMeshes(
      viewerHighlightMeshes(this.#featurePreselection),
    )
    this.#render()
  }

  setEdgeCandidates(candidates: readonly ViewerEdgeCandidate[]) {
    if (this.#disposed) return
    this.#hoverPicking.cancel()
    const selection = this.#edgeSelection
    if (
      selection &&
      !candidates.some(
        (candidate) =>
          viewerBodyKey(candidate) === viewerBodyKey(selection) &&
          candidate.candidateId === selection.candidateId,
      )
    )
      this.#clearEdgeSelection()
    this.#edgePresentation.setCandidates(candidates)
  }

  setEdgePreselection(candidate: ViewerEdgeCandidate | null) {
    if (this.#disposed) return
    this.#edgePresentation.setPreselection(candidate)
  }

  #updateEdgeMode() {
    this.#edgePresentation.setEnabled(
      this.#interactionMode === "select" &&
        !this.#originPlaneSelectionActive &&
        !this.#surfaceTextureBrush &&
        !this.#surfaceTextureBrushActive,
    )
  }

  #clearEdgeSelection() {
    if (!this.#edgeSelection) return
    this.#edgeSelection = null
    this.#onEdgeSelectionChange(null)
  }

  setFeaturePreselection(mesh: ViewerFeatureHighlight) {
    if (this.#disposed) return
    const selected = new Set(viewerHighlightMeshes(this.#featureSelection).map(viewerBodyKey))
    const visible = viewerHighlightMeshes(mesh).filter((item) => !selected.has(viewerBodyKey(item)))
    this.#featurePreselection = visible
    if (this.#featurePreselectionPresentation.setMeshes(visible)) this.#render()
  }

  setFeatureSelection(mesh: ViewerFeatureHighlight) {
    if (this.#disposed) return
    this.#featureSelection = mesh
    if (this.#featureSelectionPresentation.setMeshes(viewerHighlightMeshes(mesh))) this.#render()
    this.setFeaturePreselection(this.#featurePreselection)
  }

  setSketches(sketches: readonly ViewerSketch[]) {
    if (this.#disposed) return
    this.#clearSketchProfileCandidateStack()
    disposeModelGroup(this.#sketchGroup)
    disposeModelGroup(this.#sketchProfileGroup)
    disposeModelGroup(this.#sketchProfilePreselectionGroup)
    disposeModelGroup(this.#sketchProfileSelectionGroup)
    this.#sketchProfiles.clear()
    this.#setSketchProfilePreselection(null, false)
    this.#setSketchProfileSelections([], false)
    for (const sketch of sketches) {
      this.#addSketchGeometry(sketch)
      this.#addSketchProfiles(sketch)
    }
    this.#render()
  }

  #addSketchGeometry(sketch: ViewerSketch) {
    const highlight = sketch.selected
      ? this.#featureSelectionEdgeMaterial
      : sketch.preselected
        ? this.#featurePreselectionEdgeMaterial
        : null
    this.#addSketchLines(
      sketch.sketchId,
      "curves",
      sketch.curvePositions,
      highlight ?? this.#sketchCurveMaterial,
    )
    this.#addSketchLines(
      sketch.sketchId,
      "construction-curves",
      sketch.constructionCurvePositions,
      highlight ?? this.#sketchConstructionCurveMaterial,
      true,
    )
    this.#addSketchPoints(
      sketch.sketchId,
      "points",
      sketch.pointPositions,
      highlight ? this.#sketchPointPreselectionMaterial : this.#sketchPointMaterial,
    )
    this.#addSketchPoints(
      sketch.sketchId,
      "construction-points",
      sketch.constructionPointPositions,
      this.#sketchConstructionPointMaterial,
    )
    this.#addSketchControls(sketch)
  }

  #addSketchProfiles(sketch: ViewerSketch) {
    if (sketch.frame && sketch.profiles) {
      for (const profile of sketch.profiles) {
        const geometry = createViewerSketchProfileGeometry(profile, sketch.frame)
        if (!geometry) continue
        const mesh = new Mesh(geometry, this.#sketchProfileMaterial)
        mesh.name = `sketch-profile:${viewerSketchProfileKey(profile.selector)}`
        mesh.renderOrder = 3
        this.#sketchProfileGroup.add(mesh)
        this.#sketchProfiles.set(mesh, profile)
      }
    }
  }

  #sketchReferenceLineMaterial(candidate: ViewerSketchReferenceCandidate) {
    if (candidate.kind !== "model-curve" || candidate.sourceType !== "edge")
      return this.#sketchLineCandidateMaterial
    return candidate.selected ? this.#featureSelectionEdgeMaterial : this.#sketchCurveMaterial
  }

  setSketchReferenceCandidates(candidates: readonly ViewerSketchReferenceCandidate[]) {
    if (this.#disposed) return
    this.#clearSketchReferencePicking()
    disposeModelGroup(this.#sketchPointCandidateGroup)
    this.#sketchPointCandidates = candidates.filter(isViewerSketchPointCandidate)
    this.#sketchLineObjects.clear()
    this.#sketchPointObject = null
    if (this.#sketchPointCandidates.length > 0) {
      const positions = new Float32Array(this.#sketchPointCandidates.length * 3)
      for (const [index, candidate] of this.#sketchPointCandidates.entries()) {
        positions.set(candidate.position, index * 3)
      }
      const points = new Points(
        createViewerSketchGeometry(positions),
        this.#sketchPointCandidateMaterial,
      )
      points.name = "sketch-reference-candidates"
      points.renderOrder = 8
      this.#sketchPointObject = points
      this.#sketchPointCandidateGroup.add(points)
    }
    const selectedPointPositions = selectedViewerSketchPointPositions(candidates)
    if (selectedPointPositions.length > 0) {
      const points = new Points(
        createViewerSketchGeometry(selectedPointPositions),
        this.#sketchPointPreselectionMaterial,
      )
      points.name = "selected-sketch-reference-points"
      points.renderOrder = 9
      this.#sketchPointCandidateGroup.add(points)
    }
    for (const candidate of candidates) {
      if (!isViewerSketchLineCandidate(candidate)) continue
      this.#addSketchReferenceLine(candidate)
    }
    this.#render()
  }

  setSketchReferencePreselection(candidate: ViewerSketchReferenceCandidate | null) {
    if (this.#disposed) return
    this.#setSketchPointPreselection(candidate)
  }

  #addSketchReferenceLine(candidate: Parameters<typeof sketchReferenceLinePositions>[0]) {
    const line = new LineSegments(
      createViewerSketchGeometry(sketchReferenceLinePositions(candidate)),
      this.#sketchReferenceLineMaterial(candidate),
    )
    line.name = `sketch-reference-${candidate.kind}:${sketchReferenceEntityId(candidate)}`
    line.renderOrder = 8
    this.#sketchLineObjects.set(line, candidate)
    this.#sketchPointCandidateGroup.add(line)
    if (candidate.kind === "model-curve" && candidate.sourceType === "edge" && candidate.selected)
      this.#addReferenceEdgeStroke(
        this.#sketchPointCandidateGroup,
        candidate,
        this.#selectedReferenceEdgeMaterial,
      )
  }

  #addReferenceEdgeStroke(
    group: Group,
    candidate: Extract<ViewerSketchReferenceCandidate, { kind: "model-curve" }>,
    material: LineMaterial,
  ) {
    const geometry = new LineSegmentsGeometry().setPositions(
      sketchReferenceLinePositions(candidate),
    )
    const stroke = new LineSegments2(geometry, material)
    stroke.renderOrder = 10
    group.add(stroke)
  }

  setSketchProfilePreselection(profile: ViewerSketchProfile | null) {
    if (this.#disposed) return
    this.#setSketchProfilePreselection(profile, false)
  }

  setSketchProfileSelection(profile: ViewerSketchProfile | null) {
    if (this.#disposed) return
    this.#setSketchProfileSelections(profile ? [profile] : [], false)
  }

  setSketchProfileSelections(profiles: readonly ViewerSketchProfile[]) {
    if (this.#disposed) return
    this.#setSketchProfileSelections(profiles, false)
  }

  setOriginPlaneSelection(
    selectedPlane: ViewerOriginPlane | null,
    active = selectedPlane !== null,
    idleSelectionEnabled = false,
  ) {
    if (
      this.#disposed ||
      (selectedPlane === this.#originPlaneSelection &&
        active === this.#originPlaneSelectionActive &&
        idleSelectionEnabled === this.#originPlaneIdleSelectionEnabled)
    ) {
      return
    }
    this.#hoverPicking.cancel()
    this.#originPlaneSelection = selectedPlane
    this.#originPlaneSelectionActive = active
    this.#updateEdgeMode()
    this.#originPlaneIdleSelectionEnabled = idleSelectionEnabled
    if (!active) this.#selectionCandidateStackPreserved = false
    this.#clearSelectionCandidateStack()
    this.#setOriginPlanePreselection(null)
    if (active) {
      this.clearSelection()
      this.#setPreselection(null)
      this.#setSketchProfilePreselection(null)
    }
    if (!active && !idleSelectionEnabled) this.#setOriginPlanePreselection(null)
    this.#updateOriginPlanes()
    this.#render()
  }

  setOriginPlaneVisibility(visibility: ViewerOriginPlaneVisibility) {
    if (this.#disposed) return
    this.#originPlaneVisibility = visibility
    this.#updateOriginPlanes()
    this.#render()
  }

  showTranslationGizmo(position: ViewerVector3) {
    if (this.#disposed || !isFiniteViewerVector3(position)) return
    this.#translationGizmoHidePending = false
    this.hideAngularGizmo()
    this.#axialDistancePublisher.cancel()
    this.#axialGizmo = null
    this.#translationControls.setSpace("world")
    this.#translationControls.showX = true
    this.#translationControls.showY = true
    this.#translationControls.showZ = true
    this.#translationObject.position.set(...position)
    this.#translationObject.quaternion.identity()
    this.#translationObject.updateMatrixWorld()
    this.#translationHelper.visible = true
    this.#translationControls.attach(this.#translationObject)
    this.#render()
  }

  showAxialTranslationGizmo(gizmo: ViewerAxialGizmo) {
    const position = viewerAxialGizmoHandlePosition(gizmo)
    const direction = normalizedViewerDirection(gizmo.direction)
    if (this.#disposed || !position || !direction) return
    this.#translationGizmoHidePending = false
    this.hideAngularGizmo()
    this.#translationPositionPublisher.cancel()
    this.#axialGizmo = { ...gizmo, direction: [direction.x, direction.y, direction.z] }
    this.#translationControls.setSpace("local")
    this.#translationControls.showX = false
    this.#translationControls.showY = false
    this.#translationControls.showZ = true
    this.#translationObject.position.set(...position)
    this.#translationObject.quaternion.copy(
      new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction),
    )
    this.#translationObject.updateMatrixWorld()
    this.#translationHelper.visible = true
    this.#translationControls.attach(this.#translationObject)
    this.#render()
  }

  hideTranslationGizmo(options?: Readonly<{ preserveActiveGesture?: boolean }>) {
    if (this.#disposed) return
    if (this.#translationGizmoInteracting && options?.preserveActiveGesture) {
      this.#translationGizmoHidePending = true
      return
    }
    if (this.#translationGizmoInteracting) this.#cancelTranslationGesture()
    this.#translationGizmoHidePending = false
    this.#translationControls.detach()
    this.#translationHelper.visible = false
    this.#translationGizmoInteracting = false
    delete this.#canvas.dataset.translationGizmoDragging
    this.#skipTranslationGizmoPointerUp = false
    this.#pointerDown = null
    if (!this.#angularGizmoInteracting) {
      this.#controls.enabled = this.#orbitControlsEnabledBeforeTranslation
    }
    this.#translationControls.enabled = true
    this.#axialGizmo = null
    this.#translationPositionPublisher.cancel()
    this.#axialDistancePublisher.cancel()
    this.#render()
  }

  showAngularGizmo(gizmo: ViewerAngularGizmo) {
    const normalized = normalizedViewerAngularGizmo(gizmo)
    if (this.#disposed || !normalized) return
    this.hideTranslationGizmo()
    this.#angularGizmo = normalized
    this.#renderAngularGizmo()
  }

  hideAngularGizmo() {
    if (this.#disposed) return
    if (this.#angularGizmoInteracting) this.#finishAngularGizmoInteraction(false)
    this.#angularAnglePublisher.cancel()
    this.#angularGizmo = null
    this.#angularGizmoHandle = null
    delete this.#canvas.dataset.angularGizmoHandle
    disposeModelGroup(this.#angularGizmoGroup)
    this.#render()
  }

  setStandardView(view: ViewerStandardView) {
    if (this.#disposed) return
    this.#onNavigationBlur()
    const target = this.#controls.target.toArray() as [number, number, number]
    const distance = this.#camera.position.distanceTo(this.#controls.target)
    const pose = viewerCameraPoseForStandardView(view, target, distance)
    if (!pose) return
    this.#orientationInteraction.cancel()
    this.#clearSketchReferencePicking()
    this.#camera.position.set(...pose.position)
    this.#setCameraUp(pose.up)
    this.#controls.target.set(...pose.target)
    this.#controls.update()
    this.#render()
  }

  orientToFrame(frame: ViewerFrame) {
    if (this.#disposed) return false
    this.#clearSketchReferencePicking()
    const distance = this.#camera.position.distanceTo(this.#controls.target)
    const pose = viewerCameraPoseForFrame(frame, distance)
    if (!pose) return false
    this.#onNavigationBlur()
    this.#orientationInteraction.cancel()
    this.#controls.target.set(...pose.target)
    this.#camera.position.set(...pose.position)
    this.#setCameraUp(pose.up)
    this.#expandViewToScene(frame.origin)
    this.#updateProjection()
    this.#controls.update()
    this.#render()
    return true
  }

  setSketchPlaneProjection(
    frame: ViewerFrame | null,
    onChange?: (projection: ViewerSketchPlaneProjection | null) => void,
  ) {
    if (this.#disposed) return
    this.#sketchPlaneFrame = frame && isValidViewerFrame(frame) ? frame : null
    this.#sketchPlaneProjectionCallback = onChange
    this.#lastSketchPlaneProjection = undefined
    this.#publishSketchPlaneProjection()
  }

  setSketchNavigationElement(element: HTMLElement | SVGSVGElement | null) {
    if (this.#disposed || element === this.#sketchNavigationElement) return
    this.#onNavigationBlur()
    // The inset keeps canvas capture while normal sketch input switches to orbit input.
    this.#removeSketchNavigationPointerGuard()
    const target = this.#controls.target.clone()
    const enabled = this.#controls.enabled
    this.#controls.removeEventListener("change", this.#onControlsChange)
    this.#controls.removeEventListener("start", this.#onControlsStart)
    this.#controls.removeEventListener("end", this.#onControlsEnd)
    // Rebinding during a drag must also discard OrbitControls' tracked pointers.
    this.#controls.dispose()
    this.#controls = this.#createOrbitControls(target, enabled)
    this.#sketchNavigationElement = element
    if (element) {
      this.#controls.disconnect()
      this.#controls.connect(element)
      element.addEventListener("pointerdown", this.#onSketchNavigationPointerDown, true)
      element.addEventListener("pointerup", this.#onSketchNavigationPointerEnd, true)
      element.addEventListener("pointercancel", this.#onSketchNavigationPointerEnd, true)
      element.addEventListener("lostpointercapture", this.#onSketchNavigationPointerEnd, true)
      element.addEventListener("contextmenu", this.#onSketchContextMenuCapture, true)
      element.addEventListener("contextmenu", this.#onSketchContextMenuBubble)
    }
  }

  setSketchProjection(frame: ViewerFrame, bounds: ViewerSketchProjectionBounds) {
    if (this.#disposed) return false
    this.#clearSketchReferencePicking()
    const target = viewerSketchProjectionTarget(frame, bounds)
    if (!target) return false
    const distance = this.#camera.position.distanceTo(this.#controls.target)
    const pose = viewerCameraPoseForFrame({ ...frame, origin: target }, distance)
    if (!pose) return false
    this.#onNavigationBlur()
    this.#orientationInteraction.cancel()
    this.#sketchProjection = { bounds }
    this.#controls.target.set(...pose.target)
    this.#camera.position.set(...pose.position)
    this.#setCameraUp(pose.up)
    const aspect = this.#canvas.clientWidth / Math.max(this.#canvas.clientHeight, 1)
    this.#viewHeight = viewerSketchProjectionViewHeight(bounds, aspect)
    this.#camera.zoom = 1
    this.#updateProjection()
    this.#controls.update()
    this.#render()
    return true
  }

  setPointerOrbit(enabled: boolean) {
    if (this.#disposed || enabled === this.#pointerOrbit) return
    this.#hoverPicking.cancel()
    this.#onNavigationBlur()
    this.#orientationInteraction.cancel()
    this.#pointerOrbit = enabled
    this.#pointerOrbitPosition = null
    this.#pointerOrbitPivot = enabled ? this.#modelOrbitPivot() : null
    this.#pointerDown = null
    if (enabled) {
      this.#edgePresentation.clearPicking()
      this.#onNavigationStart()
    }
  }

  clearSketchProjection() {
    if (this.#disposed) return
    this.#sketchProjection = null
    this.#render()
  }

  setInteractionMode(mode: ViewerInteractionMode) {
    if (this.#disposed || mode === this.#interactionMode) return
    this.#hoverPicking.cancel()
    this.#interactionMode = mode
    this.#updateEdgeMode()
    this.#clearEdgeSelection()
    this.#clearSelectionCandidateStack()
    this.#clearSketchReferencePicking()
    this.#clearSketchProfileCandidateStack()
    if (mode !== "select") {
      this.#pointerDown = null
      this.#setOriginPlanePreselection(null)
      this.#setPreselection(null)
      this.#setSketchProfilePreselection(null)
      if (this.#selection) {
        this.#selection = null
        disposeModelGroup(this.#selectionGroup)
      }
      this.#render()
    }
  }

  fit() {
    this.#hoverPicking.cancel()
    if (this.#disposed) return
    this.#onNavigationBlur()
    this.#orientationInteraction.cancel()
    this.#edgePresentation.clearPicking()
    this.#clearSketchReferencePicking()
    this.#clearSketchProfileCandidateStack()
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#printDecoration.bed)
    // Fit supplies the complete visible span, independent of earlier wheel zoom.
    this.#camera.zoom = 1
    if (bounds.isEmpty()) {
      this.#viewHeight = DEFAULT_VIEW_HEIGHT
      this.#controls.target.set(0, 0, 0)
      this.#camera.position.set(80, -80, 65)
      this.#camera.near = 0.01
      this.#camera.far = 10_000
      this.#updateProjection()
      this.#controls.update()
      this.#render()
      return
    }
    const sphere = bounds.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 0.001)
    const direction = new Vector3(1, -1, 0.8).normalize()
    const distance = Math.max(radius * 4, 10)
    this.#viewHeight = Math.max(radius * 2 * FIT_PADDING, 1)
    this.#controls.target.copy(sphere.center)
    this.#camera.position.copy(sphere.center).addScaledVector(direction, distance)
    this.#updateProjection()
    this.#controls.update()
    this.#render()
  }

  clearSelection() {
    if (!this.#selection) return
    this.#selection = null
    disposeModelGroup(this.#selectionGroup)
    this.#onSelectionChange(null)
    this.#render()
  }

  setSelectionPreselection(selection: ViewerSelection | null) {
    if (this.#disposed) return
    this.#setPreselection(selection)
  }

  setFaceSelections(selections: readonly ViewerSelection[]) {
    if (this.#disposed || !this.#faceSelectionPresentation.setSelections(selections)) return
    this.#applySectionClipping()
    this.#render()
  }

  setAnalysisOverlays(overlays: readonly ViewerAnalysisOverlay[] | null) {
    if (this.#disposed) return
    this.#analysisDecoration.setOverlays(overlays)
    this.#analysisDecoration.setClipping(this.#sectionPlanes)
    this.#render()
  }

  setSelectionCandidateStackPreserved(preserved: boolean) {
    if (this.#disposed) return
    this.#selectionCandidateStackPreserved = preserved
  }

  dispose() {
    this.#hoverPicking.cancel()
    this.#sectionDecoration.dispose()
    this.#toolPlaneDecoration.dispose()
    this.#printDecoration.dispose()
    this.#infiniteGrid.dispose()
    this.#analysisDecoration.dispose()
    if (this.#disposed) return
    this.#disposed = true
    this.#edgePresentation.dispose()
    this.#orientationInteraction.dispose()
    this.#renderFrames.cancel()
    this.#textureSourceMeshes.clear()
    this.#finishSurfaceTextureStroke(true)
    this.#canvas.removeEventListener("pointercancel", this.#cancelSurfaceTextureStroke)
    this.#canvas.removeEventListener("lostpointercapture", this.#cancelSurfaceTextureStroke)
    document.removeEventListener("keydown", this.#surfaceTextureKeyDown, true)
    window.removeEventListener("blur", this.#cancelSurfaceTextureStroke)
    this.#resizeObserver.disconnect()
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown, true)
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove)
    document.removeEventListener("pointermove", this.#onPointerOrbitMove)
    window.removeEventListener("blur", this.#onNavigationBlur)
    window.removeEventListener("pointerup", this.#onTranslationPointerUpCapture, true)
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp)
    this.#canvas.removeEventListener("pointerleave", this.#onPointerLeave)
    this.#canvas.removeEventListener("pointercancel", this.#onTranslationGestureCancel)
    this.#canvas.removeEventListener("lostpointercapture", this.#onTranslationCaptureLost)
    document.removeEventListener("keydown", this.#onTranslationGestureKeyDown, true)
    window.removeEventListener("blur", this.#cancelTranslationGesture)
    this.#translationPositionPublisher.cancel()
    this.#axialDistancePublisher.cancel()
    this.#angularAnglePublisher.cancel()
    this.#clearSketchReferencePicking()
    this.#controls.removeEventListener("change", this.#onControlsChange)
    this.#controls.removeEventListener("start", this.#onControlsStart)
    this.#controls.removeEventListener("end", this.#onControlsEnd)
    this.#removeSketchNavigationPointerGuard()
    this.#controls.disconnect()
    this.#sketchNavigationElement = null
    this.#sketchPlaneFrame = null
    this.#sketchPlaneProjectionCallback = undefined
    this.#controls.dispose()
    this.#translationControls.removeEventListener("change", this.#onTranslationControlsChange)
    this.#translationControls.removeEventListener("objectChange", this.#onTranslationObjectChange)
    this.#translationControls.removeEventListener("mouseDown", this.#onTranslationControlsMouseDown)
    this.#translationControls.removeEventListener("mouseUp", this.#onTranslationControlsMouseUp)
    this.#translationControls.detach()
    this.#scene.remove(this.#translationHelper)
    this.#translationControls.dispose()
    this.#featurePreselectionPresentation.dispose()
    this.#featureSelectionPresentation.dispose()
    this.#modelPresentation.dispose()
    this.#edgePreparation.dispose()
    disposeModelGroup(this.#sketchGroup)
    disposeModelGroup(this.#sketchPointCandidateGroup)
    disposeModelGroup(this.#sketchPointPreselectionGroup)
    disposeModelGroup(this.#sketchProfileGroup)
    disposeModelGroup(this.#sketchProfilePreselectionGroup)
    disposeModelGroup(this.#sketchProfileSelectionGroup)
    disposeModelGroup(this.#originPlaneGroup)
    disposeModelGroup(this.#preselectionGroup)
    disposeModelGroup(this.#selectionGroup)
    this.#faceSelectionPresentation.clear()
    disposeModelGroup(this.#angularGizmoGroup)
    this.#scene.remove(this.#translationObject)
    this.#previewSurfaceMaterial.dispose()
    this.#previewEdgeMaterial.dispose()
    this.#datumSurfaceMaterial.dispose()
    this.#datumEdgeMaterial.dispose()
    this.#sketchCurveMaterial.dispose()
    this.#sketchConstructionCurveMaterial.dispose()
    this.#sketchPointMaterial.dispose()
    this.#sketchConstructionPointMaterial.dispose()
    this.#sketchControlHandleMaterial.dispose()
    this.#sketchControlPointMaterial.dispose()
    this.#sketchVertexMask.dispose()
    this.#sketchControlMask.dispose()
    this.#sketchPointCandidateMaterial.dispose()
    this.#sketchPointPreselectionMaterial.dispose()
    this.#sketchLineCandidateMaterial.dispose()
    this.#sketchLinePreselectionMaterial.dispose()
    this.#sketchProfileMaterial.dispose()
    this.#sketchProfilePreselectionMaterial.dispose()
    this.#sketchProfileSelectionMaterial.dispose()
    this.#preselectionMaterial.dispose()
    this.#selectionMaterial.dispose()
    this.#featurePreselectionMaterial.dispose()
    this.#featurePreselectionEdgeMaterial.dispose()
    this.#featureSelectionMaterial.dispose()
    this.#featureSelectionEdgeMaterial.dispose()
    this.#selectedReferenceEdgeMaterial.dispose()
    this.#hoveredReferenceEdgeMaterial.dispose()
    this.#angularGizmoLineMaterial.dispose()
    this.#angularGizmoHandleMaterial.dispose()
    for (const material of this.#originPlaneMaterials.values()) material.dispose()
    for (const material of this.#originPlaneEdgeMaterials) material.dispose()
    this.#orientationMarker.dispose()
    this.#originPlaneEdgeMaterials.length = 0
    this.#originPlaneMaterials.clear()
    this.#originPlaneMeshes.clear()
    this.#originPlaneMeshesByPlane.clear()
    this.#originPlaneEdges.clear()
    this.#originPlaneEdgesByPlane.clear()
    this.#renderer.dispose()
  }

  #resize(width: number, height: number) {
    if (this.#disposed) return
    if (width <= 0 || height <= 0) {
      this.#publishSketchPlaneProjection()
      return
    }
    this.#renderer.setSize(width, height, false)
    this.#updateProjection(width / height)
    this.#render()
  }

  #updateProjection(aspect?: number) {
    const resolvedAspect =
      aspect ?? this.#canvas.clientWidth / Math.max(this.#canvas.clientHeight, 1)
    if (this.#sketchProjection) {
      this.#viewHeight = viewerSketchProjectionViewHeight(
        this.#sketchProjection.bounds,
        resolvedAspect,
      )
    }
    setCameraFrustum(this.#camera, this.#viewHeight, resolvedAspect)
  }

  #updateClippingToScene() {
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#sketchProfileGroup)
      .expandByObject(this.#sketchPointCandidateGroup)
      .expandByObject(this.#sketchPointPreselectionGroup)
      .expandByObject(this.#featurePreselectionGroup)
      .expandByObject(this.#featureSelectionGroup)
      .expandByObject(this.#analysisDecoration.group)
      .expandByObject(this.#angularGizmoGroup)
      .expandByObject(this.#printDecoration.bed)
    if (this.#sectionDecoration.group.visible) bounds.expandByObject(this.#sectionDecoration.group)
    if (this.#toolPlaneDecoration.group.visible)
      bounds.expandByObject(this.#toolPlaneDecoration.group)
    for (const plane of this.#originPlaneGroup.children) {
      if (plane.visible) bounds.expandByObject(plane)
    }
    if (this.#translationHelper.visible) {
      // Bound finite handles only; TransformControls also owns million-unit helper axes.
      const size =
        ((this.#camera.top - this.#camera.bottom) / this.#camera.zoom) *
        (this.#translationControls.size / 2)
      bounds.union(
        new Box3().setFromCenterAndSize(
          this.#translationObject.getWorldPosition(new Vector3()),
          new Vector3(size, size, size),
        ),
      )
    }
    if (bounds.isEmpty()) {
      this.#camera.near = 0.01
      this.#camera.far = 10_000
    } else {
      this.#camera.updateMatrixWorld()
      bounds.applyMatrix4(this.#camera.matrixWorldInverse)
      const padding = Math.max((bounds.max.z - bounds.min.z) * 0.05, 1)
      const near = -bounds.max.z - padding
      const retreat = Math.max(0.01 - near, 0)
      // Orthographic scale is unchanged when retreating along the view direction.
      // Keep visible datums in front of the camera for rendering and raycasting.
      if (retreat > 0) {
        this.#camera.position.addScaledVector(
          this.#camera.getWorldDirection(new Vector3()),
          -retreat,
        )
      }
      this.#camera.near = Math.max(near + retreat, 0.01)
      this.#camera.far = Math.max(-bounds.min.z + padding + retreat, this.#camera.near + 1)
    }
    this.#camera.updateProjectionMatrix()
  }

  #expandViewToScene(target: ViewerVector3) {
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#sketchProfileGroup)
      .expandByObject(this.#sketchPointCandidateGroup)
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(new Sphere())
    this.#viewHeight = viewerViewHeightForBounds(
      this.#viewHeight,
      target,
      sphere.center.toArray() as [number, number, number],
      sphere.radius,
    )
  }

  #pickIdleSelectionTarget(event: PointerEvent): IdleSelectionTarget {
    if (!this.#prepareRaycaster(event)) {
      this.#edgePresentation.clearPicking()
      return { kind: "empty" }
    }
    const rect = this.#canvas.getBoundingClientRect()
    const candidate = this.#edgePresentation.pick(
      this.#camera,
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      rect.width,
      rect.height,
    )
    return candidate ? { kind: "edge", candidate } : this.#pickIdleSurfaceTarget()
  }

  #pickIdleSurfaceTarget(): IdleSelectionTarget {
    const modelHit = firstViewerSelectionHit(
      this.#raycaster.intersectObjects(this.#surfaceMeshes, false),
      this.#meshSources,
      this.#sectionPlanes,
    )
    const profileHits = this.#raycaster
      .intersectObjects([...this.#sketchProfiles.keys()], false)
      .flatMap((hit) => {
        if (!sectionPointVisible(this.#sectionPlanes, hit.point)) return []
        const profile = this.#sketchProfiles.get(hit.object as Mesh)
        return profile ? [{ profile, distance: hit.distance }] : []
      })
    const profiles = orderedUniqueViewerSketchProfiles(profileHits)
    const profile = profiles[0]
    const profileKey = profile ? viewerSketchProfileKey(profile.selector) : null
    const profileDistance =
      profileHits.find(
        ({ profile: candidate }) => viewerSketchProfileKey(candidate.selector) === profileKey,
      )?.distance ?? Infinity
    if (profile && (!modelHit || profileDistance <= modelHit.distance + 1e-6)) {
      return { kind: "profile", profiles }
    }
    return modelHit ? { kind: "model", selection: modelHit.selection } : { kind: "empty" }
  }

  #setSketchProfilePreselection(profile: ViewerSketchProfile | null, notify = true) {
    const key = profile ? viewerSketchProfileKey(profile.selector) : null
    const currentKey = this.#sketchProfilePreselection
      ? viewerSketchProfileKey(this.#sketchProfilePreselection.selector)
      : null
    if (key === currentKey) return
    this.#sketchProfilePreselection = profile
    disposeModelGroup(this.#sketchProfilePreselectionGroup)
    if (profile) {
      const source = [...this.#sketchProfiles.entries()].find(
        ([, candidate]) => viewerSketchProfileKey(candidate.selector) === key,
      )?.[0]
      if (source) {
        const highlight = new Mesh(source.geometry.clone(), this.#sketchProfilePreselectionMaterial)
        highlight.renderOrder = 6
        this.#sketchProfilePreselectionGroup.add(highlight)
      }
    }
    if (notify) this.#onSketchProfilePreselectionChange(profile)
    this.#render()
  }

  #setSketchProfileSelections(
    profiles: readonly ViewerSketchProfile[],
    notify = true,
    intent: ViewerSketchProfileSelectionIntent = "replace",
  ) {
    if (sameSketchProfileStack(profiles, this.#sketchProfileSelections)) {
      if (notify) this.#onSketchProfileSelectionChange(profiles[0] ?? null, intent)
      return
    }
    this.#sketchProfileSelections = profiles
    disposeModelGroup(this.#sketchProfileSelectionGroup)
    for (const profile of profiles) {
      const key = viewerSketchProfileKey(profile.selector)
      const source = [...this.#sketchProfiles.entries()].find(
        ([, candidate]) => viewerSketchProfileKey(candidate.selector) === key,
      )?.[0]
      if (source) {
        const highlight = new Mesh(source.geometry.clone(), this.#sketchProfileSelectionMaterial)
        highlight.renderOrder = 7
        this.#sketchProfileSelectionGroup.add(highlight)
      }
    }
    if (notify) this.#onSketchProfileSelectionChange(profiles[0] ?? null, intent)
    this.#render()
  }

  #setSketchProfileCandidateStack(stack: readonly ViewerSketchProfile[]) {
    if (sameSketchProfileStack(stack, this.#sketchProfileCandidateStack)) return
    this.#sketchProfileCandidateStack = stack
    this.#onSketchProfileCandidateStackChange(stack)
  }

  #clearSketchProfileCandidateStack() {
    if (this.#sketchProfileCandidateStack.length === 0) return
    this.#sketchProfileCandidateStack = []
    this.#onSketchProfileCandidateStackChange([])
  }

  #pickSelectionStack(event: PointerEvent, eligibleOnly = false): readonly ViewerSelection[] {
    if (!this.#prepareRaycaster(event)) return []
    const hits: ViewerSelectionHit[] = []
    for (const intersection of this.#raycaster.intersectObjects(this.#surfaceMeshes, false)) {
      if (!sectionPointVisible(this.#sectionPlanes, intersection.point)) continue
      const selection = this.#selectionFromIntersection({
        object: intersection.object,
        faceIndex: intersection.faceIndex,
      })
      if (selection) hits.push({ selection, distance: intersection.distance })
    }
    return eligibleOnly
      ? orderedEligibleViewerSelections(hits, this.#isSelectionCandidateEligible)
      : orderedUniqueViewerSelections(hits)
  }

  #selectionFromIntersection(intersection: {
    object: { name: string }
    faceIndex?: number | null | undefined
  }): ViewerSelection | null {
    if (!intersection || intersection.faceIndex === undefined || intersection.faceIndex === null) {
      return null
    }
    const source = this.#meshSources.get(intersection.object.name)
    return source ? viewerSelectionFromSource(source, intersection.faceIndex) : null
  }

  #pickOriginPlane(event: PointerEvent): ViewerOriginPlane | null {
    if (!this.#prepareRaycaster(event)) return null
    const intersection = this.#raycaster.intersectObjects(
      [...this.#originPlaneMeshes.keys()].filter((mesh) => mesh.visible),
      false,
    )[0]
    return intersection ? (this.#originPlaneMeshes.get(intersection.object as Mesh) ?? null) : null
  }

  #updateSketchReferencePicking(event: PointerEvent) {
    const stack = this.#pickSketchReferenceStack(event)
    const retained = stack.find((candidate) =>
      sameSketchReferenceCandidate(candidate, this.#sketchPointPreselection),
    )
    if (!sameSketchReferenceCandidateStack(stack, this.#sketchReferenceCandidateStack)) {
      this.#sketchReferenceCandidateStack = stack
      this.#onSketchReferenceCandidateStackChange(stack)
    }
    this.#setSketchPointPreselection(retained ?? stack[0] ?? null)
  }

  #pickSketchReferenceStack(event: PointerEvent) {
    if (!this.#prepareRaycaster(event)) return []
    return orderedUniqueSketchReferenceCandidates([
      ...this.#pickSketchReferencePointHits(),
      ...this.#pickSketchReferenceLineHits(),
    ])
  }

  #pickSketchReferencePointHits() {
    if (!this.#sketchPointObject) return []
    const hits: SketchReferenceHit[] = []
    for (const hit of this.#raycaster.intersectObject(this.#sketchPointObject, false)) {
      if (hit.index === undefined) continue
      const candidate = this.#sketchPointCandidates[hit.index]
      if (candidate && sectionPointVisible(this.#sectionPlanes, new Vector3(...candidate.position)))
        hits.push({ candidate, distance: hit.distance })
    }
    return hits
  }

  #pickSketchReferenceLineHits() {
    const hits: SketchReferenceHit[] = []
    for (const hit of this.#raycaster.intersectObjects(
      [...this.#sketchLineObjects.keys()],
      false,
    )) {
      if (!sectionPointVisible(this.#sectionPlanes, hit.point)) continue
      const candidate = this.#sketchLineObjects.get(hit.object as LineSegments)
      if (candidate) hits.push({ candidate, distance: hit.distance })
    }
    return hits
  }

  #prepareRaycaster(event: PointerEvent) {
    const bounds = this.#canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return false
    this.#pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(this.#pointer, this.#camera)
    const selectionThreshold = Math.max((this.#viewHeight / bounds.height) * 8, 0.25)
    this.#raycaster.params.Line.threshold = selectionThreshold
    this.#raycaster.params.Points.threshold = selectionThreshold
    return true
  }

  #setSketchPointPreselection(candidate: ViewerSketchReferenceCandidate | null) {
    if (sameSketchReferenceCandidate(candidate, this.#sketchPointPreselection)) return
    this.#sketchPointPreselection = candidate
    disposeModelGroup(this.#sketchPointPreselectionGroup)
    if (candidate && isViewerSketchLineCandidate(candidate)) {
      if (candidate.kind === "model-curve" && candidate.sourceType === "edge") {
        this.#addReferenceEdgeStroke(
          this.#sketchPointPreselectionGroup,
          candidate,
          this.#hoveredReferenceEdgeMaterial,
        )
      }
      const line = new LineSegments(
        createViewerSketchGeometry(sketchReferenceLinePositions(candidate)),
        this.#sketchLinePreselectionMaterial,
      )
      line.renderOrder = 9
      this.#sketchPointPreselectionGroup.add(line)
    } else if (candidate) {
      const points = new Points(
        createViewerSketchGeometry(new Float32Array(candidate.position)),
        this.#sketchPointPreselectionMaterial,
      )
      points.renderOrder = 9
      this.#sketchPointPreselectionGroup.add(points)
    }
    this.#canvas.style.cursor = candidate ? "crosshair" : ""
    this.#onSketchReferencePreselectionChange(candidate)
    this.#render()
  }

  #clearSketchReferencePicking() {
    if (this.#sketchReferenceCandidateStack.length > 0) {
      this.#sketchReferenceCandidateStack = []
      this.#onSketchReferenceCandidateStackChange([])
    }
    this.#setSketchPointPreselection(null)
  }

  #onNavigationStart = () => {
    this.#hoverPicking.cancel()
    this.#setOriginPlanePreselection(null)
    this.#setPreselection(null)
    this.#setSketchProfilePreselection(null)
  }

  #modelOrbitPivot() {
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#sketchProfileGroup)
    return bounds.isEmpty() ? null : bounds.getCenter(new Vector3())
  }

  #onControlsStart = () => {
    this.#controlsNavigationOrientation = this.#camera.quaternion.clone()
    this.#controlsNavigationPivot = null
    this.#onNavigationStart()
  }

  #onControlsEnd = () => {
    this.#controlsNavigationOrientation = null
    this.#controlsNavigationPivot = null
  }

  #onNavigationBlur = () => {
    this.#hoverPicking.cancel()
    this.#onControlsEnd()
    this.#pointerOrbitPosition = null
  }

  #onControlsChange = () => {
    this.#hoverPicking.cancel()
    this.#edgePresentation.clearPicking()
    const orientation = this.#controlsNavigationOrientation
    if (orientation) {
      if (!orientation.equals(this.#camera.quaternion)) {
        this.#controlsNavigationPivot ??= this.#modelOrbitPivot()
        if (this.#controlsNavigationPivot) {
          preserveOrbitPivot(
            this.#camera,
            this.#controls.target,
            this.#controlsNavigationPivot,
            orientation,
          )
        }
      }
      orientation.copy(this.#camera.quaternion)
    }
    this.#clearSelectionCandidateStack()
    this.#clearSketchReferencePicking()
    this.#clearSketchProfileCandidateStack()
    this.#setSketchProfilePreselection(null)
    this.#render()
  }

  #onTranslationControlsChange = () => {
    this.#render()
  }

  #onTranslationObjectChange = () => {
    const position = this.#translationObject.getWorldPosition(new Vector3())
    if (!position.toArray().every((value) => Number.isFinite(value))) return
    if (this.#axialGizmo) {
      const rawDistance = viewerAxialGizmoDistance(this.#axialGizmo, [
        position.x,
        position.y,
        position.z,
      ])
      if (rawDistance === null) return
      const distance = viewerAxialGizmoDragDistance(this.#axialGizmo, rawDistance)
      if (distance === null) return
      if (distance !== rawDistance) {
        const clampedPosition = viewerAxialGizmoHandlePosition({
          ...this.#axialGizmo,
          distance,
        })
        if (clampedPosition) {
          this.#translationObject.position.set(...clampedPosition)
          this.#translationObject.updateMatrixWorld()
        }
      }
      this.#axialDistancePublisher.push(distance)
      return
    }
    this.#translationPositionPublisher.push([position.x, position.y, position.z])
  }

  #onTranslationControlsMouseDown = () => {
    this.#hoverPicking.cancel()
    this.#translationGizmoInteracting = true
    this.#translationGizmoPointerId = this.#pointerDown?.pointerId ?? null
    this.#canvas.dataset.translationGizmoDragging = "true"
    this.#skipTranslationGizmoPointerUp = true
    this.#orbitControlsEnabledBeforeTranslation = this.#controls.enabled
    this.#controls.enabled = false
  }

  #onTranslationPointerUpCapture = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return
    const targetsCanvas = event.target === this.#canvas
    if (!targetsCanvas) {
      this.#skipTranslationGizmoPointerUp = false
      this.#pointerDown = null
    }
    if (!this.#translationGizmoInteracting || event.pointerId !== this.#translationGizmoPointerId)
      return
    if (targetsCanvas && this.#prepareRaycaster(event)) {
      // Consume the release endpoint before ending and flushing the gesture.
      this.#translationControls.pointerMove(
        new PointerEvent("pointermove", {
          clientX: this.#pointer.x,
          clientY: this.#pointer.y,
          button: -1,
        }),
      )
    }
    this.#translationControls.pointerUp(null)
  }

  #onTranslationControlsMouseUp = () => {
    this.#translationPositionPublisher.flush()
    this.#axialDistancePublisher.flush()
    this.#translationGizmoInteracting = false
    const pointerId = this.#translationGizmoPointerId
    this.#translationGizmoPointerId = null
    delete this.#canvas.dataset.translationGizmoDragging
    this.#controls.enabled = this.#orbitControlsEnabledBeforeTranslation
    if (pointerId !== null && this.#canvas.hasPointerCapture(pointerId)) {
      this.#canvas.releasePointerCapture(pointerId)
    }
    if (this.#translationGizmoHidePending) this.hideTranslationGizmo()
  }

  #renderAngularGizmo() {
    disposeModelGroup(this.#angularGizmoGroup)
    this.#angularGizmoHandle = null
    if (!this.#angularGizmo) return
    const positions = viewerAngularGizmoLinePositions(this.#angularGizmo)
    const handlePosition = viewerAngularGizmoPoint(this.#angularGizmo)
    if (!positions || !handlePosition) return
    const lines = new LineSegments(
      createViewerSketchGeometry(positions),
      this.#angularGizmoLineMaterial,
    )
    lines.name = "angular-gizmo-arc"
    lines.renderOrder = 10
    this.#angularGizmoGroup.add(lines)
    const handle = new Points(
      createViewerSketchGeometry(new Float32Array(handlePosition)),
      this.#angularGizmoHandleMaterial,
    )
    handle.name = "angular-gizmo-handle"
    handle.renderOrder = 11
    this.#angularGizmoHandle = handle
    this.#angularGizmoGroup.add(handle)
    this.#render()
  }

  #isAngularGizmoHandleHit(event: PointerEvent) {
    return (
      !!this.#angularGizmoHandle &&
      this.#prepareRaycaster(event) &&
      this.#raycaster.intersectObject(this.#angularGizmoHandle, false).length > 0
    )
  }

  #beginAngularGizmoInteraction(event: PointerEvent) {
    if (!this.#angularGizmo || !this.#isAngularGizmoHandleHit(event)) return false
    this.#angularGizmoInteracting = true
    this.#angularGizmoStartAngle = this.#angularGizmo.angle
    this.#angularGizmoPointerId = event.pointerId
    this.#orbitControlsEnabledBeforeTranslation = this.#controls.enabled
    this.#controls.enabled = false
    this.#pointerDown = null
    this.#canvas.style.cursor = "grabbing"
    this.#canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  }

  #updateAngularGizmoInteraction(event: PointerEvent) {
    const gizmo = this.#angularGizmo
    if (
      !this.#angularGizmoInteracting ||
      !gizmo ||
      event.pointerId !== this.#angularGizmoPointerId ||
      !this.#prepareRaycaster(event)
    ) {
      return
    }
    const frame = viewerAngularGizmoFrame(gizmo)
    if (!frame) return
    const point = this.#raycaster.ray.intersectPlane(
      new Plane().setFromNormalAndCoplanarPoint(frame.axis, frame.origin),
      new Vector3(),
    )
    if (!point) return
    const angle = viewerAngularGizmoAngle(gizmo, [point.x, point.y, point.z], gizmo.angle)
    if (angle === null || angle === gizmo.angle) return
    this.#angularGizmo = { ...gizmo, angle }
    this.#renderAngularGizmo()
    this.#angularAnglePublisher.push(angle)
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  #finishAngularGizmoInteraction(commit: boolean) {
    if (!this.#angularGizmoInteracting) return
    const pointerId = this.#angularGizmoPointerId
    if (!commit && this.#angularGizmo) {
      this.#angularGizmo = { ...this.#angularGizmo, angle: this.#angularGizmoStartAngle }
      this.#renderAngularGizmo()
      this.#angularAnglePublisher.push(this.#angularGizmoStartAngle)
    }
    this.#angularAnglePublisher.flush()
    this.#angularGizmoInteracting = false
    this.#angularGizmoPointerId = null
    this.#controls.enabled = this.#orbitControlsEnabledBeforeTranslation
    this.#pointerDown = null
    this.#canvas.style.cursor = this.#angularGizmo ? "grab" : ""
    if (pointerId !== null && this.#canvas.hasPointerCapture(pointerId)) {
      this.#canvas.releasePointerCapture(pointerId)
    }
  }

  #cancelTranslationGesture = () => {
    if (this.#angularGizmoInteracting) {
      this.#finishAngularGizmoInteraction(false)
      return
    }
    if (this.#disposed || !this.#translationGizmoInteracting) return
    this.#translationControls.reset()
    this.#translationControls.pointerUp(null)
  }

  #onTranslationGestureCancel = () => {
    this.#cancelTranslationGesture()
  }

  #onTranslationCaptureLost = (event: PointerEvent) => {
    // Finish a release outside the canvas before treating capture loss as cancellation.
    window.setTimeout(() => {
      if (this.#disposed || this.#canvas.hasPointerCapture(event.pointerId)) return
      if (
        this.#translationGizmoPointerId === event.pointerId ||
        this.#angularGizmoPointerId === event.pointerId
      )
        this.#cancelTranslationGesture()
    }, 0)
  }

  #onTranslationGestureKeyDown = (event: KeyboardEvent) => {
    if (
      (!this.#translationGizmoInteracting && !this.#angularGizmoInteracting) ||
      event.key !== "Escape"
    ) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#cancelTranslationGesture()
  }

  #createOriginPlanes() {
    for (const plane of viewerOriginPlanes) {
      const material = new MeshBasicMaterial({
        color: new Color(ORIGIN_PLANE_COLOR),
        depthWrite: false,
        opacity: ORIGIN_PLANE_OPACITY.idle.fill,
        side: DoubleSide,
        transparent: true,
      })
      const mesh = new Mesh(new PlaneGeometry(ORIGIN_PLANE_SIZE, ORIGIN_PLANE_SIZE), material)
      mesh.name = `origin-plane:${plane}`
      orientOriginPlane(mesh, plane)
      this.#originPlaneMaterials.set(plane, material)
      this.#originPlaneMeshes.set(mesh, plane)
      this.#originPlaneMeshesByPlane.set(plane, mesh)
      this.#originPlaneGroup.add(mesh)

      const edgeMaterial = new LineBasicMaterial({
        color: new Color(ORIGIN_PLANE_COLOR),
        depthWrite: false,
        opacity: ORIGIN_PLANE_OPACITY.idle.edge,
        transparent: true,
      })
      this.#originPlaneEdgeMaterials.push(edgeMaterial)
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry), edgeMaterial)
      edges.name = `origin-plane:${plane}:edges`
      edges.rotation.copy(mesh.rotation)
      this.#originPlaneEdges.set(edges, plane)
      this.#originPlaneEdgesByPlane.set(plane, edges)
      this.#originPlaneGroup.add(edges)
    }
    this.#updateOriginPlanes()
  }

  #addSketchControls(sketch: ViewerSketch) {
    if (sketch.controlHandlePositions) {
      this.#addSketchLines(
        sketch.sketchId,
        "control-handles",
        sketch.controlHandlePositions,
        this.#sketchControlHandleMaterial,
        true,
      )
    }
    if (sketch.controlPointPositions) {
      this.#addSketchPoints(
        sketch.sketchId,
        "control-points",
        sketch.controlPointPositions,
        this.#sketchControlPointMaterial,
        6,
      )
    }
  }

  #addSketchLines(
    sketchId: string,
    kind: string,
    positions: Float32Array,
    material: LineBasicMaterial | LineDashedMaterial,
    dashed = false,
  ) {
    if (positions.length === 0) return
    const lines = new LineSegments(createViewerSketchGeometry(positions), material)
    lines.name = `sketch:${sketchId}:${kind}`
    lines.renderOrder = 4
    if (dashed) lines.computeLineDistances()
    this.#sketchGroup.add(lines)
  }

  #addSketchPoints(
    sketchId: string,
    kind: string,
    positions: Float32Array,
    material: PointsMaterial,
    renderOrder = 5,
  ) {
    if (positions.length === 0) return
    const points = new Points(createViewerSketchGeometry(positions), material)
    points.name = `sketch:${sketchId}:${kind}`
    points.renderOrder = renderOrder
    this.#sketchGroup.add(points)
  }

  #setOriginPlanePreselection(plane: ViewerOriginPlane | null) {
    if (plane === this.#originPlanePreselection) return
    this.#originPlanePreselection = plane
    this.#canvas.style.cursor = plane ? "pointer" : ""
    this.#updateOriginPlanes()
    this.#onOriginPlanePreselectionChange(plane)
    this.#render()
  }

  #updateOriginPlanes() {
    for (const [plane, material] of this.#originPlaneMaterials) {
      const visible = this.#originPlaneSelectionActive || this.#originPlaneVisibility[plane]
      const mesh = this.#originPlaneMeshesByPlane.get(plane)
      if (mesh) mesh.visible = visible
      const edges = this.#originPlaneEdgesByPlane.get(plane)
      const opacity =
        ORIGIN_PLANE_OPACITY[
          plane === this.#originPlanePreselection
            ? "preselected"
            : plane === this.#originPlaneSelection
              ? "selected"
              : "idle"
        ]
      if (edges) {
        edges.visible = visible
        edges.material.opacity = opacity.edge
      }
      material.opacity = opacity.fill
    }
    this.#originPlaneGroup.visible = [...this.#originPlaneMeshes].some(([mesh]) => mesh.visible)
  }

  #setPreselection(selection: ViewerSelection | null) {
    const visibleSelection = sameSelection(selection, this.#selection) ? null : selection
    if (sameSelection(visibleSelection, this.#preselection)) return
    this.#preselection = visibleSelection
    this.#replaceHighlight(this.#preselectionGroup, this.#preselectionMaterial, visibleSelection)
  }

  #setSelectionCandidateStack(stack: readonly ViewerSelection[]) {
    if (sameSelectionStack(stack, this.#selectionCandidateStack)) return
    this.#selectionCandidateStack = stack
    this.#onSelectionCandidateStackChange(stack)
  }

  #clearSelectionCandidateStack() {
    if (this.#selectionCandidateStack.length === 0) return
    this.#selectionCandidateStack = []
    this.#onSelectionCandidateStackChange([])
  }

  #setSelection(selection: ViewerSelection | null) {
    if (sameSelection(selection, this.#selection)) return
    this.#selection = selection
    this.#replaceHighlight(this.#selectionGroup, this.#selectionMaterial, selection)
    if (sameSelection(this.#preselection, selection)) this.#setPreselection(null)
    this.#onSelectionChange(selection)
  }

  #replaceHighlight(group: Group, material: MeshBasicMaterial, selection: ViewerSelection | null) {
    disposeModelGroup(group)
    if (selection) {
      const source = this.#meshSources.get(viewerBodyKey(selection))
      const geometry = source ? createFaceHighlightGeometry(source, selection.faceId) : null
      if (geometry) group.add(new Mesh(geometry, material))
    }
    this.#render()
  }

  #handleAngularGizmoPointerMove(event: PointerEvent) {
    if (this.#angularGizmoInteracting) {
      this.#updateAngularGizmoInteraction(event)
      return true
    }
    if (!this.#angularGizmo) return false
    if (!this.#isAngularGizmoHandleHit(event)) {
      if (this.#canvas.style.cursor === "grab") this.#canvas.style.cursor = ""
      return false
    }
    this.#canvas.style.cursor = "grab"
    this.#setOriginPlanePreselection(null)
    this.#setPreselection(null)
    this.#setSketchProfilePreselection(null)
    return true
  }

  #updateOriginPlanePointerPreselection(event: PointerEvent) {
    const stack = this.#pickSelectionStack(event, true)
    this.#setSelectionCandidateStack(stack)
    const retained = stack.find((selection) => sameSelection(selection, this.#preselection))
    const modelSelection = retained ?? stack[0] ?? null
    const plane = modelSelection ? null : this.#pickOriginPlane(event)
    this.#setOriginPlanePreselection(plane)
    this.#setPreselection(modelSelection)
    this.#setSketchProfilePreselection(null)
  }

  #updateFacePointerPreselection(event: PointerEvent) {
    const stack = this.#pickSelectionStack(event, true)
    this.#setSelectionCandidateStack(stack)
    this.#setOriginPlanePreselection(null)
    this.#setPreselection(stack[0] ?? null)
    this.#setSketchProfilePreselection(null)
  }

  #handleAngularGizmoPointerUp(event: PointerEvent) {
    if (!this.#angularGizmoInteracting) return false
    if (event.pointerId === this.#angularGizmoPointerId) {
      this.#finishAngularGizmoInteraction(true)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    return true
  }

  #commitPointerActivation(event: PointerEvent) {
    if (this.#interactionMode === "sketch-reference-select") {
      this.#commitSketchPointSelection(event)
      return
    }
    if (this.#interactionMode === "face-select") {
      const stack = this.#pickSelectionStack(event, true)
      this.#setSelectionCandidateStack(stack)
      this.#setSelection(stack[0] ?? null)
      return
    }
    if (this.#originPlaneSelectionActive) {
      this.#commitOriginPlaneSelection(event)
      return
    }
    this.#commitIdleSelection(event)
  }

  setSurfaceTextureBrush(brush: ViewerSurfaceTextureBrush | null, active = false) {
    this.#hoverPicking.cancel()
    if (textureBrushTargetChanged(this.#surfaceTextureBrush, brush))
      this.#finishSurfaceTextureStroke(true)
    this.#surfaceTextureBrush = brush
    this.#surfaceTextureBrushActive = active
    this.#updateEdgeMode()
    for (const group of [
      this.#featureSelectionGroup,
      this.#featurePreselectionGroup,
      this.#selectionGroup,
      this.#faceSelectionGroup,
      this.#preselectionGroup,
    ])
      group.visible = !active
    this.#canvas.style.cursor = brush ? "crosshair" : ""
    this.#render()
  }

  #surfaceTextureDab(event: PointerEvent): ViewerSurfaceTextureDab | null {
    const brush = this.#surfaceTextureBrush
    if (!brush || !this.#prepareRaycaster(event)) return null
    for (const hit of this.#raycaster.intersectObjects(this.#surfaceMeshes, false)) {
      const visibleSelection = this.#selectionFromIntersection(hit)
      if (!visibleSelection) continue
      if (!textureBrushAcceptsSelection(brush, visibleSelection)) return null
      return this.#sourceSurfaceTextureDab(hit, visibleSelection, event.shiftKey)
    }
    return null
  }

  #sourceSurfaceTextureDab(
    hit: Intersection,
    visibleSelection: ViewerSelection,
    erase: boolean,
  ): ViewerSurfaceTextureDab | null {
    const original = this.#textureSourceMeshes.get(hit.object.name)
    const sourceHit = original ? this.#raycaster.intersectObject(original.surface, false)[0] : hit
    if (!sourceHit?.face) return null
    const selection = original
      ? viewerSelectionFromSource(original.source, sourceHit.faceIndex)
      : visibleSelection
    if (!selection) return null
    const normal = sourceHit.face.normal
      .clone()
      .transformDirection(sourceHit.object.matrixWorld)
      .normalize()
    return {
      center: sourceHit.point.toArray() as [number, number, number],
      normal: normal.toArray() as [number, number, number],
      selection,
      erase: erase,
    }
  }

  #finishSurfaceTextureStroke(cancelled: boolean) {
    const pointerId = this.#surfaceTexturePointer
    if (pointerId === null) return
    this.#surfaceTexturePointer = null
    delete this.#canvas.dataset.surfaceTextureStroke
    this.#surfaceTextureLastPoint = null
    this.#controls.enabled = this.#surfaceTextureControlsEnabled
    this.#surfaceTextureBrush?.onEnd(cancelled)
    if (this.#canvas.hasPointerCapture(pointerId)) this.#canvas.releasePointerCapture(pointerId)
  }

  #cancelSurfaceTextureStroke = () => this.#finishSurfaceTextureStroke(true)
  #surfaceTextureKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || this.#surfaceTexturePointer === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#finishSurfaceTextureStroke(true)
  }

  #beginSurfaceTextureStroke(event: PointerEvent): boolean {
    if (event.isPrimary && event.button === 0 && this.#surfaceTextureBrush) {
      const dab = this.#surfaceTextureDab(event)
      if (!dab) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      this.#surfaceTextureBrush.onStart()
      if (this.#surfaceTextureBrush.mode === "faces") {
        this.#surfaceTextureBrush.onDab(dab)
        this.#surfaceTextureBrush.onEnd(false)
        return true
      }
      this.#surfaceTexturePointer = event.pointerId
      this.#canvas.dataset.surfaceTextureStroke = "true"
      this.#surfaceTextureLastPoint = new Vector3(...dab.center)
      this.#surfaceTextureControlsEnabled = this.#controls.enabled
      this.#controls.enabled = false
      this.#canvas.setPointerCapture(event.pointerId)
      this.#surfaceTextureBrush.onDab(dab)
      return true
    }
    return false
  }

  #onPointerDown = (event: PointerEvent) => {
    this.#hoverPicking.cancel()
    if (this.#pointerOrbit) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.#beginSurfaceTextureStroke(event)) return
    if (this.#translationGizmoInteracting) return
    if (event.isPrimary && event.button === 0) {
      if (this.#beginAngularGizmoInteraction(event)) return
      this.#pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    }
  }

  #consumeOwnedPointerMove(event: PointerEvent): boolean {
    if (this.#pointerOrbit) return true
    if (this.#surfaceTexturePointer === event.pointerId && this.#surfaceTextureBrush) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const dab = this.#surfaceTextureDab(event)
      if (dab) {
        const point = new Vector3(...dab.center)
        if (
          !this.#surfaceTextureLastPoint ||
          point.distanceTo(this.#surfaceTextureLastPoint) >=
            this.#surfaceTextureBrush.radiusMm * 0.2
        ) {
          this.#surfaceTextureLastPoint = point
          this.#surfaceTextureBrush.onDab(dab)
        }
      }
      return true
    }
    return false
  }

  #onPointerMove = (event: PointerEvent) => {
    if (
      this.#consumeOwnedPointerMove(event) ||
      !event.isPrimary ||
      this.#handleAngularGizmoPointerMove(event) ||
      this.#translationGizmoInteracting ||
      event.buttons !== 0
    ) {
      this.#hoverPicking.cancel()
      return
    }
    this.#hoverPicking.update(
      event,
      this.#interactionMode === "select" &&
        !this.#originPlaneSelectionActive &&
        !this.#surfaceTextureBrush,
    )
  }

  #updatePointerPreselection(event: PointerEvent) {
    switch (this.#interactionMode) {
      case "camera-only":
        return
      case "sketch-reference-select":
        this.#updateSketchReferencePicking(event)
        return
      case "face-select":
        this.#updateFacePointerPreselection(event)
        return
    }
    if (this.#originPlaneSelectionActive) {
      this.#updateOriginPlanePointerPreselection(event)
      return
    }
    this.#updateIdleSelectionPreselection(event)
  }

  #onPointerOrbitMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    const overDrawing =
      event.target === this.#canvas ||
      (event.target instanceof Node && this.#sketchNavigationElement?.contains(event.target))
    if (!overDrawing) {
      this.#pointerOrbitPosition = null
      return
    }
    const previous = this.#pointerOrbitPosition
    this.#pointerOrbitPosition = new Vector2(event.clientX, event.clientY)
    if (!this.#pointerOrbit || !previous || !this.#controls.enabled) return
    this.#rotatePointerOrbit(event.clientX - previous.x, event.clientY - previous.y)
  }

  #rotatePointerOrbit(dx: number, dy: number) {
    const orientation = this.#camera.quaternion.clone()
    const axis = new Quaternion().setFromUnitVectors(this.#camera.up, new Vector3(0, 1, 0))
    const offset = this.#camera.position.clone().sub(this.#controls.target).applyQuaternion(axis)
    const spherical = new Spherical().setFromVector3(offset)
    const scale =
      (2 * Math.PI * this.#controls.rotateSpeed) / Math.max(this.#canvas.clientHeight, 1)
    spherical.theta -= dx * scale
    spherical.phi = Math.max(
      this.#controls.minPolarAngle,
      Math.min(this.#controls.maxPolarAngle, spherical.phi - dy * scale),
    )
    spherical.makeSafe()
    offset.setFromSpherical(spherical).applyQuaternion(axis.invert())
    this.#camera.position.copy(this.#controls.target).add(offset)
    this.#controls.update()
    if (this.#pointerOrbitPivot) {
      preserveOrbitPivot(this.#camera, this.#controls.target, this.#pointerOrbitPivot, orientation)
    }
  }

  #onPointerUp = (event: PointerEvent) => {
    this.#hoverPicking.cancel()
    if (this.#surfaceTexturePointer === event.pointerId) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.#finishSurfaceTextureStroke(false)
      return
    }
    if (this.#handleAngularGizmoPointerUp(event)) return
    if (this.#skipTranslationGizmoPointerUp) {
      this.#skipTranslationGizmoPointerUp = false
      this.#pointerDown = null
      return
    }
    const start = this.#pointerDown
    this.#pointerDown = null
    if (!event.isPrimary || event.button !== 0 || !start) return
    if (this.#interactionMode === "camera-only") return
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (movement > 3) return
    this.#commitPointerActivation(event)
  }

  #updateIdleSelectionPreselection(event: PointerEvent) {
    this.#clearSelectionCandidateStack()
    const target = this.#pickIdleSelectionTarget(event)
    const profiles = target.kind === "profile" ? target.profiles : []
    this.#setSketchProfileCandidateStack(profiles)
    const plane =
      this.#originPlaneIdleSelectionEnabled && target.kind === "empty"
        ? this.#pickOriginPlane(event)
        : null
    this.#setOriginPlanePreselection(plane)
    this.#setPreselection(target.kind === "model" ? target.selection : null)
    this.#setSketchProfilePreselection(target.kind === "profile" ? (profiles[0] ?? null) : null)
  }

  #commitIdleSelection(event: PointerEvent) {
    const target = this.#pickIdleSelectionTarget(event)
    if (target.kind === "edge") {
      this.#commitEdgeSelection(target.candidate)
      return
    }
    this.#edgeSelection = null
    this.#onEdgeSelectionChange(null)
    if (target.kind === "profile") {
      this.#setSketchProfileCandidateStack(target.profiles)
      if (target.profiles.length > 1) {
        this.#onSketchProfileCandidateStackCommit(target.profiles)
        return
      }
      this.#setOriginPlanePreselection(null)
      this.#setSelection(null)
      this.#setSketchProfileSelections(
        target.profiles.slice(0, 1),
        true,
        event.shiftKey ? "toggle" : "replace",
      )
      return
    }
    if (target.kind === "model") {
      this.#clearSketchProfileCandidateStack()
      this.#setOriginPlanePreselection(null)
      this.#setSketchProfileSelections([])
      this.#setSelection(target.selection)
      return
    }
    if (!this.#originPlaneIdleSelectionEnabled) {
      this.#clearSketchProfileCandidateStack()
      this.#setOriginPlanePreselection(null)
      const hadSelection = this.#selection !== null
      this.#setSelection(null)
      this.#setSketchProfileSelections([])
      if (!hadSelection) this.#onSelectionChange(null)
      return
    }
    const hadSelection = this.#selection !== null
    this.#setSelection(null)
    this.#clearSketchProfileCandidateStack()
    this.#setSketchProfileSelections([])
    if (!hadSelection) this.#onSelectionChange(null)
    this.#onOriginPlaneSelectionChange(this.#pickOriginPlane(event))
  }

  #commitEdgeSelection(candidate: ViewerEdgeCandidate) {
    this.#clearSelectionCandidateStack()
    this.#clearSketchProfileCandidateStack()
    this.#setOriginPlanePreselection(null)
    this.#setPreselection(null)
    this.#setSketchProfilePreselection(null)
    this.#setSelection(null)
    this.#faceSelectionPresentation.clear()
    this.#setSketchProfileSelections([])
    if (this.#originPlaneSelection) {
      this.#originPlaneSelection = null
      this.#updateOriginPlanes()
      this.#onOriginPlaneSelectionChange(null)
    }
    this.#edgeSelection = candidate
    this.#onEdgeSelectionChange(candidate)
    this.#render()
  }

  #commitSketchPointSelection(event: PointerEvent) {
    this.#updateSketchReferencePicking(event)
    if (this.#sketchPointPreselection) {
      this.#onSketchReferenceSelectionChange(this.#sketchPointPreselection)
    }
  }

  #commitOriginPlaneSelection(event: PointerEvent) {
    const stack = this.#pickSelectionStack(event, true)
    this.#setSelectionCandidateStack(stack)
    if (stack.length > 1) {
      this.#onSelectionCandidateStackCommit(stack)
      return
    }
    if (stack.length === 1) {
      this.#setSelection(stack[0] ?? null)
      return
    }
    const plane = this.#pickOriginPlane(event)
    if (plane) this.#onOriginPlaneSelectionChange(plane)
  }

  #onPointerLeave = () => {
    this.#hoverPicking.cancel()
    if (this.#angularGizmoInteracting) return
    this.#edgePresentation.clearPicking()
    this.#pointerDown = null
    if (this.#interactionMode === "camera-only") return
    if (this.#interactionMode === "sketch-reference-select") return
    this.#clearSketchReferencePicking()
    if (!this.#selectionCandidateStackPreserved) this.#clearSelectionCandidateStack()
    this.#clearSketchProfileCandidateStack()
    this.#setOriginPlanePreselection(null)
    this.#setPreselection(null)
    this.#setSketchProfilePreselection(null)
  }

  #publishTranslationGizmoOrigin(width: number, height: number) {
    if (this.#translationHelper.visible) {
      const projected = this.#translationObject
        .getWorldPosition(new Vector3())
        .project(this.#camera)
      this.#canvas.dataset.translationGizmoOrigin = `${((projected.x + 1) / 2) * width},${((1 - projected.y) / 2) * height}`
    } else {
      delete this.#canvas.dataset.translationGizmoOrigin
    }
  }

  #applySectionClipping() {
    this.#analysisDecoration.setClipping(this.#sectionPlanes)
    const groups = [
      this.#modelGroup,
      this.#featurePreselectionGroup,
      this.#featureSelectionGroup,
      this.#preselectionGroup,
      this.#selectionGroup,
      this.#faceSelectionGroup,
      this.#sketchGroup,
      this.#sketchProfileGroup,
      this.#sketchProfilePreselectionGroup,
      this.#sketchProfileSelectionGroup,
      this.#sketchPointCandidateGroup,
      this.#sketchPointPreselectionGroup,
    ]
    for (const group of groups)
      group.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof LineSegments || object instanceof Points))
          return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material.clippingPlanes === this.#sectionPlanes) continue
          material.clippingPlanes = this.#sectionPlanes
          material.needsUpdate = true
        }
      })
  }

  readonly #renderFrames = createLatestFramePublisher<null>(() => this.#renderNow())

  #render = () => {
    if (!this.#disposed) this.#renderFrames.push(null)
  }

  #renderNow = () => {
    if (this.#disposed) return
    this.#sectionDecoration.update()
    this.#applySectionClipping()
    this.#updateClippingToScene()
    const width = this.#canvas.clientWidth
    this.#edgePresentation.resize(width, this.#canvas.clientHeight)
    const height = this.#canvas.clientHeight
    this.#publishSketchPlaneProjection()
    this.#publishAxialGizmoAvailability()
    if (width <= 0 || height <= 0) return
    this.#infiniteGrid.update(this.#camera, width, height, this.#renderer.getPixelRatio())
    this.#publishTranslationGizmoOrigin(width, height)
    const angularHandle = this.#angularGizmo ? viewerAngularGizmoPoint(this.#angularGizmo) : null
    if (angularHandle) {
      const projected = new Vector3(...angularHandle).project(this.#camera)
      const x = ((projected.x + 1) / 2) * width
      const y = ((1 - projected.y) / 2) * height
      this.#canvas.dataset.angularGizmoHandle = `${x},${y}`
    } else {
      delete this.#canvas.dataset.angularGizmoHandle
    }
    this.#renderer.setScissorTest(false)
    this.#renderer.setViewport(0, 0, width, height)
    this.#renderer.render(this.#scene, this.#camera)

    const { x: insetX, y: insetY, size: insetSize } = this.#orientationInsetPlacement()
    const insetPlacement = `${insetX},${insetY},${insetSize}`
    if (this.#canvas.dataset.orientationInset !== insetPlacement) {
      this.#canvas.dataset.orientationInset = insetPlacement
    }
    if (insetSize <= 0) return
    this.#updateOrientationCamera()
    this.#renderer.setScissorTest(true)
    this.#renderer.setScissor(insetX, insetY, insetSize, insetSize)
    this.#renderer.setViewport(insetX, insetY, insetSize, insetSize)
    this.#renderer.clearDepth()
    this.#renderer.render(this.#orientationScene, this.#orientationCamera)
    this.#renderer.setScissorTest(false)
    this.#renderer.setViewport(0, 0, width, height)
  }

  #orientationInsetPlacement() {
    return orientationInsetPlacement(
      this.#canvas.clientWidth,
      this.#canvas.clientHeight,
      this.#orientationInsetOffsetElement?.clientWidth,
    )
  }

  #updateOrientationCamera() {
    this.#orientationCamera.position
      .copy(this.#camera.position)
      .sub(this.#controls.target)
      .normalize()
      .multiplyScalar(3)
    this.#orientationCamera.up.copy(this.#camera.up)
    this.#orientationCamera.lookAt(0, 0, 0)
    this.#orientationCamera.updateMatrixWorld()
    this.#orientationMarker.alignLabels(this.#orientationCamera.quaternion)
  }

  #publishAxialGizmoAvailability() {
    if (!this.#axialGizmo) {
      delete this.#canvas.dataset.axialGizmoDragAvailable
      return
    }
    const direction = new Vector3(...this.#axialGizmo.direction)
    const viewDirection = this.#camera.getWorldDirection(new Vector3())
    // TransformControls hides a translation axis at this view alignment.
    const available = Math.abs(direction.dot(viewDirection)) <= 0.99
    this.#canvas.dataset.axialGizmoDragAvailable = String(available)
  }

  #publishSketchPlaneProjection() {
    const callback = this.#sketchPlaneProjectionCallback
    if (!callback) return
    const frame = this.#sketchPlaneFrame
    const width = this.#canvas.clientWidth
    const height = this.#canvas.clientHeight
    let projection: ViewerSketchPlaneProjection | null = null
    if (frame && width > 0 && height > 0 && isValidViewerFrame(frame)) {
      this.#camera.updateMatrixWorld()
      const right = new Vector3(1, 0, 0).applyQuaternion(this.#camera.quaternion)
      const up = new Vector3(0, 1, 0).applyQuaternion(this.#camera.quaternion)
      const viewWidth = (this.#camera.right - this.#camera.left) / this.#camera.zoom
      const viewHeight = (this.#camera.top - this.#camera.bottom) / this.#camera.zoom
      projection = viewerSketchPlaneProjection(frame, {
        right: [right.x, right.y, right.z],
        up: [up.x, up.y, up.z],
        target: [this.#controls.target.x, this.#controls.target.y, this.#controls.target.z],
        viewWidth,
        viewHeight,
      })
    }
    if (sameViewerSketchPlaneProjection(this.#lastSketchPlaneProjection, projection)) return
    this.#lastSketchPlaneProjection = projection
    callback(projection)
  }

  #onSketchNavigationPointerDown = (event: Event) => {
    if (!(event instanceof PointerEvent)) return
    if (event.button !== 0 && event.pointerType !== "touch") return
    if (this.#sketchNavigationControlsEnabledBeforePointer !== null) {
      this.#restoreSketchNavigationControls()
    }
    this.#sketchNavigationControlsEnabledBeforePointer = this.#controls.enabled
    this.#sketchNavigationPointerId = event.pointerId
    this.#controls.enabled = false
    window.addEventListener("pointerup", this.#onSketchNavigationPointerEnd)
    window.addEventListener("pointercancel", this.#onSketchNavigationPointerEnd)
    window.addEventListener("blur", this.#onSketchNavigationBlur)
  }

  #onSketchNavigationPointerEnd = (event: Event) => {
    if (!(event instanceof PointerEvent)) return
    if (this.#sketchNavigationControlsEnabledBeforePointer === null) return
    if (event.pointerId !== this.#sketchNavigationPointerId) return
    this.#restoreSketchNavigationControls()
  }

  #onSketchNavigationBlur = () => {
    this.#restoreSketchNavigationControls()
  }

  #onSketchContextMenuCapture = () => {
    // OrbitControls normally prevents the browser menu. The SVG's own context-menu
    // owner must receive an uncancelled event so Radix can open the sketch actions.
    this.#sketchContextMenuControlsEnabled = this.#controls.enabled
    this.#controls.enabled = false
  }

  #onSketchContextMenuBubble = () => {
    if (this.#sketchContextMenuControlsEnabled === null) return
    this.#controls.enabled = this.#sketchContextMenuControlsEnabled
    this.#sketchContextMenuControlsEnabled = null
  }

  #restoreSketchNavigationControls() {
    if (this.#sketchNavigationControlsEnabledBeforePointer === null) return
    this.#controls.enabled = this.#sketchNavigationControlsEnabledBeforePointer
    this.#sketchNavigationControlsEnabledBeforePointer = null
    this.#sketchNavigationPointerId = null
    window.removeEventListener("pointerup", this.#onSketchNavigationPointerEnd)
    window.removeEventListener("pointercancel", this.#onSketchNavigationPointerEnd)
    window.removeEventListener("blur", this.#onSketchNavigationBlur)
  }

  #removeSketchNavigationPointerGuard() {
    const element = this.#sketchNavigationElement
    if (!element) return
    element.removeEventListener("pointerdown", this.#onSketchNavigationPointerDown, true)
    element.removeEventListener("pointerup", this.#onSketchNavigationPointerEnd, true)
    element.removeEventListener("pointercancel", this.#onSketchNavigationPointerEnd, true)
    element.removeEventListener("lostpointercapture", this.#onSketchNavigationPointerEnd, true)
    element.removeEventListener("contextmenu", this.#onSketchContextMenuCapture, true)
    element.removeEventListener("contextmenu", this.#onSketchContextMenuBubble)
    this.#onSketchContextMenuBubble()
    this.#restoreSketchNavigationControls()
  }
}

export function createGeometryViewport(
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions = {},
): GeometryViewport {
  return new ThreeGeometryViewport(canvas, options)
}

function textureBrushAcceptsSelection(
  brush: ViewerSurfaceTextureBrush,
  selection: ViewerSelection,
) {
  if (!brush.featureId) return true
  return (
    selection.featureId === brush.featureId &&
    (selection.outputRole ?? "result") === (brush.outputRole ?? "result")
  )
}

function textureBrushTargetChanged(
  previous: ViewerSurfaceTextureBrush | null,
  next: ViewerSurfaceTextureBrush | null,
) {
  if (!next) return true
  return (
    next.mode !== previous?.mode ||
    next.featureId !== previous?.featureId ||
    next.outputRole !== previous?.outputRole
  )
}
