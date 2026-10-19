import { useTranslations } from "@vibeshape/i18n"
import { MessageSquarePlus, Send, Settings, Square, X } from "@vibeshape/ui/components/icons"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { useReportApplicationError } from "../shell/application-notices"
import { AssistantIconAction } from "./assistant-icon-action"
import type { ChatMessage } from "./chat-history"

type AssistantPanelProps = {
  open: boolean
  projectName: string
  messages: readonly ChatMessage[]
  busy: boolean
  canSend: boolean
  configuration: ReactNode
  sessionControls?: ReactNode
  permission?: ReactNode
  error: string | null
  storageFailed: boolean
  onClose: () => void
  onSend: (text: string) => Promise<void>
  onCancel: () => Promise<void>
  onReset: () => Promise<void>
}

function AssistantHeader({
  titleId,
  projectName,
  settingsOpen,
  onSettings,
  onClose,
  onReset,
  canReset,
}: {
  titleId: string
  projectName: string
  settingsOpen: boolean
  onSettings: () => void
  onClose: () => void
  onReset: () => Promise<void>
  canReset: boolean
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

function AssistantMessages({ messages }: { messages: readonly ChatMessage[] }) {
  const t = useTranslations("app.assistant")
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" })
  }, [messages])
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-3"
      role="log"
      aria-label={t("messages")}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {messages.map((message) => (
        <article key={message.id} className="mb-4 min-w-0">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {t(`role.${message.role}`)}
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        </article>
      ))}
      <div ref={end} />
    </div>
  )
}

function AssistantFeedback(
  props: Pick<AssistantPanelProps, "permission" | "error" | "storageFailed">,
) {
  const t = useTranslations("app.assistant")
  const centralized = useReportApplicationError(props.error)
  const storageCentralized = useReportApplicationError(
    props.storageFailed ? t("storageFailed") : null,
  )
  return (
    <>
      {props.permission}
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

function AssistantComposer(
  props: Pick<
    AssistantPanelProps,
    "busy" | "canSend" | "permission" | "error" | "storageFailed" | "onSend" | "onCancel"
  > & { text: string; onTextChange: (text: string) => void },
) {
  const t = useTranslations("app.assistant")
  const id = useId()
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    composer.current?.focus()
  }, [])
  const submit = async () => {
    const value = props.text.trim()
    if (!value || props.busy || !props.canSend) return
    props.onTextChange("")
    await props.onSend(value)
  }
  return (
    <div className="shrink-0 space-y-2 border-t p-3">
      <AssistantFeedback
        permission={props.permission}
        error={props.error}
        storageFailed={props.storageFailed}
      />
      <label htmlFor={id} className="sr-only">
        {t("prompt")}
      </label>
      <Textarea
        id={id}
        ref={composer}
        value={props.text}
        rows={2}
        maxLength={16_000}
        placeholder={t("placeholder")}
        disabled={!props.canSend}
        onChange={(event) => props.onTextChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        {props.busy ? (
          <AssistantIconAction key="stop" label={t("stop")} onAction={props.onCancel}>
            <Square aria-hidden="true" />
          </AssistantIconAction>
        ) : (
          <AssistantIconAction
            key="send"
            label={t("send")}
            disabled={!props.canSend || !props.text.trim()}
            onAction={submit}
            primary
          >
            <Send aria-hidden="true" />
          </AssistantIconAction>
        )}
      </div>
    </div>
  )
}

export function AssistantPanel(props: AssistantPanelProps) {
  const t = useTranslations("app.assistant")
  const titleId = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [text, setText] = useState("")
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
          canReset={!props.busy && props.messages.length > 0}
        />
        {props.sessionControls && (
          <div className="shrink-0 space-y-2 border-b px-3 py-2">{props.sessionControls}</div>
        )}
        {(settingsOpen || !props.canSend) && (
          <section
            aria-label={t("settingsTitle")}
            className="shrink-0 overflow-y-auto border-b p-3 max-h-[45%]"
          >
            {props.configuration}
          </section>
        )}
        <AssistantMessages messages={props.messages} />
        <AssistantComposer {...props} text={text} onTextChange={setText} />
      </aside>
    </TooltipProvider>
  )
}
