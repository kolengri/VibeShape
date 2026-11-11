import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  type BodyTopoRef,
  type BodyVertexRef,
  bodyVertexRefSchema,
  createTopologyReferenceResolver,
  type DocumentSnapshot,
  datumPointCircleEdgeRefSchema,
  isReferenceGeometryFeature,
  TOPOLOGY_RESOLUTION_POLICY,
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

type PeerResolver = (
  candidate: WorkerCandidate,
  reference: Parameters<ReturnType<typeof createTopologyReferenceResolver>>[0],
) => ReturnType<ReturnType<typeof createTopologyReferenceResolver>>

function isPointLike(candidate: WorkerCandidate) {
  const { min, max } = candidate.signature.bounds
  return min.every((value, index) => value === max[index])
}

/**
 * For point-like peers the signature scale is the absolute tolerance, so a peer at least that far
 * away scores at least (centroid + bounds weight) / total weight. When that floor exceeds the
 * acceptance score plus the ambiguity margin, such a peer can be neither the best match nor an
 * ambiguous rival, and resolving against the tolerance neighbourhood gives the full result.
 */
function farPeersAreIrrelevant() {
  const { weights, maximumScore, ambiguityMargin } = TOPOLOGY_RESOLUTION_POLICY
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  return (weights.centroid + weights.bounds) / total > maximumScore + ambiguityMargin
}

function peerResolver(peers: readonly WorkerCandidate[]): PeerResolver {
  if (!farPeersAreIrrelevant() || !peers.every(isPointLike)) {
    const full = createTopologyReferenceResolver(peers.map(domainCandidate))
    return (_candidate, reference) => full(reference)
  }
  const cell = TOPOLOGY_RESOLUTION_POLICY.absoluteTolerance
  const cellOf = (position: readonly number[]) => position.map((value) => Math.floor(value / cell))
  const buckets = new Map<string, WorkerCandidate[]>()
  for (const peer of peers) {
    const key = cellOf(peer.signature.centroid).join(":")
    buckets.set(key, [...(buckets.get(key) ?? []), peer])
  }
  return (candidate, reference) => {
    const [x, y, z] = cellOf(candidate.signature.centroid) as [number, number, number]
    const nearby: WorkerCandidate[] = []
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const dz of [-1, 0, 1])
          nearby.push(...(buckets.get(`${x + dx}:${y + dy}:${z + dz}`) ?? []))
    return createTopologyReferenceResolver(nearby.map(domainCandidate))(reference)
  }
}

type IdentityCounts = Readonly<{
  roles: ReadonlyMap<string, number>
  lineages: ReadonlyMap<string, number>
}>

/** Keeps only identity tokens that are unique among peers, as body references require. */
function uniqueIdentity(candidate: WorkerCandidate, counts: IdentityCounts) {
  const semanticRole =
    candidate.semanticRole && counts.roles.get(candidate.semanticRole) === 1
      ? candidate.semanticRole
      : undefined
  const lineageToken = candidate.lineageTokens.find((token) => counts.lineages.get(token) === 1)
  return { ...(semanticRole ? { semanticRole } : {}), ...(lineageToken ? { lineageToken } : {}) }
}

/**
 * Projects one body's candidates of one kind, stopping once `limit` options exist. Identity
 * counts and the topology index are built once per body and kind; an option is offered only
 * when its reference resolves back to exactly that candidate today, as the rebuild requires.
 */
function bodyOptions<Reference extends BodyVertexRef | BodyTopoRef>(
  source: BodySource,
  optionKind: OptionKind<Reference>,
  limit: number,
): DatumPointReferenceOption<Reference>[] {
  const options: DatumPointReferenceOption<Reference>[] = []
  if (limit <= 0) return options
  const peers = source.body.topologyCandidates.filter(({ kind }) => kind === optionKind.kind)
  const counts = {
    roles: uniqueCounts(peers.map(({ semanticRole }) => semanticRole)),
    lineages: uniqueCounts(peers.flatMap(({ lineageTokens }) => lineageTokens)),
  }
  const resolve = peerResolver(peers)
  for (const candidate of peers) {
    const option = candidateOption(source, optionKind, candidate, counts, resolve)
    if (option) options.push(option)
    if (options.length >= limit) break
  }
  return options
}

function candidateOption<Reference extends BodyVertexRef | BodyTopoRef>(
  source: BodySource,
  optionKind: OptionKind<Reference>,
  candidate: WorkerCandidate,
  counts: IdentityCounts,
  resolve: PeerResolver,
): DatumPointReferenceOption<Reference> | null {
  const position = optionKind.position(candidate)
  if (!position) return null
  const identity = uniqueIdentity(candidate, counts)
  const reference = optionKind.parse({
    schemaVersion: 1,
    featureId: source.featureId,
    outputRole: source.body.outputRole,
    kind: optionKind.kind,
    ...identity,
    signature: candidate.signature,
  })
  if (!reference) return null
  const { outputRole: _role, schemaVersion: _version, ...legacy } = reference
  const resolution = resolve(candidate, { ...legacy, schemaVersion: 0 })
  if (resolution.status !== "resolved" || resolution.candidateId !== candidate.candidateId)
    return null
  const name = identity.semanticRole ?? candidate.candidateId
  return {
    key: JSON.stringify([source.featureId, source.body.outputRole, candidate.candidateId]),
    label: `${source.featureLabel} · ${source.body.outputRole} · ${name} (${formatPosition(position)})`,
    position,
    reference,
  }
}

function cappedOptions<Reference extends BodyVertexRef | BodyTopoRef>(
  sources: readonly BodySource[],
  optionKind: OptionKind<Reference>,
) {
  const options: DatumPointReferenceOption<Reference>[] = []
  for (const source of sources) {
    options.push(...bodyOptions(source, optionKind, MAX_OPTIONS_PER_KIND - options.length))
    if (options.length >= MAX_OPTIONS_PER_KIND) break
  }
  return options
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
    vertices: cappedOptions(sources, vertexKind),
    circles: cappedOptions(sources, circleKind),
  }
}
