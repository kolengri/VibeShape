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
  projectedOwners: ReadonlyMap<SketchEntityId, SketchExternalReference>
}>

function referenceSourceEntityId(reference: SketchBackedExternalReference) {
  if (reference.kind === "line") return reference.sourceLineId
  if (reference.kind === "curve") return reference.sourceEntityId
  return reference.sourcePointId
}

function referenceExpectedType(reference: SketchBackedExternalReference): SketchEntity["type"] {
  if (reference.kind === "line") return "line"
  if (reference.kind === "curve") return reference.sourceType
  return "point"
}

function sourceGeometryIndex(sketch: SketchRecord): SourceGeometryIndex {
  const projectedOwners = new Map<SketchEntityId, SketchExternalReference>()
  for (const reference of sketch.externalReferences ?? []) {
    for (const entity of projectedExternalSketchEntities([reference])) {
      projectedOwners.set(entity.id, reference)
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

function modelReferenceResolution(
  ownerSketchId: SketchId,
  reference: SketchExternalModelReference,
  resolveModelReference: SketchModelReferenceHealthResolver | undefined,
): ReferenceResolution {
  const resolution = resolveModelReference?.(ownerSketchId, reference) ?? "unknown"
  if (resolution === "resolved") return "healthy"
  return resolution === "broken" ? "direct-broken" : "unknown"
}

function resolveReference(
  ownerSketchId: SketchId,
  reference: SketchExternalReference,
  sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>,
  resolveModelReference: SketchModelReferenceHealthResolver | undefined,
  visiting: ReadonlySet<string>,
): ReferenceResolution {
  if (isOrphanedModelReference(reference)) return "direct-broken"
  if (isSketchExternalModelReference(reference)) {
    return modelReferenceResolution(ownerSketchId, reference, resolveModelReference)
  }
  const visitKey = `${ownerSketchId}:${reference.id}`
  if (visiting.has(visitKey)) return "transitive-broken"

  const target = referencedSourceEntity(reference, sourceGeometry)
  if (!target) return "direct-broken"
  const { entity, geometry } = target
  if (geometry.authoredEntityIds.has(entity.id)) return "healthy"

  const owner = geometry.projectedOwners.get(entity.id)
  if (!owner) return "direct-broken"
  return inheritedResolution(
    resolveReference(
      reference.sourceSketchId,
      owner,
      sourceGeometry,
      resolveModelReference,
      new Set([...visiting, visitKey]),
    ),
  )
}

function inspectSketch(
  sketch: SketchRecord,
  sourceGeometry: ReadonlyMap<SketchId, SourceGeometryIndex>,
  resolveModelReference: SketchModelReferenceHealthResolver | undefined,
): SketchReferenceHealth {
  const directBrokenReferenceIds: SketchExternalReferenceId[] = []
  const transitiveBrokenReferenceIds: SketchExternalReferenceId[] = []
  const unknownReferenceIds: SketchExternalReferenceId[] = []

  for (const reference of sketch.externalReferences ?? []) {
    const resolution = resolveReference(
      sketch.id,
      reference,
      sourceGeometry,
      resolveModelReference,
      new Set(),
    )
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
  return new Map(
    targets.map(
      (target) =>
        [target.id, inspectSketch(target, sourceGeometry, resolveModelReference)] as const,
    ),
  )
}
