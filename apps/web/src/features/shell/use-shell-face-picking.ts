import { canonicalJson } from "@vibeshape/domain"
import type { ViewerMesh, ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import type { ShellPickingContext, ShellPickRequest } from "./shell-picking"

function canPickShellFaces(
  controller: DocumentControllerState,
  context: ShellPickingContext | null,
  hiddenFeatureIds: readonly string[],
) {
  if (!context || !controller.report?.rebuild.ok) return false
  return (
    controller.report.mode === "read-write" &&
    controller.saveStatus !== "saving" &&
    !hiddenFeatureIds.includes(context.targetBody.featureId)
  )
}

function shellPickingTaskKey(
  report: DocumentControllerState["report"],
  activeTool: ActivePartDesignTool | null,
) {
  const featureId = activeTool && "featureId" in activeTool ? activeTool.featureId : "create"
  return `${report?.snapshot.id}:${report?.snapshot.revision}:${activeTool?.kind}:${featureId}`
}

export function useShellFacePicking(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  hiddenFeatureIds: readonly string[],
) {
  const [state, setState] = useState<{ key: string; context: ShellPickingContext | null } | null>(
    null,
  )
  const [pending, setPending] = useState<{ key: string; request: ShellPickRequest } | null>(null)
  const report = controller.report
  const active = activeTool?.kind === "create-shell" || activeTool?.kind === "edit-shell"
  const key = shellPickingTaskKey(report, activeTool)
  useEffect(() => setPending(null), [key])
  const onContextChange = useCallback(
    (context: ShellPickingContext | null) => {
      setState((previous) =>
        previous?.key === key && canonicalJson(previous.context) === canonicalJson(context)
          ? previous
          : { key, context },
      )
    },
    [key],
  )
  const context = active && state?.key === key ? state.context : null
  const targetFeatureId = context?.targetBody.featureId
  const outputRole = context?.targetBody.outputRole
  const source = useMemo(
    () =>
      report?.rebuild.ok
        ? report.rebuild.response.geometry.find(({ featureId }) => featureId === targetFeatureId)
        : undefined,
    [report, targetFeatureId],
  )
  const body = source?.geometry.bodies?.find((candidate) => candidate.outputRole === outputRole)
  const sourceMesh = useMemo<ViewerMesh | undefined>(
    () =>
      body && targetFeatureId && outputRole
        ? { ...body.mesh, featureId: targetFeatureId, outputRole }
        : undefined,
    [body, targetFeatureId, outputRole],
  )
  const editingId = activeTool?.kind === "edit-shell" ? activeTool.featureId : null
  const excludedFeatureIds = useMemo(() => {
    const excluded = new Set<string>()
    if (editingId) {
      excluded.add(editingId)
      for (const feature of report?.snapshot.features ?? [])
        if (feature.dependencies.some((id) => excluded.has(id))) excluded.add(feature.id)
    }
    return [...excluded]
  }, [editingId, report?.snapshot.features])
  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!context || !report || !canPickShellFaces(controller, context, hiddenFeatureIds))
      return undefined
    if (
      !body ||
      !sourceMesh ||
      source?.contentHash !== context.evidence.contentHash ||
      context.evidence.revision !== report.snapshot.revision
    )
      return undefined
    const faces = body.topologyCandidates.filter(({ kind }) => kind === "face")
    const selectionFor = (candidateId: string): ViewerSelection[] => {
      const face = faces.find((candidate) => candidate.candidateId === candidateId)
      return face?.meshFaceId === undefined
        ? []
        : [
            {
              featureId: context.targetBody.featureId,
              outputRole: context.targetBody.outputRole,
              faceId: face.meshFaceId,
              faceOrdinal: faces.indexOf(face) + 1,
            },
          ]
    }
    return {
      mode: "orbit",
      frame: null,
      faceIntersectionSelection: {
        sourceMesh,
        excludedFeatureIds,
        selectedFaces: context.openingIds.flatMap(selectionFor),
        onSelect: (picked) => {
          if (
            picked.featureId !== context.targetBody.featureId ||
            picked.outputRole !== context.targetBody.outputRole
          )
            return
          const matches = faces.filter(({ meshFaceId }) => meshFaceId === picked.faceId)
          const face = matches[0]
          if (
            matches.length !== 1 ||
            !face ||
            !context.evidence.candidates.some(({ candidateId }) => candidateId === face.candidateId)
          )
            return
          setPending((previous) => ({
            key,
            request: {
              featureId: context.featureId,
              sourceContentHash: context.evidence.contentHash,
              candidateId: face.candidateId,
              sequence: (previous?.request.sequence ?? 0) + 1,
            },
          }))
        },
      },
    }
  }, [
    body,
    context,
    controller,
    excludedFeatureIds,
    hiddenFeatureIds,
    key,
    report,
    source?.contentHash,
    sourceMesh,
  ])
  return {
    request:
      pending?.key === key && context?.featureId === pending.request.featureId
        ? pending.request
        : null,
    onContextChange,
    viewportContext,
  }
}
