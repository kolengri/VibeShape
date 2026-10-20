import type { SketchEntityId, SketchExternalReferenceId, SketchId } from "./identifiers"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  projectedExternalSketchEntities,
  type SketchEntity,
  type SketchExternalModelReference,
  type SketchExternalOrphanedModelReference,
  type SketchExternalReference,
  type SketchRecord,
} from "./sketch"

type SketchBackedExternalReference = Exclude<
  SketchExternalReference,
  SketchExternalModelReference | SketchExternalOrphanedModelReference
>

type ReferenceResolution = "direct-broken" | "healthy" | "transitive-broken" | "unknown"

export type SketchModelReferenceHealthResolver = (
  ownerSketchId: SketchId,
  reference: SketchExternalModelReference,
) => "broken" | "resolved" | "unknown"

export type SketchReferenceHealth = Readonly<{
  status: "broken" | "healthy" | "unknown"
  directBrokenReferenceIds: readonly SketchExternalReferenceId[]
  transitiveBrokenReferenceIds: readonly SketchExternalReferenceId[]
  unknownReferenceIds: readonly SketchExternalReferenceId[]
}>

type SourceGeometryIndex = Readonly<{
  authoredEntityIds: ReadonlySet<SketchEntityId>
  entities: ReadonlyMap<SketchEntityId, SketchEntity>
  projectedOwners: ReadonlyMap<SketchEntityId, SourceReferenceNode>
  references: ReadonlyMap<SketchExternalReferenceId, SourceReferenceNode>
}>

type SourceReferenceNode = {
  ownerSketchId: SketchId
  reference: SketchExternalReference
  dependents: SourceReferenceNode[]
  terminal?: SourceReferenceNode
  resolution?: ReferenceResolution
  start: number
  end: number
}

function referenceSourceEntityId(reference: SketchBackedExternalReference) {
  if (reference.kind === "line") return reference.sourceLineId
  if (reference.kind === "curve") return reference.sourceEntityId
  if (reference.kind === "pierce-point") return reference.sourceLineId
  return reference.sourcePointId
}

function referenceExpectedType(reference: SketchBackedExternalReference): SketchEntity["type"] {
  if (reference.kind === "line") return "line"
  if (reference.kind === "curve") return reference.sourceType
  if (reference.kind === "pierce-point") return "line"
  return "point"
}

function sourceGeometryIndex(sketch: SketchRecord): SourceGeometryIndex {
  const projectedOwners = new Map<SketchEntityId, SourceReferenceNode>()
  const references = new Map<SketchExternalReferenceId, SourceReferenceNode>()
  for (const reference of sketch.externalReferences ?? []) {
    const node: SourceReferenceNode = {
      ownerSketchId: sketch.id,
      reference,
      dependents: [],
      start: 0,
      end: 0,
    }
    references.set(reference.id, node)
    for (const entity of projectedExternalSketchEntities([reference])) {
      projectedOwners.set(entity.id, node)
    }
  }
  const entities = [
    ...sketch.entities,
    ...projectedExternalSketchEntities(sketch.externalReferences ?? []),
  ]
  return {
    authoredEntityIds: new Set(sketch.entities.map(({ id }) => id)),
    entities: new Map(entities.map((entity) => [entity.id, entity])),
    projectedOwners,
    references,
  }
}

function inheritedResolution(resolution: ReferenceResolution): ReferenceResolution {
  if (resolution === "healthy" || resolution === "unknown") return resolution
  return "transitive-broken"
}

function referencedSourceEntity(
  reference: SketchBackedExternalReference,
  sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>,
) {
  const geometry = sourceGeometry.get(reference.sourceSketchId)
  const entity = geometry?.entities.get(referenceSourceEntityId(reference))
  if (!geometry || !entity || entity.type !== referenceExpectedType(reference)) return null
  return { entity, geometry } as const
}

function sourceReferenceStep(
  reference: SketchBackedExternalReference,
  sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>,
): ReferenceResolution | SourceReferenceNode {
  const target = referencedSourceEntity(reference, sourceGeometry)
  if (!target) return "direct-broken"
  const { entity, geometry } = target
  if (geometry.authoredEntityIds.has(entity.id)) return "healthy"
  return geometry.projectedOwners.get(entity.id) ?? "direct-broken"
}

function indexSourceReferenceTree(terminal: SourceReferenceNode, start: number): number {
  terminal.terminal = terminal
  terminal.start = start++
  const stack = [{ node: terminal, nextDependent: 0 }]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (!frame) break
    const dependent = frame.node.dependents[frame.nextDependent++]
    if (dependent) {
      dependent.terminal = terminal
      dependent.start = start++
      stack.push({ node: dependent, nextDependent: 0 })
    } else {
      frame.node.end = start
      stack.pop()
    }
  }
  return start
}

