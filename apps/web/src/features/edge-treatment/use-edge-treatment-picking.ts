import { canonicalJson } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type {
  ViewerMesh,
  ViewerModelCurveCandidate,
  ViewerSelection,
} from "@vibeshape/viewer/three-viewport"
import { useCallback, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import {
  type EdgeTreatmentCandidate,
  edgeTreatmentCandidates,
  resolveTreatmentReference,
} from "./edge-treatment-candidates"
import type {
  EdgeTreatmentPick,
  EdgeTreatmentPickingContext,
  EdgeTreatmentPickRequest,
} from "./edge-treatment-picking"

function taskKey(
  controller: DocumentControllerState,
  tool: ActivePartDesignTool | null,
  hidden: readonly string[],
) {
  const report = controller.report
  const rebuild = report?.rebuild.ok ? report.rebuild.response : null
  return JSON.stringify([
    report?.snapshot.id,
    report?.snapshot.revision,
    rebuild?.generation,
    rebuild?.requestId,
    tool?.kind,
    tool && "featureId" in tool ? tool.featureId : "create",
    [...hidden].sort(),
  ])
}

function selectedCandidateIds(
  context: EdgeTreatmentPickingContext,
  candidates: readonly EdgeTreatmentCandidate[],
) {
  const references = [
    ...(context.targets ?? []).flatMap((target) =>
      target.kind === "edge"
        ? [target.edge, ...(target.sideFace ? [target.sideFace] : [])]
        : [target.face],
    ),
    ...(context.directionOverrides ?? []),
    ...context.references,
  ]
  return new Set(
    references.flatMap((reference) => {
      const resolved = resolveTreatmentReference(reference, candidates)
      return resolved.status === "resolved" ? [resolved.candidate.id] : []
    }),
  )
}

function selectedFaces(
  candidates: readonly EdgeTreatmentCandidate[],
  selected: ReadonlySet<string>,
): readonly ViewerSelection[] {
  return candidates.flatMap((candidate) => {
    const ref = candidate.reference
    return ref.kind === "face" &&
      ref.schemaVersion === 1 &&
      candidate.candidate.meshFaceId !== undefined &&
      selected.has(candidate.id)
      ? [
          {
            featureId: ref.featureId,
            outputRole: ref.outputRole,
            faceId: candidate.candidate.meshFaceId,
            faceOrdinal: 0,
          },
        ]
      : []
  })
}

function treatmentMeshes(
  controller: DocumentControllerState,
  context: EdgeTreatmentPickingContext,
  hidden: readonly string[],
  restricted: boolean,
): readonly ViewerMesh[] {
  if (!controller.report?.rebuild.ok) return []
  const geometry = controller.report.rebuild.response.geometry
  return (context.options ?? []).flatMap((option) => {
    const body = option.body
    if (
      !body ||
      hidden.includes(body.featureId) ||
      (restricted && option.id !== context.targetOptionId)
    )
      return []
    const source = geometry
      .find(({ featureId }) => featureId === body.featureId)
      ?.geometry.bodies?.find(({ outputRole }) => outputRole === body.outputRole)
    return source
      ? [{ ...source.mesh, featureId: body.featureId, outputRole: body.outputRole }]
      : []
  })
}

function treatmentViewport(
  controller: DocumentControllerState,
  context: EdgeTreatmentPickingContext,
  hidden: readonly string[],
  candidates: readonly EdgeTreatmentCandidate[],
  labels: ReadonlyMap<string, string>,
  publish: (request: Omit<EdgeTreatmentPickRequest, "sequence">) => void,
): GeometryViewportSketchContext {
  const pick = context.pick ?? { kind: "edges" }
  const restricted = pick.kind === "side-face" || pick.kind === "overrides"
  const eligible = candidates.filter(
    (candidate) =>
      !hidden.includes(candidate.reference.featureId) &&
      (!restricted || candidate.optionId === context.targetOptionId),
  )
  const selected = selectedCandidateIds(context, eligible)
  const select = (matches: readonly EdgeTreatmentCandidate[], intent: EdgeTreatmentPick) => {
    const candidate = matches[0]
    if (matches.length !== 1 || !candidate) {
      publish({
        featureId: context.featureId,
        pick: intent,
        issue: matches.length ? "ambiguous" : "missing",
      })
      return
    }
    const status = candidate.resolveStatus()
    publish({
      featureId: context.featureId,
      reference: candidate.reference,
      optionId: candidate.optionId,
      pick: intent,
      ...(status !== "resolved" ? { issue: status } : {}),
    })
  }
  if (pick.kind === "faces" || pick.kind === "side-face")
    return {
      mode: "orbit",
      frame: null,
      faceIntersectionSelection: {
        consumeBackground: true,
        selectionMeshes: treatmentMeshes(controller, context, hidden, restricted),
        selectedFaces: selectedFaces(eligible, selected),
        isCandidateEligible: (selection) =>
          eligible.some((candidate) => faceMatches(candidate, selection)),
        onSelect: (selection) => {
          if (restricted && !eligible.some((candidate) => faceMatches(candidate, selection))) {
            publish({ featureId: context.featureId, pick, issue: "wrong-body" })
            return
          }
          select(
            eligible.filter((candidate) => faceMatches(candidate, selection)),
            pick,
          )
        },
      },
    }
  const display = eligible.flatMap<ViewerModelCurveCandidate>((candidate) =>
    candidate.reference.kind === "edge" &&
    candidate.edgePolyline &&
    candidate.edgePolyline.length >= 2
      ? [
          {
            kind: "model-curve",
            sourceType: "edge",
            featureId: candidate.reference.featureId,
            candidateId: candidate.id,
            label: labels.get(candidate.id) ?? candidate.label,
            points: candidate.edgePolyline,
            selected: Boolean(selected.has(candidate.id)),
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
        if (picked.kind !== "model-curve") {
          select([], pick)
          return
        }
        select(
          eligible.filter(
            (candidate) =>
              candidate.reference.kind === "edge" &&
              candidate.id === picked.candidateId &&
              candidate.reference.featureId === picked.featureId,
          ),
          pick,
        )
      },
    },
  }
}

function faceMatches(candidate: EdgeTreatmentCandidate, selection: ViewerSelection) {
  const reference = candidate.reference
  return (
    reference.schemaVersion === 1 &&
    reference.kind === "face" &&
    reference.featureId === selection.featureId &&
    reference.outputRole === selection.outputRole &&
    candidate.candidate.meshFaceId === selection.faceId
  )
}

export function useEdgeTreatmentPicking(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  hiddenFeatureIds: readonly string[],
) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const [state, setState] = useState<{
    key: string
    context: EdgeTreatmentPickingContext | null
  } | null>(null)
  const [pending, setPending] = useState<{ key: string; request: EdgeTreatmentPickRequest } | null>(
    null,
  )
  const key = taskKey(controller, activeTool, hiddenFeatureIds)
  const active =
    activeTool &&
    ["create-fillet", "edit-fillet", "create-chamfer", "edit-chamfer"].includes(activeTool.kind)
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
  const candidates = useMemo(() => {
    if (!context || !rebuild?.ok) return []
    const options =
      context.options ??
      (context.targetFeatureId ? [{ id: context.targetFeatureId, label: "" }] : [])
    return edgeTreatmentCandidates(options, rebuild.response.geometry, (kind, ordinal) =>
      t(kind === "edge" ? "edgeLabel" : "faceLabel", { ordinal }),
    )
  }, [context, rebuild, t])
  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (
      context?.scope !== "selected" ||
      context.pick === null ||
      controller.saveStatus === "saving" ||
      controller.report?.mode !== "read-write"
    )
      return undefined
    const bodies = new Map(context.options?.map(({ id, label }) => [id, label]))
    const labels = new Map(
      candidates.map((candidate) => [
        candidate.id,
        t("candidateLabel", {
          body: bodies.get(candidate.optionId) ?? "",
          reference: candidate.label,
        }),
      ]),
    )
    return treatmentViewport(
      controller,
      context,
      hiddenFeatureIds,
      candidates,
      labels,
      (request) => {
        setPending((previous) => ({
          key,
          request: { ...request, sequence: (previous?.request.sequence ?? 0) + 1 },
        }))
      },
    )
  }, [candidates, context, controller, hiddenFeatureIds, key, t])
  return {
    request:
      pending?.key === key && context?.featureId === pending.request.featureId
        ? pending.request
        : null,
    onContextChange,
    viewportContext,
  }
}
