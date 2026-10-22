import type { AssistantQuestion } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  AssistantThinkingIcon,
  Box,
  Eye,
  EyeOff,
  Layers3,
  MessageSquarePlus,
  PanelLeftClose,
  Settings,
  Undo2,
} from "@vibeshape/ui/components/icons"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { WindowHeader, WindowTitle } from "@vibeshape/ui/components/window-header"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ComponentProps, type ReactNode, useEffect, useId, useState } from "react"
import { ReviewActions } from "../automation/automation-review-actions"
import { TaskPanelLifecycleButton } from "../components/task-panel-lifecycle-button"
import { useReportApplicationError } from "../shell/application-notices"
import {
  AssistantComposer,
  type AssistantComposerDraft,
  type AssistantComposerProps,
} from "./assistant-composer"
import type { AssistantDraftDisplay } from "./assistant-draft-display"
import { AssistantIconAction } from "./assistant-icon-action"
import { AssistantMessages } from "./assistant-messages"
import { AssistantQuestionForm } from "./assistant-question"
import { AssistantSettingsDialog, useAssistantSettings } from "./assistant-settings-dialog"
import type { AssistantToolHighlight } from "./assistant-tool-highlight"
import type { ChatMessage } from "./chat-history"

type AssistantPanelProps = AssistantComposerProps & {
  open: boolean
  messages: readonly ChatMessage[]
  onToolHighlight?: AssistantToolHighlight | undefined
  draftDisplay?: AssistantDraftDisplay | undefined
  onApplyDraft?: (apply: () => Promise<boolean>) => Promise<boolean>
  configuration: ReactNode
  configurationRequired?: boolean
  permission?: ReactNode
  question?: AssistantQuestion | null
  onAnswer?: (answers: Record<string, string> | null) => Promise<boolean>
  error: string | null
  storageFailed: boolean
  contextOmittedMessages?: number | undefined
  onRetryHistory?: (() => Promise<void>) | undefined
  onClose: () => void
  onReset: () => Promise<void>
  canUndoAgentChanges?: boolean
  undoingAgentChanges?: boolean
  viewingBefore?: boolean
  preparingBefore?: boolean
  onUndoAgentChanges?: () => Promise<boolean>
  onViewBefore?: () => Promise<boolean>
}

type AssistantCheckpointState = Pick<
  AssistantPanelProps,
  | "canUndoAgentChanges"
  | "undoingAgentChanges"
  | "viewingBefore"
  | "preparingBefore"
  | "onUndoAgentChanges"
  | "onViewBefore"
  | "busy"
>

function hasAssistantCheckpoint(checkpoint: AssistantCheckpointState) {
  return Boolean(
    checkpoint.canUndoAgentChanges || checkpoint.undoingAgentChanges || checkpoint.preparingBefore,
  )
}

function AssistantCheckpointActions({ checkpoint }: { checkpoint: AssistantCheckpointState }) {
  const t = useTranslations("app.assistant")
  const { onViewBefore, onUndoAgentChanges } = checkpoint
  if (!hasAssistantCheckpoint(checkpoint)) return null
  const disabled = Boolean(
    checkpoint.busy || checkpoint.undoingAgentChanges || checkpoint.preparingBefore,
  )
  return (
    <>
      {onViewBefore && (
        <AssistantIconAction
          label={t(checkpoint.viewingBefore ? "viewCurrent" : "viewBefore")}
          pressed={Boolean(checkpoint.viewingBefore)}
          disabled={disabled}
          onAction={onViewBefore}
        >
          {checkpoint.viewingBefore ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </AssistantIconAction>
      )}
      {onUndoAgentChanges && (
        <AssistantIconAction
          label={t("undoAgentChanges")}
          disabled={disabled}
          onAction={onUndoAgentChanges}
        >
          <Undo2 aria-hidden="true" />
        </AssistantIconAction>
      )}
    </>
  )
}

function AssistantDraftModes({ display }: { display: AssistantPanelProps["draftDisplay"] }) {
  const t = useTranslations("app.shell.viewport")
  if (!display || display.application?.status === "error") return null
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{t("assistantPreviewDisplay")}</legend>
      <AssistantIconAction
        label={t("assistantPreviewChanges")}
        pressed={display.mode === "changes"}
        onAction={() => display.onChange("changes")}
      >
        <Layers3 aria-hidden="true" />
      </AssistantIconAction>
      <AssistantIconAction
        label={t("assistantPreviewResult")}
        pressed={display.mode === "result"}
        onAction={() => display.onChange("result")}
      >
        <Box aria-hidden="true" />
      </AssistantIconAction>
    </fieldset>
  )
}

