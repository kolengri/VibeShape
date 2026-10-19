import type { FeatureRecord } from "@vibeshape/domain"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"

/** Capture the eligible selected source before starting a task clears editor selection. */
export function edgeTreatmentCreateTool(
  kind: "create-fillet" | "create-chamfer",
  selected: { featureId: string } | null,
  targets: readonly Pick<FeatureRecord, "id">[],
): Extract<ActivePartDesignTool, { kind: typeof kind }> {
  if (!selected) return { kind }
  return {
    kind,
    targetFeatureId: targets.find(({ id }) => id === selected.featureId)?.id ?? null,
  }
}