function indexSourceReferences(sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>) {
  const terminals: SourceReferenceNode[] = []
  for (const geometry of sourceGeometry.values()) {
    for (const node of geometry.references.values()) {
      const { reference } = node
      if (isOrphanedModelReference(reference)) {
        node.resolution = "direct-broken"
      } else if (!isSketchExternalModelReference(reference)) {
        const step = sourceReferenceStep(reference, sourceGeometry)
        if (typeof step !== "string") {
          step.dependents.push(node)
          continue
        }
        node.resolution = step
      }
      terminals.push(node)
    }
  }

  // Reversing the single-dependency graph gives disjoint trees rooted at terminal references.
  // Nodes outside those trees reach a cycle and remain transitively broken.
  let start = 0
  for (const terminal of terminals) start = indexSourceReferenceTree(terminal, start)
}

function sourcePathContains(
  source: SourceReferenceNode,
  candidate: SourceReferenceNode | undefined,
) {
  return (
    candidate !== undefined &&
    !isSketchExternalModelReference(candidate.reference) &&
    candidate.terminal === source.terminal &&
    candidate.start <= source.start &&
    source.start < candidate.end
  )
}

function createReferenceResolver(
  sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>,
  resolveModelReference: SketchModelReferenceHealthResolver | undefined,
) {
  // Identity includes both owner and reference object: a draft may retain committed reference IDs.
  const modelResolutions = new Map<
    SketchId,
    Map<SketchExternalModelReference, ReferenceResolution>
  >()
  function modelResolution(
    ownerSketchId: SketchId,
    reference: SketchExternalModelReference,
  ): ReferenceResolution {
    let ownerResolutions = modelResolutions.get(ownerSketchId)
    if (!ownerResolutions) {
      ownerResolutions = new Map()
      modelResolutions.set(ownerSketchId, ownerResolutions)
    }
    const cached = ownerResolutions.get(reference)
    if (cached) return cached
    const evidence = resolveModelReference?.(ownerSketchId, reference) ?? "unknown"
    const resolution =
      evidence === "resolved" ? "healthy" : evidence === "broken" ? "direct-broken" : "unknown"
    ownerResolutions.set(reference, resolution)
    return resolution
  }

  return (ownerSketchId: SketchId, reference: SketchExternalReference): ReferenceResolution => {
    if (isOrphanedModelReference(reference)) return "direct-broken"
    if (isSketchExternalModelReference(reference)) return modelResolution(ownerSketchId, reference)

    const source = sourceReferenceStep(reference, sourceGeometry)
    if (typeof source === "string") return source
    const terminal = source.terminal
    if (!terminal) return "transitive-broken"

    // Preserve the root's ID-based cycle check even when a draft differs from its committed node.
    // Reverse-tree intervals answer source-path membership without rewalking the source chain.
    const committed = sourceGeometry.get(ownerSketchId)?.references.get(reference.id)
    if (sourcePathContains(source, committed)) return "transitive-broken"

    const resolution =
      terminal.resolution ??
      (isSketchExternalModelReference(terminal.reference)
        ? modelResolution(terminal.ownerSketchId, terminal.reference)
        : "direct-broken")
    return inheritedResolution(resolution)
  }
}

function inspectSketch(
  sketch: SketchRecord,
  resolveReference: ReturnType<typeof createReferenceResolver>,
): SketchReferenceHealth {
  const directBrokenReferenceIds: SketchExternalReferenceId[] = []
  const transitiveBrokenReferenceIds: SketchExternalReferenceId[] = []
  const unknownReferenceIds: SketchExternalReferenceId[] = []

  for (const reference of sketch.externalReferences ?? []) {
    const resolution = resolveReference(sketch.id, reference)
    if (resolution === "direct-broken") directBrokenReferenceIds.push(reference.id)
    if (resolution === "transitive-broken") transitiveBrokenReferenceIds.push(reference.id)
    if (resolution === "unknown") unknownReferenceIds.push(reference.id)
  }

  const broken = directBrokenReferenceIds.length + transitiveBrokenReferenceIds.length > 0
  return {
    status: broken ? "broken" : unknownReferenceIds.length > 0 ? "unknown" : "healthy",
    directBrokenReferenceIds,
    transitiveBrokenReferenceIds,
    unknownReferenceIds,
  }
}

/**
 * Inspects stable sketch-reference identity. Model references remain unknown unless the caller
 * supplies current worker evidence. Targets may contain an active draft while sources remain the
 * committed document sketches.
 */
export function inspectSketchReferenceHealth(
  sources: readonly SketchRecord[],
  targets: readonly SketchRecord[] = sources,
  resolveModelReference?: SketchModelReferenceHealthResolver,
): ReadonlyMap<SketchId, SketchReferenceHealth> {
  const sourceGeometry = new Map(
    sources.map((source) => [source.id, sourceGeometryIndex(source)] as const),
  )
  indexSourceReferences(sourceGeometry)
  const resolveReference = createReferenceResolver(sourceGeometry, resolveModelReference)
  return new Map(
    targets.map((target) => [target.id, inspectSketch(target, resolveReference)] as const),
  )
}
