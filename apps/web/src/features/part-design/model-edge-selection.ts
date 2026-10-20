import { canonicalJson } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"

/** Exact, transient CAD edge intent captured before a modeling task clears viewport selection. */
export type ModelEdgeSelection = Readonly<{
  targetBody: BodyReference
  edges: readonly BodyTopoRef[]
}>

function exactPickedEdge(selection: ModelEdgeSelection) {
  const edge = selection.edges[0]
  return edge?.kind === "edge" &&
    edge.featureId === selection.targetBody.featureId &&
    edge.outputRole === selection.targetBody.outputRole
    ? edge
    : null
}

/** Undefined rejects mismatched intent; null clears the last selected edge. */
export function nextModelEdgeSelection(
  current: ModelEdgeSelection | null,
  picked: ModelEdgeSelection,
): ModelEdgeSelection | null | undefined {
  const edge = exactPickedEdge(picked)
  if (!edge) return undefined
  const body = picked.targetBody
  const sameBody =
    current?.targetBody.featureId === body.featureId &&
    current.targetBody.outputRole === body.outputRole
  const edges = sameBody ? current.edges : []
  const key = canonicalJson(edge)
  const remaining = edges.filter((value) => canonicalJson(value) !== key)
  const next =
    remaining.length !== edges.length ? remaining : edges.length < 256 ? [...edges, edge] : edges
  return next.length ? { targetBody: body, edges: next } : null
}
