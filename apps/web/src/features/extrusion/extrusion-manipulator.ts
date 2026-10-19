import type { FeatureId, readExtrusionFeatureParameters } from "@vibeshape/domain"
import {
  createViewerSketchProfileGeometry,
  isValidViewerFrame,
  type ViewerFrame,
  type ViewerSketch,
  type ViewerSketchProfile,
  type ViewerVector3,
  viewerSketchProfileKey,
} from "@vibeshape/viewer/three-viewport"
import {
  type ExtrusionDistanceRequest,
  finiteExtrusionDistance,
} from "./extrusion-distance-manipulator"

type ExtrusionParameters = NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>

export type ExtrusionProfileCentroid = Readonly<{
  profileKey: string
  position: readonly [number, number]
}>

export type ExtrusionManipulator = Readonly<{
  direction: ViewerVector3
  distance: number
  distanceScale: number
  featureId: FeatureId
  origin: ViewerVector3
  secondDistance: number | null
}>

const LOCAL_PROFILE_FRAME: ViewerFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}

function profileAreaCentroid(profile: ViewerSketchProfile): readonly [number, number] | null {
  // Triangulate locally so distant support origins cannot erase small profiles in Float32 buffers.
  const geometry = createViewerSketchProfileGeometry(profile, LOCAL_PROFILE_FRAME)
  if (!geometry) return null
  try {
    const positions = geometry.getAttribute("position")
    const indices = geometry.getIndex()
    if (!indices) return null
    let area = 0
    let weightedX = 0
    let weightedY = 0
    for (let index = 0; index < indices.count; index += 3) {
      const a = indices.getX(index)
      const b = indices.getX(index + 1)
      const c = indices.getX(index + 2)
      const ax = positions.getX(a)
      const ay = positions.getY(a)
      const bx = positions.getX(b)
      const by = positions.getY(b)
      const cx = positions.getX(c)
      const cy = positions.getY(c)
      const triangleArea = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
      area += triangleArea
      weightedX += ((ax + bx + cx) / 3) * triangleArea
      weightedY += ((ay + by + cy) / 3) * triangleArea
    }
    if (!Number.isFinite(area) || area <= 0) return null
    const x = weightedX / area
    const y = weightedY / area
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  } finally {
    geometry.dispose()
  }
}

/** Materializes only profile-local geometry; callers retain it across depth and placement updates. */
export function extrusionProfileCentroid(
  sketch: ViewerSketch | null,
  profileKey: string | null,
): ExtrusionProfileCentroid | null {
  if (!sketch || profileKey === null) return null
  const profile = sketch.profiles?.find(
    ({ selector }) => viewerSketchProfileKey(selector) === profileKey,
  )
  if (!profile || profile.selector.sketchId !== sketch.sketchId) return null
  const position = profileAreaCentroid(profile)
  return position ? { profileKey, position } : null
}

function requestedDistance(
  featureId: FeatureId,
  distance: number,
  request: ExtrusionDistanceRequest | null,
  side: "first" | "second",
) {
  return request?.featureId === featureId && (request.side ?? "first") === side
    ? request.distance
    : distance
}

/** Anchors the primary profile's depth controls without combining distinct sketch normals. */
export function createExtrusionManipulator(
  featureId: FeatureId,
  parameters: ExtrusionParameters,
  centroid: ExtrusionProfileCentroid | null,
  frame: ViewerFrame | null | undefined,
  distanceRequest: ExtrusionDistanceRequest | null,
): ExtrusionManipulator | null {
  if (parameters.endCondition && parameters.endCondition.kind !== "distance") return null
  if (
    !centroid ||
    centroid.profileKey !== viewerSketchProfileKey(parameters.profile) ||
    !frame ||
    !isValidViewerFrame(frame)
  ) {
    return null
  }
  const distance = requestedDistance(featureId, parameters.distance.value, distanceRequest, "first")
  const secondDistance = parameters.secondDistance
    ? requestedDistance(featureId, parameters.secondDistance.value, distanceRequest, "second")
    : null
  const startOffset = parameters.startOffset?.value ?? 0
  if (
    !finiteExtrusionDistance(distance) ||
    (secondDistance !== null && !finiteExtrusionDistance(secondDistance)) ||
    !Number.isFinite(startOffset)
  ) {
    return null
  }
  const [x, y] = centroid.position
  // Start offset is a reference-normal coordinate, independent of reverse and symmetric depth.
  const origin: ViewerVector3 = [
    frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y + frame.normal[0] * startOffset,
    frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y + frame.normal[1] * startOffset,
    frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y + frame.normal[2] * startOffset,
  ]
  if (!origin.every(Number.isFinite)) return null
  const sign = parameters.reversed ? -1 : 1
  const distanceScale = parameters.symmetric ? 2 : 1
  return {
    direction: [frame.normal[0] * sign, frame.normal[1] * sign, frame.normal[2] * sign],
    distance: distance / distanceScale,
    distanceScale,
    featureId,
    origin,
    secondDistance,
  }
}
