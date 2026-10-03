import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { FeatureRecord } from "@vibeshape/domain"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import {
  readCompoundFeatureParameters,
  readUnionFeatureParameters,
} from "@vibeshape/domain/part-design-body-combination"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"
import {
  addFeature,
  createBrowserFeatureId,
  type DocumentControllerState,
  updateFeature,
} from "../document/document-controller"
import {
  type BodyCombinationCopy,
  BodyCombinationForm,
} from "../features/body-combination/body-combination-form"
import {
  type BodyCombinationKind,
  type BodyCombinationMode,
  combinationInputOptions,
  retainedCombinationInputs,
} from "../features/body-combination/body-combination-model"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"

type CombinationPanelProps = {
  activeTool: ActivePartDesignTool
  authority: AuthoredDocumentSnapshot | null
  parts: readonly ResolvedAuthoredPart[]
  documentBusy: boolean
  report: NonNullable<DocumentControllerState["report"]>
  onCloseTool: () => void
  onCompleteTool: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  featurePreviewStatus: FeaturePreviewState["status"]
  renderDelete: (feature: FeatureRecord) => ReactNode
}
function combinationMode(
  tool: ActivePartDesignTool,
  authority: AuthoredDocumentSnapshot,
  features: readonly FeatureRecord[],
  operation: BodyCombinationKind,
  label: string,
): BodyCombinationMode | null {
  if (tool.kind === "create-compound" || tool.kind === "create-union")
    return {
      kind: "create",
      operation,
      initial: [],
      createFeatureId: createBrowserFeatureId,
      featureLabel: label,
    }
  if (tool.kind !== "edit-compound" && tool.kind !== "edit-union") return null
  const feature = features.find(({ id }) => id === tool.featureId)
  if (!feature) return null
  const initial = retainedCombinationInputs(authority, feature, operation)
  return initial ? { kind: "edit", operation, feature, initial } : null
}
function useCombinationCopy(operation: BodyCombinationKind, editing: boolean): BodyCombinationCopy {
  const t = useTranslations("app.bodyCombination")
  const title = operation === "compound" ? "compoundTitle" : "unionTitle"
  const editTitle = operation === "compound" ? "editCompoundTitle" : "editUnionTitle"
  return {
    title: t(editing ? editTitle : title),
    description: t(operation === "compound" ? "compoundDescription" : "unionDescription"),
    cancel: t("cancel"),
    submit: t(editing ? "update" : "create"),
    parameters: t("parameters"),
    selectionRules: t("selectionRules"),
    invalidSelection: t("invalidSelection"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
    selectedParts: t("selectedParts"),
    availableParts: t("availableParts"),
    emptySelection: t("emptySelection"),
    selectPart: (name) => t("selectPart", { name }),
    removePart: (name) => t("removePart", { name }),
    moveUp: (name) => t("moveUp", { name }),
    moveDown: (name) => t("moveDown", { name }),
    survivor: (name) => t("survivor", { name }),
  }
}
export function BodyCombinationTaskPanel(props: CombinationPanelProps) {
  const t = useTranslations("app.bodyCombination")
  const task = useTranslations("app.shell.taskPanel")
  const operation = props.activeTool.kind.endsWith("compound") ? "compound" : "union"
  const reader =
    operation === "compound" ? readCompoundFeatureParameters : readUnionFeatureParameters
  const count = props.report.snapshot.features.filter((feature) => reader(feature)).length
  const label = t(operation === "compound" ? "compoundLabel" : "unionLabel", { number: count + 1 })
  const mode = props.authority
    ? combinationMode(
        props.activeTool,
        props.authority,
        props.report.snapshot.features,
        operation,
        label,
      )
    : null
  const copy = useCombinationCopy(operation, mode?.kind === "edit")
  if (!mode || !props.authority)
    return (
      <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
        <p role="alert" className="text-sm">
          {t("unavailable")}
        </p>
        <Button type="button" variant="outline" onClick={props.onCloseTool}>
          {t("cancel")}
        </Button>
      </aside>
    )
  const options = combinationInputOptions(props.authority, props.parts, mode)
  const key =
    mode.kind === "edit"
      ? `edit:${mode.feature.id}:${props.report.snapshot.revision}`
      : `create:${operation}:${props.report.snapshot.revision}`
  return (
    <aside aria-label={task("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <BodyCombinationForm
        key={key}
        baseRevision={props.report.snapshot.revision}
        copy={copy}
        mode={mode}
        options={options}
        disabled={props.documentBusy || props.report.mode === "read-only"}
        onCancel={props.onCloseTool}
        onSaved={props.onCompleteTool}
        onSave={mode.kind === "edit" ? updateFeature : addFeature}
        onPreviewChange={props.onFeaturePreviewChange}
        previewStatus={props.featurePreviewStatus}
      />
      {mode.kind === "edit" && props.renderDelete(mode.feature)}
    </aside>
  )
}
