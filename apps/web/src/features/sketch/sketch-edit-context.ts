import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentSnapshot,
  type FeatureId,
  isSketchExternalModelReference,
  readExtrusionFeatureParameters,
  type SketchExternalReference,
  type SketchId,
} from "@vibeshape/domain"

export type SketchEditContextVisibility = Readonly<{
  featureIds: readonly FeatureId[]
  sketchIds: readonly SketchId[]
}>

type SketchEditContextSnapshot = Pick<DocumentSnapshot, "features" | "sketches">

type DocumentNode =
  | Readonly<{ id: FeatureId; kind: "feature" }>
  | Readonly<{ id: SketchId; kind: "sketch" }>

function appendDependent(
  index: Map<string, DocumentNode[]>,
  owner: DocumentNode,
  dependent: DocumentNode,
) {
  const key = `${owner.kind}:${owner.id}`
  const dependents = index.get(key) ?? []
  dependents.push(dependent)
  index.set(key, dependents)
}

function externalReferenceOwner(reference: SketchExternalReference): DocumentNode {
  return isSketchExternalModelReference(reference)
    ? { id: reference.reference.featureId, kind: "feature" }
    : { id: reference.sourceSketchId, kind: "sketch" }
}

function indexFeatureDependents(
  dependents: Map<string, DocumentNode[]>,
  features: DocumentSnapshot["features"],
) {
  for (const feature of features) {
    const dependent = { id: feature.id, kind: "feature" } as const
    for (const featureId of new Set([
      ...feature.dependencies,
      ...feature.references.map(({ featureId }) => featureId),
    ])) {
      appendDependent(dependents, { id: featureId, kind: "feature" }, dependent)
    }
    const extrusion = readExtrusionFeatureParameters(feature)
    if (extrusion) {
      appendDependent(dependents, { id: extrusion.profile.sketchId, kind: "sketch" }, dependent)
    }
  }
}

function indexSketchDependents(
  dependents: Map<string, DocumentNode[]>,
  sketches: DocumentSnapshot["sketches"],
) {
  for (const sketch of sketches) {
    const dependent = { id: sketch.id, kind: "sketch" } as const
    if (sketch.support) {
      appendDependent(
        dependents,
        { id: sketch.support.reference.featureId, kind: "feature" },
        dependent,
      )
    }
    for (const reference of sketch.externalReferences ?? []) {
      appendDependent(dependents, externalReferenceOwner(reference), dependent)
    }
  }
}

function dependentNodeIndex(snapshot: Pick<DocumentSnapshot, "features" | "sketches">) {
  const dependents = new Map<string, DocumentNode[]>()
  indexFeatureDependents(dependents, snapshot.features)
  indexSketchDependents(dependents, snapshot.sketches)
  return dependents
}

function appendLaterHistoryItems(
  snapshot: SketchEditContextSnapshot,
  activeSketchId: SketchId,
  featureIds: Set<FeatureId>,
  sketchIds: Set<SketchId>,
) {
  const graph = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!graph.ok) return
  const activeIndex = graph.graph.history.findIndex(
    (item) => item.kind === "sketch" && item.id === activeSketchId,
  )
  if (activeIndex < 0) return
  for (const item of graph.graph.history.slice(activeIndex + 1)) {
    if (item.kind === "feature") featureIds.add(item.id)
    else sketchIds.add(item.id)
  }
}

function nodeKey(node: DocumentNode) {
  return `${node.kind}:${node.id}`
}

export function sketchEditContextVisibility(
  snapshot: SketchEditContextSnapshot,
  activeSketchId: SketchId,
): SketchEditContextVisibility {
  const dependents = dependentNodeIndex(snapshot)
  const featureIds = new Set<FeatureId>()
  const sketchIds = new Set<SketchId>([activeSketchId])
  appendLaterHistoryItems(snapshot, activeSketchId, featureIds, sketchIds)
  const visited = new Set<string>([`sketch:${activeSketchId}`])
  const queue: DocumentNode[] = [{ id: activeSketchId, kind: "sketch" }]

  for (const node of queue) {
    for (const dependent of dependents.get(nodeKey(node)) ?? []) {
      const key = nodeKey(dependent)
      if (visited.has(key)) continue
      visited.add(key)
      queue.push(dependent)
      if (dependent.kind === "feature") featureIds.add(dependent.id)
      else sketchIds.add(dependent.id)
    }
  }

  return { featureIds: [...featureIds], sketchIds: [...sketchIds] }
}

export function mergeSketchEditVisibility(
  configured: Readonly<{
    featureIds: readonly FeatureId[]
    sketchIds: readonly SketchId[]
  }>,
  contextual: SketchEditContextVisibility,
): SketchEditContextVisibility {
  return {
    featureIds: [...new Set([...configured.featureIds, ...contextual.featureIds])],
    sketchIds: [...new Set([...configured.sketchIds, ...contextual.sketchIds])],
  }
}
