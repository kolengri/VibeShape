import type { FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import {
  CirclePause,
  CirclePlay,
  Ellipsis,
  PenLine,
  Scan,
  Trash2,
} from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { type RefObject, useRef, useState } from "react"
import {
  type DocumentControllerState,
  type DocumentMutationResult,
  type FeatureMutationResult,
  removeFeaturePreservingModelReferenceIntent,
} from "../document/document-controller"
import { FeatureDeleteDialog } from "../features/part-design/feature-delete-action"
import {
  type FeatureDeleteEligibility,
  featureDeleteEligibility,
} from "../features/part-design/feature-delete-eligibility"
import {
  externalModelCurveLabelKind,
  externalModelReferenceLabels,
} from "../features/sketch/external-model-geometry"

type HistoryFeatureActionsProps = {
  onFindInBrowser?: (() => void) | undefined
  controller: DocumentControllerState
  deleteDisabled: boolean
  feature: FeatureRecord
  label: string
  onDeleted: () => void
  onRemove: (revision: number, id: FeatureRecord["id"]) => Promise<FeatureMutationResult>
  onRename: () => void
  onSuppressionChange: (
    revision: number,
    id: FeatureRecord["id"],
    suppressed: boolean,
  ) => Promise<DocumentMutationResult>
  renameDisabled: boolean
  renameOpen: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
}

function featureDeletionIsBlocked(eligibility: ReturnType<typeof featureDeleteEligibility> | null) {
  return !eligibility || eligibility.unavailable
}

function useHistoryFeatureMenu(props: HistoryFeatureActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<"delete" | "preserve" | null>(null)
  const deleteOpen = deleteMode !== null
  const [actionFailed, setActionFailed] = useState(false)
  const [suppressionPending, setSuppressionPending] = useState(false)
  const report = props.controller.report
  const eligibility =
    (menuOpen || deleteOpen) && report
      ? featureDeleteEligibility(
          report.snapshot,
          props.feature.id,
          props.controller.authoredSnapshot,
        )
      : null
  const blocked =
    props.deleteDisabled || suppressionPending || featureDeletionIsBlocked(eligibility)
  const writeDisabled =
    props.controller.status !== "ready" ||
    report?.mode !== "read-write" ||
    props.controller.saveStatus === "saving"
  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (!open) setActionFailed(false)
  }
  const suppress = async () => {
    setSuppressionPending(true)
    setActionFailed(false)
    try {
      const result = await props.onSuppressionChange(
        report?.snapshot.revision ?? 0,
        props.feature.id,
        !props.feature.suppressed,
      )
      if (result.ok) setMenuOpen(false)
      else setActionFailed(true)
    } catch {
      setActionFailed(true)
    } finally {
      setSuppressionPending(false)
    }
  }
  return {
    actionFailed,
    blocked,
    deleteMode,
    deleteOpen,
    eligibility,
    menuOpen,
    onMenuOpenChange,
    setDeleteMode,
    suppress,
    suppressionPending,
    writeDisabled,
  }
}

