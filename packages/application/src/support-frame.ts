import {
  boxFeatureParametersSchema,
  cylinderFeatureParametersSchema,
  type DocumentSnapshot,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  type SketchRecord,
} from "@vibeshape/domain"
import { extrusionFrameSchema } from "@vibeshape/protocol"

export type SupportFrame = ReturnType<typeof extrusionFrameSchema.parse>
type Vector3 = readonly [number, number, number]

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
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
) {
  const parameters = readExtrusionFeatureParameters(feature)
  if (!parameters) return null
  const sourceSketch = document.sketches.find(({ id }) => id === parameters.profile.sketchId)
  if (!sourceSketch) return null
  const frame = sketchFrame(sourceSketch, document, features, visitedFeatureIds)
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
): SupportFrame | null {
  if (feature.type.typeId === "org.vibeshape.feature.part-design.box") {
    return boxSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.cylinder") {
    return cylinderSupportFrame(feature, role)
  }
  if (feature.type.typeId === "org.vibeshape.feature.part-design.extrusion") {
    return extrusionSupportFrame(feature, role, document, features, visitedFeatureIds)
  }
  if (
    feature.type.typeId === "org.vibeshape.feature.reference-geometry.datum-plane" &&
    role === "datum.plane"
  ) {
    return datumPlaneFrame(feature, document, features, visitedFeatureIds)
  }
  return null
}

export function sketchFrame(
  sketch: SketchRecord,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  visitedFeatureIds: ReadonlySet<string> = new Set(),
): SupportFrame | null {
  const support = sketch.support
  if (!support) return originPlaneFrame(sketch.plane)
  const reference = support.reference
  const role = reference.semanticRole
  if (!role || visitedFeatureIds.has(reference.featureId)) return null
  const feature = features.find(({ id }) => id === reference.featureId)
  if (!feature) return null
  return featureSupportFrame(
    feature,
    role,
    document,
    features,
    new Set([...visitedFeatureIds, reference.featureId]),
  )
}
