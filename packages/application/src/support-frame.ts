import {
  boxFeatureParametersSchema,
  cylinderFeatureParametersSchema,
  type DocumentSnapshot,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  resolveTopologyReference,
  type SketchRecord,
  type TopologyCandidate,
} from "@vibeshape/domain"
import { extrusionFrameSchema } from "@vibeshape/protocol"

export type SupportFrame = ReturnType<typeof extrusionFrameSchema.parse>
type Vector3 = readonly [number, number, number]
export type SupportFrameGeometryRecord = Readonly<{
  featureId: string
  geometry: Readonly<{
    topologyCandidates: readonly (TopologyCandidate & Readonly<{ referenceGeometry?: unknown }>)[]
  }>
}>
type CurrentGeometry =
  | SupportFrameGeometryRecord
  | readonly SupportFrameGeometryRecord[]
  | ReadonlyMap<string, SupportFrameGeometryRecord>

export type SupportPoint2 = Readonly<{ x: number; y: number }>

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function supportPointToWorld(frame: SupportFrame, point: SupportPoint2): Vector3 {
  return [
    frame.origin[0] + frame.xAxis[0] * point.x + frame.yAxis[0] * point.y,
    frame.origin[1] + frame.xAxis[1] * point.x + frame.yAxis[1] * point.y,
    frame.origin[2] + frame.xAxis[2] * point.x + frame.yAxis[2] * point.y,
  ]
}

export function projectWorldPointToSupport(frame: SupportFrame, point: Vector3): SupportPoint2 {
  const relative: Vector3 = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ]
  return { x: dot(relative, frame.xAxis), y: dot(relative, frame.yAxis) }
}

export function projectSketchPointBetweenFrames(
  source: SupportFrame,
  target: SupportFrame,
  point: SupportPoint2,
) {
  const world = supportPointToWorld(source, point)
  return { local: projectWorldPointToSupport(target, world), world } as const
}

function cross(left: Vector3, right: Vector3): [number, number, number] {
  const [leftX, leftY, leftZ] = left
  const [rightX, rightY, rightZ] = right
  return [
    leftY * rightZ - leftZ * rightY,
    leftZ * rightX - leftX * rightZ,
    leftX * rightY - leftY * rightX,
  ]
}

