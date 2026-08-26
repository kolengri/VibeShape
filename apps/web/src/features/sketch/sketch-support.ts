import {
  type FeatureId,
  type PlanarFaceTopoRef,
  type SketchFeatureFaceSupport,
  type SketchRecord,
  sketchFeatureFaceSupportSchema,
  type TopologyCandidate,
} from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../../document/document-controller"

export type SelectedSketchSupport = Readonly<{
  plane: SketchRecord["plane"]
  support: SketchFeatureFaceSupport
}>

function supportedPlanarRole(role: string | undefined) {
  if (!role) return false
  if (role === "datum.plane") return true
  if (role.startsWith("primitive.box.")) return true
  if (role === "primitive.cylinder.cap.start") return true
  if (role === "primitive.cylinder.cap.end") return true
  if (role === "extrusion.cap.start") return true
  return role === "extrusion.cap.end"
}

export function selectedPlanarFaceReference(
  featureId: FeatureId,
  meshFaceId: number,
  candidates: readonly TopologyCandidate[],
): PlanarFaceTopoRef | null {
  const candidate = candidates.find((item) => item.meshFaceId === meshFaceId)
  const direction = candidate?.signature.direction
  if (candidate?.kind !== "face" || candidate.signature.geometryClass !== "PLANE" || !direction) {
    return null
  }
  const parsed = sketchFeatureFaceSupportSchema.shape.reference.safeParse({
    schemaVersion: 0,
    featureId,
    kind: "face",
    ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
    ...(candidate.lineageTokens.length === 1 ? { lineageToken: candidate.lineageTokens[0] } : {}),
    signature: candidate.signature,
    intent: {
      nearPoint: candidate.signature.centroid,
      expectedDirection: direction,
    },
  })
  return parsed.success ? parsed.data : null
}

function nearestOriginPlane(direction: readonly [number, number, number]): SketchRecord["plane"] {
  const x = Math.abs(direction[0])
  const y = Math.abs(direction[1])
  const z = Math.abs(direction[2])
  if (x >= y && x >= z) return "yz"
  return y >= z ? "xz" : "xy"
}

export function selectedSketchSupport(
  featureId: FeatureId,
  meshFaceId: number,
  candidates: readonly TopologyCandidate[],
): SelectedSketchSupport | null {
  const candidate = candidates.find((item) => item.meshFaceId === meshFaceId)
  const reference = selectedPlanarFaceReference(featureId, meshFaceId, candidates)
  const direction = reference?.signature.direction
  if (!candidate || !reference || !direction || !supportedPlanarRole(candidate.semanticRole))
    return null
  const parsed = sketchFeatureFaceSupportSchema.safeParse({
    kind: "feature-face",
    reference,
  })
  return parsed.success ? { plane: nearestOriginPlane(direction), support: parsed.data } : null
}

export function selectedPlanarFaceReferenceFromController(
  controller: DocumentControllerState,
  selection: ViewerSelection,
) {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return null
  const geometry = rebuild.response.geometry.find(
    ({ featureId }) => featureId === selection.featureId,
  )
  return geometry
    ? selectedPlanarFaceReference(
        selection.featureId as FeatureId,
        selection.faceId,
        geometry.geometry.topologyCandidates,
      )
    : null
}

export function selectedSketchSupportFromController(
  controller: DocumentControllerState,
  selection: ViewerSelection,
) {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return null
  const geometry = rebuild.response.geometry.find(
    ({ featureId }) => featureId === selection.featureId,
  )
  return geometry
    ? selectedSketchSupport(
        selection.featureId as FeatureId,
        selection.faceId,
        geometry.geometry.topologyCandidates,
      )
    : null
}
