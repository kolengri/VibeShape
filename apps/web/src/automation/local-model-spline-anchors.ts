import { featureGeometryRecordSchema } from "@vibeshape/application/feature-rebuild"
import { automationDraftSnapshotReadRequestSchema } from "@vibeshape/automation-api/drafts"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { anchorModelSplineReferences } from "@vibeshape/document-worker/external-sketch-references"
import type { CommandActor } from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { SketchRecord, SketchRecordInput } from "@vibeshape/domain/sketch"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"
import type { FaceAlignmentPreparationPort } from "./local-face-alignment-command"

type SketchDraftInput = Readonly<{
  draftId: string
  baseRevision: number
  sketch: SketchRecordInput
}>

function needsAnchors(sketch: SketchRecordInput) {
  return (sketch.externalReferences ?? []).some(
    (reference) => reference.kind === "model-spline" && reference.endpointAnchors === undefined,
  )
}

async function ownedDraftSnapshot(
  actor: CommandActor,
  documentId: string,
  input: SketchDraftInput,
  readOwnedDraftSnapshot: NonNullable<FaceAlignmentPreparationPort["readOwnedDraftSnapshot"]>,
) {
  const owned = await readOwnedDraftSnapshot(
    actor,
    automationDraftSnapshotReadRequestSchema.parse({
      schemaVersion: 1,
      draftId: input.draftId,
      revision: input.baseRevision,
    }),
  )
  if (!owned.ok)
    return localFailure(owned.diagnostic.code, owned.diagnostic.message, owned.diagnostic.retryable)
  const snapshot = documentSnapshotSchema.safeParse(owned.value)
  const current =
    snapshot.success &&
    snapshot.data.id === documentId &&
    snapshot.data.revision === input.baseRevision
  return current
    ? { ok: true as const, snapshot: snapshot.data }
    : localFailure("stale-query-revision", "The owned draft revision is no longer current.", true)
}

/** Feature geometry of a rebuild that describes exactly this draft snapshot, or null. */
function exactRebuildGeometry(response: unknown, snapshot: DocumentSnapshot) {
  const rebuilt = documentWorkerResponseSchema.safeParse(response)
  if (!rebuilt.success || rebuilt.data.type !== "documentRebuilt") return null
  if (rebuilt.data.documentId !== snapshot.id || rebuilt.data.revision !== snapshot.revision)
    return null
  const geometry = featureGeometryRecordSchema.array().safeParse(rebuilt.data.geometry)
  return geometry.success ? geometry.data : null
}

async function rebuiltGeometry(
  snapshot: DocumentSnapshot,
  rebuild: FaceAlignmentPreparationPort["rebuild"],
  signal?: AbortSignal,
) {
  const result = await rebuild(snapshot, signal)
  if (signal?.aborted)
    return localFailure("request-cancelled", "Model spline anchoring was cancelled.", true)
  if (!result.ok)
    return localFailure(result.code, "Exact draft geometry could not be prepared.", true)
  const geometry = exactRebuildGeometry(result.response, snapshot)
  return geometry
    ? { ok: true as const, geometry }
    : localFailure(
        "stale-geometry",
        "The rebuild does not describe this exact draft revision.",
        true,
      )
}

/**
 * MCP cannot see a sketch's support frame, so `create_sketch` and `update_sketch` may omit the
 * sketch-local anchors of a model-spline reference. Like Use and repair in the sketch view, the
 * omitted anchors are filled from the current projected chain ends, read from one disposable
 * rebuild of the owned draft, before the sketch becomes a command. Supplied anchors are kept.
 */
export async function anchorSketchModelSplines(
  actor: CommandActor,
  documentId: string,
  input: SketchDraftInput,
  preparation: FaceAlignmentPreparationPort | undefined,
  signal?: AbortSignal,
): Promise<
  { ok: true; sketch: SketchRecordInput | SketchRecord } | ReturnType<typeof localFailure>
> {
  if (!needsAnchors(input.sketch)) return { ok: true, sketch: input.sketch }
  const unavailable = localFailure(
    "model-spline-anchors-unavailable",
    "The paired session cannot read draft geometry to anchor model spline references; supply endpointAnchors.",
  )
  if (!preparation?.readOwnedDraftSnapshot) return unavailable
  const owned = await ownedDraftSnapshot(
    actor,
    documentId,
    input,
    preparation.readOwnedDraftSnapshot,
  )
  if (!owned.ok) return owned
  const rebuilt = await rebuiltGeometry(owned.snapshot, preparation.rebuild, signal)
  if (!rebuilt.ok) return rebuilt
  try {
    return {
      ok: true,
      sketch: anchorModelSplineReferences(owned.snapshot, input.sketch, rebuilt.geometry),
    }
  } catch (error) {
    return localFailure(
      "invalid-model-spline-reference",
      error instanceof Error ? error.message.slice(0, 512) : "The model spline cannot be anchored.",
    )
  }
}
