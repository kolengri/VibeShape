import { isAnyObject, isArray, isString } from "is-what"
import type { ZodError } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DocumentNodeRef, documentNodeRefSchema, type HistoryItemRef } from "./document-node"
import {
  type FeatureRecord,
  type FeatureRecordV1,
  versionedFeatureRecordSchema,
} from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { featureTypeKey } from "./feature-type-contracts"
import type { FeatureId } from "./identifiers"
import {
  booleanFeatureType,
  boxFeatureType,
  cylinderFeatureType,
  expectedRevolveDependencyIds,
  extrusionFeatureType,
  legacyExtrusionFeatureType,
  legacyRevolveFeatureType,
  legacyRevolveFeatureTypeV2,
  legacyRevolveFeatureTypeV3,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  revolveFeatureType,
} from "./part-design"
import { datumPlaneFeatureType, hasCompleteDatumPlaneDependencyModel } from "./reference-geometry"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  type SketchRecord,
  sketchRecordSchema,
} from "./sketch"

const MAX_NODES = 100_256
// Keep the retained graph bounded independently of larger per-record schema limits. The aggregate
// check runs before edge objects, keys, or adjacency sets are allocated.
const MAX_EDGES = 100_000
const MAX_DIAGNOSTICS = 8

export type { DocumentNodeRef, HistoryItemRef }
export { documentNodeRefSchema }

export type DocumentGraphNode = Readonly<{
  ref: DocumentNodeRef
  record: SketchRecord | FeatureRecord | FeatureRecordV1
}>

export type DocumentGraphEdgeRelation =
  | "feature-dependency"
  | "feature-topology-reference"
  | "extrusion-profile"
  | "revolve-profile"
  | "sketch-support"
  | "external-sketch"
  | "semantic-input"

export type DocumentGraphEdge = Readonly<{
  source: DocumentNodeRef
  target: DocumentNodeRef
  relation: DocumentGraphEdgeRelation
}>

export type DocumentGraphDependencyBlocker = Readonly<{
  dependent: DocumentNodeRef
  ownerPath: string
  relation: DocumentGraphEdgeRelation
}>

export type DocumentDependencyModelIssue = Readonly<{
  featureId: FeatureRecord["id"]
  ownerPath: string
  typeKey: string
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
  dependencyModelIssues: readonly DocumentDependencyModelIssue[]
  getNode: (ref: DocumentNodeRef) => DocumentGraphNode | undefined
  dependenciesOf: (ref: DocumentNodeRef) => readonly DocumentNodeRef[]
  dependentsOf: (ref: DocumentNodeRef) => readonly DocumentNodeRef[]
  deletionBlockersFor: (ref: DocumentNodeRef) => readonly DocumentGraphDependencyBlocker[]
}>

export type DocumentDependencyGraphResult =
  | Readonly<{ ok: true; graph: DocumentDependencyGraph }>
  | Readonly<{ ok: false; diagnostic: DocumentGraphDiagnostic }>

export type LegacyDocumentGraphNode = Readonly<{
  ref: DocumentNodeRef
  record: SketchRecord | FeatureRecord
}>

export type LegacyDocumentDependencyGraph = Readonly<
  Omit<DocumentDependencyGraph, "nodes" | "getNode"> & {
    nodes: readonly LegacyDocumentGraphNode[]
    getNode: (ref: DocumentNodeRef) => LegacyDocumentGraphNode | undefined
  }
>

export type LegacyDocumentDependencyGraphResult =
  | Readonly<{ ok: true; graph: LegacyDocumentDependencyGraph }>
  | Readonly<{ ok: false; diagnostic: DocumentGraphDiagnostic }>

// Slice 0 intentionally derives only the durable built-in relation fields; extension parameters
// are opaque unless a trusted built-in reader recognizes them.

type Input = Readonly<{
  sketches: readonly unknown[]
  features: readonly unknown[]
  history: readonly unknown[]
}>
type VersionedFeatureRecord = FeatureRecord | FeatureRecordV1

export type LegacyDocumentSnapshot = Readonly<Pick<Input, "sketches" | "features">>

export type LegacyHistoryResult =
  | Readonly<{ ok: true; history: readonly HistoryItemRef[] }>
  | GraphFailure

function key(ref: DocumentNodeRef) {
  return `${ref.kind}:${ref.id}`
}

