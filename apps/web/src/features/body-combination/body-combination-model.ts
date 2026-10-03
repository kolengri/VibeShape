import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import { type FeatureId, type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { createDocumentDependencyGraph } from "@vibeshape/domain/document-graph"
import type { DocumentNodeRef } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { historyItemKey } from "@vibeshape/domain/history-folders"
import type { CompoundSlotId, PartId } from "@vibeshape/domain/identifiers"
import {
  compoundBodyOutputRole,
  compoundFeatureParametersSchema,
  compoundFeatureType,
  readCompoundFeatureParameters,
  readUnionFeatureParameters,
  unionFeatureParametersSchema,
  unionFeatureType,
} from "@vibeshape/domain/part-design-body-combination"
import { authoredPlacementTarget } from "../part-design/authored-part-selection"

function sameBody(a: BodyReference, b: BodyReference) {
  return a.featureId === b.featureId && a.outputRole === b.outputRole
}

export type BodyCombinationKind = "compound" | "union"
export type BodyCombinationInput = Readonly<{
  partId: PartId
  name: string
  body: BodyReference
  slotId?: CompoundSlotId
}>
export type BodyCombinationMode = Readonly<{
  operation: BodyCombinationKind
  initial: readonly BodyCombinationInput[]
}> &
  (
    | Readonly<{ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }>
    | Readonly<{ kind: "edit"; feature: FeatureRecord }>
  )

function downstreamFeatures(
  authority: AuthoredDocumentSnapshot,
  featureId: FeatureId,
): Set<FeatureId> | null {
  const result = createDocumentDependencyGraph(authority)
  if (!result.ok || result.graph.dependencyModelIssues.length) return null
  const queue: DocumentNodeRef[] = [{ kind: "feature", id: featureId }]
  const seen = new Set<string>()
  const excluded = new Set<FeatureId>()
  for (const ref of queue) {
    const key = historyItemKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    if (ref.kind === "feature") excluded.add(ref.id)
    queue.push(...result.graph.dependentsOf(ref))
  }
  // Editing never reorders History: later independent producers are also invalid dependencies.
  const index = authority.history.findIndex((ref) => ref.kind === "feature" && ref.id === featureId)
  for (const ref of authority.history.slice(index)) if (ref.kind === "feature") excluded.add(ref.id)
  return excluded
}

export function combinationInputOptions(
  authority: AuthoredDocumentSnapshot,
  parts: readonly ResolvedAuthoredPart[],
  mode: BodyCombinationMode,
): readonly BodyCombinationInput[] {
  const excluded =
    mode.kind === "edit" ? downstreamFeatures(authority, mode.feature.id) : new Set<FeatureId>()
  if (!excluded) return mode.initial
  const initialIds = new Set(mode.initial.map(({ partId }) => partId))
  const available = parts.flatMap((resolved) => {
    const body = authoredPlacementTarget(resolved)
    if (!body || initialIds.has(resolved.part.id) || excluded.has(body.featureId)) return []
    return [{ partId: resolved.part.id, name: resolved.part.name, body }]
  })
  return [...mode.initial, ...available]
}

function retainedInput(
  authority: AuthoredDocumentSnapshot,
  body: BodyReference,
  output: BodyReference | null,
): BodyCombinationInput | null {
  const contains =
    (reference: BodyReference) => (part: AuthoredDocumentSnapshot["parts"][number]) =>
      part.bodyHistory.some((entry) => sameBody(entry, reference))
  const outputOwner = output ? authority.parts.filter(contains(output)) : []
  const candidates = outputOwner.length ? outputOwner : authority.parts.filter(contains(body))
  if (candidates.length !== 1) return null
  const part = candidates[0]
  if (!part) return null
  return { partId: part.id, name: part.name, body }
}

function compoundInputs(
  authority: AuthoredDocumentSnapshot,
  feature: FeatureRecord,
): readonly BodyCombinationInput[] | null {
  const parameters = readCompoundFeatureParameters(feature)
  if (!parameters) return null
  const inputs = parameters.slots.map(({ slotId, targetBody }) => {
    const input = retainedInput(authority, targetBody, {
      schemaVersion: 0,
      featureId: feature.id,
      outputRole: compoundBodyOutputRole(slotId),
    })
    return input ? { ...input, slotId } : null
  })
  return inputs.every((input) => input !== null) ? inputs : null
}
function unionInputs(
  authority: AuthoredDocumentSnapshot,
  feature: FeatureRecord,
): readonly BodyCombinationInput[] | null {
  const parameters = readUnionFeatureParameters(feature)
  if (!parameters) return null
  const inputs = parameters.bodies.map((body, index) =>
    retainedInput(
      authority,
      body,
      index === 0 ? { schemaVersion: 0, featureId: feature.id, outputRole: "result" } : null,
    ),
  )
  return inputs.every((input) => input !== null) ? inputs : null
}
export function retainedCombinationInputs(
  authority: AuthoredDocumentSnapshot,
  feature: FeatureRecord,
  operation: BodyCombinationKind,
): readonly BodyCombinationInput[] | null {
  const inputs =
    operation === "compound" ? compoundInputs(authority, feature) : unionInputs(authority, feature)
  return inputs && new Set(inputs.map(({ partId }) => partId)).size === inputs.length
    ? inputs
    : null
}

export function selectedCombinationInputs(
  selected: readonly PartId[],
  options: readonly BodyCombinationInput[],
): readonly BodyCombinationInput[] | null {
  if (selected.length < 2 || selected.length > 8 || new Set(selected).size !== selected.length)
    return null
  const inputs = selected.map((id) => options.find(({ partId }) => partId === id))
  if (!inputs.every((input) => input !== undefined)) return null
  return new Set(inputs.map(({ body }) => body.featureId)).size === inputs.length ? inputs : null
}

export function bodyCombinationFeature(
  mode: BodyCombinationMode,
  featureId: FeatureId,
  inputs: readonly BodyCombinationInput[],
  slots: ReadonlyMap<PartId, CompoundSlotId>,
): FeatureRecord {
  const parameters =
    mode.operation === "compound"
      ? compoundFeatureParametersSchema.parse({
          slots: inputs.map((input) => ({
            slotId: slots.get(input.partId),
            targetBody: input.body,
          })),
        })
      : unionFeatureParametersSchema.parse({ bodies: inputs.map(({ body }) => body) })
  const dependencies = inputs.map(({ body }) => body.featureId)
  if (mode.kind === "edit")
    return featureRecordSchema.parse({ ...mode.feature, parameters, dependencies })
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    label: mode.featureLabel,
    type: (mode.operation === "compound" ? compoundFeatureType : unionFeatureType).type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}

export function moveCombinationInput(
  selected: readonly PartId[],
  index: number,
  direction: -1 | 1,
): PartId[] {
  const result = [...selected]
  const next = index + direction
  const current = result[index]
  const other = result[next]
  if (!current || !other) return result
  result[index] = other
  result[next] = current
  return result
}
