import type { QueryDispatcher } from "@vibeshape/automation-api/queries"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import { modelDiagnosticsEvidenceSchema } from "@vibeshape/domain/model-diagnostics"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"
import { z } from "zod"

export type DraftGeometryPort = Readonly<{
  inspectSketchSolution?: (
    snapshot: DocumentSnapshot,
    sketchId: import("@vibeshape/domain/identifiers").SketchId,
  ) => PromiseLike<unknown> | unknown
  evaluate: (snapshot: DocumentSnapshot) => PromiseLike<unknown> | unknown
  inspectBodyMeasurements?: (snapshot: DocumentSnapshot) => PromiseLike<unknown> | unknown
  inspectBodyTopology?: (
    snapshot: DocumentSnapshot,
    target: { featureId: FeatureId; outputRole: string; kind: "edge" | "face" },
  ) => PromiseLike<unknown> | unknown
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
  const evaluated = z
    .union([
      modelMeasurementEvidenceSchema.transform((measurements) => ({
        measurements,
        diagnostics: null,
      })),
      z
        .object({
          measurements: modelMeasurementEvidenceSchema,
          diagnostics: modelDiagnosticsEvidenceSchema,
        })
        .strict()
        .refine(
          ({ measurements, diagnostics }) =>
            measurements.documentId === diagnostics.documentId &&
            measurements.revision === diagnostics.revision &&
            measurements.generation === diagnostics.generation,
          "Diagnostics must describe the same exact rebuild.",
        ),
    ])
    .safeParse(await geometry.evaluate(documentSnapshotSchema.parse(snapshot)))
  const evidence = evaluated.success
    ? { success: true as const, data: evaluated.data.measurements }
    : evaluated
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
  const result = {
    ok: true as const,
    geometry: {
      diagnostics: evaluated.success ? evaluated.data.diagnostics : null,
      status:
        (evaluated.success &&
          evaluated.data.diagnostics !== null &&
          evaluated.data.diagnostics.status !== "valid") ||
        evidence.data.features.some(
          (entry) => entry.status === "failed" || entry.status === "blocked",
        )
          ? ("invalid" as const)
          : ("valid" as const),
      measurements: measured.view,
    },
  }
  if (serializedQueryBytes(result.geometry) > 128 * 1024)
    return {
      ok: false as const,
      diagnostic: {
        code: "query-result-too-large" as const,
        message: "Complete draft diagnostics and measurements exceed the 128 KiB response budget.",
        retryable: false,
        issues: [],
      },
    }
  return result
}
