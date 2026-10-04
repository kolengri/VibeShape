import {
  type PlanarFaceTopoRef,
  resolveTopologyReference,
  type SketchRecord,
  type TopologyCandidate,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"

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
  const {
    referenceGeometry: _referenceGeometry,
    edgePolyline: _edgePolyline,
    ...result
  } = candidate
  return result
}

function supportCandidates(reference: PlanarFaceTopoRef, candidates: readonly TopologyCandidate[]) {
  const direction = reference.signature.direction
  if (
    reference.semanticRole !== "datum.plane" ||
    reference.signature.directionMode !== "oriented" ||
    !direction
  )
    return candidates
  // Datum display caps share one role; retain the authored oriented face rather than a native index.
  return candidates.filter((candidate) => {
    const signature = candidate.signature
    return (
      candidate.kind === "face" &&
      candidate.semanticRole === "datum.plane" &&
      signature.geometryClass === "PLANE" &&
      signature.directionMode === "oriented" &&
      signature.direction &&
      Math.hypot(...signature.direction.map((value, i) => value - (direction[i] ?? 0))) <= 1e-9
    )
  })
}

export function inspectPlanarSupportHealth(
  reference: PlanarFaceTopoRef,
  rebuild: DocumentRebuiltResponse | undefined,
): SketchSupportHealth | null {
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
    supportCandidates(reference, geometry.geometry.topologyCandidates.map(domainCandidate)),
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

export function supportedPlanarRole(role: string | undefined) {
  if (!role) return false
  if (supportedFixedPlanarRoles.has(role)) return true
  return role.startsWith("extrusion.side.") && role.length > "extrusion.side.".length
}

export function inspectSketchSupportHealth(
  sketch: SketchRecord,
  rebuild: DocumentRebuiltResponse | undefined,
): SketchSupportHealth | null {
  return sketch.support ? inspectPlanarSupportHealth(sketch.support.reference, rebuild) : null
}
