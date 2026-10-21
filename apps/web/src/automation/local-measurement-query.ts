import { createModelBodyTopologyEvidenceResolver } from "@vibeshape/application/model-body-topology"
import {
  distanceBetweenMeasurementPoints,
  inspectTopologyMeasurements,
  parallelPlaneSeparation,
  type TopologyMeasurementElement,
  topologyDirectionAngle,
} from "@vibeshape/application/model-topology-measurements"
import { automationDraftSnapshotReadRequestSchema } from "@vibeshape/automation-api/drafts"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type MeasurementOperation,
  type MeasurementView,
  measurementOperationSchema,
  measurementViewSchema,
} from "@vibeshape/automation-api/measurement-tools"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import type { AutomationHostResult } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { createBodyTopologyReferenceResolver } from "@vibeshape/domain/model-body-topology"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"

type Rebuild = { ok: true; response: unknown } | { ok: false; code?: string }
type CommittedContext = Readonly<{ snapshot: DocumentSnapshot; rebuild: Rebuild }>
export type MeasurementPreparationPort = Readonly<{
  /** Current report only; null after document replacement or session disposal. */
  readCommittedContext: () => CommittedContext | null
  /** Compatible with FaceAlignmentPreparationPort; host validates ownership, expiry and revision. */
  readOwnedDraftSnapshot?:
    | ((actor: unknown, request: unknown) => Promise<AutomationHostResult<DocumentSnapshot>>)
    | undefined
  /** One disposable exact rebuild for both targets; never publishes viewport or document state. */
  rebuild: (snapshot: DocumentSnapshot, signal?: AbortSignal) => Promise<Rebuild>
}>

type MeasurementResult = { ok: true; value: MeasurementView } | LocalFailure
type MeasurementInput = MeasurementOperation["arguments"]
type MeasurementTarget = MeasurementInput["targets"][number]
type RebuiltResponse = Extract<
  ReturnType<typeof documentWorkerResponseSchema.parse>,
  { type: "documentRebuilt" }
>

function cancelled(signal?: AbortSignal) {
  return signal?.aborted
    ? localFailure("request-cancelled", "Topology measurement was cancelled.", true)
    : null
}

function validateSnapshot(value: unknown, documentId: string, revision: number) {
  const parsed = documentSnapshotSchema.safeParse(value)
  return parsed.success && parsed.data.id === documentId && parsed.data.revision === revision
    ? parsed.data
    : null
}

function exactResponse(snapshot: DocumentSnapshot, rebuild: Rebuild) {
  if (!rebuild.ok)
    return localFailure(
      rebuild.code ?? "geometry-unavailable",
      "Exact geometry is unavailable.",
      true,
    )
  const parsed = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (!parsed.success || parsed.data.type !== "documentRebuilt")
    return localFailure("invalid-geometry-evidence", "The exact rebuild response is invalid.")
  if (parsed.data.documentId !== snapshot.id || parsed.data.revision !== snapshot.revision)
    return localFailure(
      "stale-geometry",
      "The rebuild belongs to another document or revision.",
      true,
    )
  return { ok: true as const, response: parsed.data }
}

function measureTarget(
  target: MeasurementTarget,
  evidenceFor: ReturnType<typeof createModelBodyTopologyEvidenceResolver>,
  elementsFor: (target: MeasurementTarget) => readonly TopologyMeasurementElement[] | null,
) {
  const { reference } = target
  const evidence = evidenceFor(reference)
  if (!evidence.ok) return localFailure(evidence.code, "Exact body topology is unavailable.", true)
  const resolution = createBodyTopologyReferenceResolver(evidence.evidence)(reference)
  if (resolution.status !== "resolved")
    return localFailure(
      `${resolution.status}-topology-reference`,
      "The body topology reference must resolve uniquely in this exact rebuild.",
    )
  const element = elementsFor(target)?.find(
    ({ id, kind }) => id === resolution.candidateId && kind === reference.kind,
  )
  if (!element)
    return localFailure("invalid-geometry-evidence", "Resolved topology has no exact measurement.")
  const point = element.points.find(({ kind }) => kind === target.pointKind)
  if (!point)
    return localFailure(
      "unsupported-measurement-point",
      "The requested analytical point is unavailable.",
    )
  return {
    ok: true as const,
    element,
    point,
    value: {
      ...target,
      geometryClass: element.geometryClass,
      ...(element.kind === "edge" ? { lengthMm: element.measure } : { areaMm2: element.measure }),
      radiusMm: element.radius ?? null,
      diameterMm: element.radius === undefined ? null : element.radius * 2,
      direction: element.direction ?? null,
      pointMm: point.position,
    },
  }
}

