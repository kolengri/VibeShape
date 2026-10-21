import type { FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
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
import type {
  DocumentControllerState,
  DocumentMutationResult,
  FeatureMutationResult,
} from "../document/document-controller"
import { FeatureDeleteDialog } from "../features/part-design/feature-delete-action"
import { featureDeleteEligibility } from "../features/part-design/feature-delete-eligibility"

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
  const [deleteOpen, setDeleteOpen] = useState(false)
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
    deleteOpen,
    eligibility,
    menuOpen,
    onMenuOpenChange,
    setDeleteOpen,
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
  const deleteT = useTranslations("app.shell.taskPanel.featureDelete")
  const revealingResult = useRef(false)
  const actionsLabel = t("featureActions", { feature: props.label })
  const suppressionLabel = t(props.feature.suppressed ? "unsuppressFeature" : "suppressFeature", {
    feature: props.label,
  })
  const blockedReason = props.deleteDisabled ? t("historyWriteUnavailable") : deleteT("unavailable")
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
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={model.blocked}
          onSelect={() => model.setDeleteOpen(true)}
        >
          <Trash2 aria-hidden="true" />
          {t("deleteFeature", { feature: props.label })}
        </DropdownMenuItem>
        {model.blocked ? (
          <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{blockedReason}</p>
        ) : null}
        {model.actionFailed ? (
          <p role="alert" className="max-w-64 px-2 py-1.5 text-xs text-destructive">
            {t("historyActionFailed")}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function HistoryFeatureActions(props: HistoryFeatureActionsProps) {
  const deleteT = useTranslations("app.shell.taskPanel.featureDelete")
  const model = useHistoryFeatureMenu(props)
  return (
    <>
      <FeatureHistoryMenu props={props} model={model} />
      <FeatureDeleteDialog
        copy={{
          action: deleteT("action"),
          cancel: deleteT("cancel"),
          confirm: deleteT("confirm"),
          description: deleteT("description"),
          failed: deleteT("failed"),
          title: deleteT("title", { feature: props.label }),
        }}
        baseRevision={props.controller.report?.snapshot.revision ?? 0}
        disabled={model.blocked}
        feature={props.feature}
        onDeleted={props.onDeleted}
        onRemove={props.onRemove}
        open={model.deleteOpen}
        onOpenChange={model.setDeleteOpen}
        showTrigger={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          props.triggerRef.current?.focus()
        }}
      />
    </>
  )
}
