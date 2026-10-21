import { calculateFaceAlignment } from "@vibeshape/application/face-alignment"
import { createModelBodyTopologyEvidenceResolver } from "@vibeshape/application/model-body-topology"
import { automationDraftSnapshotReadRequestSchema } from "@vibeshape/automation-api/drafts"
import {
  type FaceAlignmentOperation,
  faceAlignmentOperationSchema,
} from "@vibeshape/automation-api/face-alignment-tools"
import { localFailure, localToolInputs } from "@vibeshape/automation-api/local-tools"
import type { AutomationHost, AutomationHostResult } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  type BodyTopoRef,
  createBodyTopologyReferenceResolver,
} from "@vibeshape/domain/model-body-topology"
import { createAngleQuantity, createLengthQuantity } from "@vibeshape/domain/units"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"
import { createLocalCadCommand } from "./local-cad-command"

export type FaceAlignmentPreparationPort = Readonly<{
  /** Host-owned read validates actor, session, draft expiry and the exact draft revision. */
  readOwnedDraftSnapshot?:
    | ((actor: unknown, request: unknown) => Promise<AutomationHostResult<DocumentSnapshot>>)
    | undefined
  /** One disposable exact rebuild; never read committed geometry or mutate the viewport. */
  rebuild: (
    snapshot: DocumentSnapshot,
    signal?: AbortSignal,
  ) => Promise<{ ok: true; response: unknown } | { ok: false; code: string }>
}>

type FaceAlignmentInput = FaceAlignmentOperation["arguments"]
type DraftRebuild = Extract<
  ReturnType<typeof documentWorkerResponseSchema.parse>,
  { type: "documentRebuilt" }
>

function hasValidSolidBody(reference: BodyTopoRef, response: DraftRebuild) {
  const body = response.geometry
    .find(({ featureId }) => featureId === reference.featureId)
    ?.geometry.bodies?.find(({ outputRole }) => outputRole === reference.outputRole)
  if (!body?.shape.valid || body.shape.volume <= 0 || body.shape.solidCount !== 1) return false
  return true
}

function resolvedFace(
  reference: BodyTopoRef,
  evidenceFor: ReturnType<typeof createModelBodyTopologyEvidenceResolver>,
  response: DraftRebuild,
) {
  const result = evidenceFor({ ...reference, kind: "face" })
  if (!result.ok) return null
  if (!hasValidSolidBody(reference, response)) return null
  const resolution = createBodyTopologyReferenceResolver(result.evidence)(reference)
  if (resolution.status !== "resolved") return null
  const candidate = result.evidence.candidates.find(
    ({ candidateId }) => candidateId === resolution.candidateId,
  )
  const signature = candidate?.signature
  if (
    signature?.geometryClass !== "PLANE" ||
    signature.directionMode !== "oriented" ||
    !signature.direction
  )
    return null
  return {
    context: JSON.stringify([
      response.documentId,
      response.revision,
      response.generation,
      response.requestId,
    ]),
    reference,
    center: signature.centroid,
    normal: signature.direction,
  }
}

function cancelled(signal?: AbortSignal) {
  return signal?.aborted
    ? localFailure("request-cancelled", "Face alignment preparation was cancelled.", true)
    : null
}

async function readFaceAlignmentDraft(
  actor: CommandActor,
  documentId: string,
  operation: FaceAlignmentOperation,
  preparation: FaceAlignmentPreparationPort,
) {
  const readOwnedDraftSnapshot = preparation.readOwnedDraftSnapshot
  if (!readOwnedDraftSnapshot)
    return localFailure(
      "face-alignment-unavailable",
      "The paired host cannot read owned CAD drafts.",
    )
  const parsed = faceAlignmentOperationSchema.safeParse(operation)
  if (!parsed.success)
    return localFailure("invalid-face-alignment", "The face alignment request is invalid.")
  const input = parsed.data.arguments
  const request = automationDraftSnapshotReadRequestSchema.parse({
    schemaVersion: 1,
    draftId: input.draftId,
    revision: input.baseRevision,
  })
  const owned = await readOwnedDraftSnapshot(actor, request)
  if (!owned.ok)
    return localFailure(owned.diagnostic.code, owned.diagnostic.message, owned.diagnostic.retryable)
  const snapshot = documentSnapshotSchema.safeParse(owned.value)
  if (
    !snapshot.success ||
    snapshot.data.id !== documentId ||
    snapshot.data.revision !== input.baseRevision
  )
    return localFailure(
      "stale-query-revision",
      "The owned draft revision is no longer current.",
      true,
    )
  return {
    ok: true as const,
    value: { snapshot: snapshot.data, input, request, readOwnedDraftSnapshot },
  }
}

