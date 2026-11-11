import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  type BodyTopoRef,
  type BodyVertexRef,
  bodyVertexRefSchema,
  type DocumentSnapshot,
  datumPointCircleEdgeRefSchema,
  isReferenceGeometryFeature,
  resolveTopologyReference,
  type TopologyCandidate,
} from "@vibeshape/domain"

type Vector = readonly [number, number, number]
type Rebuilt = Extract<DocumentRebuildOutcome, { ok: true }>
type Geometry = Rebuilt["response"]["geometry"][number]
type Body = NonNullable<Geometry["geometry"]["bodies"]>[number]
type WorkerCandidate = Body["topologyCandidates"][number]

export type DatumPointReferenceOption<Reference> = Readonly<{
  key: string
  label: string
  position: Vector
  reference: Reference
}>
export type DatumPointOptions = Readonly<{
  vertices: readonly DatumPointReferenceOption<BodyVertexRef>[]
  circles: readonly DatumPointReferenceOption<BodyTopoRef>[]
}>

/** Bounds the native select lists on dense meshes; coordinates remain available for any point. */
const MAX_OPTIONS_PER_KIND = 2_000

function candidatePosition(candidate: WorkerCandidate): Vector | null {
  const geometry = candidate.referenceGeometry
  if (candidate.kind === "vertex") return geometry?.kind === "vertex" ? geometry.position : null
  if (candidate.kind !== "edge" || candidate.signature.geometryClass !== "CIRCLE") return null
  return geometry?.kind === "circle-edge" || geometry?.kind === "arc-edge" ? geometry.center : null
}

function domainCandidate(candidate: WorkerCandidate): TopologyCandidate {
  const { candidateId, kind, semanticRole, lineageTokens, signature } = candidate
  return { candidateId, kind, ...(semanticRole ? { semanticRole } : {}), lineageTokens, signature }
}

function uniqueCounts(values: readonly (string | undefined)[]) {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function formatPosition(position: Vector) {
  return position.map((value) => Number(value.toFixed(3))).join(", ")
}

/** Projects every uniquely resolvable vertex or circle of one body into a persisted reference. */
function bodyOptions(featureId: string, featureLabel: string, body: Body, kind: "vertex" | "edge") {
  const peers = body.topologyCandidates.filter((candidate) => candidate.kind === kind)
  const domainPeers = peers.map(domainCandidate)
  const roles = uniqueCounts(peers.map(({ semanticRole }) => semanticRole))
  const lineages = uniqueCounts(peers.flatMap(({ lineageTokens }) => lineageTokens))
  const options: DatumPointReferenceOption<BodyVertexRef | BodyTopoRef>[] = []
  for (const candidate of peers) {
    const position = candidatePosition(candidate)
    if (!position) continue
    const semanticRole =
      candidate.semanticRole && roles.get(candidate.semanticRole) === 1
        ? candidate.semanticRole
        : undefined
    const lineageToken = candidate.lineageTokens.find((token) => lineages.get(token) === 1)
    const reference = {
      schemaVersion: 1,
      featureId,
      outputRole: body.outputRole,
      kind,
      ...(semanticRole ? { semanticRole } : {}),
      ...(lineageToken ? { lineageToken } : {}),
      signature: candidate.signature,
    }
    const parsed = (
      kind === "vertex" ? bodyVertexRefSchema : datumPointCircleEdgeRefSchema
    ).safeParse(reference)
    if (!parsed.success) continue
    const { outputRole: _role, schemaVersion: _version, ...legacy } = parsed.data
    const resolution = resolveTopologyReference({ ...legacy, schemaVersion: 0 }, domainPeers)
    // Only offer references that resolve back to exactly this candidate today.
    if (resolution.status !== "resolved" || resolution.candidateId !== candidate.candidateId)
      continue
    options.push({
      key: JSON.stringify([featureId, body.outputRole, candidate.candidateId]),
      label: `${featureLabel} · ${body.outputRole} · ${semanticRole ?? candidate.candidateId} (${formatPosition(position)})`,
      position,
      reference: parsed.data,
    })
  }
  return options
}

export function datumPointOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
): DatumPointOptions {
  const vertices: DatumPointReferenceOption<BodyVertexRef>[] = []
  const circles: DatumPointReferenceOption<BodyTopoRef>[] = []
  if (!rebuild.ok) return { vertices, circles }
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  for (const feature of features) {
    if (feature.suppressed || isReferenceGeometryFeature(feature)) continue
    const record = rebuild.response.geometry.find(({ featureId }) => featureId === feature.id)
    const label = feature.label ?? feature.type.typeId
    for (const body of record?.geometry.bodies ?? []) {
      if (!body.shape.valid || body.shape.solidCount !== 1) continue
      for (const option of bodyOptions(feature.id, label, body, "vertex"))
        if (option.reference.kind === "vertex" && vertices.length < MAX_OPTIONS_PER_KIND)
          vertices.push({ ...option, reference: option.reference })
      for (const option of bodyOptions(feature.id, label, body, "edge"))
        if (option.reference.kind === "edge" && circles.length < MAX_OPTIONS_PER_KIND)
          circles.push({ ...option, reference: option.reference })
    }
  }
  return { vertices, circles }
}