function FeatureHistoryMenu({
  props,
  model,
}: {
  props: HistoryFeatureActionsProps
  model: ReturnType<typeof useHistoryFeatureMenu>
}) {
  const t = useTranslations("app.shell.modelTree")
  const revealingResult = useRef(false)
  const actionsLabel = t("featureActions", { feature: props.label })
  const suppressionLabel = t(props.feature.suppressed ? "unsuppressFeature" : "suppressFeature", {
    feature: props.label,
  })
  return (
    <DropdownMenu open={model.menuOpen} onOpenChange={model.onMenuOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={props.triggerRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={actionsLabel}
              dropdown
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{actionsLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (model.deleteOpen || props.renameOpen || revealingResult.current)
            event.preventDefault()
          revealingResult.current = false
        }}
      >
        {props.onFindInBrowser && (
          <DropdownMenuItem
            onSelect={() => {
              revealingResult.current = true
              props.onFindInBrowser?.()
            }}
          >
            <Scan aria-hidden="true" />
            {t("findInBrowser")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={props.renameDisabled || model.suppressionPending}
          onSelect={props.onRename}
        >
          <PenLine aria-hidden="true" />
          {t("renameHistoryItem", { item: props.label })}
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          disabled={model.writeDisabled}
          onSelect={(event) => event.preventDefault()}
        >
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            disabled={model.writeDisabled}
            onClick={model.suppress}
          >
            {props.feature.suppressed ? (
              <CirclePlay aria-hidden="true" />
            ) : (
              <CirclePause aria-hidden="true" />
            )}
            {suppressionLabel}
          </Button>
        </DropdownMenuItem>
        <FeatureDeletionMenuItems props={props} model={model} />
        {model.actionFailed ? <Alert className="max-w-64">{t("historyActionFailed")}</Alert> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function preserveDeletionIsBlocked(
  props: HistoryFeatureActionsProps,
  model: ReturnType<typeof useHistoryFeatureMenu>,
) {
  return (
    props.deleteDisabled || model.suppressionPending || !model.eligibility?.preserveIntentAllowed
  )
}

function FeatureDeletionMenuItems({
  props,
  model,
}: {
  props: HistoryFeatureActionsProps
  model: ReturnType<typeof useHistoryFeatureMenu>
}) {
  const t = useTranslations("app.shell.modelTree")
  const deleteT = useTranslations("app.shell.taskPanel.featureDelete")
  const blockedReason = props.deleteDisabled ? t("historyWriteUnavailable") : deleteT("unavailable")
  return (
    <>
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        disabled={model.blocked}
        onSelect={() => model.setDeleteMode("delete")}
      >
        <Trash2 aria-hidden="true" />
        {t("deleteFeature", { feature: props.label })}
      </DropdownMenuItem>
      {model.eligibility?.preserveIntentAllowed ? (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={preserveDeletionIsBlocked(props, model)}
          onSelect={() => model.setDeleteMode("preserve")}
        >
          <Trash2 aria-hidden="true" />
          {deleteT("preserveAction")}
        </DropdownMenuItem>
      ) : null}
      {model.blocked ? (
        <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{blockedReason}</p>
      ) : null}
    </>
  )
}

function useAffectedFeatureReferences(
  report: DocumentControllerState["report"],
  eligibility: FeatureDeleteEligibility | null,
) {
  const t = useTranslations("app.shell.taskPanel.featureDelete")
  const modelTreeT = useTranslations("app.shell.modelTree")
  const viewportT = useTranslations("app.shell.viewport")
  const referenceLabelCopy = {
    curve: (feature, kind, ordinal) =>
      viewportT("externalModelCurveCandidate", {
        feature,
        kind: externalModelCurveLabelKind(kind),
        ordinal,
      }),
    face: (feature, ordinal) => viewportT("externalModelFaceReference", { feature, ordinal }),
    line: (feature, ordinal) => viewportT("externalModelLineCandidate", { feature, ordinal }),
    point: (feature, ordinal) => viewportT("externalModelPointCandidate", { feature, ordinal }),
    problem: (feature, kind, status) =>
      viewportT("externalModelReferenceProblem", { feature, kind, status }),
    unknownFeature: viewportT("unknownFeature"),
  } satisfies Parameters<typeof externalModelReferenceLabels>[3]
  if (!report || !eligibility) return []
  const sketchesById = new Map(report.snapshot.sketches.map((sketch) => [sketch.id, sketch]))
  const labelsBySketchId = new Map(
    [...new Set(eligibility.preservableReferences.map(({ sketchId }) => sketchId))].map(
      (sketchId) => {
        const sketch = sketchesById.get(sketchId)
        return [
          sketchId,
          externalModelReferenceLabels(
            report.rebuild.ok ? report.rebuild.response.geometry : [],
            report.snapshot.features,
            sketch?.externalReferences,
            referenceLabelCopy,
          ),
        ] as const
      },
    ),
  )
  return eligibility.preservableReferences.map(({ referenceId, sketchId }) => {
    const sketch = sketchesById.get(sketchId)
    return {
      id: referenceId,
      label: t("affectedReference", {
        reference: labelsBySketchId.get(sketchId)?.get(referenceId) ?? t("unknownReference"),
        sketch: sketch?.label ?? modelTreeT("unnamedSketch"),
      }),
    }
  })
}

function useHistoryFeatureDeleteCopy(
  props: HistoryFeatureActionsProps,
  model: ReturnType<typeof useHistoryFeatureMenu>,
) {
  const t = useTranslations("app.shell.taskPanel.featureDelete")
  const affectedItems = useAffectedFeatureReferences(props.controller.report, model.eligibility)
  if (model.deleteMode !== "preserve")
    return {
      action: t("action"),
      cancel: t("cancel"),
      confirm: t("confirm"),
      description: t("description"),
      failed: t("failed"),
      title: t("title", { feature: props.label }),
    }
  const remaining = model.eligibility
    ? model.eligibility.preservableReferenceCount - model.eligibility.preservableReferences.length
    : 0
  return {
    action: t("preserveAction"),
    cancel: t("cancel"),
    confirm: t("preserveConfirm"),
    description: t("preserveDescription"),
    failed: t("preserveFailed"),
    title: t("preserveTitle", { feature: props.label }),
    affectedItems,
    affectedReferences: t("affectedReferences"),
    remainingAffectedItems:
      remaining > 0 ? t("moreAffectedReferences", { count: remaining }) : null,
  }
}

export function HistoryFeatureActions(props: HistoryFeatureActionsProps) {
  const model = useHistoryFeatureMenu(props)
  const copy = useHistoryFeatureDeleteCopy(props, model)
  const preservingIntent = model.deleteMode === "preserve"
  return (
    <>
      <FeatureHistoryMenu props={props} model={model} />
      <FeatureDeleteDialog
        copy={copy}
        baseRevision={props.controller.report?.snapshot.revision ?? 0}
        disabled={preservingIntent ? preserveDeletionIsBlocked(props, model) : model.blocked}
        feature={props.feature}
        onDeleted={props.onDeleted}
        onRemove={preservingIntent ? removeFeaturePreservingModelReferenceIntent : props.onRemove}
        open={model.deleteOpen}
        onOpenChange={(open) => {
          if (!open) model.setDeleteMode(null)
        }}
        showTrigger={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          props.triggerRef.current?.focus()
        }}
      />
    </>
  )
}
