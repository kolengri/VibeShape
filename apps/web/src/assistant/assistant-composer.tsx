import {
  ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES,
  ASSISTANT_MAX_ATTACHMENTS,
  type AssistantAttachment,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { Paperclip, Send, Square, X } from "@vibeshape/ui/components/icons"
import { Textarea } from "@vibeshape/ui/components/textarea"
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import {
  type AssistantAttachmentDraft,
  AssistantAttachments,
  readAssistantAttachment,
} from "./assistant-attachments"
import { AssistantIconAction } from "./assistant-icon-action"

export type AssistantComposerDraft = {
  text: string
  attachments: readonly AssistantAttachmentDraft[]
}
export type AssistantQueuedMessage = {
  id: string
  text: string
  attachments?: readonly { id: string; name: string }[]
}
export type AssistantComposerProps = {
  busy: boolean
  canSend: boolean
  sessionControls?: ReactNode
  feedback?: ReactNode
  attachmentCapabilities?: { text: boolean; images: boolean }
  queuedMessages?: readonly AssistantQueuedMessage[]
  queuePaused?: boolean
  onSend: (
    text: string,
    attachments?: readonly AssistantAttachment[],
  ) => Promise<void> | Promise<boolean>
  onQueue?: (text: string, attachments?: readonly AssistantAttachment[]) => Promise<boolean>
  onRemoveQueued?: (id: string) => void | Promise<void>
  onResumeQueue?: () => Promise<boolean>
  onCancel: () => Promise<void>
}

function AssistantQueue({
  queuedMessages = [],
  queuePaused,
  onRemoveQueued,
  onResumeQueue,
}: Pick<
  AssistantComposerProps,
  "queuedMessages" | "queuePaused" | "onRemoveQueued" | "onResumeQueue"
>) {
  const t = useTranslations("app.assistant")
  if (!queuedMessages.length) return null
  return (
    <section
      aria-label={t("queuedMessages")}
      className="space-y-1 rounded-md border bg-muted/30 p-2"
    >
      <ul className="space-y-1">
        {queuedMessages.map((message) => (
          <li key={message.id} className="flex min-w-0 items-start gap-1 text-xs">
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer truncate py-2">
                {t("queuedMessage", { text: message.text || message.attachments?.[0]?.name || "" })}
              </summary>
              <p className="whitespace-pre-wrap break-words pb-1">{message.text}</p>
              {message.attachments?.map((attachment) => (
                <p key={attachment.id} className="truncate pb-1 text-muted-foreground">
                  {attachment.name}
                </p>
              ))}
            </details>
            {onRemoveQueued && (
              <AssistantIconAction
                label={t("removeQueuedMessage")}
                onAction={() => onRemoveQueued(message.id)}
              >
                <X aria-hidden="true" />
              </AssistantIconAction>
            )}
          </li>
        ))}
      </ul>
      {queuePaused && onResumeQueue && (
        <Button type="button" size="xs" variant="outline" onClick={onResumeQueue}>
          {t("resumeQueue")}
        </Button>
      )}
    </section>
  )
}

function useAssistantSubmission(
  props: Pick<AssistantComposerProps, "busy" | "canSend" | "onSend" | "onQueue">,
  draft: AssistantComposerDraft,
  onAccepted: () => void,
) {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const filesReady = draft.attachments.every((file) => file.status === "ready")
  const canSubmit =
    props.canSend &&
    Boolean(draft.text.trim() || draft.attachments.length) &&
    filesReady &&
    !pending &&
    (!props.busy || Boolean(props.onQueue))
  useReportActivity(pending)
  const submit = async () => {
    if (lock.current || !canSubmit) return
    const action = props.busy ? props.onQueue : props.onSend
    if (!action) return
    lock.current = true
    setPending(true)
    const attachments = draft.attachments.flatMap((file) =>
      file.attachment ? [file.attachment] : [],
    )
    try {
      const accepted = attachments.length
        ? await action(draft.text.trim(), attachments)
        : await action(draft.text.trim())
      if (accepted !== false) onAccepted()
    } catch {
      // The owning controller reports failures; keep the draft available for retry.
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return { pending, canSubmit, submit }
}

type ComposerActionsProps = Pick<
  AssistantComposerProps,
  "busy" | "canSend" | "sessionControls" | "attachmentCapabilities" | "onQueue" | "onCancel"
> & {
  submitting: boolean
  canSubmit: boolean
  onSubmit: () => Promise<void>
  onSelectFiles: (files: readonly File[]) => void
}

function AssistantAttachmentAction({
  canSend,
  submitting,
  attachmentCapabilities,
  onSelectFiles,
}: Pick<
  ComposerActionsProps,
  "canSend" | "submitting" | "attachmentCapabilities" | "onSelectFiles"
>) {
  const t = useTranslations("app.assistant")
  const fileInput = useRef<HTMLInputElement>(null)
  const canAttach = Boolean(attachmentCapabilities?.text || attachmentCapabilities?.images)
  if (!canAttach) return null
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label={t("attachFiles")}
        disabled={!canSend || submitting}
        onChange={(event) => {
          onSelectFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ""
        }}
      />
      <AssistantIconAction
        label={t("attachFiles")}
        disabled={!canSend || submitting}
        onAction={() => fileInput.current?.click()}
      >
        <Paperclip aria-hidden="true" />
      </AssistantIconAction>
    </>
  )
}

function AssistantTurnActions({
  busy,
  onQueue,
  onCancel,
  canSubmit,
  onSubmit,
}: Pick<ComposerActionsProps, "busy" | "onQueue" | "onCancel" | "canSubmit" | "onSubmit">) {
  const t = useTranslations("app.assistant")
  return (
    <>
      {busy && (
        <AssistantIconAction key="stop" label={t("stop")} onAction={onCancel}>
          <Square aria-hidden="true" />
        </AssistantIconAction>
      )}
      {(!busy || onQueue) && (
        <AssistantIconAction
          key={busy ? "queue" : "send"}
          label={t(busy ? "queueMessage" : "send")}
          disabled={!canSubmit}
          onAction={onSubmit}
          primary
        >
          <Send aria-hidden="true" />
        </AssistantIconAction>
      )}
    </>
  )
}

function AssistantComposerActions(props: ComposerActionsProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {props.sessionControls}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <AssistantAttachmentAction {...props} />
        <AssistantTurnActions {...props} />
      </div>
    </div>
  )
}

export function AssistantComposer({
  draft,
  onDraftChange,
  ...props
}: AssistantComposerProps & {
  draft: AssistantComposerDraft
  onDraftChange: Dispatch<SetStateAction<AssistantComposerDraft>>
}) {
  const t = useTranslations("app.assistant")
  const id = useId()
  const composer = useRef<HTMLTextAreaElement>(null)
  const [selectionIssue, setSelectionIssue] = useState<"count" | "total" | null>(null)
  const pendingFiles = draft.attachments.some((attachment) => attachment.status === "pending")
  const submission = useAssistantSubmission(props, draft, () => {
    onDraftChange({ text: "", attachments: [] })
    setSelectionIssue(null)
  })
  useReportActivity(pendingFiles)
  useEffect(() => {
    if (!submission.pending) composer.current?.focus()
  }, [submission.pending])
  const selectFiles = (files: readonly File[]) => {
    const capabilities = props.attachmentCapabilities
    if (!capabilities || (!capabilities.text && !capabilities.images)) return
    setSelectionIssue(null)
    if (draft.attachments.length + files.length > ASSISTANT_MAX_ATTACHMENTS) {
      setSelectionIssue("count")
      return
    }
    const size =
      draft.attachments.reduce((bytes, file) => bytes + file.size, 0) +
      files.reduce((bytes, file) => bytes + file.size, 0)
    if (size > ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES) {
      setSelectionIssue("total")
      return
    }
    const pending = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      status: "pending" as const,
    }))
    onDraftChange((current) => ({ ...current, attachments: [...current.attachments, ...pending] }))
    for (const [index, file] of files.entries()) {
      const selected = pending[index]
      if (!selected) continue
      void readAssistantAttachment(file, selected.id, capabilities).then((attachment) => {
        onDraftChange((current) => ({
          ...current,
          attachments: current.attachments.map((value) =>
            value.id === attachment.id ? attachment : value,
          ),
        }))
      })
    }
  }
  return (
    <div className="shrink-0 space-y-2 p-3">
      {props.feedback}
      <AssistantQueue {...props} />
      <section
        aria-label={t("prompt")}
        className="min-w-0 overflow-hidden rounded-xl border bg-background focus-within:border-ring"
      >
        <AssistantAttachments
          attachments={draft.attachments}
          disabled={submission.pending}
          onRemove={(attachmentId) => {
            onDraftChange((current) => ({
              ...current,
              attachments: current.attachments.filter((file) => file.id !== attachmentId),
            }))
            setSelectionIssue(null)
          }}
        />
        {selectionIssue && (
          <p role="alert" className="px-3 pt-2 text-xs text-destructive">
            {selectionIssue === "count"
              ? t("attachmentTooMany", { count: ASSISTANT_MAX_ATTACHMENTS })
              : t("attachmentTotalTooLarge", {
                  limit: ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES / 1024 ** 2,
                })}
          </p>
        )}
        <label htmlFor={id} className="sr-only">
          {t("prompt")}
        </label>
        <Textarea
          id={id}
          ref={composer}
          className="resize-none rounded-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          value={draft.text}
          rows={3}
          maxLength={16_000}
          placeholder={t("placeholder")}
          disabled={!props.canSend || submission.pending}
          onChange={(event) => onDraftChange({ ...draft, text: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              void submission.submit()
            }
          }}
        />
        <AssistantComposerActions
          {...props}
          submitting={submission.pending}
          canSubmit={submission.canSubmit}
          onSubmit={submission.submit}
          onSelectFiles={selectFiles}
        />
      </section>
    </div>
  )
}
