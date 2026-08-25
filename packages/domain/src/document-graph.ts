import { isAnyObject, isArray, isString } from "is-what"
import { type ZodError, z } from "zod"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { featureIdSchema, sketchIdSchema } from "./identifiers"
import { readExtrusionFeatureParameters } from "./part-design"
import { isSketchExternalModelReference, type SketchRecord, sketchRecordSchema } from "./sketch"

const MAX_NODES = 100_256
// Keep the retained graph bounded independently of larger per-record schema limits. The aggregate
// check runs before edge objects, keys, or adjacency sets are allocated.
const MAX_EDGES = 100_000
const MAX_DIAGNOSTICS = 8

export const documentNodeRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sketch"), id: sketchIdSchema }).strict(),
  z.object({ kind: z.literal("feature"), id: featureIdSchema }).strict(),
])

export type DocumentNodeRef = Readonly<z.infer<typeof documentNodeRefSchema>>
export type HistoryItemRef = DocumentNodeRef

export type DocumentGraphNode = Readonly<{
  ref: DocumentNodeRef
  record: SketchRecord | FeatureRecord
}>

export type DocumentGraphEdgeRelation =
  | "feature-dependency"
  | "feature-topology-reference"
  | "extrusion-profile"
  | "sketch-support"
  | "external-sketch"

export type DocumentGraphEdge = Readonly<{
  source: DocumentNodeRef
  target: DocumentNodeRef
  relation: DocumentGraphEdgeRelation
}>

export type DocumentGraphDiagnostic = Readonly<{
  code:
    | "invalid-sketch"
    | "invalid-feature"
    | "invalid-history"
    | "duplicate-node"
    | "duplicate-history"
    | "missing-node"
    | "history-coverage"
    | "forward-reference"
    | "self-reference"
    | "cycle"
    | "node-limit"
    | "edge-limit"
  message: string
  issues: readonly { path: string; message: string }[]
}>

export type DocumentDependencyGraph = Readonly<{
  nodes: readonly DocumentGraphNode[]
  edges: readonly DocumentGraphEdge[]
  history: readonly HistoryItemRef[]
  evaluationOrder: readonly DocumentNodeRef[]
  getNode: (ref: DocumentNodeRef) => DocumentGraphNode | undefined
  dependenciesOf: (ref: DocumentNodeRef) => readonly DocumentNodeRef[]
  dependentsOf: (ref: DocumentNodeRef) => readonly DocumentNodeRef[]
}>

export type DocumentDependencyGraphResult =
  | Readonly<{ ok: true; graph: DocumentDependencyGraph }>
  | Readonly<{ ok: false; diagnostic: DocumentGraphDiagnostic }>

// Slice 0 intentionally derives only the durable built-in relation fields; extension parameters
// are opaque unless a trusted built-in reader recognizes them.

type Input = Readonly<{
  sketches: readonly unknown[]
  features: readonly unknown[]
  history: readonly unknown[]
}>

function key(ref: DocumentNodeRef) {
  return `${ref.kind}:${ref.id}`
}

function diagnostic(
  code: DocumentGraphDiagnostic["code"],
  message: string,
  issues: readonly { path: string; message: string }[] = [],
): GraphFailure {
  return { ok: false, diagnostic: { code, message, issues: issues.slice(0, MAX_DIAGNOSTICS) } }
}

function invalidRecord(code: "invalid-sketch" | "invalid-feature", index: number, error: ZodError) {
  return diagnostic(
    code,
    `The ${code === "invalid-sketch" ? "sketch" : "feature"} at index ${index} is invalid.`,
    error.issues.map((issue) => ({
      path: `${index}.${issue.path.join(".")}`,
      message: issue.message,
    })),
  )
}