function resolveFaceAlignment(
  snapshot: DocumentSnapshot,
  input: FaceAlignmentInput,
  response: DraftRebuild,
) {
  const evidenceFor = createModelBodyTopologyEvidenceResolver(snapshot, { ok: true, response })
  const source = resolvedFace(input.sourceFace, evidenceFor, response)
  const target = resolvedFace(input.targetFace, evidenceFor, response)
  const transform =
    source && target
      ? calculateFaceAlignment(source, target, input.orientation, input.offsetMm)
      : null
  return transform
    ? { ok: true as const, value: transform }
    : localFailure(
        "invalid-face-alignment",
        "Both faces must resolve uniquely to oriented planar faces on distinct valid solid bodies.",
      )
}

async function prepareFaceAlignment(
  snapshot: DocumentSnapshot,
  input: FaceAlignmentInput,
  preparation: FaceAlignmentPreparationPort,
  signal?: AbortSignal,
) {
  const rebuild = await preparation.rebuild(snapshot, signal)
  const afterRebuild = cancelled(signal)
  if (afterRebuild) return afterRebuild
  if (!rebuild.ok)
    return localFailure(rebuild.code, "Exact draft geometry could not be prepared.", true)
  const rebuilt = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (
    !rebuilt.success ||
    rebuilt.data.type !== "documentRebuilt" ||
    rebuilt.data.documentId !== snapshot.id ||
    rebuilt.data.revision !== snapshot.revision
  )
    return localFailure(
      "stale-geometry",
      "The rebuild does not describe this exact draft revision.",
      true,
    )
  return resolveFaceAlignment(snapshot, input, rebuilt.data)
}

function createFaceAlignmentCommand(
  actor: CommandActor,
  documentId: string,
  input: FaceAlignmentInput,
  transform: NonNullable<ReturnType<typeof calculateFaceAlignment>>,
) {
  const [x, y, z] = transform.translation.map((value) => createLengthQuantity(value, "mm"))
  const [rx, ry, rz] = transform.rotation.map((value) => createAngleQuantity(value, "rad"))
  return createLocalCadCommand(
    {
      tool: "create_placement",
      arguments: localToolInputs.create_placement.parse({
        draftId: input.draftId,
        baseRevision: input.baseRevision,
        commandId: input.commandId,
        featureId: input.featureId,
        ...(input.label ? { label: input.label } : {}),
        suppressed: false,
        dependencies: [input.sourceFace.featureId],
        references: [],
        parameters: {
          targetBody: {
            schemaVersion: 0,
            featureId: input.sourceFace.featureId,
            outputRole: input.sourceFace.outputRole,
          },
          translation: { x, y, z },
          rotation: { x: rx, y: ry, z: rz },
        },
      }),
    },
    actor,
    documentId,
  )
}

export async function executeFaceAlignedPlacementCommand(
  host: Pick<AutomationHost, "applyCommand">,
  actor: CommandActor,
  documentId: string,
  operation: FaceAlignmentOperation,
  preparation: FaceAlignmentPreparationPort,
  signal?: AbortSignal,
) {
  const before = cancelled(signal)
  if (before) return before
  const draft = await readFaceAlignmentDraft(actor, documentId, operation, preparation)
  if (!draft.ok) return draft
  const { snapshot, input, request, readOwnedDraftSnapshot } = draft.value
  const afterRead = cancelled(signal)
  if (afterRead) return afterRead
  try {
    const prepared = await prepareFaceAlignment(snapshot, input, preparation, signal)
    if (!prepared.ok) return prepared
    const current = await readOwnedDraftSnapshot(actor, request)
    if (!current.ok)
      return localFailure(
        current.diagnostic.code,
        current.diagnostic.message,
        current.diagnostic.retryable,
      )
    if (current.value.id !== documentId || current.value.revision !== input.baseRevision)
      return localFailure(
        "stale-query-revision",
        "The draft changed during face alignment preparation.",
        true,
      )
    const beforeApply = cancelled(signal)
    if (beforeApply) return beforeApply
    const command = createFaceAlignmentCommand(actor, documentId, input, prepared.value)
    const result = await host.applyCommand(actor, command)
    return result.ok
      ? { ok: true as const, value: result.value }
      : localFailure(result.diagnostic.code, result.diagnostic.message, result.diagnostic.retryable)
  } catch {
    return (
      cancelled(signal) ??
      localFailure(
        "face-alignment-failed",
        "Face alignment preparation failed; inspect the current draft before retrying.",
        true,
      )
    )
  }
}
