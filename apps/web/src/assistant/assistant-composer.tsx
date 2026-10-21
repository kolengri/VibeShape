import {
  ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES,
  ASSISTANT_MAX_ATTACHMENTS,
  type AssistantAttachment,
  type AssistantAttachmentCapabilities,
  assistantAttachmentsSupported,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import {
  AssistantSteerIcon,
  Image,
  Paperclip,
  Send,
  StopIcon,
  X,
} from "@vibeshape/ui/components/icons"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  type AssistantAttachmentDraft,
  AssistantAttachments,
  AssistantImageAttachmentFeedback,
  readAssistantAttachment,
  readyAssistantAttachments,
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
  attachmentCapabilities?: AssistantAttachmentCapabilities
  onCaptureView?: (() => Promise<File | null>) | undefined
  queuedMessages?: readonly AssistantQueuedMessage[]
  queuePaused?: boolean
  supportsActiveSteer?: boolean
  activeSteerTurn?: boolean
  steeringQueuedId?: string | null
  onSend: (
    text: string,
    attachments?: readonly AssistantAttachment[],
  ) => Promise<void> | Promise<boolean>
  onQueue?: (text: string, attachments?: readonly AssistantAttachment[]) => Promise<boolean>
  onRemoveQueued?: (id: string) => void | Promise<void>
  onSteerQueued?: (id: string) => Promise<boolean>
  onResumeQueue?: () => Promise<boolean>
  onCancel: () => Promise<void>
}

function AssistantQueue({
  queuedMessages = [],
  queuePaused,
  busy,
  supportsActiveSteer,
  activeSteerTurn,
  steeringQueuedId,
  onRemoveQueued,
  onSteerQueued,
  onResumeQueue,
}: Pick<
  AssistantComposerProps,
  | "queuedMessages"
  | "queuePaused"
  | "busy"
  | "supportsActiveSteer"
  | "activeSteerTurn"
  | "steeringQueuedId"
  | "onRemoveQueued"
  | "onSteerQueued"
  | "onResumeQueue"
>) {
  const t = useTranslations("app.assistant")
  const reasonId = useId()
  const steeringTurn = activeSteerTurn ?? busy
  const unavailable =
    !supportsActiveSteer || !onSteerQueued
      ? t("steerUnsupported")
      : !steeringTurn
        ? t("steerRequiresActiveTurn")
        : null
  if (!queuedMessages.length) return null
  return (
    <section
      aria-label={t("queuedMessages")}
      className="space-y-1 rounded-md border bg-muted/30 p-2"
    >
      {unavailable && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {unavailable}
        </p>
      )}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("steerQueuedMessage")}
                  aria-describedby={unavailable ? reasonId : undefined}
                  disabled={Boolean(unavailable || steeringQueuedId)}
                  isLoading={steeringQueuedId === message.id}
                  onClick={() => onSteerQueued?.(message.id)}
                >
                  <AssistantSteerIcon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("steerQueuedMessage")}</TooltipContent>
            </Tooltip>
            {onRemoveQueued && (
              <AssistantIconAction
                label={t("removeQueuedMessage")}
                disabled={steeringQueuedId === message.id}
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
  props: Pick<
    AssistantComposerProps,
    "busy" | "canSend" | "onSend" | "onQueue" | "attachmentCapabilities"
  >,
  draft: AssistantComposerDraft,
  onAccepted: () => void,
  lock: RefObject<boolean>,
  attachments: ReturnType<typeof useAssistantAttachmentAdmission>,
  capture: ReturnType<typeof useAssistantViewCapture>,
) {
  const [pending, setPending] = useState(false)
  const action = props.busy ? props.onQueue : props.onSend
  const canSubmit =
    props.canSend &&
    assistantDraftReady(draft.text, draft.attachments, props.attachmentCapabilities) &&
    !pending &&
    !capture.pending &&
    Boolean(action)
  useReportActivity(pending)
  const submit = async () => {
    const currentFiles = attachments.current()
    if (
      lock.current ||
      capture.lock.current ||
      !canSubmit ||
      !assistantDraftReady(draft.text, currentFiles, props.attachmentCapabilities)
    )
      return
    if (!action) return
    lock.current = true
    setPending(true)
    const readyAttachments = readyAssistantAttachments(currentFiles)
    try {
      const accepted = readyAttachments.length
        ? await action(draft.text.trim(), readyAttachments)
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

function assistantDraftReady(
  text: string,
  files: readonly AssistantAttachmentDraft[],
  capabilities?: AssistantAttachmentCapabilities,
) {
  return (
    Boolean(text.trim() || files.length) &&
    files.every((file) => file.status === "ready") &&
    (!capabilities || assistantAttachmentsSupported(readyAssistantAttachments(files), capabilities))
  )
}

type ComposerActionsProps = Pick<
  AssistantComposerProps,
  | "busy"
  | "canSend"
  | "sessionControls"
  | "attachmentCapabilities"
  | "onQueue"
  | "onCancel"
  | "onCaptureView"
> & {
  submitting: boolean
  capturing: boolean
  canSubmit: boolean
  onSubmit: () => Promise<void>
  onSelectFiles: (files: readonly File[]) => void
  onCapture: () => Promise<void>
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
          <StopIcon aria-hidden="true" />
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
    <div className="grid min-w-0 grid-cols-1 items-end gap-1 px-2 pb-2 @sm/composer:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">{props.sessionControls}</div>
      <div className="flex shrink-0 items-center justify-self-end gap-1">
        <AssistantAttachmentAction {...props} />
        {props.attachmentCapabilities?.images && props.onCaptureView && (
          <AssistantCaptureAction {...props} />
        )}
        <AssistantTurnActions {...props} />
      </div>
    </div>
  )
}

function AssistantCaptureAction({
  canSend,
  submitting,
  capturing,
  onCapture,
}: Pick<ComposerActionsProps, "canSend" | "submitting" | "capturing" | "onCapture">) {
  const t = useTranslations("app.assistant")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("captureView")}
          disabled={!canSend || submitting}
          isLoading={capturing}
          onClick={onCapture}
        >
          <Image aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("captureView")}</TooltipContent>
    </Tooltip>
  )
}

