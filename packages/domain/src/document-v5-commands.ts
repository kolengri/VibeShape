import { z } from "zod"
import { emptyAssemblyAuthority } from "./assembly-authority"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import type { DocumentSnapshotV1 } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import type { DocumentNodeRef } from "./document-node"
import { projectAuthoredDocumentSnapshotToV1 } from "./document-v2"
import { type DocumentSnapshotV2, documentSnapshotV2Schema } from "./document-v2-schema"
import { sameOperationEnvelope } from "./document-v2-support"
import { type DocumentSnapshotV3, documentSnapshotV3Schema } from "./document-v3-schema"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "./document-v4"
import { documentV4CommandSchema } from "./document-v4-command-schemas"
import {
  applyDocumentV4AuthoredCommand,
  applyDocumentV4Command,
  applyDocumentV4ModelEvent,
  reduceDocumentV4Event,
} from "./document-v4-commands"
import {
  type DocumentSnapshotV5,
  documentSnapshotV5Schema,
  projectDocumentSnapshotV5ToV4,
} from "./document-v5"
import {
  type DocumentV5Event,
  documentV5EventSchema,
  type HistoryRepairItem,
  historyRemoveRetainingDependentsCommandSchema,
  historyRepairCommandSchema,
  historyRepairItemSchema,
} from "./document-v5-command-schemas"
import { type FeatureRecordV1, featureRecordV1Schema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import {
  authoredHistoryFeature,
  authoredHistorySketch,
  detachedHistoryFeature,
  detachedHistorySketch,
  type HistoryRepairIntent,
  isMissingInputFeature,
  nodeKey,
} from "./history-repair"
import { draftIdSchema } from "./identifiers"
import { planPartEffects } from "./part-effects"
import { partAllocationsSchema } from "./parts"
import {
  isOrphanedModelReference,
  isSketchExternalModelReference,
  type SketchRecord,
} from "./sketch"

type Source = DocumentSnapshotV2 | DocumentSnapshotV3 | DocumentSnapshotV4 | DocumentSnapshotV5
export type DocumentV5Result =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV5 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type DocumentV5CommandResult =
  | (Extract<DocumentV5Result, { ok: true }> & { event: DocumentV5Event })
  | Extract<DocumentV5Result, { ok: false }>
function invalid(
  message: string,
  code: DomainDiagnostic["code"] = "invalid-event",
): Extract<DocumentV5Result, { ok: false }> {
  return { ok: false, diagnostic: domainDiagnostic(code, message, code === "stale-revision") }
}
function lift(snapshot: Source): DocumentSnapshotV5 {
  if (snapshot.schemaVersion === 5) return snapshot
  return {
    ...snapshot,
    schemaVersion: 5,
    repairIntents: [],
    suspendedParts: [],
    surfaceTextures: snapshot.schemaVersion === 2 ? [] : snapshot.surfaceTextures,
    assets: snapshot.schemaVersion === 4 ? snapshot.assets : [],
    assembly: snapshot.schemaVersion === 4 ? snapshot.assembly : emptyAssemblyAuthority(),
  }
}
function authoredSources(
  snapshot: DocumentSnapshotV5,
  node: DocumentNodeRef,
): readonly DocumentNodeRef[] {
  if (node.kind === "feature") {
    const feature = authoredHistoryFeature(snapshot, node.id)
    return feature
      ? [
          ...feature.dependencies.map((id) => ({ kind: "feature" as const, id })),
          ...(feature.semanticInputs ?? []),
        ]
      : []
  }
  const sketch = authoredHistorySketch(snapshot, node.id)
  if (!sketch) return []
  return [
    ...(sketch.support
      ? [{ kind: "feature" as const, id: sketch.support.reference.featureId }]
      : []),
    ...(sketch.externalReferences ?? [])
      .filter((reference) => !isOrphanedModelReference(reference))
      .map(
        (reference): DocumentNodeRef =>
          isSketchExternalModelReference(reference)
            ? { kind: "feature", id: reference.reference.featureId }
            : { kind: "sketch", id: reference.sourceSketchId },
      ),
  ]
}
function affectedHistory(snapshot: DocumentSnapshotV5, target: DocumentNodeRef) {
  const affected = new Set([nodeKey(target)])
  // History is topological, so each complete declaration needs one bounded forward pass.
  for (const item of snapshot.history)
    if (authoredSources(snapshot, item).some((source) => affected.has(nodeKey(source))))
      affected.add(nodeKey(item))
  return affected
}
function planRepairIntents(
  current: DocumentSnapshotV5,
  target: DocumentNodeRef,
  affected: ReadonlySet<string>,
) {
  const byId = new Map(
    current.repairIntents.map((intent) => [`${intent.kind}:${intent.authored.id}`, intent]),
  )
  byId.delete(nodeKey(target))
  for (const item of current.history) {
    if (!affected.has(nodeKey(item)) || nodeKey(item) === nodeKey(target)) continue
    const prior = byId.get(nodeKey(item))
    const sources = authoredSources(current, item).filter((source) => affected.has(nodeKey(source)))
    const missingInputs = [
      ...new Map(
        [...(prior?.missingInputs ?? []), ...sources].map((source) => [nodeKey(source), source]),
      ).values(),
    ]
    const next = authoredRepairIntent(current, item, missingInputs)
    if (!next) return null
    byId.set(nodeKey(item), next)
  }
  return [...byId.values()]
}
function authoredRepairIntent(
  current: DocumentSnapshotV5,
  item: DocumentNodeRef,
  missingInputs: readonly DocumentNodeRef[],
): HistoryRepairIntent | null {
  if (!missingInputs.length) return null
  if (item.kind === "feature") {
    const authored = authoredHistoryFeature(current, item.id)
    return authored ? { kind: "feature", authored, missingInputs: [...missingInputs] } : null
  }
  const authored = authoredHistorySketch(current, item.id)
  return authored ? { kind: "sketch", authored, missingInputs: [...missingInputs] } : null
}
function disconnectedCollections(
  current: DocumentSnapshotV5,
  target: DocumentNodeRef,
  repairIntents: readonly HistoryRepairIntent[],
) {
  const retained = new Set(
    current.history.filter((item) => nodeKey(item) !== nodeKey(target)).map(nodeKey),
  )
  const featureIds = new Set(
    current.features
      .filter((feature) => retained.has(`feature:${feature.id}`))
      .map((feature) => feature.id),
  )
  const byId = new Map(
    repairIntents.map((intent) => [`${intent.kind}:${intent.authored.id}`, intent]),
  )
  const features = current.features
    .filter((feature) => featureIds.has(feature.id))
    .map((feature) => {
      const intent = byId.get(`feature:${feature.id}`)
      return intent?.kind === "feature" ? detachedHistoryFeature(intent, featureIds) : feature
    })
  const sketches = current.sketches
    .filter((sketch) => retained.has(`sketch:${sketch.id}`))
    .map((sketch) => {
      const intent = byId.get(`sketch:${sketch.id}`)
      return intent?.kind === "sketch" ? detachedHistorySketch(intent) : sketch
    })
  const folders = current.folders.flatMap((folder) => {
    const items = folder.items.filter((item) => retained.has(nodeKey(item)))
    return items.length ? [{ ...folder, items }] : []
  })
  return {
    features,
    sketches,
    folders,
    history: current.history.filter((item) => retained.has(nodeKey(item))),
    surfaceTextures: current.surfaceTextures.filter((layer) => featureIds.has(layer.featureId)),
  }
}
function removeRetainingDependents(
  current: DocumentSnapshotV5,
  target: DocumentNodeRef,
): DocumentV5Result {
  const graph = createDocumentDependencyGraph(current)
  if (!graph.ok || graph.graph.dependencyModelIssues.length)
    return invalid("Removal requires complete dependency declarations.")
  if (!graph.graph.getNode(target))
    return invalid(
      "The History item does not exist.",
      target.kind === "feature" ? "feature-not-found" : "sketch-not-found",
    )
  const repairIntents = planRepairIntents(current, target, affectedHistory(current, target))
  if (!repairIntents)
    return invalid("The removed dependency has no complete authored repair intent.")
  const active = {
    ...current,
    ...disconnectedCollections(current, target, repairIntents),
    repairIntents,
  }
  const planned = planPartEffects({
    after: { ...active, schemaVersion: 1 },
    parts: current.parts,
    allocations: [],
  })
  if (!planned.ok) return invalid(planned.message)
  const suspendedParts = suspendedPartsForRepair(
    [...current.suspendedParts, ...current.parts],
    repairIntents,
    planned.parts,
  )
  return { ok: true, snapshot: { ...active, parts: planned.parts, suspendedParts } }
}

function suspendedPartsForRepair(
  parts: DocumentSnapshotV5["parts"],
  intents: readonly HistoryRepairIntent[],
  activeParts: DocumentSnapshotV5["parts"],
) {
  const repairOwners = new Set(
    intents.filter((intent) => intent.kind === "feature").map((intent) => intent.authored.id),
  )
  const activeIds = new Set(activeParts.map((part) => part.id))
  return parts.filter((part) => {
    const owner = part.bodyHistory[0]
    return owner && repairOwners.has(owner.featureId) && !activeIds.has(part.id)
  })
}

function restoredHistoryItem(
  snapshot: DocumentSnapshotV5,
  intent: HistoryRepairIntent,
): DocumentSnapshotV5 {
  return {
    ...snapshot,
    features:
      intent.kind === "feature"
        ? snapshot.features.map((feature) =>
            feature.id === intent.authored.id ? intent.authored : feature,
          )
        : snapshot.features,
    sketches:
      intent.kind === "sketch"
        ? snapshot.sketches.map((sketch) =>
            sketch.id === intent.authored.id ? intent.authored : sketch,
          )
        : snapshot.sketches,
    repairIntents: snapshot.repairIntents.filter(
      (record) => `${record.kind}:${record.authored.id}` !== `${intent.kind}:${intent.authored.id}`,
    ),
  }
}
function validatedRestoration(
  candidate: DocumentSnapshotV5,
  previous: DocumentSnapshotV5,
): DocumentSnapshotV5 | null {
  const graph = createDocumentDependencyGraph(candidate)
  if (!graph.ok || graph.graph.dependencyModelIssues.length) return null
  const planned = planPartEffects({
    after: { ...candidate, schemaVersion: 1 },
    parts: [...previous.parts, ...previous.suspendedParts],
    allocations: [],
  })
  if (!planned.ok) return null
  const restored = new Set(planned.parts.map((part) => part.id))
  const parsed = documentSnapshotV5Schema.safeParse({
    ...candidate,
    parts: planned.parts,
    suspendedParts: previous.suspendedParts.filter((part) => !restored.has(part.id)),
  })
  return parsed.success ? parsed.data : null
}
function restoreAvailableDescendants(snapshot: DocumentSnapshotV5): DocumentSnapshotV5 {
  let next = snapshot
  const existing = new Set(snapshot.history.map(nodeKey))
  const pending = new Map(
    snapshot.repairIntents.map((intent) => [`${intent.kind}:${intent.authored.id}`, intent]),
  )
  for (const item of snapshot.history) {
    const intent = pending.get(nodeKey(item))
    if (!intent) continue
    const unavailable = authoredSources(next, item).some(
      (source) => !existing.has(nodeKey(source)) || pending.has(nodeKey(source)),
    )
    if (unavailable) continue
    const restored = validatedRestoration(restoredHistoryItem(next, intent), next)
    if (!restored) continue
    next = restored
    pending.delete(nodeKey(item))
  }
  return next
}

function repairNode(item: HistoryRepairItem): DocumentNodeRef {
  return item.kind === "feature"
    ? { kind: "feature", id: item.feature.id }
    : { kind: "sketch", id: item.sketch.id }
}
function repairedCollections(snapshot: DocumentSnapshotV5, item: HistoryRepairItem) {
  if (item.kind === "sketch")
    return {
      features: snapshot.features,
      sketches: snapshot.sketches.map((sketch) =>
        sketch.id === item.sketch.id ? item.sketch : sketch,
      ),
    }
  const inputs = projectFirstPartyFeatureSemanticInputs(item.feature)
  if (!inputs.recognized || !inputs.ok || isMissingInputFeature(item.feature)) return null
  const feature = featureRecordV1Schema.safeParse({
    ...item.feature,
    schemaVersion: 1,
    semanticInputs: inputs.inputs,
  })
  return feature.success
    ? {
        sketches: snapshot.sketches,
        features: snapshot.features.map((current) =>
          current.id === feature.data.id ? feature.data : current,
        ),
      }
    : null
}
/** Validates the replacement model before the application captures any new Part identities. */
export function prepareHistoryRepairModel(
  snapshot: DocumentSnapshotV5,
  itemInput: unknown,
): Readonly<{ ok: true; model: DocumentSnapshotV1 }> | Extract<DocumentV5Result, { ok: false }> {
  const item = historyRepairItemSchema.safeParse(itemInput)
  if (!item.success) return invalid("The History repair record is invalid.", "invalid-command")
  const key = nodeKey(repairNode(item.data))
  if (!snapshot.repairIntents.some((intent) => `${intent.kind}:${intent.authored.id}` === key))
    return invalid("History repair requires a retained repair intent.", "invalid-command")
  const collections = repairedCollections(snapshot, item.data)
  if (!collections)
    return invalid("History repair requires complete authored feature inputs.", "invalid-command")
  const model = { ...projectAuthoredDocumentSnapshotToV1(snapshot), ...collections }
  const graph = createDocumentDependencyGraph(model)
  return graph.ok && !graph.graph.dependencyModelIssues.length
    ? { ok: true, model }
    : invalid("The repaired History record must validate its complete dependency graph.")
}
function repairHistoryItem(
  current: DocumentSnapshotV5,
  event: Extract<DocumentV5Event, { type: "org.vibeshape.history.repaired" }>,
): DocumentV5Result {
  const repaired = prepareHistoryRepairModel(current, event.item)
  if (!repaired.ok) return repaired
  const planned = planPartEffects({
    after: repaired.model,
    parts: [...current.parts, ...current.suspendedParts],
    allocations: event.partAllocations,
  })
  if (!planned.ok) return invalid(planned.message)
  const key = nodeKey(repairNode(event.item))
  const repairIntents = current.repairIntents.filter(
    (intent) => `${intent.kind}:${intent.authored.id}` !== key,
  )
  const candidate = {
    ...current,
    features: repaired.model.features,
    sketches: repaired.model.sketches,
    parts: planned.parts,
    repairIntents,
    suspendedParts: suspendedPartsForRepair(current.suspendedParts, repairIntents, planned.parts),
  }
  return { ok: true, snapshot: restoreAvailableDescendants(candidate) }
}

function updatedNodes(event: unknown): ReadonlySet<string> {
  const parsed = z
    .object({
      type: z.string(),
      feature: z.object({ id: z.string() }).passthrough().optional(),
      sketch: z.object({ id: z.string() }).passthrough().optional(),
      authoredEvent: z.unknown().optional(),
      modelEvent: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(event)
  if (!parsed.success) return new Set()
  if (parsed.data.type === "org.vibeshape.feature.updated" && parsed.data.feature)
    return new Set([`feature:${parsed.data.feature.id}`])
  if (parsed.data.type === "org.vibeshape.sketch.updated" && parsed.data.sketch)
    return new Set([`sketch:${parsed.data.sketch.id}`])
  return parsed.data.authoredEvent
    ? updatedNodes(parsed.data.authoredEvent)
    : parsed.data.modelEvent
      ? updatedNodes(parsed.data.modelEvent)
      : new Set()
}

const sourceAuthoritySchema = z.union([
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
])
function validateEnvelope(current: DocumentSnapshotV5, event: DocumentV5Event) {
  if (current.id !== event.documentId)
    return invalid("The V5 event targets another document.", "document-id-mismatch")
  if (current.revision === Number.MAX_SAFE_INTEGER)
    return invalid("The revision cannot advance safely.", "revision-exhausted")
  if (current.revision !== event.baseRevision || event.revision !== current.revision + 1)
    return invalid("The V5 event does not extend its source revision.", "stale-revision")
  return null
}
function reduceRestore(
  current: DocumentSnapshotV5,
  event: Extract<DocumentV5Event, { type: "org.vibeshape.document.restored" }>,
  input: unknown,
): DocumentV5Result {
  const target = sourceAuthoritySchema.safeParse(input)
  if (!target.success) return invalid("A V5 restore requires a validated historical revision.")
  const historical =
    target.data.id === current.id &&
    target.data.createdAt === current.createdAt &&
    target.data.revision === event.targetRevision &&
    target.data.revision < current.revision
  return historical
    ? { ok: true, snapshot: lift(target.data) }
    : invalid("A V5 restore must target an earlier revision of the same document.")
}
function retainRepairAuthority(
  current: DocumentSnapshotV5,
  active: DocumentSnapshotV4,
  updated: ReadonlySet<string>,
): DocumentSnapshotV5 {
  const saved = new Map(current.suspendedParts.map((part) => [part.id, part]))
  const repairIntents = reconcileRepairIntents(current, active, updated)
  return {
    ...active,
    parts: active.parts.map((part) => ({
      ...part,
      visible: saved.get(part.id)?.visible ?? part.visible,
    })),
    schemaVersion: 5,
    suspendedParts: suspendedPartsForRepair(current.suspendedParts, repairIntents, active.parts),
    repairIntents,
  }
}
function reconcileFeatureRepairIntent(
  intent: Extract<HistoryRepairIntent, { kind: "feature" }>,
  before: FeatureRecordV1 | undefined,
  after: FeatureRecordV1 | undefined,
  updated: ReadonlySet<string>,
): HistoryRepairIntent[] {
  if (!before || !after) return []
  const recipe = (feature: FeatureRecordV1) =>
    canonicalJson({ ...feature, label: "", suppressed: false })
  if (recipe(before) === recipe(after))
    return [
      {
        ...intent,
        authored: { ...intent.authored, label: after.label, suppressed: after.suppressed },
      },
    ]
  return updated.has(`feature:${intent.authored.id}`) ? [] : [intent]
}
function reconcileSketchRepairIntent(
  intent: Extract<HistoryRepairIntent, { kind: "sketch" }>,
  before: SketchRecord | undefined,
  after: SketchRecord | undefined,
  updated: ReadonlySet<string>,
): HistoryRepairIntent[] {
  if (!before || !after) return []
  const recipe = (sketch: SketchRecord) => canonicalJson({ ...sketch, label: "" })
  if (recipe(before) === recipe(after))
    return [{ ...intent, authored: { ...intent.authored, label: after.label } }]
  return updated.has(`sketch:${intent.authored.id}`) ? [] : [intent]
}
function reconcileRepairIntents(
  current: DocumentSnapshotV5,
  active: DocumentSnapshotV4,
  updated: ReadonlySet<string>,
) {
  const beforeFeatures = new Map(current.features.map((feature) => [feature.id, feature]))
  const afterFeatures = new Map(active.features.map((feature) => [feature.id, feature]))
  const beforeSketches = new Map(current.sketches.map((sketch) => [sketch.id, sketch]))
  const afterSketches = new Map(active.sketches.map((sketch) => [sketch.id, sketch]))
  return current.repairIntents.flatMap((intent) =>
    intent.kind === "feature"
      ? reconcileFeatureRepairIntent(
          intent,
          beforeFeatures.get(intent.authored.id),
          afterFeatures.get(intent.authored.id),
          updated,
        )
      : reconcileSketchRepairIntent(
          intent,
          beforeSketches.get(intent.authored.id),
          afterSketches.get(intent.authored.id),
          updated,
        ),
  )
}
function reduceAuthored(
  current: DocumentSnapshotV5,
  event: Extract<DocumentV5Event, { type: "org.vibeshape.document.authored-changed" }>,
): DocumentV5Result {
  const same =
    sameOperationEnvelope(event, event.authoredEvent) &&
    event.revision === event.authoredEvent.revision &&
    event.transactionId === event.authoredEvent.transactionId
  if (!same) return invalid("The authored event must share V5 provenance and revision.")
  if (
    event.authoredEvent.type === "org.vibeshape.document.restored" ||
    event.authoredEvent.type === "org.vibeshape.document.upgraded-v4"
  )
    return invalid("V5 restore and upgrade cannot use a compatibility event.")
  const active = reduceDocumentV4Event(projectDocumentSnapshotV5ToV4(current), event.authoredEvent)
  if (!active.ok) return active
  const retained = retainRepairAuthority(
    current,
    active.snapshot,
    updatedNodes(event.authoredEvent),
  )
  return { ok: true, snapshot: restoreAvailableDescendants(retained) }
}
function reduceContent(
  current: DocumentSnapshotV5,
  event: DocumentV5Event,
  target: unknown,
): DocumentV5Result {
  switch (event.type) {
    case "org.vibeshape.history.removed-retaining-dependents":
      return removeRetainingDependents(current, event.target)
    case "org.vibeshape.history.repaired":
      return repairHistoryItem(current, event)
    case "org.vibeshape.document.restored":
      return reduceRestore(current, event, target)
    case "org.vibeshape.document.authored-changed":
      return reduceAuthored(current, event)
  }
}
/** V5 writes never fall back to an older authority reducer. Compatibility is explicit inside this envelope. */
export function reduceDocumentV5Event(
  sourceInput: unknown,
  eventInput: unknown,
  targetInput?: unknown,
): DocumentV5Result {
  const event = documentV5EventSchema.safeParse(eventInput)
  if (!event.success) return invalid("The V5 event is invalid.")
  const sourceSchema =
    event.data.type === "org.vibeshape.history.removed-retaining-dependents"
      ? sourceAuthoritySchema
      : documentSnapshotV5Schema
  const source = sourceSchema.safeParse(sourceInput)
  if (!source.success) return invalid("The V5 event does not match its source authority version.")
  const current = lift(source.data)
  const envelope = validateEnvelope(current, event.data)
  if (envelope) return envelope
  const reduced = reduceContent(current, event.data, targetInput)
  if (!reduced.ok) return reduced
  const parsed = documentSnapshotV5Schema.safeParse({
    ...reduced.snapshot,
    revision: event.data.revision,
    updatedAt: event.data.issuedAt,
  })
  return parsed.success
    ? { ok: true, snapshot: parsed.data }
    : invalid(
        `The V5 event violates document or repair invariants: ${parsed.error.issues[0]?.message ?? "Invalid authority"}`,
      )
}

export function applyHistoryRemoveRetainingDependentsCommand(
  source: unknown,
  input: unknown,
  optionsInput: unknown = {},
): DocumentV5CommandResult {
  const command = historyRemoveRetainingDependentsCommandSchema.safeParse(input)
  const options = z
    .object({ transactionId: draftIdSchema.nullable().optional() })
    .strict()
    .safeParse(optionsInput)
  if (!command.success || !options.success)
    return invalid("The History removal command is invalid.", "invalid-command")
  const { kind: _kind, payload, ...envelope } = command.data
  const event = documentV5EventSchema.safeParse({
    ...envelope,
    transactionId: options.data.transactionId ?? null,
    revision: envelope.baseRevision + 1,
    type: "org.vibeshape.history.removed-retaining-dependents",
    target: payload.target,
  })
  if (!event.success)
    return invalid("The removal cannot advance its revision safely.", "revision-exhausted")
  const reduced = reduceDocumentV5Event(source, event.data)
  return reduced.ok ? { ...reduced, event: event.data } : reduced
}
export function applyHistoryRepairCommand(
  source: unknown,
  input: unknown,
  optionsInput: unknown = {},
): DocumentV5CommandResult {
  const command = historyRepairCommandSchema.safeParse(input)
  const current = documentSnapshotV5Schema.safeParse(source)
  const options = z
    .object({
      transactionId: draftIdSchema.nullable().optional(),
      partAllocations: partAllocationsSchema.default([]),
    })
    .strict()
    .safeParse(optionsInput)
  if (!command.success || !current.success || !options.success)
    return invalid("The V5 History repair command is invalid.", "invalid-command")
  const { kind: _kind, payload, ...envelope } = command.data
  const event = documentV5EventSchema.safeParse({
    ...envelope,
    transactionId: options.data.transactionId ?? null,
    revision: envelope.baseRevision + 1,
    type: "org.vibeshape.history.repaired",
    item: payload.item,
    partAllocations: options.data.partAllocations,
  })
  if (!event.success)
    return invalid("The repair cannot advance its revision safely.", "revision-exhausted")
  const reduced = reduceDocumentV5Event(current.data, event.data)
  return reduced.ok ? { ...reduced, event: event.data } : reduced
}
function wrapAuthored(
  current: DocumentSnapshotV5,
  result: ReturnType<typeof applyDocumentV4AuthoredCommand>,
): DocumentV5CommandResult {
  if (!result.ok) return result
  const { commandId, documentId, baseRevision, revision, issuedAt, actor, transactionId } =
    result.event
  const event = documentV5EventSchema.parse({
    schemaVersion: 5,
    commandId,
    documentId,
    baseRevision,
    revision,
    issuedAt,
    actor,
    transactionId,
    type: "org.vibeshape.document.authored-changed",
    authoredEvent: result.event,
  })
  const reduced = reduceDocumentV5Event(current, event)
  return reduced.ok ? { ...reduced, event } : reduced
}
export function applyDocumentV5AuthoredCommand(
  snapshot: DocumentSnapshotV5,
  command: unknown,
  options: unknown = {},
) {
  const sourceCommand = documentV4CommandSchema.safeParse(command)
  return wrapAuthored(
    snapshot,
    sourceCommand.success
      ? applyDocumentV4Command(projectDocumentSnapshotV5ToV4(snapshot), sourceCommand.data, options)
      : applyDocumentV4AuthoredCommand(projectDocumentSnapshotV5ToV4(snapshot), command, options),
  )
}
export function applyDocumentV5ModelEvent(
  snapshot: DocumentSnapshotV5,
  event: unknown,
  allocations: unknown,
) {
  return wrapAuthored(
    snapshot,
    applyDocumentV4ModelEvent(projectDocumentSnapshotV5ToV4(snapshot), event, allocations),
  )
}