const dependencyCompleteFeatureTypeKeys = new Set([
  featureTypeKey(boxFeatureType.type),
  featureTypeKey(cylinderFeatureType.type),
  featureTypeKey(booleanFeatureType.type),
])
const revolveTypeKeys = new Set(
  [
    revolveFeatureType,
    legacyRevolveFeatureType,
    legacyRevolveFeatureTypeV2,
    legacyRevolveFeatureTypeV3,
  ].map(({ type }) => featureTypeKey(type)),
)

function hasCompleteDependencyModel(feature: FeatureRecord | FeatureRecordV1) {
  if (feature.schemaVersion === 1) return feature.semanticInputs !== null
  const typeKey = featureTypeKey(feature.type)
  if (dependencyCompleteFeatureTypeKeys.has(typeKey)) return true
  if (
    typeKey === featureTypeKey(legacyExtrusionFeatureType.type) ||
    typeKey === featureTypeKey(extrusionFeatureType.type)
  ) {
    return readExtrusionFeatureParameters(feature) !== null
  }
  if (revolveTypeKeys.has(typeKey)) {
    return readRevolveFeatureParameters(feature) !== null
  }
  if (typeKey === featureTypeKey(datumPlaneFeatureType.type)) {
    return hasCompleteDatumPlaneDependencyModel(feature)
  }
  return false
}

