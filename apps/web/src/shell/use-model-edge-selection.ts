import { bodyTopoRefSchema } from "@vibeshape/domain/body-topology-reference"
import { useTranslations } from "@vibeshape/i18n"
import { type ViewerModelCurveCandidate, viewerBodyKey } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import {
  edgeTreatmentCandidates,
  resolveTreatmentReference,
} from "../features/edge-treatment/edge-treatment-candidates"
import { edgeTreatmentTargetOptions } from "../features/edge-treatment/edge-treatment-options"
import type { ModelEdgeSelection } from "../features/part-design/model-edge-selection"
import { useReportApplicationError } from "./application-notices"
import { currentAuthoredParts } from "./authored-tree-state"
import { type GeometryViewportSketchContext, viewerMeshes } from "./geometry-viewport"
import type { ModelEdgeViewportSelection as ViewportEdgeSelection } from "./model-edge-viewport"

type Options = {
  controller: DocumentControllerState
  enabled: boolean
  selected: ModelEdgeSelection | null
  hiddenFeatureIds: readonly string[]
  visibility: PartVisibilityOverrides | undefined
  onToggle: ((selection: ModelEdgeSelection) => void) | undefined
  onChange: ((selection: ModelEdgeSelection | null) => void) | undefined
}

/** Idle picking uses the same exact CAD catalogues and transient reference broker as tools. */
export function useModelEdgeSelection({
  controller,
  enabled,
  selected,
  hiddenFeatureIds,
  visibility,
  onToggle,
  onChange,
}: Options) {
  const t = useTranslations("app.shell.viewport")
  const treatmentT = useTranslations("app.shell.taskPanel.edgeTreatment")
  const report = controller.report
  const [pickIssue, setPickIssue] = useState<{
    report: typeof report
    status: "ambiguous" | "missing"
  } | null>(null)
  useEffect(() => setPickIssue(null), [enabled, report])
  useReportApplicationError(
    enabled && pickIssue && pickIssue.report === report
      ? treatmentT(pickIssue.status === "ambiguous" ? "idleAmbiguousEdge" : "idleMissingEdge")
      : null,
  )
  const authority = controller.authoredSnapshot
  const candidates = useMemo(() => {
    if (!enabled || !report?.rebuild.ok || report.mode !== "read-write") return []
    const source = { ...controller, report, authoredSnapshot: authority ?? null }
    const visible = new Set(
      viewerMeshes(source, hiddenFeatureIds, [], visibility).map(viewerBodyKey),
    )
    const options = edgeTreatmentTargetOptions(
      report.snapshot,
      report.rebuild,
      undefined,
      currentAuthoredParts(source),
      "",
      "chamfer",
      "edge",
    ).filter(({ body }) => body && visible.has(viewerBodyKey(body)))
    return edgeTreatmentCandidates(
      options,
      report.rebuild.response.geometry,
      (_kind, ordinal, option) =>
        treatmentT("candidateLabel", {
          body: option.label,
          reference: t("edgeTreatmentEdgeLabel", { ordinal }),
        }),
      "edge",
    ).filter(({ reference, edgePolyline }) => reference.kind === "edge" && edgePolyline)
  }, [enabled, report, authority, hiddenFeatureIds, visibility, t, treatmentT])
  useEffect(() => {
    if (
      selected &&
      enabled &&
      !selected.edges.every(
        (edge) => resolveTreatmentReference(edge, candidates).status === "resolved",
      )
    )
      onChange?.(null)
  }, [selected, enabled, candidates, onChange])
  return useMemo<
    (GeometryViewportSketchContext & { edgeSelection: ViewportEdgeSelection }) | undefined
  >(() => {
    if (!enabled || !onToggle) return undefined
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const selectedIds = new Set(
      selected?.edges.flatMap((edge) => {
        const resolved = resolveTreatmentReference(edge, candidates)
        return resolved.status === "resolved" ? [resolved.candidate.id] : []
      }),
    )
    const select = (candidate: (typeof candidates)[number]) => {
      const status = candidate.resolveStatus()
      if (status !== "resolved") {
        setPickIssue({ report, status })
        return
      }
      setPickIssue(null)
      const edge = bodyTopoRefSchema.parse({
        outputRole: "result",
        ...candidate.reference,
        schemaVersion: 1,
      })
      onToggle({
        targetBody: {
          schemaVersion: 0,
          featureId: edge.featureId,
          outputRole: edge.outputRole,
        },
        edges: [edge],
      })
    }
    const display = candidates.flatMap<ViewerModelCurveCandidate>((candidate) =>
      candidate.edgePolyline
        ? [
            {
              kind: "model-curve",
              sourceType: "edge",
              featureId: candidate.reference.featureId,
              candidateId: candidate.id,
              label: candidate.label,
              points: candidate.edgePolyline,
              selected: selectedIds.has(candidate.id),
            },
          ]
        : [],
    )
    return {
      frame: null,
      mode: "orbit",
      edgeSelection: {
        candidates: candidates.flatMap((candidate) =>
          candidate.edgePolyline
            ? [
                {
                  featureId: candidate.reference.featureId,
                  outputRole:
                    candidate.reference.schemaVersion === 1
                      ? candidate.reference.outputRole
                      : "result",
                  candidateId: candidate.id,
                  label: candidate.label,
                  points: candidate.edgePolyline,
                  selected: selectedIds.has(candidate.id),
                },
              ]
            : [],
        ),
        onSelect(picked) {
          if (!picked) return onChange?.(null)
          const candidate = byId.get(picked.candidateId)
          if (
            !candidate ||
            candidate.reference.featureId !== picked.featureId ||
            (candidate.reference.schemaVersion === 1
              ? candidate.reference.outputRole
              : "result") !== picked.outputRole
          )
            return
          select(candidate)
        },
      },
      referenceSelection: {
        purpose: "edge-treatment",
        candidates: display,
        onSelect(picked) {
          if (picked.kind !== "model-curve") return
          const candidate = byId.get(picked.candidateId)
          if (!candidate || candidate.reference.featureId !== picked.featureId) return
          select(candidate)
        },
      },
    }
  }, [enabled, onToggle, onChange, selected, candidates, report])
}
