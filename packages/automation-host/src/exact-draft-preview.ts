import type { QueryDispatcher } from "@vibeshape/automation-api/queries"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"

export type DraftGeometryPort = Readonly<{
  evaluate: (snapshot: DocumentSnapshot) => PromiseLike<unknown> | unknown
  inspectEdges?: (
    snapshot: DocumentSnapshot,
    featureId: FeatureId,
  ) => PromiseLike<unknown> | unknown
}>

export async function evaluateDraftGeometry(
  snapshot: DocumentSnapshot,
  geometry: DraftGeometryPort,
  queries: QueryDispatcher,
) {
  const evidence = modelMeasurementEvidenceSchema.safeParse(
    await geometry.evaluate(documentSnapshotSchema.parse(snapshot)),
  )
  if (!evidence.success)
    return {
      ok: false as const,
      diagnostic: {
        code: "invalid-geometry-evidence" as const,
        message: "The draft geometry port returned invalid measurement evidence.",
        retryable: false,
        issues: [],
      },
    }
  const measured = queries.dispatch(
    snapshot,
    {
      kind: "org.vibeshape.model.measurements",
      schemaVersion: 1,
      documentId: snapshot.id,
      revision: snapshot.revision,
    },
    { measurements: evidence.data },
  )
  if (!measured.ok) return measured
  if (measured.view.kind !== "org.vibeshape.model.measurements")
    return {
      ok: false as const,
      diagnostic: {
        code: "invalid-geometry-evidence" as const,
        message: "The draft geometry query returned another view.",
        retryable: false,
        issues: [],
      },
    }
  return {
    ok: true as const,
    geometry: {
      status: evidence.data.features.some(
        (entry) => entry.status === "failed" || entry.status === "blocked",
      )
        ? ("invalid" as const)
        : ("valid" as const),
      measurements: measured.view,
    },
  }
}
