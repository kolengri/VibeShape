import type { AssistantQuestion } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Eye, EyeOff, MessageSquarePlus, Settings, Undo2, X } from "@vibeshape/ui/components/icons"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { type ReactNode, useId, useState } from "react"
import { useReportApplicationError } from "../shell/application-notices"
import {
  AssistantComposer,
  type AssistantComposerDraft,
  type AssistantComposerProps,
} from "./assistant-composer"
import { AssistantIconAction } from "./assistant-icon-action"
import { AssistantMessages } from "./assistant-messages"
import { AssistantQuestionForm } from "./assistant-question"
import type { ChatMessage } from "./chat-history"

type AssistantPanelProps = AssistantComposerProps & {
  open: boolean
  projectName: string
  messages: readonly ChatMessage[]
  configuration: ReactNode
  permission?: ReactNode
  question?: AssistantQuestion | null
  onAnswer?: (answers: Record<string, string> | null) => Promise<boolean>
  error: string | null
  storageFailed: boolean
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

function AssistantCheckpointActions({ checkpoint }: { checkpoint: AssistantCheckpointState }) {
  const t = useTranslations("app.assistant")
  if (!checkpoint.canUndoAgentChanges) return null
  const disabled = Boolean(
    checkpoint.busy || checkpoint.undoingAgentChanges || checkpoint.preparingBefore,
  )
  return (
    <>
      {checkpoint.onViewBefore && (
        <AssistantIconAction
          label={t(checkpoint.viewingBefore ? "viewCurrent" : "viewBefore")}
          pressed={Boolean(checkpoint.viewingBefore)}
          disabled={disabled}
          onAction={async () => {
            await checkpoint.onViewBefore?.()
          }}
        >
          {checkpoint.viewingBefore ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </AssistantIconAction>
      )}
      {checkpoint.onUndoAgentChanges && (
        <AssistantIconAction
          label={t("undoAgentChanges")}
          disabled={disabled}
          onAction={async () => {
            await checkpoint.onUndoAgentChanges?.()
          }}
        >
          <Undo2 aria-hidden="true" />
        </AssistantIconAction>
      )}
    </>
  )
}

function AssistantHeader({
  titleId,
  projectName,
  settingsOpen,
  onSettings,
  onClose,
  onReset,
  canReset,
  checkpoint,
}: {
  titleId: string
  projectName: string
  settingsOpen: boolean
  onSettings: () => void
  onClose: () => void
  onReset: () => Promise<void>
  canReset: boolean
  checkpoint: AssistantCheckpointState
}) {
  const t = useTranslations("app.assistant")
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="font-medium">
          {t("title")}
        </h2>
        <p className="truncate text-xs text-muted-foreground">{projectName}</p>
      </div>
      <AssistantCheckpointActions checkpoint={checkpoint} />
      <AssistantIconAction label={t("newChat")} disabled={!canReset} onAction={onReset}>
        <MessageSquarePlus aria-hidden="true" />
      </AssistantIconAction>
      <AssistantIconAction label={t("settingsTitle")} expanded={settingsOpen} onAction={onSettings}>
        <Settings aria-hidden="true" />
      </AssistantIconAction>
      <AssistantIconAction label={t("close")} onAction={onClose}>
        <X aria-hidden="true" />
      </AssistantIconAction>
    </div>
  )
}

function AssistantFeedback(
  props: Pick<
    AssistantPanelProps,
    "permission" | "error" | "storageFailed" | "question" | "onAnswer"
  >,
) {
  const t = useTranslations("app.assistant")
  const centralized = useReportApplicationError(props.error)
  const storageCentralized = useReportApplicationError(
    props.storageFailed ? t("storageFailed") : null,
  )
  return (
    <>
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
      {props.error && !centralized && (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      )}
      {props.storageFailed && !storageCentralized && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("storageFailed")}
        </p>
      )}
    </>
  )
}

export function AssistantPanel(props: AssistantPanelProps) {
  const t = useTranslations("app.assistant")
  const titleId = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<AssistantComposerDraft>({ text: "", attachments: [] })
  if (!props.open) return null
  return (
    <TooltipProvider>
      <aside
        className="assistant-panel flex min-h-0 flex-col border-l bg-panel shadow-lg"
        aria-labelledby={titleId}
      >
        <AssistantHeader
          titleId={titleId}
          projectName={props.projectName}
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen(!settingsOpen)}
          onClose={props.onClose}
          onReset={props.onReset}
          canReset={!props.busy && !props.queuedMessages?.length && props.messages.length > 0}
          checkpoint={props}
        />
        {(settingsOpen || !props.canSend) && (
          <section
            aria-label={t("settingsTitle")}
            className="shrink-0 overflow-y-auto border-b p-3 max-h-[45%]"
          >
            {props.configuration}
          </section>
        )}
        <AssistantMessages messages={props.messages} />
        <AssistantComposer
          {...props}
          draft={draft}
          onDraftChange={setDraft}
          feedback={<AssistantFeedback {...props} />}
        />
      </aside>
    </TooltipProvider>
  )
}