function measurements(
  snapshot: DocumentSnapshot,
  response: RebuiltResponse,
  input: MeasurementInput,
) {
  const rebuild = { ok: true as const, response }
  const evidenceFor = createModelBodyTopologyEvidenceResolver(snapshot, rebuild)
  const bodies = new Map<string, readonly TopologyMeasurementElement[] | null>()
  const selected = []
  for (const target of input.targets) {
    const measured = measureTarget(target, evidenceFor, ({ reference }) => {
      const key = JSON.stringify([reference.featureId, reference.outputRole])
      if (!bodies.has(key))
        bodies.set(
          key,
          inspectTopologyMeasurements(snapshot, rebuild, { ...reference, schemaVersion: 0 }),
        )
      return bodies.get(key) ?? null
    })
    if (!measured.ok) return measured
    selected.push(measured)
  }
  const [left, right] = selected
  const parsed = measurementViewSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: response.generation,
    source: input.source,
    ...(input.source === "draft" ? { draftId: input.draftId } : {}),
    targets: selected.map(({ value }) => value),
    pair:
      left && right
        ? {
            pointDistanceMm: distanceBetweenMeasurementPoints(
              left.point.position,
              right.point.position,
            ),
            directionAngleRad: topologyDirectionAngle(left.element, right.element),
            parallelPlaneSeparationMm: parallelPlaneSeparation(left.element, right.element),
          }
        : null,
  })
  if (!parsed.success)
    return localFailure(
      "invalid-geometry-evidence",
      "Exact measurements exceed the finite result contract.",
    )
  const result = { ok: true as const, value: parsed.data }
  return serializedQueryBytes(result) <= 128 * 1024
    ? result
    : localFailure("query-result-too-large", "Exact measurements exceed the response byte limit.")
}

function committedContextMatches(
  preparation: MeasurementPreparationPort,
  snapshot: DocumentSnapshot,
  response: RebuiltResponse,
) {
  const current = preparation.readCommittedContext()
  if (!current || !validateSnapshot(current.snapshot, snapshot.id, snapshot.revision)) return false
  const exact = exactResponse(snapshot, current.rebuild)
  return (
    exact.ok &&
    exact.response.generation === response.generation &&
    exact.response.requestId === response.requestId
  )
}

async function readDraftSnapshot(
  read: NonNullable<MeasurementPreparationPort["readOwnedDraftSnapshot"]>,
  actor: CommandActor,
  documentId: string,
  request: ReturnType<typeof automationDraftSnapshotReadRequestSchema.parse>,
  signal?: AbortSignal,
) {
  const owned = await read(actor, request)
  const afterRead = cancelled(signal)
  if (afterRead) return afterRead
  if (!owned.ok)
    return localFailure(owned.diagnostic.code, owned.diagnostic.message, owned.diagnostic.retryable)
  const snapshot = validateSnapshot(owned.value, documentId, request.revision)
  return snapshot
    ? { ok: true as const, snapshot }
    : localFailure("stale-query-revision", "The owned draft no longer matches this revision.", true)
}

async function measureDraft(
  preparation: MeasurementPreparationPort,
  actor: CommandActor,
  documentId: string,
  input: Extract<MeasurementInput, { source: "draft" }>,
  signal?: AbortSignal,
): Promise<MeasurementResult> {
  const read = preparation.readOwnedDraftSnapshot
  if (!read)
    return localFailure("measurement-unavailable", "The paired host cannot read owned CAD drafts.")
  const request = automationDraftSnapshotReadRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    revision: input.revision,
  })
  const owned = await readDraftSnapshot(read, actor, documentId, request, signal)
  if (!owned.ok) return owned
  const beforeRebuild = cancelled(signal)
  if (beforeRebuild) return beforeRebuild
  const { snapshot } = owned
  const rebuild = await preparation.rebuild(snapshot, signal)
  const afterRebuild = cancelled(signal)
  if (afterRebuild) return afterRebuild
  const exact = exactResponse(snapshot, rebuild)
  if (!exact.ok) return exact
  const result = measurements(snapshot, exact.response, input)
  if (!result.ok) return result
  const current = await readDraftSnapshot(read, actor, documentId, request, signal)
  return cancelled(signal) ?? (current.ok ? result : current)
}

export async function executeModelMeasurementQuery(
  preparation: MeasurementPreparationPort,
  actor: CommandActor,
  documentId: string,
  operation: MeasurementOperation,
  signal?: AbortSignal,
): Promise<MeasurementResult> {
  const before = cancelled(signal)
  if (before) return before
  const parsed = measurementOperationSchema.safeParse(operation)
  if (!parsed.success)
    return localFailure("invalid-query", "The topology measurement request is invalid.")
  const input = parsed.data.arguments
  try {
    if (input.source === "draft")
      return await measureDraft(preparation, actor, documentId, input, signal)
    const context = preparation.readCommittedContext()
    const snapshot = context && validateSnapshot(context.snapshot, documentId, input.revision)
    if (!snapshot)
      return localFailure(
        "stale-query-revision",
        "The committed document revision is no longer current.",
        true,
      )
    const exact = exactResponse(snapshot, context.rebuild)
    if (!exact.ok) return exact
    const result = measurements(snapshot, exact.response, input)
    if (!committedContextMatches(preparation, snapshot, exact.response))
      return localFailure(
        "stale-geometry",
        "The committed rebuild changed during measurement.",
        true,
      )
    return cancelled(signal) ?? result
  } catch {
    return (
      cancelled(signal) ??
      localFailure("measurement-failed", "Exact topology measurement failed.", true)
    )
  }
}