function asRef(value: unknown) {
  const parsed = documentNodeRefSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

type IndexedDocument = Readonly<{
  sketches: readonly SketchRecord[]
  features: readonly FeatureRecord[]
  nodes: readonly DocumentGraphNode[]
  byKey: ReadonlyMap<string, DocumentGraphNode>
}>

type IndexedHistory = Readonly<{
  history: readonly HistoryItemRef[]
  historyIndex: ReadonlyMap<string, number>
}>

type CollectedEdges = Readonly<{
  edges: readonly DocumentGraphEdge[]
  dependencies: ReadonlyMap<string, ReadonlySet<string>>
  dependents: ReadonlyMap<string, ReadonlySet<string>>
  ownerPathByEdge: ReadonlyMap<string, string>
}>

type GraphFailure = Extract<DocumentDependencyGraphResult, { ok: false }>

function isFailure<T>(value: GraphFailure | T): value is GraphFailure {
  return isAnyObject(value) && "ok" in value && value.ok === false
}

function parseSketches(values: readonly unknown[]): GraphFailure | readonly SketchRecord[] {
  const sketches: SketchRecord[] = []
  for (const [index, value] of values.entries()) {
    const parsed = sketchRecordSchema.safeParse(value)
    if (!parsed.success) return invalidRecord("invalid-sketch", index, parsed.error)
    sketches.push(parsed.data)
  }
  return sketches
}

function selfFeatureDependencyIndex(value: unknown) {
  if (!isAnyObject(value) || !isString(value.id) || !isArray(value.dependencies)) return
  const index = value.dependencies.indexOf(value.id)
  return index >= 0 ? index : undefined
}

function parseFeatures(values: readonly unknown[]): GraphFailure | readonly FeatureRecord[] {
  const features: FeatureRecord[] = []
  for (const [index, value] of values.entries()) {
    const dependencyIndex = selfFeatureDependencyIndex(value)
    if (dependencyIndex !== undefined)
      return diagnostic("self-reference", "A node cannot reference itself.", [
        {
          path: `features.${index}.dependencies.${dependencyIndex}`,
          message: "A feature cannot depend on itself.",
        },
      ])
    const parsed = featureRecordSchema.safeParse(value)
    if (!parsed.success) return invalidRecord("invalid-feature", index, parsed.error)
    features.push(parsed.data)
  }
  return features
}

function indexNodes(
  sketches: readonly SketchRecord[],
  features: readonly FeatureRecord[],
): GraphFailure | Pick<IndexedDocument, "nodes" | "byKey"> {
  const nodes: DocumentGraphNode[] = [
    ...sketches.map((record) => ({
      ref: { kind: "sketch", id: record.id } as DocumentNodeRef,
      record,
    })),
    ...features.map((record) => ({
      ref: { kind: "feature", id: record.id } as DocumentNodeRef,
      record,
    })),
  ]
  const byKey = new Map<string, DocumentGraphNode>()
  for (const node of nodes) {
    if (byKey.has(key(node.ref)))
      return diagnostic("duplicate-node", `Duplicate ${node.ref.kind} ID.`, [
        { path: node.ref.id, message: "IDs must be unique." },
      ])
    byKey.set(key(node.ref), node)
  }
  return { nodes, byKey }
}

function shallowFeatureRelationCount(features: readonly unknown[]) {
  // Reserve one possible extrusion-profile relation per feature before feature-specific parsing.
  let count = features.length
  for (const feature of features) {
    if (!isAnyObject(feature)) continue
    if (isArray(feature.dependencies)) count += feature.dependencies.length
    if (isArray(feature.references)) count += feature.references.length
    if (count > MAX_EDGES) return count
  }
  return count
}

function shallowSketchRelationCount(sketches: readonly unknown[]) {
  let count = 0
  for (const sketch of sketches) {
    if (!isAnyObject(sketch)) continue
    if (sketch.support !== undefined) count += 1
    if (isArray(sketch.externalReferences)) count += sketch.externalReferences.length
    if (count > MAX_EDGES) return count
  }
  return count
}

type RawRecordInput = Readonly<Pick<Input, "sketches" | "features">>

function boundedRecordInput(input: Input): GraphFailure | RawRecordInput {
  if (!isArray(input?.sketches) || !isArray(input?.features))
    return diagnostic(
      "invalid-history",
      "Document graph input must contain sketches, features, and history arrays.",
    )
  if (input.sketches.length + input.features.length > MAX_NODES)
    return diagnostic("node-limit", `Document graph nodes are limited to ${MAX_NODES}.`)
  const relationCount =
    shallowFeatureRelationCount(input.features) + shallowSketchRelationCount(input.sketches)
  if (relationCount > MAX_EDGES)
    return diagnostic("edge-limit", `Document graph edges are limited to ${MAX_EDGES}.`)
  return input
}

function parseRecords(input: Input): GraphFailure | IndexedDocument {
  const bounded = boundedRecordInput(input)
  if (isFailure(bounded)) return bounded
  const sketches = parseSketches(bounded.sketches)
  if (isFailure(sketches)) return sketches
  const features = parseFeatures(bounded.features)
  if (isFailure(features)) return features
  const index = indexNodes(sketches, features)
  if (isFailure(index)) return index
  return { sketches, features, ...index }
}

function indexHistory(
  historyInput: readonly unknown[],
  document: IndexedDocument,
): GraphFailure | IndexedHistory {
  const history: HistoryItemRef[] = []
  const historyKeys = new Set<string>()
  for (const [index, value] of historyInput.entries()) {
    const ref = asRef(value)
    if (!ref)
      return diagnostic("invalid-history", "History contains a malformed item.", [
        { path: `${index}`, message: "Expected a sketch or feature reference." },
      ])
    const refKey = key(ref)
    if (historyKeys.has(refKey))
      return diagnostic("duplicate-history", "History contains a duplicate item.", [
        { path: `${index}`, message: "History IDs must be unique." },
      ])
    if (!document.byKey.has(refKey))
      return diagnostic("missing-node", "History references a missing document node.", [
        { path: `${index}`, message: "Referenced node does not exist." },
      ])
    historyKeys.add(refKey)
    history.push(ref)
  }
  if (
    history.length !== document.nodes.length ||
    document.nodes.some((node) => !historyKeys.has(key(node.ref)))
  )
    return diagnostic("history-coverage", "History must cover every document node exactly once.")
  return { history, historyIndex: new Map(history.map((item, index) => [key(item), index])) }
}

type EdgeState = {
  edges: DocumentGraphEdge[]
  edgeSet: Set<string>
  ownerPathByEdge: Map<string, string>
}

type RelationCandidate = Readonly<{
  source: DocumentNodeRef
  target: DocumentNodeRef
  relation: DocumentGraphEdgeRelation
  missingMessage: string
  issue: Readonly<{ path: string; message: string }>
}>

function relationCount(document: IndexedDocument) {
  let count = 0
  for (const feature of document.features) {
    count += feature.dependencies.length + feature.references.length
    if (readExtrusionFeatureParameters(feature)) count += 1
  }
  for (const sketch of document.sketches)
    count += (sketch.support ? 1 : 0) + (sketch.externalReferences?.length ?? 0)
  return count
}

function addEdge(state: EdgeState, candidate: RelationCandidate): void {
  const relationKey = edgeKey(candidate.source, candidate.target, candidate.relation)
  if (state.edgeSet.has(relationKey)) return
  state.edgeSet.add(relationKey)
  state.ownerPathByEdge.set(relationKey, candidate.issue.path)
  state.edges.push({
    source: candidate.source,
    target: candidate.target,
    relation: candidate.relation,
  })
}

function edgeKey(
  source: DocumentNodeRef,
  target: DocumentNodeRef,
  relation: DocumentGraphEdgeRelation,
) {
  return `${key(source)}>${key(target)}:${relation}`
}

function validateRelationSource(
  document: IndexedDocument,
  candidate: RelationCandidate,
): GraphFailure | undefined {
  if (
    candidate.source.kind === candidate.target.kind &&
    candidate.source.id === candidate.target.id
  )
    return diagnostic("self-reference", "A node cannot reference itself.", [candidate.issue])
  if (!document.byKey.has(key(candidate.source)))
    return diagnostic("missing-node", candidate.missingMessage, [candidate.issue])
}

function featureTopologyCandidates(feature: FeatureRecord, featureIndex: number) {
  const target: DocumentNodeRef = { kind: "feature", id: feature.id }
  return feature.references.map(
    (reference, index): RelationCandidate => ({
      source: { kind: "feature", id: reference.featureId },
      target,
      relation: "feature-topology-reference",
      missingMessage: "A topology reference references a missing feature.",
      issue: {
        path: `features.${featureIndex}.references.${index}.featureId`,
        message: "Referenced feature does not exist.",
      },
    }),
  )
}

function featureDependencyCandidates(feature: FeatureRecord, featureIndex: number) {
  const target: DocumentNodeRef = { kind: "feature", id: feature.id }
  return feature.dependencies.map(
    (dependencyId, index): RelationCandidate => ({
      source: { kind: "feature", id: dependencyId },
      target,
      relation: "feature-dependency",
      missingMessage: "A feature dependency references a missing feature.",
      issue: {
        path: `features.${featureIndex}.dependencies.${index}`,
        message: "Referenced feature does not exist.",
      },
    }),
  )
}

function extrusionProfileCandidate(
  feature: FeatureRecord,
  featureIndex: number,
): RelationCandidate | undefined {
  const extrusion = readExtrusionFeatureParameters(feature)
  if (!extrusion) return
  return {
    source: { kind: "sketch", id: extrusion.profile.sketchId },
    target: { kind: "feature", id: feature.id },
    relation: "extrusion-profile",
    missingMessage: "An extrusion profile references a missing sketch.",
    issue: {
      path: `features.${featureIndex}.parameters.profile.sketchId`,
      message: "Referenced sketch does not exist.",
    },
  }
}

function featureCandidates(feature: FeatureRecord, featureIndex: number) {
  const profile = extrusionProfileCandidate(feature, featureIndex)
  return [
    ...featureDependencyCandidates(feature, featureIndex),
    ...featureTopologyCandidates(feature, featureIndex),
    ...(profile ? [profile] : []),
  ]
}

function sketchCandidates(sketch: SketchRecord, sketchIndex: number) {
  const target: DocumentNodeRef = { kind: "sketch", id: sketch.id }
  const support: RelationCandidate[] = sketch.support
    ? [
        {
          source: { kind: "feature", id: sketch.support.reference.featureId },
          target,
          relation: "sketch-support",
          missingMessage: "Sketch support references a missing feature.",
          issue: {
            path: `sketches.${sketchIndex}.support.reference.featureId`,
            message: "Referenced feature does not exist.",
          },
        },
      ]
    : []
  const external = (sketch.externalReferences ?? []).map((reference, index): RelationCandidate => {
    if (isSketchExternalModelReference(reference)) {
      return {
        source: { kind: "feature", id: reference.reference.featureId },
        target,
        relation: "feature-topology-reference",
        missingMessage: "External model reference is missing its source feature.",
        issue: {
          path: `sketches.${sketchIndex}.externalReferences.${index}.reference.featureId`,
          message: "Referenced feature does not exist.",
        },
      }
    }
    return {
      source: { kind: "sketch", id: reference.sourceSketchId },
      target,
      relation: "external-sketch",
      missingMessage: "External sketch reference is missing its source sketch.",
      issue: {
        path: `sketches.${sketchIndex}.externalReferences.${index}.sourceSketchId`,
        message: "Referenced sketch does not exist.",
      },
    }
  })
  return [...support, ...external]
}

function collectRelationCandidates(document: IndexedDocument) {
  return [
    ...document.features.flatMap(featureCandidates),
    ...document.sketches.flatMap(sketchCandidates),
  ]
}

function validateCandidates(
  document: IndexedDocument,
  candidates: readonly RelationCandidate[],
): GraphFailure | undefined {
  for (const candidate of candidates) {
    const invalid = validateRelationSource(document, candidate)
    if (invalid) return invalid
  }
}

function validateFeatureSources(document: IndexedDocument): GraphFailure | undefined {
  for (const [index, feature] of document.features.entries()) {
    const profile = extrusionProfileCandidate(feature, index)
    const candidates = [
      ...featureTopologyCandidates(feature, index),
      ...featureDependencyCandidates(feature, index),
      ...(profile ? [profile] : []),
    ]
    const invalid = validateCandidates(document, candidates)
    if (invalid) return invalid
  }
}

function validateSketchSources(document: IndexedDocument): GraphFailure | undefined {
  for (const [index, sketch] of document.sketches.entries()) {
    const invalid = validateCandidates(document, sketchCandidates(sketch, index))
    if (invalid) return invalid
  }
}

function validateDocumentSources(document: IndexedDocument) {
  return validateFeatureSources(document) ?? validateSketchSources(document)
}

function buildAdjacency(
  nodes: readonly DocumentGraphNode[],
  edges: readonly DocumentGraphEdge[],
): Pick<CollectedEdges, "dependencies" | "dependents"> {
  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  for (const node of nodes) {
    dependencies.set(key(node.ref), new Set())
    dependents.set(key(node.ref), new Set())
  }
  for (const edge of edges) {
    dependencies.get(key(edge.target))?.add(key(edge.source))
    dependents.get(key(edge.source))?.add(key(edge.target))
  }
  return { dependencies, dependents }
}

function collectEdges(document: IndexedDocument): GraphFailure | CollectedEdges {
  if (relationCount(document) > MAX_EDGES)
    return diagnostic("edge-limit", `Document graph edges are limited to ${MAX_EDGES}.`)
  const invalidSource = validateDocumentSources(document)
  if (invalidSource) return invalidSource
  const candidates = collectRelationCandidates(document)
  const state: EdgeState = { edges: [], edgeSet: new Set(), ownerPathByEdge: new Map() }
  for (const candidate of candidates) addEdge(state, candidate)
  return {
    edges: state.edges,
    ownerPathByEdge: state.ownerPathByEdge,
    ...buildAdjacency(document.nodes, state.edges),
  }
}

function residualIndegree(
  history: IndexedHistory,
  collected: CollectedEdges,
): ReadonlyMap<string, number> {
  const indegree = new Map(
    [...collected.dependencies].map(([nodeKey, dependencies]) => [nodeKey, dependencies.size]),
  )
  const queue = history.history.filter((ref) => indegree.get(key(ref)) === 0).map(key)
  for (let index = 0; index < queue.length; index += 1) {
    const nodeKey = queue[index] as string
    for (const dependent of collected.dependents.get(nodeKey) ?? []) {
      const degree = (indegree.get(dependent) ?? 1) - 1
      indegree.set(dependent, degree)
      if (degree === 0) queue.push(dependent)
    }
  }
  return indegree
}

type CyclePair = Readonly<{ sourceKey: string; targetKey: string }>

function cyclePairs(
  history: IndexedHistory,
  collected: CollectedEdges,
  indegree: ReadonlyMap<string, number>,
): readonly CyclePair[] {
  const start = history.history.find((ref) => (indegree.get(key(ref)) ?? 0) > 0)
  if (!start) return []
  const seenAt = new Map<string, number>()
  const transitions: CyclePair[] = []
  let current = key(start)
  while (!seenAt.has(current)) {
    seenAt.set(current, transitions.length)
    const source = [...(collected.dependencies.get(current) ?? [])].find(
      (candidate) => (indegree.get(candidate) ?? 0) > 0,
    )
    if (!source) return []
    transitions.push({ sourceKey: source, targetKey: current })
    current = source
  }
  const cycleStart = seenAt.get(current) ?? 0
  return transitions.slice(cycleStart, cycleStart + MAX_DIAGNOSTICS)
}

function pairKey(sourceKey: string, targetKey: string) {
  return `${sourceKey}>${targetKey}`
}

function cycleIssues(
  history: IndexedHistory,
  collected: CollectedEdges,
  indegree: ReadonlyMap<string, number>,
) {
  const firstEdgeByPair = new Map<string, DocumentGraphEdge>()
  for (const edge of collected.edges) {
    const pair = pairKey(key(edge.source), key(edge.target))
    if (!firstEdgeByPair.has(pair)) firstEdgeByPair.set(pair, edge)
  }
  return cyclePairs(history, collected, indegree).flatMap(({ sourceKey, targetKey }) => {
    const edge = firstEdgeByPair.get(pairKey(sourceKey, targetKey))
    if (!edge) return []
    return [
      {
        path:
          collected.ownerPathByEdge.get(edgeKey(edge.source, edge.target, edge.relation)) ??
          targetKey,
        message: `Dependency ${sourceKey} -> ${targetKey} participates in a cycle.`,
      },
    ]
  })
}

function forwardReference(
  history: IndexedHistory,
  edges: readonly DocumentGraphEdge[],
): DocumentGraphEdge | undefined {
  return edges.find((edge) => {
    const sourceIndex = history.historyIndex.get(key(edge.source)) ?? -1
    const targetIndex = history.historyIndex.get(key(edge.target)) ?? -1
    return sourceIndex >= targetIndex
  })
}

function validateGraph(
  history: IndexedHistory,
  collected: CollectedEdges,
): GraphFailure | undefined {
  const indegree = residualIndegree(history, collected)
  if ([...indegree.values()].some((degree) => degree > 0))
    return diagnostic(
      "cycle",
      "Document dependencies must form an acyclic graph.",
      cycleIssues(history, collected, indegree),
    )
  const invalid = forwardReference(history, collected.edges)
  if (!invalid) return
  return diagnostic("forward-reference", "References must precede their consumers in history.", [
    {
      path: `${key(invalid.target)}.${invalid.relation}`,
      message: `Source ${key(invalid.source)} must precede target.`,
    },
  ])
}

function assembleGraph(
  document: IndexedDocument,
  history: IndexedHistory,
  collected: CollectedEdges,
): DocumentDependencyGraph {
  const refForKey = (nodeKey: string) => document.byKey.get(nodeKey)?.ref
  const refsFor = (values: ReadonlySet<string>) =>
    [...values].map(refForKey).filter((ref): ref is DocumentNodeRef => Boolean(ref))
  return {
    nodes: document.nodes,
    edges: collected.edges,
    history: history.history,
    evaluationOrder: history.history
      .map((ref) => refForKey(key(ref)))
      .filter((ref): ref is DocumentNodeRef => Boolean(ref)),
    getNode: (ref) => document.byKey.get(key(ref)),
    dependenciesOf: (ref) => refsFor(collected.dependencies.get(key(ref)) ?? new Set()),
    dependentsOf: (ref) => refsFor(collected.dependents.get(key(ref)) ?? new Set()),
  }
}

export function createDocumentDependencyGraph(input: Input): DocumentDependencyGraphResult {
  try {
    if (!isArray(input?.history))
      return diagnostic(
        "invalid-history",
        "Document graph input must contain sketches, features, and history arrays.",
      )
    const document = parseRecords(input)
    if (isFailure(document)) return document
    const history = indexHistory(input.history, document)
    if (isFailure(history)) return history
    const collected = collectEdges(document)
    if (isFailure(collected)) return collected
    const validation = validateGraph(history, collected)
    if (validation) return validation
    return { ok: true, graph: assembleGraph(document, history, collected) }
  } catch {
    return diagnostic("invalid-history", "Document graph input could not be evaluated safely.")
  }
}
