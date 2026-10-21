import type { FeatureRecord } from "@vibeshape/domain"
import { type BodyReference, bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import { chamferEdgeRefSchema } from "@vibeshape/domain/part-design"
import { z } from "zod"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"

export type EdgeTreatmentPreselection = Readonly<{
  targetBody: BodyReference
  edges: readonly BodyTopoRef[]
}>

const preselectionSchema = z
  .object({ targetBody: bodyReferenceSchema, edges: z.array(chamferEdgeRefSchema).min(1).max(256) })
  .strict()
  .refine(({ targetBody, edges }) =>
    edges.every(
      (edge) =>
        edge.featureId === targetBody.featureId && edge.outputRole === targetBody.outputRole,
    ),
  )

export function readEdgeTreatmentPreselection(value: unknown) {
  const result = preselectionSchema.safeParse(value)
  return result.success ? result.data : null
}

/** Capture the eligible selected source before starting a task clears editor selection. */
export function edgeTreatmentCreateTool(
  kind: "create-fillet" | "create-chamfer",
  selected: { featureId: string } | null,
  targets: readonly Pick<FeatureRecord, "id">[],
  edgeSelection?: EdgeTreatmentPreselection | null,
): Extract<ActivePartDesignTool, { kind: typeof kind }> & {
  edgeSelection?: EdgeTreatmentPreselection
} {
  const preselection = readEdgeTreatmentPreselection(edgeSelection)
  if (preselection) {
    return { kind, targetFeatureId: preselection.targetBody.featureId, edgeSelection: preselection }
  }
  if (!selected) return { kind }
  return {
    kind,
    targetFeatureId: targets.find(({ id }) => id === selected.featureId)?.id ?? null,
  }
}
