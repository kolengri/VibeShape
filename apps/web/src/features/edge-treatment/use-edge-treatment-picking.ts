import { canonicalJson, createTopologyReferenceResolver } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerModelCurveCandidate } from "@vibeshape/viewer/three-viewport"
import { useCallback, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import { selectedEdgeCandidates } from "./edge-treatment-candidates"
import type { EdgeTreatmentPickingContext, EdgeTreatmentPickRequest } from "./edge-treatment-form"

export function useEdgeTreatmentPicking(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  hiddenFeatureIds: readonly string[],
) {
  const t = useTranslations("app.shell.viewport")
  const [state, setState] = useState<Readonly<{
    key: string
    context: EdgeTreatmentPickingContext | null
  }> | null>(null)
  const [request, setRequest] = useState<EdgeTreatmentPickRequest | null>(null)
  const active =
    activeTool &&
    ["create-fillet", "edit-fillet", "create-chamfer", "edit-chamfer"].includes(activeTool.kind)
  const snapshot = controller.report?.snapshot
  const key = `${snapshot?.id}:${snapshot?.revision}:${activeTool?.kind}:${activeTool && "featureId" in activeTool ? activeTool.featureId : "create"}`
  const onContextChange = useCallback(
    (context: EdgeTreatmentPickingContext | null) => {
      setState((previous) =>
        previous?.key === key && canonicalJson(previous.context) === canonicalJson(context)
          ? previous
          : { key, context },
      )
    },
    [key],
  )
  const context = active && state?.key === key ? state.context : null
  const rebuild = controller.report?.rebuild
  const candidates = useMemo(
    () =>
      context && rebuild?.ok
        ? selectedEdgeCandidates(rebuild.response.geometry, context.targetFeatureId, (ordinal) =>
            t("edgeTreatmentEdgeLabel", { ordinal }),
          )
        : [],
    [context, rebuild, t],
  )
  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (
      context?.scope !== "selected" ||
      controller.saveStatus === "saving" ||
      controller.report?.mode !== "read-write" ||
      hiddenFeatureIds.includes(context.targetFeatureId)
    )
      return undefined
    const resolve = createTopologyReferenceResolver(candidates.map(({ candidate }) => candidate))
    const selected = new Set(
      context.references.flatMap((reference) => {
        if (reference.featureId !== context.targetFeatureId) return []
        const result = resolve(reference)
        return result.status === "resolved" ? [result.candidateId] : []
      }),
    )
    const display = candidates.flatMap<ViewerModelCurveCandidate>((candidate) =>
      candidate.edgePolyline
        ? [
            {
              kind: "model-curve",
              sourceType: "edge",
              featureId: context.targetFeatureId,
              candidateId: candidate.candidateId,
              label: candidate.label,
              points: candidate.edgePolyline,
              selected: selected.has(candidate.candidateId),
            },
          ]
        : [],
    )
    return {
      mode: "orbit",
      frame: null,
      referenceSelection: {
        purpose: "edge-treatment",
        candidates: display,
        onSelect: (picked) => {
          if (picked.kind !== "model-curve" || picked.featureId !== context.targetFeatureId) return
          const candidate = candidates.find(({ candidateId }) => candidateId === picked.candidateId)
          if (candidate)
            setRequest((previous) => ({
              sequence: (previous?.sequence ?? 0) + 1,
              featureId: context.featureId,
              reference: candidate.reference,
            }))
        },
      },
    }
  }, [candidates, context, controller.report?.mode, controller.saveStatus, hiddenFeatureIds])
  return {
    request: context?.featureId === request?.featureId ? request : null,
    onContextChange,
    viewportContext,
  }
}