function AssistantDraftActions({
  display,
  busy,
  onApplyDraft,
}: {
  display: AssistantPanelProps["draftDisplay"]
  busy: boolean
  onApplyDraft: AssistantPanelProps["onApplyDraft"]
}) {
  const t = useTranslations("app.assistant")
  const reviewTranslations = useTranslations("app.shell.taskPanel.automationReview")
  if (!display) return null
  const { application, review } = display
  if (review)
    return (
      <ReviewActions
        review={review}
        commands={"kind" in review.input ? [] : review.input.commands}
        t={reviewTranslations}
        applyLabel={t("applyChanges")}
      />
    )
  if (!application || application.status === "error" || !onApplyDraft) return null
  return (
    <TaskPanelLifecycleButton
      kind="accept"
      label={t("applyChanges")}
      disabled={busy || application.status === "applying"}
      isLoading={application.status === "applying"}
      onClick={() => onApplyDraft(application.onApply)}
    />
  )
}

function AssistantDraftCaption({ display }: { display: AssistantPanelProps["draftDisplay"] }) {
  const t = useTranslations("app.assistant")
  const preview = useTranslations("app.shell.viewport")
  if (display?.application?.status === "error")
    return (
      <Alert>
        {t("applyChangesFailed", {
          code: display.application.diagnostic ?? "automation-operation-failed",
        })}
      </Alert>
    )
  return (
    <p className="text-xs text-muted-foreground">
      {display ? preview("assistantPreviewUnsaved") : t("changesSaved")}
    </p>
  )
}

function AssistantChangeReview({ props }: { props: AssistantPanelProps }) {
  const t = useTranslations("app.assistant")
  const display = props.draftDisplay
  const applying =
    display?.application?.status === "applying" || display?.review?.status === "applying"
  return (
    <section
      aria-label={t("changeReview")}
      className="shrink-0 space-y-1 border-t bg-panel-muted px-3 py-2"
    >
      <AssistantDraftCaption display={display} />
      <div className="flex flex-wrap items-center gap-1">
        <AssistantDraftModes display={display} />
        <AssistantDraftActions
          display={display}
          busy={props.busy}
          onApplyDraft={props.onApplyDraft}
        />
        {applying && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("applyingChanges")}
          </p>
        )}
        <AssistantCheckpointActions checkpoint={{ ...props, busy: props.busy || applying }} />
      </div>
    </section>
  )
}

function AssistantHeader({
  titleId,
  settingsOpen,
  onSettings,
  onClose,
  onReset,
  canReset,
}: {
  titleId: string
  settingsOpen: boolean
  onSettings: () => void
  onClose: () => void
  onReset: () => Promise<void>
  canReset: boolean
}) {
  const t = useTranslations("app.assistant")
  return (
    <WindowHeader>
      <div className="flex min-w-0 items-start gap-2">
        <WindowTitle id={titleId} className="flex-1">
          {t("title")}
        </WindowTitle>
        <div className="flex shrink-0 items-center gap-2">
          <AssistantIconAction
            size="icon-xs"
            label={t("newChat")}
            disabled={!canReset}
            onAction={onReset}
          >
            <MessageSquarePlus aria-hidden="true" />
          </AssistantIconAction>
          <AssistantIconAction
            size="icon-xs"
            label={t("settingsTitle")}
            expanded={settingsOpen}
            onAction={onSettings}
          >
            <Settings aria-hidden="true" />
          </AssistantIconAction>
          <AssistantIconAction size="icon-xs" label={t("collapse")} onAction={onClose}>
            <PanelLeftClose aria-hidden="true" className="rotate-180" />
          </AssistantIconAction>
        </div>
      </div>
    </WindowHeader>
  )
}

