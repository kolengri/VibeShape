import type { QueryDispatcher } from "@vibeshape/automation-api/queries"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import {
  type RenderPreviewArguments,
  type RenderPreviewResult,
  renderDraftPreviewRequestSchema,
  renderPreviewResultContextMatches,
  renderPreviewResultSchema,
} from "@vibeshape/automation-api/render-preview"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import { modelDiagnosticsEvidenceSchema } from "@vibeshape/domain/model-diagnostics"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"
import { z } from "zod"
import type { AutomationHostResult } from "./host"

export type DraftGeometryPort = Readonly<{
  renderPreview?: (
    snapshot: DocumentSnapshot,
    options: Pick<RenderPreviewArguments, "views" | "target" | "camera">,
    signal?: Readonly<{ aborted: boolean }>,
  ) =>
    | PromiseLike<AutomationHostResult<Extract<RenderPreviewResult, { source: "model" }>>>
    | AutomationHostResult<Extract<RenderPreviewResult, { source: "model" }>>
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

export async function renderDraftGeometry(
  snapshot: DocumentSnapshot,
  request: ReturnType<typeof renderDraftPreviewRequestSchema.parse>,
  geometry: DraftGeometryPort,
  signal?: Readonly<{ aborted: boolean }>,
): Promise<AutomationHostResult<Extract<RenderPreviewResult, { source: "model" }>>> {
  const render = geometry.renderPreview
  if (!render)
    return {
      ok: false,
      diagnostic: {
        code: "render-preview-unavailable",
        message: "The draft geometry port cannot render previews.",
        retryable: false,
        issues: [],
      },
    }
  const { views, target, camera } = renderDraftPreviewRequestSchema.parse(request)
  return render(
    documentSnapshotSchema.parse(snapshot),
    {
      ...(views ? { views } : {}),
      ...(target ? { target } : {}),
      ...(camera ? { camera } : {}),
    },
    signal,
  )
}

export function validateRenderedDraftGeometry(
  snapshot: DocumentSnapshot,
  request: ReturnType<typeof renderDraftPreviewRequestSchema.parse>,
  result: { ok: true; value: unknown },
  baseRevision: number,
): AutomationHostResult<Extract<RenderPreviewResult, { source: "draft" }>> {
  const parsed = renderPreviewResultSchema.safeParse(result.value)
  const invalid = {
    ok: false as const,
    diagnostic: {
      code: "invalid-geometry-evidence" as const,
      message: "The rendered image does not describe the requested draft rebuild.",
      retryable: false,
      issues: [],
    },
  }
  if (!parsed.success || parsed.data.source !== "model") return invalid
  const value = { ...parsed.data, source: "draft" as const, draftId: request.draftId, baseRevision }
  const rendered = { ok: true as const, value }
  const { schemaVersion: _schemaVersion, ...argumentsInput } = request
  const context = {
    tool: "render_preview",
    arguments: { source: "draft", ...argumentsInput },
  }
  return renderPreviewResultContextMatches(context, rendered, snapshot.id) ? rendered : invalid
}

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
