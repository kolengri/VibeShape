import { createDocumentDependencyGraph, type HistoryItemRef } from "@vibeshape/domain"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { historyItemKey } from "@vibeshape/domain/history-folders"
import type { PartId } from "@vibeshape/domain/identifiers"

export type HistorySelectionDeleteTarget = HistoryItemRef | Readonly<{ kind: "part"; id: PartId }>
type RemovalBlock = "unavailable" | "limit" | "siblingsBlocked" | null
export type RemovalPlan = Readonly<{
  documentId: AuthoredDocumentSnapshot["id"]
  revision: number
  targets: readonly HistoryItemRef[]
  names: readonly string[]
  owners: readonly string[]
  dependents: readonly string[]
  blocked: RemovalBlock
  siblings: readonly string[]
}>

function removalRecords(authority: AuthoredDocumentSnapshot) {
  return new Map<string, string>([
    ...authority.features.map(
      (feature) => [`feature:${feature.id}`, feature.label ?? feature.id] as const,
    ),
    ...authority.sketches.map((sketch) => [`sketch:${sketch.id}`, sketch.label] as const),
  ])
}

function removalContext(authority: AuthoredDocumentSnapshot) {
  const parts =
    authority.schemaVersion === 5
      ? [...authority.parts, ...authority.suspendedParts]
      : authority.parts
  return {
    parts,
    partsById: new Map(parts.map((part) => [part.id, part])),
    records: removalRecords(authority),
  }
}

type TargetResolution = Readonly<{
  target: HistoryItemRef | null
  name: string | null
  owner: string | null
  siblings: readonly string[]
  blocked: RemovalBlock
}>
const unavailable: TargetResolution = {
  target: null,
  name: null,
  owner: null,
  siblings: [],
  blocked: "unavailable",
}

function resolvePartRemoval(
  context: ReturnType<typeof removalContext>,
  id: PartId,
  selectedParts: ReadonlySet<PartId>,
): TargetResolution {
  const part = context.partsById.get(id)
  const owner = part?.bodyHistory[0]?.featureId
  if (!part || !owner) return unavailable
  const name = context.records.get(`feature:${owner}`)
  if (name === undefined) return unavailable
  const siblings = context.parts
    .filter(
      (sibling) => sibling.bodyHistory[0]?.featureId === owner && !selectedParts.has(sibling.id),
    )
    .map((sibling) => sibling.name)
  return {
    target: { kind: "feature", id: owner },
    name: part.name,
    owner: name,
    siblings,
    blocked: siblings.length > 0 ? "siblingsBlocked" : null,
  }
}

function resolveRemovalTarget(
  context: ReturnType<typeof removalContext>,
  target: HistorySelectionDeleteTarget,
  selectedParts: ReadonlySet<PartId>,
): TargetResolution {
  if (target.kind === "part") return resolvePartRemoval(context, target.id, selectedParts)
  const name = context.records.get(historyItemKey(target))
  return name === undefined
    ? unavailable
    : { target, name, owner: null, siblings: [], blocked: null }
}

function removalDependents(
  authority: AuthoredDocumentSnapshot,
  targets: readonly HistoryItemRef[],
  records: ReadonlyMap<string, string>,
) {
  const graph = createDocumentDependencyGraph(authority)
  if (!graph.ok || graph.graph.dependencyModelIssues.length > 0) {
    return { blocked: "unavailable" as const, names: [] }
  }
  const queue = [...targets]
  const visited = new Set(targets.map(historyItemKey))
  const names = new Map<string, string>()
  for (const current of queue) {
    for (const dependent of graph.graph.dependentsOf(current)) {
      const key = historyItemKey(dependent)
      if (visited.has(key)) continue
      visited.add(key)
      queue.push(dependent)
      const name = records.get(key)
      if (name !== undefined) names.set(key, name)
    }
  }
  return { blocked: null, names: [...names.values()] }
}

export function planHistoryRemoval(
  authority: AuthoredDocumentSnapshot,
  targets: readonly HistorySelectionDeleteTarget[],
): RemovalPlan {
  const context = removalContext(authority)
  const unique = [
    ...new Map(targets.map((target) => [`${target.kind}:${target.id}`, target])).values(),
  ]
  const selectedParts = new Set(
    unique.flatMap((target) => (target.kind === "part" ? [target.id] : [])),
  )
  const resolved = unique.map((target) => resolveRemovalTarget(context, target, selectedParts))
  const selected = new Map(
    resolved.flatMap(({ target }) => (target ? [[historyItemKey(target), target] as const] : [])),
  )
  const dependents = removalDependents(authority, [...selected.values()], context.records)
  const owners = new Map(
    resolved.flatMap(({ target, owner }) =>
      target && owner ? [[historyItemKey(target), owner] as const] : [],
    ),
  )
  return {
    documentId: authority.id,
    revision: authority.revision,
    targets: [...selected.values()],
    names: resolved.flatMap(({ name }) => (name === null ? [] : [name])),
    owners: [...owners.values()],
    dependents: dependents.names,
    blocked:
      unique.length > 256
        ? "limit"
        : (resolved.find((item) => item.blocked)?.blocked ?? dependents.blocked),
    siblings: [...new Set(resolved.flatMap((item) => item.siblings))],
  }
}
