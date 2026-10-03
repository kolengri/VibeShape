import type { BodyReference } from "./body-reference"
import { canonicalJson } from "./canonical-json"
import type { DocumentSnapshotV1 } from "./document"
import type { FeatureRecordV1 } from "./feature-graph"
import type { FeatureId } from "./identifiers"
import { readUnionFeatureParameters } from "./part-design-body-combination"
import {
  classifyPartOperation,
  featureResultBody,
  type PartOperation,
  sameBodyReference,
} from "./part-operation"
import type { PartAllocation, PartOrigin, PartRecord } from "./parts"

type PartModel = Pick<DocumentSnapshotV1, "features" | "history">
export type PartRootRequirement = Readonly<{ body: BodyReference; origin: PartOrigin }>
type BindingIntent = {
  root: BodyReference
  origin: PartOrigin
  bodyHistory: BodyReference[]
  consumedBy: FeatureId | null
}
type BindingState = {
  roots: BindingIntent[]
  owners: Map<string, BindingIntent>
  forkRoots: ReadonlySet<string>
  unavailable: Set<FeatureId>
}

function bodyKey(body: BodyReference): string {
  return `${body.featureId}:${body.outputRole}`
}

function orderedFeatures(model: PartModel): readonly FeatureRecordV1[] {
  const byId = new Map(model.features.map((feature) => [feature.id, feature]))
  return model.history.flatMap((item) => {
    const feature = item.kind === "feature" ? byId.get(item.id) : undefined
    return feature ? [feature] : []
  })
}

function currentBody(part: BindingIntent): BodyReference {
  return part.bodyHistory.at(-1) ?? part.root
}

function createRoot(state: BindingState, body: BodyReference, origin: PartOrigin): BindingIntent {
  const part: BindingIntent = { root: body, origin, bodyHistory: [body], consumedBy: null }
  state.roots.push(part)
  state.owners.set(bodyKey(body), part)
  return part
}

function isCurrentUnconsumed(part: BindingIntent, body: BodyReference): boolean {
  return part.consumedBy === null && sameBodyReference(currentBody(part), body)
}

function consumeCurrentBody(state: BindingState, body: BodyReference, consumer: FeatureId) {
  const owner = state.owners.get(bodyKey(body))
  if (owner && isCurrentUnconsumed(owner, body)) owner.consumedBy = consumer
}

function markUnavailableUnionInputs(state: BindingState, feature: FeatureRecordV1) {
  const union = readUnionFeatureParameters(feature)
  if (union?.bodies.some((body) => !state.owners.has(bodyKey(body))))
    state.unavailable.add(feature.id)
}

function applyModifier(
  state: BindingState,
  feature: FeatureRecordV1,
  operation: Extract<PartOperation, { kind: "modify" }>,
  result: BodyReference = featureResultBody(feature),
) {
  markUnavailableUnionInputs(state, feature)
  const target = state.owners.get(bodyKey(operation.target))
  const historical = target !== undefined && !isCurrentUnconsumed(target, operation.target)
  const fork = state.forkRoots.has(bodyKey(result)) || historical
  if (fork) createRoot(state, result, "fork")
  if (state.unavailable.has(feature.id)) return
  if (fork) consumeCurrentBody(state, operation.target, feature.id)
  else if (target) {
    target.bodyHistory.push(result)
    state.owners.set(bodyKey(result), target)
  }
  for (const body of operation.consumed) consumeCurrentBody(state, body, feature.id)
}

function applyCompound(
  state: BindingState,
  feature: FeatureRecordV1,
  operation: Extract<PartOperation, { kind: "compound" }>,
) {
  if (operation.entries.some(({ target }) => !state.owners.has(bodyKey(target))))
    state.unavailable.add(feature.id)
  for (const { target, output } of operation.entries) {
    applyModifier(state, feature, { kind: "modify", target, consumed: [] }, output)
  }
}

function deriveBindingIntents(
  model: PartModel,
  retainedParts: readonly PartRecord[],
): readonly BindingIntent[] {
  const forkRoots = new Set(
    retainedParts.flatMap((part) => {
      const root = part.bodyHistory[0]
      return part.origin === "fork" && root ? [bodyKey(root)] : []
    }),
  )
  const state: BindingState = { roots: [], owners: new Map(), forkRoots, unavailable: new Set() }
  for (const feature of orderedFeatures(model)) {
    if (feature.suppressed || feature.dependencies.some((id) => state.unavailable.has(id)))
      state.unavailable.add(feature.id)
    const operation = classifyPartOperation(feature)
    if (operation.kind === "new") createRoot(state, featureResultBody(feature), "independent")
    else if (operation.kind === "modify") applyModifier(state, feature, operation)
    else if (operation.kind === "compound") applyCompound(state, feature, operation)
  }
  return state.roots
}

/** Captured fork roots remain roots when later edits or suppression expose their old source. */
export function requiredPartAllocations(
  model: PartModel,
  retainedParts: readonly PartRecord[] = [],
): readonly PartRootRequirement[] {
  const existing = new Set(
    retainedParts.flatMap((part) => (part.bodyHistory[0] ? [bodyKey(part.bodyHistory[0])] : [])),
  )
  return deriveBindingIntents(model, retainedParts)
    .filter((intent) => !existing.has(bodyKey(intent.root)))
    .map((intent) => ({ body: intent.root, origin: intent.origin }))
}

/** Allocations name roots only; lineage and consumption are recomputed from trusted operations. */
export function derivePartBindings(
  model: PartModel,
  allocations: readonly PartAllocation[],
  retainedParts: readonly PartRecord[],
): readonly PartRecord[] | null {
  const byBody = new Map(allocations.map((allocation) => [bodyKey(allocation.body), allocation]))
  if (
    byBody.size !== allocations.length ||
    new Set(allocations.map((allocation) => allocation.id)).size !== allocations.length
  )
    return null
  const parts: PartRecord[] = []
  for (const intent of deriveBindingIntents(model, retainedParts)) {
    const allocation = byBody.get(bodyKey(intent.root))
    if (!allocation || allocation.origin !== intent.origin) return null
    parts.push({
      schemaVersion: 0,
      id: allocation.id,
      name: allocation.name,
      visible: true,
      origin: intent.origin,
      bodyHistory: intent.bodyHistory,
      consumedBy: intent.consumedBy,
    })
  }
  return parts.length === allocations.length ? parts : null
}

function partRootAllocations(parts: readonly PartRecord[]): readonly PartAllocation[] {
  return parts.flatMap((part) => {
    const body = part.bodyHistory[0]
    return body ? [{ id: part.id, name: part.name, body, origin: part.origin }] : []
  })
}

export function validatePartBindings(
  parts: readonly PartRecord[],
  model: PartModel,
): string | null {
  const derived = derivePartBindings(model, partRootAllocations(parts), parts)
  if (!derived)
    return "Part ownership requires exactly one captured identity per independent or fork root."
  const actual = parts.map((part) => ({ ...part, visible: true }))
  return canonicalJson(actual) === canonicalJson(derived)
    ? null
    : "Part bindings must match active producer, modifier and consumption semantics."
}

/** Existing identities survive retargeting; only roots that remain authored are retained. */
export function retainedPartAllocations(
  model: PartModel,
  parts: readonly PartRecord[],
): readonly PartAllocation[] {
  const byRoot = new Map(
    partRootAllocations(parts).map((allocation) => [bodyKey(allocation.body), allocation]),
  )
  return deriveBindingIntents(model, parts).flatMap((intent) => {
    const allocation = byRoot.get(bodyKey(intent.root))
    return allocation ? [{ ...allocation, origin: intent.origin }] : []
  })
}
