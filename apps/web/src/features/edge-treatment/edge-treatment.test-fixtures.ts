import { featureIdSchema } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import type { EdgeTreatmentGeometry } from "./edge-treatment-candidates"
import type { EdgeTreatmentFormCopy, EdgeTreatmentFormProps } from "./edge-treatment-form"
import type { EdgeTreatmentTargetOption } from "./edge-treatment-options"

export const treatmentId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5801")
export const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5802")
export const otherId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5803")
export const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5804"
export const copy: EdgeTreatmentFormCopy = {
  title: "Chamfer",
  description: "Treat selected edges",
  cancel: "Cancel",
  scopeLabel: "Scope",
  allEdges: "All edges",
  selectedEdges: "Selected edges",
  selectedEdgesDescription: "Pick the edges to treat.",
  selectedEdgeCount: (count) => `${count} targets selected`,
  edgeLabel: (ordinal) => `Edge ${ordinal}`,
  removeEdge: "Remove",
  removeEdgeLabel: (edge) => `Remove ${edge}`,
  clearEdges: "Clear targets",
  pickEdges: "Edges",
  missingEdge: "Pick a current exact target.",
  ambiguousEdge: "This target is ambiguous. Select a replacement.",
  distance: "Distance",
  expressionDescription: "Use a length expression.",
  invalidDimension: "Use the correct dimension.",
  invalidExpression: "Use a valid expression.",
  invalidRange: "Use a supported length.",
  missingTarget: "Choose a body.",
  saveFailed: "Could not save.",
  staleRevision: "Reopen the task.",
  submit: "Apply chamfer",
  target: "Target body",
  targetDescription: "Pick an exact body.",
  validationSummary: "Review the treatment.",
}
export function candidate(kind: "edge" | "face", index = 1, curved = false) {
  return {
    candidateId: `${kind}-${index}`,
    kind,
    lineageTokens: [],
    signature: {
      kind,
      geometryClass: curved
        ? kind === "edge"
          ? "CIRCLE"
          : "CYLINDRE"
        : kind === "edge"
          ? "LINE"
          : "PLANE",
      measure: 10 + index,
      centroid: [index * 10, 0, 0] as [number, number, number],
      bounds: {
        min: [index * 10, 0, 0] as [number, number, number],
        max: [index * 10 + 10, 0, 0] as [number, number, number],
      },
      boundaryCount: kind === "edge" ? 2 : 4,
      adjacentGeometryClasses: curved ? ["CYLINDRE", "PLANE"] : ["PLANE", "PLANE"],
    },
    ...(kind === "face" ? { meshFaceId: index } : {}),
  }
}
export function option(
  id = sourceId,
  outputRole = "result",
  label = "Body A",
  edges = [candidate("edge")],
  faces = [candidate("face")],
): EdgeTreatmentTargetOption {
  const body = { schemaVersion: 0 as const, featureId: id, outputRole }
  const evidence = (kind: "edge" | "face", candidates: unknown[]) =>
    modelBodyTopologyEvidenceSchema.parse({
      ...body,
      schemaVersion: 1,
      documentId,
      revision: 3,
      generation: 2,
      rebuildId: "current",
      contentHash: "a".repeat(64),
      kind,
      candidates,
    })
  return {
    id: outputRole === "result" ? id : JSON.stringify([id, outputRole]),
    label,
    body,
    edgeEvidence: evidence("edge", edges),
    faceEvidence: evidence("face", faces),
  }
}
export function geometry(
  options: readonly EdgeTreatmentTargetOption[],
  polylines = true,
): readonly EdgeTreatmentGeometry[] {
  const ids = [...new Set(options.flatMap(({ body }) => (body ? [body.featureId] : [])))]
  return ids.map((featureId) => ({
    featureId,
    geometry: {
      topologyCandidates: [],
      bodies: options
        .filter(({ body }) => body?.featureId === featureId)
        .map((entry) => ({
          outputRole: entry.body?.outputRole ?? "result",
          topologyCandidates: [
            ...(entry.edgeEvidence?.candidates ?? []).map((edge) => ({
              ...edge,
              ...(polylines
                ? {
                    edgePolyline: [
                      [0, 0, 0],
                      [10, 0, 0],
                    ] as [number, number, number][],
                  }
                : {}),
            })),
            ...(entry.faceEvidence?.candidates ?? []),
          ],
        })),
    },
  }))
}
export function defaultProps(options = [option()]): EdgeTreatmentFormProps {
  return {
    baseRevision: 3,
    copy,
    mode: { kind: "create", createFeatureId: () => treatmentId, featureLabel: "Chamfer 1" },
    operation: "chamfer",
    options,
    topologyCandidates: geometry(options),
    variables: [],
    onCancel: () => {},
    onSaved: () => {},
    onSave: async () => ({ ok: true }),
  }
}
