import type { FeatureRecord } from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { ReactNode } from "react"
import {
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import type { BodyFeatureFormMode } from "../features/part-design/body-feature-record"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"

export type BodyFeatureTaskPanelProps = {
  activeTool: ActivePartDesignTool
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  selectedFace?: ViewerSelection | null | undefined
  renderDelete: (feature: FeatureRecord) => ReactNode
}
export function bodyFeatureTaskMode(
  input: Readonly<{
    tool: ActivePartDesignTool
    features: readonly FeatureRecord[]
    label: string
    createKind: ActivePartDesignTool["kind"]
    editKind: ActivePartDesignTool["kind"]
    accepts: (feature: FeatureRecord) => boolean
  }>,
): BodyFeatureFormMode | null {
  const { tool } = input
  if (tool.kind === input.createKind && "targetBody" in tool)
    return {
      kind: "create",
      targetBody: tool.targetBody,
      createFeatureId: createBrowserFeatureId,
      featureLabel: input.label,
    }
  if (tool.kind !== input.editKind || !("featureId" in tool)) return null
  const feature = input.features.find(({ id }) => id === tool.featureId)
  return feature && input.accepts(feature) ? { kind: "edit", feature } : null
}
