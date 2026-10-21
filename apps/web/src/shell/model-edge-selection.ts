import {
  createTopologyReferenceResolver,
  type EdgeTopoRef,
  type FeatureId,
} from "@vibeshape/domain"
import type { ViewerEdgeCandidate } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import { selectedEdgeCandidates } from "../features/edge-treatment/edge-treatment-candidates"
import { terminalModelBodies } from "../features/part-design/model-bodies"
import { authoredBodyKey, authoredBodyKeys, currentAuthoredSnapshot } from "./authored-tree-state"

export type ModelEdgeSelection = Readonly<{
  featureId: FeatureId
  outputRole?: string
  reference: EdgeTopoRef
}>

export type ModelEdgeOption = Readonly<{
  display: ViewerEdgeCandidate
  selection: ModelEdgeSelection
  candidate: ReturnType<typeof selectedEdgeCandidates>[number]["candidate"]
}>

/** Only current, visible terminal exact bodies may supply ordinary edge selections. */
export function modelEdgeOptions(
  controller: DocumentControllerState,
  hiddenFeatureIds: readonly string[],
  partVisibilityOverrides: PartVisibilityOverrides | undefined,
  edgeLabel: (feature: string, ordinal: number, bodyOrdinal: number | null) => string,
): readonly ModelEdgeOption[] {
  const report = controller.report
  if (
    controller.status !== "ready" ||
    !report?.rebuild.ok ||
    report.rebuild.response.documentId !== report.snapshot.id ||
    report.rebuild.response.revision !== report.snapshot.revision
  )
    return []
  const bodies = terminalModelBodies(report.snapshot.features, report.rebuild.response) ?? []
  const authority = currentAuthoredSnapshot(controller)
  const hiddenBodies = authority
    ? authoredBodyKeys(authority, true, partVisibilityOverrides)
    : new Set<string>()
  const hidden = new Set(hiddenFeatureIds)
  const bodyCounts = new Map<string, number>()
  for (const { feature } of bodies)
    bodyCounts.set(feature.id, (bodyCounts.get(feature.id) ?? 0) + 1)
  return bodies.flatMap(({ feature, geometry }, bodyIndex) => {
    if (
      feature.suppressed ||
      hidden.has(feature.id) ||
      hiddenBodies.has(authoredBodyKey(geometry)) ||
      geometry.representation === "triangle-mesh" ||
      !geometry.shape.valid ||
      geometry.shape.solidCount !== 1 ||
      geometry.shape.volume <= 0
    )
      return []
    return selectedEdgeCandidates([{ featureId: feature.id, geometry }], feature.id, (ordinal) =>
      edgeLabel(
        feature.label ?? "",
        ordinal,
        (bodyCounts.get(feature.id) ?? 0) > 1 ? bodyIndex + 1 : null,
      ),
    ).flatMap((edge) =>
      edge.edgePolyline
        ? [
            {
              candidate: edge.candidate,
              selection: {
                featureId: feature.id,
                ...(geometry.outputRole === undefined ? {} : { outputRole: geometry.outputRole }),
                reference: edge.reference,
              },
              display: {
                featureId: feature.id,
                outputRole: geometry.outputRole,
                candidateId: edge.candidateId,
                label: edge.label,
                points: edge.edgePolyline,
              },
            },
          ]
        : [],
    )
  })
}

/** Re-resolve stable intent within its exact body; ambiguous or missing edges stay unusable. */
export function resolveModelEdgeSelection(
  options: readonly ModelEdgeOption[],
  selection: ModelEdgeSelection | null | undefined,
): ModelEdgeOption | null {
  if (!selection) return null
  const bodyOptions = options.filter(
    ({ selection: option }) =>
      option.featureId === selection.featureId && option.outputRole === selection.outputRole,
  )
  const resolved = createTopologyReferenceResolver(bodyOptions.map(({ candidate }) => candidate))(
    selection.reference,
  )
  return resolved.status === "resolved"
    ? (bodyOptions.find(({ display }) => display.candidateId === resolved.candidateId) ?? null)
    : null
}

export function pickedModelEdge(
  options: readonly ModelEdgeOption[],
  picked: ViewerEdgeCandidate,
): ModelEdgeOption | null {
  const matches = options.filter(
    ({ display }) =>
      display.featureId === picked.featureId &&
      display.outputRole === picked.outputRole &&
      display.candidateId === picked.candidateId,
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}