function dependencyModelIssues(features: readonly VersionedFeatureRecord[]) {
  return features.flatMap((feature, index): readonly DocumentDependencyModelIssue[] =>
    hasCompleteDependencyModel(feature)
      ? []
      : [
          {
            featureId: feature.id,
            ownerPath: `features.${index}.type`,
            typeKey: featureTypeKey(feature.type),
          },
        ],
  )
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
  features: readonly VersionedFeatureRecord[]
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

function parseFeatures(
  values: readonly unknown[],
): GraphFailure | readonly VersionedFeatureRecord[] {
  const features: VersionedFeatureRecord[] = []
  for (const [index, value] of values.entries()) {
    const dependencyIndex = selfFeatureDependencyIndex(value)
    if (dependencyIndex !== undefined)
      return diagnostic("self-reference", "A node cannot reference itself.", [
        {
          path: `features.${index}.dependencies.${dependencyIndex}`,
          message: "A feature cannot depend on itself.",
        },
      ])
    const parsed = versionedFeatureRecordSchema.safeParse(value)
    if (!parsed.success) return invalidRecord("invalid-feature", index, parsed.error)
    features.push(parsed.data)
  }
  return features
}

function indexNodes(
  sketches: readonly SketchRecord[],
  features: readonly VersionedFeatureRecord[],
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
  // Reserve one possible sketch-profile relation per feature before feature-specific parsing.
  let count = features.length
  for (const feature of features) {
    if (!isAnyObject(feature)) continue
    if (isArray(feature.dependencies)) count += feature.dependencies.length
    if (isArray(feature.references)) count += feature.references.length
    if (isArray(feature.semanticInputs)) count += feature.semanticInputs.length
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
    if (feature.schemaVersion === 1 && feature.semanticInputs)
      count += feature.semanticInputs.length
    count += hasProfileRelation(feature as FeatureRecord) ? 1 : 0
  }
  for (const sketch of document.sketches)
    count += (sketch.support ? 1 : 0) + (sketch.externalReferences?.length ?? 0)
  return count
}

function hasProfileRelation(feature: FeatureRecord) {
  return Boolean(readExtrusionFeatureParameters(feature) || readRevolveFeatureParameters(feature))
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

function revolveProfileCandidate(
  feature: FeatureRecord,
  featureIndex: number,
): RelationCandidate | undefined {
  const revolve = readRevolveFeatureParameters(feature)
  if (!revolve) return
  return {
    source: { kind: "sketch", id: revolve.profile.sketchId },
    target: { kind: "feature", id: feature.id },
    relation: "revolve-profile",
    missingMessage: "A revolve profile references a missing sketch.",
    issue: {
      path: `features.${featureIndex}.parameters.profile.sketchId`,
      message: "Referenced sketch does not exist.",
    },
  }
}

function semanticInputCandidates(
  feature: VersionedFeatureRecord,
  featureIndex: number,
): RelationCandidate[] {
  return feature.schemaVersion === 1 && feature.semanticInputs
    ? feature.semanticInputs.map(
        (input, index): RelationCandidate => ({
          source: input,
          target: { kind: "feature", id: feature.id },
          relation: "semantic-input",
          missingMessage: "A semantic input references a missing document node.",
          issue: {
            path: `features.${featureIndex}.semanticInputs.${index}`,
            message: "Referenced document node does not exist.",
          },
        }),
      )
    : []
}

function featureCandidates(feature: VersionedFeatureRecord, featureIndex: number) {
  const profile = extrusionProfileCandidate(feature as FeatureRecord, featureIndex)
  const revolveProfile = revolveProfileCandidate(feature as FeatureRecord, featureIndex)
  return [
    ...featureDependencyCandidates(feature as FeatureRecord, featureIndex),
    ...featureTopologyCandidates(feature as FeatureRecord, featureIndex),
    ...(profile ? [profile] : []),
    ...(revolveProfile ? [revolveProfile] : []),
    ...semanticInputCandidates(feature, featureIndex),
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
  const external = (sketch.externalReferences ?? []).flatMap(
    (reference, index): RelationCandidate[] => {
      if (isOrphanedModelReference(reference)) return []
      if (isSketchExternalModelReference(reference)) {
        return [
          {
            source: { kind: "feature", id: reference.reference.featureId },
            target,
            relation: "feature-topology-reference",
            missingMessage: "External model reference is missing its source feature.",
            issue: {
              path: `sketches.${sketchIndex}.externalReferences.${index}.reference.featureId`,
              message: "Referenced feature does not exist.",
            },
          },
        ]
      }
      return [
        {
          source: { kind: "sketch", id: reference.sourceSketchId },
          target,
          relation: "external-sketch",
          missingMessage: "External sketch reference is missing its source sketch.",
          issue: {
            path: `sketches.${sketchIndex}.externalReferences.${index}.sourceSketchId`,
            message: "Referenced sketch does not exist.",
          },
        },
      ]
    },
  )
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

function validateFirstPartySemanticInputs(
  feature: FeatureRecordV1,
  index: number,
): GraphFailure | undefined {
  const projection = projectFirstPartyFeatureSemanticInputs(feature)
  if (!projection.recognized) return
  if (!projection.ok)
    return diagnostic("invalid-feature", projection.message, [
      { path: `features.${index}.parameters`, message: projection.message },
    ])
  if (sameDocumentNodeRefs(feature.semanticInputs, projection.inputs)) return
  return diagnostic(
    "invalid-feature",
    "A first-party feature semantic-input declaration does not match its parameters.",
    [
      {
        path: `features.${index}.semanticInputs`,
        message: "Semantic inputs must exactly match the first-party feature parameters.",
      },
    ],
  )
}

function validateFeatureSources(document: IndexedDocument): GraphFailure | undefined {
  for (const [index, feature] of document.features.entries()) {
    const semanticFailure =
      feature.schemaVersion === 1 ? validateFirstPartySemanticInputs(feature, index) : undefined
    if (semanticFailure) return semanticFailure
    const revolveSupportFailure = validateRevolveSupportIntent(document, feature, index)
    if (revolveSupportFailure) return revolveSupportFailure
    const profile = extrusionProfileCandidate(feature as FeatureRecord, index)
    const revolveProfile = revolveProfileCandidate(feature as FeatureRecord, index)
    const invalid = validateCandidates(document, [
      ...featureTopologyCandidates(feature as FeatureRecord, index),
      ...featureDependencyCandidates(feature as FeatureRecord, index),
      ...(profile ? [profile] : []),
      ...(revolveProfile ? [revolveProfile] : []),
      ...semanticInputCandidates(feature, index),
    ])
    if (invalid) return invalid
  }
}

function validateRevolveSupportIntent(
  document: IndexedDocument,
  feature: VersionedFeatureRecord,
  featureIndex: number,
): GraphFailure | undefined {
  const revolve = readRevolveFeatureParameters(feature as FeatureRecord)
  if (!revolve) return
  const sketch = document.sketches.find(({ id }) => id === revolve.profile.sketchId)
  if (!sketch) return
  const expectedReferences = sketch.support ? [sketch.support.reference] : []
  const supportFeatureId = sketch.support?.reference.featureId
  const issues = [
    revolveReferenceIssue(feature, featureIndex, expectedReferences),
    revolveDependencyOrderIssue(feature, featureIndex, revolve, supportFeatureId),
  ].flatMap((issue) => (issue ? [issue] : []))
  if (issues.length === 0) return
  return diagnostic(
    "invalid-feature",
    "A revolve must retain its source sketch support intent.",
    issues,
  )
}

function revolveReferenceIssue(
  feature: VersionedFeatureRecord,
  featureIndex: number,
  expectedReferences: readonly unknown[],
) {
  if (canonicalJson(feature.references) === canonicalJson(expectedReferences)) return null
  return {
    path: `features.${featureIndex}.references`,
    message: "Revolve references must exactly match the selected profile sketch support.",
  }
}

function revolveDependencyOrderIssue(
  feature: VersionedFeatureRecord,
  featureIndex: number,
  revolve: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
  supportFeatureId: FeatureId | undefined,
) {
  const targetFeatureId = revolve.operation === "new" ? null : (feature.dependencies[0] ?? null)
  const expectedDependencyOrder = expectedRevolveDependencyIds(
    revolve,
    targetFeatureId,
    supportFeatureId ? [supportFeatureId] : [],
  )
  const matches = !(
    (revolve.operation !== "new" && targetFeatureId === null) ||
    !orderedIdsMatch(feature.dependencies, expectedDependencyOrder)
  )
  if (matches) return null
  return {
    path: `features.${featureIndex}.dependencies`,
    message:
      revolve.operation === "new"
        ? "New-body revolve dependencies must contain the profile support owner and model-edge axis source in canonical order."
        : "Modifying revolve dependencies must contain the target first, followed by distinct profile support and model-edge axis sources.",
  }
}

function orderedIdsMatch(actual: readonly FeatureId[], expected: readonly FeatureId[]) {
  return (
    actual.length === expected.length &&
    actual.every((dependency, index) => dependency === expected[index])
  )
}

function sameDocumentNodeRefs(
  actual: readonly DocumentNodeRef[] | null,
  expected: readonly DocumentNodeRef[],
) {
  return (
    actual !== null &&
    actual.length === expected.length &&
    actual.every((ref, index) => {
      const expectedRef = expected[index]
      return expectedRef !== undefined && key(ref) === key(expectedRef)
    })
  )
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
      path:
        collected.ownerPathByEdge.get(edgeKey(invalid.source, invalid.target, invalid.relation)) ??
        key(invalid.target),
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
  const deletionBlockersFor = (ref: DocumentNodeRef) =>
    collected.edges.flatMap((edge): readonly DocumentGraphDependencyBlocker[] =>
      key(edge.source) === key(ref)
        ? [
            {
              dependent: edge.target,
              ownerPath:
                collected.ownerPathByEdge.get(edgeKey(edge.source, edge.target, edge.relation)) ??
                key(edge.target),
              relation: edge.relation,
            },
          ]
        : [],
    )
  return {
    nodes: document.nodes,
    edges: collected.edges,
    history: history.history,
    evaluationOrder: history.history
      .map((ref) => refForKey(key(ref)))
      .filter((ref): ref is DocumentNodeRef => Boolean(ref)),
    dependencyModelIssues: dependencyModelIssues(document.features),
    getNode: (ref) => document.byKey.get(key(ref)),
    dependenciesOf: (ref) => refsFor(collected.dependencies.get(key(ref)) ?? new Set()),
    dependentsOf: (ref) => refsFor(collected.dependents.get(key(ref)) ?? new Set()),
    deletionBlockersFor,
  }
}

type HeapItem = Readonly<{ nodeKey: string; ref: DocumentNodeRef }>
type HeapCompare = (left: HeapItem, right: HeapItem) => number

function legacyOrdinalMap(document: IndexedDocument) {
  const ordinal = new Map<string, number>()
  document.sketches.forEach((record, index) => {
    ordinal.set(`sketch:${record.id}`, index)
  })
  document.features.forEach((record, index) => {
    ordinal.set(`feature:${record.id}`, index)
  })
  return ordinal
}

function preferredOrdinalMap(history: readonly HistoryItemRef[]) {
  return new Map(history.map((ref, index) => [key(ref), index]))
}

function legacyHeapCompare(ordinal: ReadonlyMap<string, number>): HeapCompare {
  return (left, right) => {
    const ordinalDifference =
      (ordinal.get(left.nodeKey) ?? Number.MAX_SAFE_INTEGER) -
      (ordinal.get(right.nodeKey) ?? Number.MAX_SAFE_INTEGER)
    if (ordinalDifference !== 0) return ordinalDifference
    const kindDifference =
      left.ref.kind < right.ref.kind ? -1 : left.ref.kind > right.ref.kind ? 1 : 0
    if (kindDifference !== 0) return kindDifference
    return left.ref.id < right.ref.id ? -1 : left.ref.id > right.ref.id ? 1 : 0
  }
}

function heapPush(heap: HeapItem[], item: HeapItem, compare: HeapCompare) {
  heap.push(item)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (compare(heap[parent] as HeapItem, item) <= 0) break
    heap[index] = heap[parent] as HeapItem
    index = parent
  }
  heap[index] = item
}

function heapPop(heap: HeapItem[], compare: HeapCompare): HeapItem | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (!first || !last || heap.length === 0) return first
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const child =
      right < heap.length && compare(heap[right] as HeapItem, heap[left] as HeapItem) < 0
        ? right
        : left
    if (compare(heap[child] as HeapItem, last) >= 0) break
    heap[index] = heap[child] as HeapItem
    index = child
  }
  heap[index] = last
  return first
}

function legacyIndegree(collected: CollectedEdges) {
  return new Map(
    [...collected.dependencies].map(([nodeKey, dependencies]) => [nodeKey, dependencies.size]),
  )
}

function enqueueLegacyRoots(
  document: IndexedDocument,
  indegree: ReadonlyMap<string, number>,
  heap: HeapItem[],
  compare: HeapCompare,
) {
  for (const node of document.nodes) {
    if (indegree.get(key(node.ref)) === 0)
      heapPush(heap, { nodeKey: key(node.ref), ref: node.ref }, compare)
  }
}

function releaseLegacyDependents(
  item: HeapItem,
  document: IndexedDocument,
  collected: CollectedEdges,
  indegree: Map<string, number>,
  heap: HeapItem[],
  compare: HeapCompare,
) {
  for (const dependent of collected.dependents.get(item.nodeKey) ?? []) {
    const degree = (indegree.get(dependent) ?? 1) - 1
    indegree.set(dependent, degree)
    if (degree !== 0) continue
    const ref = document.byKey.get(dependent)?.ref
    if (ref) heapPush(heap, { nodeKey: dependent, ref }, compare)
  }
}

function legacyCycleFailure(
  document: IndexedDocument,
  collected: CollectedEdges,
  indegree: ReadonlyMap<string, number>,
) {
  const temporaryHistory: IndexedHistory = {
    history: document.nodes.map((node) => node.ref),
    historyIndex: new Map(document.nodes.map((node, index) => [key(node.ref), index])),
  }
  return diagnostic(
    "cycle",
    "Document dependencies must form an acyclic graph.",
    cycleIssues(temporaryHistory, collected, indegree),
  )
}

function deriveHeapOrder(
  document: IndexedDocument,
  collected: CollectedEdges,
  ordinal: ReadonlyMap<string, number>,
): LegacyHistoryResult {
  const compare = legacyHeapCompare(ordinal)
  const heap: HeapItem[] = []
  const indegree = legacyIndegree(collected)
  enqueueLegacyRoots(document, indegree, heap, compare)
  const order: DocumentNodeRef[] = []
  while (heap.length > 0) {
    const item = heapPop(heap, compare)
    if (!item) break
    order.push(item.ref)
    releaseLegacyDependents(item, document, collected, indegree, heap, compare)
  }
  if (order.length === document.nodes.length) return { ok: true, history: order }
  return legacyCycleFailure(document, collected, indegree)
}

export function deriveLegacyHistory(input: LegacyDocumentSnapshot): LegacyHistoryResult {
  try {
    const document = parseRecords({ ...input, history: [] })
    if (isFailure(document)) return document
    const collected = collectEdges(document)
    if (isFailure(collected)) return collected
    return deriveHeapOrder(document, collected, legacyOrdinalMap(document))
  } catch {
    return diagnostic("invalid-history", "Document graph input could not be evaluated safely.")
  }
}

export function deriveLegacyHistoryWithPreferredOrder(
  input: LegacyDocumentSnapshot,
  preferredHistory: readonly unknown[],
): LegacyHistoryResult {
  try {
    const document = parseRecords({ ...input, history: [] })
    if (isFailure(document)) return document
    const preferred = indexHistory(preferredHistory, document)
    if (isFailure(preferred)) return preferred
    const collected = collectEdges(document)
    if (isFailure(collected)) return collected
    return deriveHeapOrder(document, collected, preferredOrdinalMap(preferred.history))
  } catch {
    return diagnostic("invalid-history", "Document graph input could not be evaluated safely.")
  }
}

export function createDocumentDependencyGraphFromSnapshot(
  input: Readonly<{
    sketches: readonly SketchRecord[]
    features: readonly FeatureRecord[]
  }>,
): LegacyDocumentDependencyGraphResult
export function createDocumentDependencyGraphFromSnapshot(
  input: LegacyDocumentSnapshot,
): DocumentDependencyGraphResult
export function createDocumentDependencyGraphFromSnapshot(
  input: LegacyDocumentSnapshot,
): DocumentDependencyGraphResult {
  const history = deriveLegacyHistory(input)
  if (isFailure(history)) return history
  return createDocumentDependencyGraph({ ...input, history: history.history })
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
