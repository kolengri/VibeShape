import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import type { ChatMessage } from "./chat-history"

type AssistantPanelProps = {
  open: boolean
  projectName: string
  messages: readonly ChatMessage[]
  busy: boolean
  canSend: boolean
  configuration: ReactNode
  permission?: ReactNode
  error: ReactNode
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
}: {
  titleId: string
  projectName: string
  settingsOpen: boolean
  onSettings: () => void
  onClose: () => void
}) {
  const t = useTranslations("app.assistant")
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="font-medium">
          {t("title")}
        </h2>
        <p className="truncate text-xs text-muted-foreground" title={projectName}>
          {projectName}
        </p>
      </div>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={onSettings}
        aria-expanded={settingsOpen}
      >
        {t("connection")}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onClose}>
        {t("close")}
      </Button>
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
  return (
    <>
      {props.permission}
      {props.error && (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      )}
      {props.storageFailed && (
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
    | "busy"
    | "canSend"
    | "messages"
    | "permission"
    | "error"
    | "storageFailed"
    | "onSend"
    | "onCancel"
    | "onReset"
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
        rows={3}
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.busy || props.messages.length === 0}
          onClick={props.onReset}
        >
          {t("newChat")}
        </Button>
        <span className="flex-1" />
        {props.busy ? (
          <Button key="stop" type="button" size="sm" variant="outline" onClick={props.onCancel}>
            {t("stop")}
          </Button>
        ) : (
          <Button
            key="send"
            type="button"
            size="sm"
            disabled={!props.canSend || !props.text.trim()}
            onClick={submit}
          >
            {t("send")}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AssistantPanel(props: AssistantPanelProps) {
  const titleId = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [text, setText] = useState("")
  if (!props.open) return null
  return (
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
      />
      {(settingsOpen || !props.canSend) && (
        <div className="shrink-0 overflow-y-auto border-b p-3 max-h-[45%]">
          {props.configuration}
        </div>
      )}
      <AssistantMessages messages={props.messages} />
      <AssistantComposer {...props} text={text} onTextChange={setText} />
    </aside>
  )
}
