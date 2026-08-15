import {
  type FeatureRecord,
  featureRecordSchema,
  type SketchRecord,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { z } from "zod"
import {
  SemanticRenameDialog,
  type SemanticRenameDialogCopy,
  type SemanticRenameResult,
} from "../components/semantic-rename-dialog"
import type { DocumentControllerState } from "../document/document-controller"

const modelTreeNameInputSchema = z.string().trim().min(1).max(120)

export type ModelTreeRenameTarget =
  | Readonly<{ kind: "feature"; record: FeatureRecord }>
  | Readonly<{ kind: "sketch"; record: SketchRecord }>

export function ModelTreeRenameDialog({
  blocked = false,
  controller,
  fallbackName,
  onFeatureRename,
  onOpenChange,
  onSketchRename,
  open,
  target,
}: {
  blocked?: boolean
  controller: DocumentControllerState
  fallbackName: string
  onFeatureRename: (baseRevision: number, feature: FeatureRecord) => Promise<SemanticRenameResult>
  onOpenChange: (open: boolean) => void
  onSketchRename: (baseRevision: number, sketch: SketchRecord) => Promise<SemanticRenameResult>
  open: boolean
  target: ModelTreeRenameTarget
}) {
  const commonT = useTranslations("app.modelRename")
  const featureT = useTranslations("app.modelRename.feature")
  const sketchT = useTranslations("app.modelRename.sketch")
  const t = target.kind === "feature" ? featureT : sketchT
  const report = controller.report
  const currentName = target.record.label || fallbackName
  const writable = controller.status === "ready" && report?.mode === "read-write"
  const copy: SemanticRenameDialogCopy = {
    cancel: commonT("cancel"),
    closeLabel: t("closeLabel"),
    description: t("description"),
    fieldDescription: t("fieldDescription"),
    fieldLabel: t("fieldLabel"),
    invalidName: commonT("invalidName"),
    save: t("save"),
    saveFailed: t("saveFailed"),
    staleRevision: t("staleRevision"),
    title: t("title"),
    unchangedName: commonT("unchangedName"),
  }
  const rename = (name: string) => {
    const baseRevision = report?.snapshot.revision ?? 0
    return target.kind === "feature"
      ? onFeatureRename(baseRevision, featureRecordSchema.parse({ ...target.record, label: name }))
      : onSketchRename(baseRevision, sketchRecordSchema.parse({ ...target.record, label: name }))
  }

  return (
    <SemanticRenameDialog
      copy={copy}
      currentName={currentName}
      disabled={!writable || blocked}
      disabledTooltip={blocked ? commonT("finishSketch") : commonT("readOnly")}
      nameSchema={modelTreeNameInputSchema}
      onOpenChange={onOpenChange}
      onRename={rename}
      open={open}
      triggerLabel={commonT("trigger", { name: currentName })}
      triggerTooltip={commonT("tooltip")}
    />
  )
}