function AssistantHistoryFeedback(
  props: Pick<
    AssistantPanelProps,
    "storageFailed" | "contextOmittedMessages" | "onRetryHistory" | "busy"
  >,
) {
  const t = useTranslations("app.assistant")
  const storageCentralized = useReportApplicationError(
    props.storageFailed ? t("storageFailed") : null,
  )
  return (
    <>
      {Boolean(props.contextOmittedMessages) && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("historyContextLimited", { count: props.contextOmittedMessages ?? 0 })}
        </p>
      )}
      {props.storageFailed && props.onRetryHistory && (
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onRetryHistory}>
          {t("historyRetry")}
        </Button>
      )}
      {props.storageFailed && !storageCentralized && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("storageFailed")}
        </p>
      )}
    </>
  )
}

function AssistantFeedback(
  props: Pick<
    AssistantPanelProps,
    | "permission"
    | "error"
    | "storageFailed"
    | "question"
    | "onAnswer"
    | "contextOmittedMessages"
    | "onRetryHistory"
    | "busy"
  >,
) {
  const centralized = useReportApplicationError(props.error)
  return (
    <>
      <AssistantHistoryFeedback {...props} />
      {props.permission}
      {props.question && props.onAnswer && (
        <div className="max-h-72 overflow-y-auto">
          <AssistantQuestionForm
            key={props.question.requestId}
            question={props.question}
            onAnswer={props.onAnswer}
          />
        </div>
      )}
      {props.error && !centralized && <Alert>{props.error}</Alert>}
    </>
  )
}

function AssistantPanelMessages({
  open,
  ...props
}: ComponentProps<typeof AssistantMessages> & { open: boolean }) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  return open || mounted ? <AssistantMessages {...props} /> : null
}

export function AssistantPanel(props: AssistantPanelProps) {
  const t = useTranslations("app.assistant")
  const titleId = useId()
  const settings = useAssistantSettings(props.open)
  const [draft, setDraft] = useState<AssistantComposerDraft>({ text: "", attachments: [] })
  return (
    <TooltipProvider>
      <aside
        hidden={!props.open}
        className={cn(
          "assistant-panel min-h-0 flex-col border-l bg-panel shadow-lg",
          props.open ? "flex" : "hidden",
        )}
        aria-labelledby={titleId}
      >
        <AssistantHeader
          titleId={titleId}
          settingsOpen={settings.open}
          onSettings={settings.show}
          onClose={props.onClose}
          onReset={props.onReset}
          canReset={!props.busy && !props.queuedMessages?.length && props.messages.length > 0}
        />
        {(props.configurationRequired ?? !props.canSend) && (
          <Button size="sm" variant="outline" className="m-3" onClick={settings.show}>
            {t("configure")}
          </Button>
        )}
        <AssistantPanelMessages
          open={props.open}
          messages={props.messages}
          onHighlight={props.onToolHighlight}
        />
        {props.busy && (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          >
            <AssistantThinkingIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="application-wordmark-ink">{t("thinking")}</span>
          </div>
        )}
        {(!props.busy ||
          props.draftDisplay?.review ||
          props.draftDisplay?.application?.status === "applying") &&
        (props.draftDisplay || hasAssistantCheckpoint(props)) ? (
          <AssistantChangeReview props={props} />
        ) : null}
        <AssistantComposer
          {...props}
          draft={draft}
          onDraftChange={setDraft}
          feedback={<AssistantFeedback {...props} />}
        />
      </aside>
      <AssistantSettingsDialog
        {...settings.dialog}
        title={t("settingsTitle")}
        description={t("settingsDescription")}
        closeLabel={t("closeSettings")}
      >
        {props.configuration}
      </AssistantSettingsDialog>
    </TooltipProvider>
  )
}
