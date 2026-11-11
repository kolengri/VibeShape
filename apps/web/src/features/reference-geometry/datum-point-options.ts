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

function vertexPosition(candidate: WorkerCandidate): Vector | null {
  const geometry = candidate.referenceGeometry
  return candidate.kind === "vertex" && geometry?.kind === "vertex" ? geometry.position : null
}

const circularGeometryKinds = new Set(["circle-edge", "arc-edge"])

function circleCenter(candidate: WorkerCandidate): Vector | null {
  const geometry = candidate.referenceGeometry
  if (candidate.kind !== "edge" || !geometry || !circularGeometryKinds.has(geometry.kind))
    return null
  return "center" in geometry ? geometry.center : null
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

type BodySource = Readonly<{ featureId: string; featureLabel: string; body: Body }>
type OptionKind<Reference> = Readonly<{
  kind: "vertex" | "edge"
  position: (candidate: WorkerCandidate) => Vector | null
  parse: (value: unknown) => Reference | null
}>

const vertexKind: OptionKind<BodyVertexRef> = {
  kind: "vertex",
  position: vertexPosition,
  parse: (value) => {
    const parsed = bodyVertexRefSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  },
}
const circleKind: OptionKind<BodyTopoRef> = {
  kind: "edge",
  position: circleCenter,
  parse: (value) => {
    const parsed = datumPointCircleEdgeRefSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  },
}

/** Keeps only identity tokens that are unique among peers, as body references require. */
function uniqueIdentity(candidate: WorkerCandidate, peers: readonly WorkerCandidate[]) {
  const roles = uniqueCounts(peers.map(({ semanticRole }) => semanticRole))
  const lineages = uniqueCounts(peers.flatMap(({ lineageTokens }) => lineageTokens))
  const semanticRole =
    candidate.semanticRole && roles.get(candidate.semanticRole) === 1
      ? candidate.semanticRole
      : undefined
  const lineageToken = candidate.lineageTokens.find((token) => lineages.get(token) === 1)
  return { ...(semanticRole ? { semanticRole } : {}), ...(lineageToken ? { lineageToken } : {}) }
}

/** Only offers references that resolve back to exactly this candidate today. */
function resolvesToCandidate(
  reference: BodyVertexRef | BodyTopoRef,
  candidate: WorkerCandidate,
  peers: readonly TopologyCandidate[],
) {
  const { outputRole: _role, schemaVersion: _version, ...legacy } = reference
  const resolution = resolveTopologyReference({ ...legacy, schemaVersion: 0 }, peers)
  return resolution.status === "resolved" && resolution.candidateId === candidate.candidateId
}

function bodyOptions<Reference extends BodyVertexRef | BodyTopoRef>(
  source: BodySource,
  optionKind: OptionKind<Reference>,
): DatumPointReferenceOption<Reference>[] {
  const peers = source.body.topologyCandidates.filter(({ kind }) => kind === optionKind.kind)
  const domainPeers = peers.map(domainCandidate)
  return peers.flatMap((candidate) => {
    const position = optionKind.position(candidate)
    const identity = position ? uniqueIdentity(candidate, peers) : null
    const reference = optionKind.parse({
      schemaVersion: 1,
      featureId: source.featureId,
      outputRole: source.body.outputRole,
      kind: optionKind.kind,
      ...identity,
      signature: candidate.signature,
    })
    if (!position || !reference || !resolvesToCandidate(reference, candidate, domainPeers))
      return []
    const name = identity?.semanticRole ?? candidate.candidateId
    return [
      {
        key: JSON.stringify([source.featureId, source.body.outputRole, candidate.candidateId]),
        label: `${source.featureLabel} · ${source.body.outputRole} · ${name} (${formatPosition(position)})`,
        position,
        reference,
      },
    ]
  })
}

/** Valid single-solid bodies of earlier, unsuppressed, non-reference features. */
function bodySources(
  snapshot: DocumentSnapshot,
  rebuilt: Rebuilt,
  excludedFeatureId: string | undefined,
): BodySource[] {
  const stop = excludedFeatureId
    ? snapshot.features.findIndex(({ id }) => id === excludedFeatureId)
    : -1
  const features = stop >= 0 ? snapshot.features.slice(0, stop) : snapshot.features
  const geometry = new Map(rebuilt.response.geometry.map((record) => [record.featureId, record]))
  return features
    .filter((feature) => !feature.suppressed && !isReferenceGeometryFeature(feature))
    .flatMap((feature) =>
      (geometry.get(feature.id)?.geometry.bodies ?? [])
        .filter(({ shape }) => shape.valid && shape.solidCount === 1)
        .map((body) => ({
          featureId: feature.id,
          featureLabel: feature.label ?? feature.type.typeId,
          body,
        })),
    )
}

export function datumPointOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
): DatumPointOptions {
  if (!rebuild.ok) return { vertices: [], circles: [] }
  const sources = bodySources(snapshot, rebuild, excludedFeatureId)
  return {
    vertices: sources
      .flatMap((source) => bodyOptions(source, vertexKind))
      .slice(0, MAX_OPTIONS_PER_KIND),
    circles: sources
      .flatMap((source) => bodyOptions(source, circleKind))
      .slice(0, MAX_OPTIONS_PER_KIND),
  }
}
