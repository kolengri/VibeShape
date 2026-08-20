import {
  type FeatureId,
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
  const direction = candidate?.signature.direction
  if (
    candidate?.kind !== "face" ||
    candidate.signature.geometryClass !== "PLANE" ||
    !direction ||
    !supportedPlanarRole(candidate.semanticRole)
  ) {
    return null
  }
  const parsed = sketchFeatureFaceSupportSchema.safeParse({
    kind: "feature-face",
    reference: {
      schemaVersion: 0,
      featureId,
      kind: "face",
      semanticRole: candidate.semanticRole,
      ...(candidate.lineageTokens[0] ? { lineageToken: candidate.lineageTokens[0] } : {}),
      signature: candidate.signature,
      intent: {
        nearPoint: candidate.signature.centroid,
        expectedDirection: direction,
      },
    },
  })
  return parsed.success ? { plane: nearestOriginPlane(direction), support: parsed.data } : null
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