function normalize(vector: Vector3): [number, number, number] | null {
  const magnitude = Math.hypot(...vector)
  return magnitude > Number.EPSILON
    ? [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
    : null
}

function frameFromNormal(origin: Vector3, normal: Vector3): SupportFrame | null {
  const unitNormal = normalize(normal)
  if (!unitNormal) return null
  const reference: Vector3 = Math.abs(unitNormal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const projection = dot(reference, unitNormal)
  const projected: [number, number, number] = [
    reference[0] - projection * unitNormal[0],
    reference[1] - projection * unitNormal[1],
    reference[2] - projection * unitNormal[2],
  ]
  const xAxis = normalize(projected)
  if (!xAxis) return null
  return extrusionFrameSchema.parse({
    origin,
    xAxis,
    yAxis: cross(unitNormal, xAxis),
    normal: unitNormal,
  })
}

function projectAnchorOntoPlane(anchor: Vector3, planePoint: Vector3, normal: Vector3): Vector3 {
  const offset = dot(
    [planePoint[0] - anchor[0], planePoint[1] - anchor[1], planePoint[2] - anchor[2]],
    normal,
  )
  return [
    anchor[0] + normal[0] * offset,
    anchor[1] + normal[1] * offset,
    anchor[2] + normal[2] * offset,
  ]
}

function currentFeatureGeometry(
  geometry: CurrentGeometry | undefined,
  featureId: string,
): SupportFrameGeometryRecord | undefined {
  if (!geometry) return undefined
  if ("get" in geometry) return geometry.get(featureId)
  if ("featureId" in geometry) return geometry.featureId === featureId ? geometry : undefined
  return geometry.find((record) => record.featureId === featureId)
}

function domainCandidate(
  candidate: SupportFrameGeometryRecord["geometry"]["topologyCandidates"][number],
): TopologyCandidate {
  const { referenceGeometry: _referenceGeometry, ...result } = candidate
  return result
}

function orientedPlanarGeometry(
  candidate: SupportFrameGeometryRecord["geometry"]["topologyCandidates"][number] | undefined,
): Readonly<{ centroid: Vector3; direction: Vector3 }> | null {
  if (candidate?.kind !== "face") return null
  const { signature } = candidate
  if (
    signature.geometryClass !== "PLANE" ||
    signature.directionMode !== "oriented" ||
    !signature.direction
  ) {
    return null
  }
  return { centroid: signature.centroid, direction: signature.direction }
}

function currentPlanarSupportFrame(
  reference: NonNullable<SketchRecord["support"]>["reference"],
  geometry: CurrentGeometry | undefined,
): SupportFrame | null {
  const record = currentFeatureGeometry(geometry, reference.featureId)
  if (!record) return null
  const resolution = resolveTopologyReference(
    reference,
    record.geometry.topologyCandidates.map(domainCandidate),
  )
  if (resolution.status !== "resolved") return null
  const plane = orientedPlanarGeometry(
    record.geometry.topologyCandidates.find(
      ({ candidateId }) => candidateId === resolution.candidateId,
    ),
  )
  if (!plane) return null
  const anchor = reference.intent?.nearPoint ?? reference.signature.centroid
  return frameFromNormal(
    projectAnchorOntoPlane(anchor, plane.centroid, plane.direction),
    plane.direction,
  )
}

function originPlaneFrame(plane: SketchRecord["plane"]): SupportFrame {
  if (plane === "xz") {
    return { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] }
  }
  if (plane === "yz") {
    return { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] }
  }
  return { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
}

function translatedFrame(frame: SupportFrame, offset: number, reverse = false): SupportFrame {
  return extrusionFrameSchema.parse({
    origin: [
      frame.origin[0] + frame.normal[0] * offset,
      frame.origin[1] + frame.normal[1] * offset,
      frame.origin[2] + frame.normal[2] * offset,
    ],
    xAxis: frame.xAxis,
    yAxis: reverse ? frame.yAxis.map((coordinate) => -coordinate) : frame.yAxis,
    normal: reverse ? frame.normal.map((coordinate) => -coordinate) : frame.normal,
  })
}

function boxSupportFrame(feature: FeatureRecord, role: string) {
  const parameters = boxFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return null
  const { centered, depth, height, origin, width } = parameters.data
  const originX = origin.x.value
  const originY = origin.y.value
  const originZ = origin.z.value
  const minimumZ = originZ + (centered ? -height.value / 2 : 0)
  const maximumZ = originZ + (centered ? height.value / 2 : height.value)
  const definitions: Readonly<Record<string, readonly [Vector3, Vector3]>> = {
    "primitive.box.side.x-min": [
      [-1, 0, 0],
      [originX - width.value / 2, originY, originZ],
    ],
    "primitive.box.side.x-max": [
      [1, 0, 0],
      [originX + width.value / 2, originY, originZ],
    ],
    "primitive.box.side.y-min": [
      [0, -1, 0],
      [originX, originY - depth.value / 2, originZ],
    ],
    "primitive.box.side.y-max": [
      [0, 1, 0],
      [originX, originY + depth.value / 2, originZ],
    ],
    "primitive.box.cap.start": [
      [0, 0, -1],
      [originX, originY, minimumZ],
    ],
    "primitive.box.cap.end": [
      [0, 0, 1],
      [originX, originY, maximumZ],
    ],
  }
  const definition = definitions[role]
  if (!definition) return null
  const [normal, faceOrigin] = definition
  return frameFromNormal(faceOrigin, normal)
}

function cylinderSupportFrame(feature: FeatureRecord, role: string) {
  const parameters = cylinderFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return null
  const { centered, height, origin } = parameters.data
  const originX = origin.x.value
  const originY = origin.y.value
  const originZ = origin.z.value
  if (role === "primitive.cylinder.cap.start") {
    const z = originZ + (centered ? -height.value / 2 : 0)
    return frameFromNormal([originX, originY, z], [0, 0, -1])
  }
  if (role === "primitive.cylinder.cap.end") {
    const z = originZ + (centered ? height.value / 2 : height.value)
    return frameFromNormal([originX, originY, z], [0, 0, 1])
  }
  return null
}

function extrusionSupportFrame(
  feature: FeatureRecord,
  role: string,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
  geometry: CurrentGeometry | undefined,
) {
  const parameters = readExtrusionFeatureParameters(feature)
  if (!parameters) return null
  const sourceSketch = document.sketches.find(({ id }) => id === parameters.profile.sketchId)
  if (!sourceSketch) return null
  const frame = sketchFrame(sourceSketch, document, features, visitedFeatureIds, geometry)
  if (!frame) return null
  const start = parameters.symmetric ? -parameters.distance.value / 2 : 0
  if (role === "extrusion.cap.start") return translatedFrame(frame, start, true)
  return role === "extrusion.cap.end"
    ? translatedFrame(frame, start + parameters.distance.value)
    : null
}

export function datumPlaneFrame(
  feature: FeatureRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
  geometry?: CurrentGeometry,
): SupportFrame | null {
  const parameters = readDatumPlaneFeatureParameters(feature)
  if (!parameters) return null
  const support = parameters.support
  const baseFrame: SupportFrame | null =
    support.kind === "origin-plane"
      ? originPlaneFrame(support.plane)
      : (() => {
          const source = features.find(({ id }) => id === support.reference.featureId)
          const role = support.reference.semanticRole
          if (!source || !role || visitedFeatureIds.has(source.id)) return null
          return featureSupportFrame(
            source,
            role,
            document,
            features,
            new Set([...visitedFeatureIds, source.id]),
            geometry,
          )
        })()
  return baseFrame ? translatedFrame(baseFrame, parameters.offset.value) : null
}

function featureSupportFrame(
  feature: FeatureRecord,
  role: string,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string>,
  geometry: CurrentGeometry | undefined,
): SupportFrame | null {
  if (feature.type.typeId === "org.vibeshape.feature.part-design.box") {
    return boxSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.cylinder") {
    return cylinderSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.extrusion") {
    return extrusionSupportFrame(feature, role, document, features, visitedFeatureIds, geometry)
  }
  if (
    feature.type.typeId === "org.vibeshape.feature.reference-geometry.datum-plane" &&
    role === "datum.plane"
  ) {
    return datumPlaneFrame(feature, document, features, visitedFeatureIds, geometry)
  }
  return null
}

export function sketchFrame(
  sketch: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string> = new Set(),
  geometry?: CurrentGeometry,
): SupportFrame | null {
  const support = sketch.support
  if (!support) return originPlaneFrame(sketch.plane)
  const reference = support.reference
  const role = reference.semanticRole
  if (!role || visitedFeatureIds.has(reference.featureId)) return null
  const feature = features.find(({ id }) => id === reference.featureId)
  if (!feature) return null
  return (
    featureSupportFrame(
      feature,
      role,
      document,
      features,
      new Set([...visitedFeatureIds, reference.featureId]),
      geometry,
    ) ??
    (feature.type.typeId === "org.vibeshape.feature.part-design.extrusion" &&
    role.startsWith("extrusion.side.")
      ? currentPlanarSupportFrame(reference, geometry)
      : null)
  )
}
