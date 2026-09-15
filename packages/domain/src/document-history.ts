import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, zodDiagnosticIssues } from "./command-support"
import { commandActorSchema } from "./commands"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  timestampSchema,
} from "./identifiers"

export const documentRestoredEventSchema = z
  .object({
    type: z.literal("org.vibeshape.document.restored"),
    schemaVersion: z.literal(1),
    commandId: commandIdSchema,
    transactionId: draftIdSchema.nullable(),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
    direction: z.enum(["undo", "redo"]),
    targetRevision: revisionSchema,
  })
  .strict()

export type DocumentRestoredEvent = Readonly<z.infer<typeof documentRestoredEventSchema>>

type RestoreResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function failure(message: string, issues: DomainDiagnostic["issues"] = []): RestoreResult {
  return {
    ok: false,
    diagnostic: { code: "invalid-event", message, retryable: false, issues },
  }
}

function withoutRevisionMetadata(snapshot: DocumentSnapshotV1) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = snapshot
  return content
}

function hasCanonicalFirstPartySemanticInputs(snapshot: DocumentSnapshotV1) {
  for (const [index, feature] of snapshot.features.entries()) {
    const projection = projectFirstPartyFeatureSemanticInputs(feature)
    if (!projection.recognized) continue
    if (!projection.ok)
      return {
        path: `target.features.${index}.parameters`,
        message: projection.message,
      }
    if (canonicalJson(feature.semanticInputs) !== canonicalJson(projection.inputs))
      return {
        path: `target.features.${index}.semanticInputs`,
        message: "First-party semantic inputs must match the canonical feature declaration.",
      }
  }
  return null
}

function validateSnapshot(snapshot: DocumentSnapshotV1) {
  const parsed = documentSnapshotV1Schema.safeParse(snapshot)
  if (!parsed.success) return zodDiagnosticIssues(parsed.error)
  const graph = createDocumentDependencyGraph(parsed.data)
  if (!graph.ok)
    return [
      { path: "target.history", message: graph.diagnostic.message },
      ...graph.diagnostic.issues,
    ].slice(0, 8)
  if (graph.graph.dependencyModelIssues.length > 0)
    return graph.graph.dependencyModelIssues.slice(0, 8).map((issue) => ({
      path: issue.ownerPath,
      message: "The snapshot contains an unavailable feature dependency model.",
    }))
  const semanticIssue = hasCanonicalFirstPartySemanticInputs(parsed.data)
  return semanticIssue ? [semanticIssue] : null
}

/** Applies a validated compensating restore event to a v1 document. */
export function reduceDocumentRestoredEvent(
  snapshot: DocumentSnapshotV1,
  input: unknown,
  targetInput?: DocumentSnapshotV1,
): RestoreResult {
  const current = documentSnapshotV1Schema.safeParse(snapshot)
  if (!current.success)
    return failure(
      "The current versioned document snapshot is invalid.",
      zodDiagnosticIssues(current.error),
    )
  const currentIssues = validateSnapshot(current.data)
  if (currentIssues)
    return failure("The current versioned document snapshot is invalid.", currentIssues)
  const parsed = documentRestoredEventSchema.safeParse(input)
  if (!parsed.success)
    return failure("The document restored event is invalid.", zodDiagnosticIssues(parsed.error))
  const event = parsed.data
  const parsedTarget = documentSnapshotV1Schema.safeParse(targetInput)
  if (!parsedTarget.success)
    return failure("The historical restore target is unavailable or invalid.")
  const target = parsedTarget.data
  if (target.revision !== event.targetRevision)
    return failure("The restore target revision does not match the event.")
  const targetIssues = validateSnapshot(target)
  if (targetIssues)
    return failure("The document restored event targets an invalid snapshot.", targetIssues)
  if (event.documentId !== current.data.id || target.id !== current.data.id)
    return failure("The document restored event targets a different document.")
  if (event.baseRevision !== current.data.revision)
    return failure("The document restored event does not extend the current revision.")
  if (event.baseRevision === Number.MAX_SAFE_INTEGER)
    return failure("The document revision cannot advance safely.")
  if (event.revision !== event.baseRevision + 1)
    return failure("The document restored event revision is not contiguous.")
  if (target.revision < 1 || target.revision >= current.data.revision)
    return failure("The document restored event target revision is not historical.")
  if (target.createdAt !== current.data.createdAt)
    return failure("A document restore cannot change createdAt.")
  if (
    canonicalJson(withoutRevisionMetadata(target)) ===
    canonicalJson(withoutRevisionMetadata(current.data))
  )
    return failure("The document restored event is a semantic no-op.")
  return {
    ok: true,
    snapshot: {
      ...target,
      id: current.data.id,
      revision: event.revision,
      createdAt: current.data.createdAt,
      updatedAt: event.issuedAt,
    },
  }
}