function useAssistantAttachmentAdmission(
  props: Pick<AssistantComposerProps, "canSend" | "attachmentCapabilities">,
  draft: AssistantComposerDraft,
  onDraftChange: Dispatch<SetStateAction<AssistantComposerDraft>>,
  submissionLock: RefObject<boolean>,
) {
  const enabled =
    props.canSend &&
    Boolean(props.attachmentCapabilities?.text || props.attachmentCapabilities?.images)
  const live = useRef({ ...props, enabled, attachments: draft.attachments, onDraftChange })
  const mounted = useRef(false)
  const [selectionIssue, setSelectionIssue] = useState<"count" | "total" | null>(null)
  useLayoutEffect(() => {
    live.current = { ...props, enabled, attachments: draft.attachments, onDraftChange }
  })
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const update = (
    change: (files: readonly AssistantAttachmentDraft[]) => readonly AssistantAttachmentDraft[],
  ) => {
    // Reserve synchronously: another picker/drop event can arrive before React commits.
    live.current.attachments = change(live.current.attachments)
    live.current.onDraftChange((current) => ({
      ...current,
      attachments: change(current.attachments),
    }))
  }
  const selectFiles = (files: readonly File[]) => {
    const { attachmentCapabilities: capabilities, enabled, attachments } = live.current
    if (!mounted.current || !enabled || submissionLock.current || !files.length || !capabilities)
      return
    setSelectionIssue(null)
    if (attachments.length + files.length > ASSISTANT_MAX_ATTACHMENTS) {
      setSelectionIssue("count")
      return
    }
    const size =
      attachments.reduce((bytes, file) => bytes + file.size, 0) +
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
    update((current) => [...current, ...pending])
    readSelectedAttachments(files, pending, capabilities, (attachment) => {
      if (!mounted.current) return
      update((current) => current.map((value) => (value.id === attachment.id ? attachment : value)))
    })
  }
  return {
    current: () => live.current.attachments,
    selectFiles,
    selectionIssue,
    clearIssue: () => setSelectionIssue(null),
    remove: (id: string) => {
      if (submissionLock.current) return
      update((current) => current.filter((file) => file.id !== id))
      setSelectionIssue(null)
    },
  }
}

function readSelectedAttachments(
  files: readonly File[],
  pending: readonly AssistantAttachmentDraft[],
  capabilities: NonNullable<AssistantComposerProps["attachmentCapabilities"]>,
  onRead: (attachment: AssistantAttachmentDraft) => void,
) {
  for (const [index, file] of files.entries()) {
    const selected = pending[index]
    if (selected) void readAssistantAttachment(file, selected.id, capabilities).then(onRead)
  }
}

