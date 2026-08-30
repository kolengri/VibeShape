import {
  type FeatureId,
  type PlanarFaceTopoRef,
  resolveTopologyReference,
  type SketchFeatureFaceSupport,
  type SketchRecord,
  sketchFeatureFaceSupportSchema,
  type TopologyCandidate,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../../document/document-controller"

export type SelectedSketchSupport = Readonly<{
  plane: SketchRecord["plane"]
  support: SketchFeatureFaceSupport
}>

const supportedFixedPlanarRoles = new Set([
  "datum.plane",
  "primitive.box.side.x-min",
  "primitive.box.side.x-max",
  "primitive.box.side.y-min",
  "primitive.box.side.y-max",
  "primitive.box.cap.start",
  "primitive.box.cap.end",
  "primitive.cylinder.cap.start",
  "primitive.cylinder.cap.end",
  "extrusion.cap.start",
  "extrusion.cap.end",
])

type DocumentRebuiltResponse = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

export type SketchSupportHealth = Readonly<{
  status: "resolved" | "missing" | "ambiguous" | "unknown"
}>

function domainCandidate(
  candidate: DocumentRebuiltResponse["geometry"][number]["geometry"]["topologyCandidates"][number],
): TopologyCandidate {
  const { referenceGeometry: _referenceGeometry, ...result } = candidate
  return result
}

export function inspectSketchSupportHealth(
  sketch: SketchRecord,
  rebuild: DocumentRebuiltResponse | undefined,
): SketchSupportHealth | null {
  const reference = sketch.support?.reference
  if (!reference) return null
  if (!rebuild) return { status: "unknown" }
  if (!supportedPlanarRole(reference.semanticRole)) return { status: "missing" }
  const evaluation = rebuild.evaluation.records.find(
    ({ featureId }) => featureId === reference.featureId,
  )
  if (evaluation?.status !== "succeeded") return { status: "unknown" }
  const geometry = rebuild.geometry.find(({ featureId }) => featureId === reference.featureId)
  if (!geometry) return { status: "unknown" }
  const resolution = resolveTopologyReference(
    reference,
    geometry.geometry.topologyCandidates.map(domainCandidate),
  )
  if (resolution.status !== "resolved") return { status: resolution.status }
  const candidate = geometry.geometry.topologyCandidates.find(
    ({ candidateId }) => candidateId === resolution.candidateId,
  )
  const signature = candidate?.signature
  return {
    status:
      candidate?.kind === "face" &&
      signature?.geometryClass === "PLANE" &&
      signature.directionMode === "oriented" &&
      signature.direction
        ? "resolved"
        : "missing",
  }
}

function supportedPlanarRole(role: string | undefined) {
  if (!role) return false
  if (supportedFixedPlanarRoles.has(role)) return true
  return role.startsWith("extrusion.side.") && role.length > "extrusion.side.".length
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
