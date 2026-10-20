import type { DocumentCommand } from "@vibeshape/domain/commands"
import { documentCoreModule, featureCoreModule } from "@vibeshape/domain/modules"
import type { useTranslations } from "@vibeshape/i18n"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@vibeshape/ui/components/alert-dialog"
import { Button } from "@vibeshape/ui/components/button"
import { TaskPanelLifecycleActions } from "../components/task-panel-lifecycle-actions"
import { TaskPanelLifecycleButton } from "../components/task-panel-lifecycle-button"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"

export function isDestructiveCommand(command: DocumentCommand) {
  const descriptor = [...documentCoreModule.commands, ...featureCoreModule.commands].find(
    (candidate) =>
      candidate.kind === command.kind && candidate.schemaVersion === command.schemaVersion,
  )
  return descriptor?.automation.destructive === true || descriptor?.confirmation === "destructive"
}

export function ReviewActions({
  commands = [],
  review,
  t,
  destructive: explicitDestructive,
  ready = true,
  applyLabel,
}: {
  commands?: readonly DocumentCommand[]
  review: AutomationReviewState
  t: ReturnType<typeof useTranslations>
  destructive?: boolean
  ready?: boolean
  applyLabel?: string
}) {
  const destructive = explicitDestructive ?? commands.some(isDestructiveCommand)
  const apply = async () => {
    await automationReviews.decide(review.id, "approved")
  }
  const discard = () => automationReviews.decide(review.id, "rejected")
  if (review.status === "error")
    return (
      <TaskPanelLifecycleActions
        ariaLabel={t("title")}
        cancelLabel={t("close")}
        onCancel={() => automationReviews.dismiss(review.id)}
      />
    )
  const disabled = review.status !== "ready" || !ready
  const loading = review.status === "applying"
  return (
    <TaskPanelLifecycleActions
      ariaLabel={t("title")}
      cancelLabel={t("discard")}
      acceptLabel={applyLabel ?? t("apply")}
      acceptDisabled={disabled}
      acceptLoading={loading}
      cancelDisabled={review.status !== "ready"}
      onCancel={discard}
      onAccept={apply}
      {...(destructive
        ? {
            renderAccept: (describedBy: string | undefined) => (
              <DestructiveApply
                disabled={disabled}
                isLoading={loading}
                onApply={apply}
                label={applyLabel ?? t("apply")}
                t={t}
                describedBy={describedBy}
              />
            ),
          }
        : {})}
    />
  )
}

function DestructiveApply({
  disabled,
  isLoading,
  onApply,
  label,
  t,
  describedBy,
}: {
  describedBy: string | undefined
  disabled: boolean
  isLoading: boolean
  onApply: () => Promise<void>
  label: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <TaskPanelLifecycleButton
          kind="accept"
          label={label}
          destructive
          type="button"
          disabled={disabled}
          isLoading={isLoading}
          aria-describedby={describedBy}
        />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("destructiveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("destructiveDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            type="button"
            disabled={disabled}
            isLoading={isLoading}
            onClick={onApply}
          >
            {t("confirmApply")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