function useAssistantViewCapture(
  props: Pick<AssistantComposerProps, "canSend" | "attachmentCapabilities" | "onCaptureView">,
  onFiles: (files: readonly File[]) => void,
  submissionLock: RefObject<boolean>,
) {
  const enabled = Boolean(
    props.canSend && props.attachmentCapabilities?.images && props.onCaptureView,
  )
  const live = useRef({ enabled, onCaptureView: props.onCaptureView, onFiles })
  const mounted = useRef(false)
  const epoch = useRef(0)
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  useReportActivity(pending)
  useLayoutEffect(() => {
    live.current = { enabled, onCaptureView: props.onCaptureView, onFiles }
  })
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useLayoutEffect(() => {
    return () => {
      epoch.current += 1
    }
  }, [enabled])
  const canCapture = () => live.current.enabled && !submissionLock.current && !lock.current
  const capture = async () => {
    const { onCaptureView } = live.current
    if (!onCaptureView || !canCapture()) return
    lock.current = true
    setPending(true)
    setFailed(false)
    const started = epoch.current
    const isCurrent = () => mounted.current && started === epoch.current
    try {
      const file = await onCaptureView()
      if (isCurrent() && file) live.current.onFiles([file])
    } catch {
      if (isCurrent()) setFailed(true)
    } finally {
      lock.current = false
      if (mounted.current) setPending(false)
    }
  }
  return { capture, pending, lock, failed }
}

function useAssistantFileDrop(onFiles: (files: readonly File[]) => void) {
  const depth = useRef(0)
  const [active, setActive] = useState(false)
  const isFileDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files") ||
    Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file") ||
    event.dataTransfer.files.length > 0
  const intercept = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }
  return {
    active,
    handlers: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!isFileDrag(event)) return
        intercept(event)
        depth.current += 1
        setActive(true)
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (isFileDrag(event)) intercept(event)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!depth.current) return
        intercept(event)
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setActive(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!isFileDrag(event)) return
        intercept(event)
        depth.current = 0
        setActive(false)
        onFiles(Array.from(event.dataTransfer.files))
      },
    },
  }
}

function AssistantComposerFeedback({
  dropActive,
  canAttach,
  captureFailed,
  selectionIssue,
}: {
  dropActive: boolean
  canAttach: boolean
  captureFailed: boolean
  selectionIssue: "count" | "total" | null
}) {
  const t = useTranslations("app.assistant")
  return (
    <>
      {dropActive && (
        <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">
          {t(canAttach ? "dropFiles" : "dropFilesUnavailable")}
        </p>
      )}
      {captureFailed && (
        <p role="alert" className="px-3 pt-2 text-xs text-destructive">
          {t("captureViewFailed")}
        </p>
      )}
      {selectionIssue && (
        <p role="alert" className="px-3 pt-2 text-xs text-destructive">
          {selectionIssue === "count"
            ? t("attachmentTooMany", { count: ASSISTANT_MAX_ATTACHMENTS })
            : t("attachmentTotalTooLarge", {
                limit: ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES / 1024 ** 2,
              })}
        </p>
      )}
    </>
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
  const submissionLock = useRef(false)
  const admissions = useAssistantAttachmentAdmission(props, draft, onDraftChange, submissionLock)
  const capture = useAssistantViewCapture(props, admissions.selectFiles, submissionLock)
  const pendingFiles = draft.attachments.some((attachment) => attachment.status === "pending")
  const submission = useAssistantSubmission(
    props,
    draft,
    () => {
      onDraftChange({ text: "", attachments: [] })
      admissions.clearIssue()
    },
    submissionLock,
    admissions,
    capture,
  )
  const drop = useAssistantFileDrop(admissions.selectFiles)
  const canAttach =
    props.canSend &&
    !submission.pending &&
    Boolean(props.attachmentCapabilities?.text || props.attachmentCapabilities?.images)
  useReportActivity(pendingFiles)
  useEffect(() => {
    if (!submission.pending) composer.current?.focus()
  }, [submission.pending])
  return (
    <div className="shrink-0 space-y-2 p-3">
      {props.feedback}
      <AssistantQueue {...props} />
      <section
        {...drop.handlers}
        aria-label={t("prompt")}
        className={cn(
          "@container/composer min-w-0 overflow-hidden rounded-xl border bg-background focus-within:border-ring",
          drop.active && "border-ring ring-2 ring-ring/50",
        )}
      >
        <AssistantAttachments
          attachments={draft.attachments}
          disabled={submission.pending}
          onRemove={admissions.remove}
        />
        <AssistantImageAttachmentFeedback
          capabilities={props.attachmentCapabilities}
          attachments={draft.attachments}
        />
        <AssistantComposerFeedback
          dropActive={drop.active}
          canAttach={canAttach}
          captureFailed={capture.failed}
          selectionIssue={admissions.selectionIssue}
        />
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
          onChange={(event) => {
            const text = event.currentTarget.value
            onDraftChange((current) => ({ ...current, text }))
          }}
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
          capturing={capture.pending}
          canSubmit={submission.canSubmit}
          onSubmit={submission.submit}
          onSelectFiles={admissions.selectFiles}
          onCapture={capture.capture}
        />
      </section>
    </div>
  )
}
