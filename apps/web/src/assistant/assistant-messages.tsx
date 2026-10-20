import type { AssistantToolTargets } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import { type FocusEvent, type ReactNode, useEffect, useId, useMemo, useRef } from "react"
import { AssistantToolDetails, hasToolDetails } from "./assistant-tool-details"
import type { AssistantToolHighlight } from "./assistant-tool-highlight"
import type { ChatMessage } from "./chat-history"

function toolAction(title: string) {
  const identifier = title.replace(/^(?:functions\.)?mcp(?:\.[\w.-]+\.|__[\w-]+__)/, "")
  if (identifier === title && !/^[a-z][a-zA-Z0-9]*(?:[_-][a-zA-Z0-9]+)*$/.test(identifier)) {
    return { action: "", name: title }
  }
  const words = identifier.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")
  return { action: identifier, name: words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() }
}

function nearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 48
}

function sameToolSummary(left: ChatMessage["tool"], right: ChatMessage["tool"]) {
  return (["title", "status", "hasFailureDetails"] as const).every(
    (key) => left?.[key] === right?.[key],
  )
}

function sameAttachments(
  left: ChatMessage["attachments"] = [],
  right: ChatMessage["attachments"] = [],
) {
  return (
    left.length === right.length &&
    left.every(
      (attachment, index) =>
        attachment.id === right[index]?.id && attachment.name === right[index]?.name,
    )
  )
}

function sameTranscript(left: readonly ChatMessage[], right: readonly ChatMessage[]) {
  return (
    left.length === right.length &&
    left.every((message, index) => {
      const other = right[index]
      return (
        other &&
        message.id === other.id &&
        message.role === other.role &&
        message.text === other.text &&
        sameToolSummary(message.tool, other.tool) &&
        sameAttachments(message.attachments, other.attachments)
      )
    })
  )
}

type MessageGroup = [ChatMessage, ...ChatMessage[]]

function groupMessages(messages: readonly ChatMessage[]) {
  const groups: MessageGroup[] = []
  for (const message of messages) {
    const previous = groups.at(-1)
    const title = message.tool?.title?.trim()
    if (
      message.role === "tool" &&
      title &&
      previous?.[0].role === "tool" &&
      previous[0].tool?.title?.trim() === title &&
      previous[0].tool?.status === message.tool?.status
    ) {
      previous.push(message)
    } else {
      groups.push([message])
    }
  }
  return groups
}

function useToolHighlight(messages: readonly ChatMessage[], onHighlight?: AssistantToolHighlight) {
  const owner = useId()
  const hovered = useRef(false)
  const focused = useRef(false)
  const targets = useMemo((): AssistantToolTargets | null => {
    const entries = messages.flatMap((message) =>
      message.tool?.targets && !["failed", "cancelled"].includes(message.tool.status ?? "")
        ? [message.tool.targets]
        : [],
    )
    const first = entries[0]
    if (!first || entries.some((entry) => entry.projectId !== first.projectId)) return null
    const featureIds = [...new Set(entries.flatMap((entry) => entry.featureIds))]
    const sketchIds = [...new Set(entries.flatMap((entry) => entry.sketchIds))]
    return featureIds.length || sketchIds.length
      ? { projectId: first.projectId, featureIds, sketchIds }
      : null
  }, [messages])
  useEffect(() => {
    if (hovered.current || focused.current) onHighlight?.(owner, targets)
    return () => onHighlight?.(owner, null)
  }, [onHighlight, owner, targets])
  const publish = () => onHighlight?.(owner, hovered.current || focused.current ? targets : null)
  return {
    enabled: Boolean(targets && onHighlight),
    hintId: `${owner}-hint`,
    handlers: {
      onPointerEnter() {
        hovered.current = true
        publish()
      },
      onPointerLeave() {
        hovered.current = false
        publish()
      },
      onPointerCancel() {
        hovered.current = false
        publish()
      },
      onFocusCapture() {
        focused.current = true
        publish()
      },
      onBlurCapture(event: FocusEvent<HTMLElement>) {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return
        focused.current = false
        publish()
      },
    },
  }
}

function ToolFailureNotice({ message }: { message: ChatMessage }) {
  const t = useTranslations("app.assistant")
  const hasFailureDetails = message.tool?.hasFailureDetails ?? hasToolDetails(message.text)
  return message.tool?.status === "failed" && !hasFailureDetails ? (
    <p className="text-xs text-muted-foreground">{t("toolFailureUnavailable")}</p>
  ) : null
}

function ToolCallOutput({
  message,
  number,
  onHighlight,
}: {
  message: ChatMessage
  number: number
  onHighlight?: AssistantToolHighlight | undefined
}) {
  const t = useTranslations("app.assistant")
  const messages = useMemo(() => [message], [message])
  const highlight = useToolHighlight(messages, onHighlight)
  const identity = message.tool?.title?.trim() ?? ""
  return (
    <li
      className="space-y-2 py-2 first:pt-0 last:pb-0 focus-visible:outline focus-visible:outline-ring"
      tabIndex={highlight.enabled ? 0 : undefined}
      aria-describedby={highlight.enabled ? highlight.hintId : undefined}
      {...(highlight.enabled ? highlight.handlers : {})}
    >
      <h4 className="text-xs font-medium">{t("toolCall", { number })}</h4>
      {highlight.enabled && (
        <span id={highlight.hintId} className="sr-only">
          {t("toolHighlightHint")}
        </span>
      )}
      <ToolFailureNotice message={message} />
      {hasToolDetails(message.text) ? (
        <AssistantToolDetails
          action={toolAction(identity).action}
          identity={identity}
          text={message.text}
        />
      ) : (
        message.tool?.status !== "failed" && (
          <p className="text-xs text-muted-foreground">{t("toolEmptyValue")}</p>
        )
      )}
    </li>
  )
}

function ToolMessageHeading({
  message,
  count,
  hintId,
}: {
  message: ChatMessage
  count: number
  hintId?: string | undefined
}) {
  const t = useTranslations("app.assistant")
  const rawTitle = message.tool?.title?.trim() ?? ""
  return (
    <>
      {hintId && (
        <span id={hintId} className="sr-only">
          {t("toolHighlightHint")}
        </span>
      )}
      <span className="min-w-0 flex-1 break-words font-medium" title={rawTitle || undefined}>
        {rawTitle ? t("toolAction", toolAction(rawTitle)) : t("role.tool")}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {t("toolStatus", { status: message.tool?.status ?? "unknown" })}
      </span>
      {count > 1 && (
        <span className="shrink-0 rounded bg-panel-muted px-1.5 py-0.5 font-medium tabular-nums">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{t("toolCallCount", { count })}</span>
        </span>
      )}
    </>
  )
}

function EmptyToolMessage({
  messages,
  highlight,
}: {
  messages: MessageGroup
  highlight: ReturnType<typeof useToolHighlight>
}) {
  const message = messages[0]
  return (
    <div
      tabIndex={highlight.enabled ? 0 : undefined}
      aria-describedby={highlight.enabled ? highlight.hintId : undefined}
      {...(highlight.enabled ? highlight.handlers : {})}
      className={cn(
        "mb-2 min-w-0 rounded-md border text-xs",
        highlight.enabled && "hover:bg-accent/60 focus-visible:outline focus-visible:outline-ring",
      )}
    >
      <div className="flex min-h-8 items-center gap-2 px-2 py-1">
        <ToolMessageHeading
          message={message}
          count={messages.length}
          hintId={highlight.enabled ? highlight.hintId : undefined}
        />
      </div>
      {message.tool?.status === "failed" && (
        <div className="px-2 pb-2">
          <ToolFailureNotice message={message} />
        </div>
      )}
    </div>
  )
}

function ToolMessage({
  messages,
  onHighlight,
}: {
  messages: MessageGroup
  onHighlight?: AssistantToolHighlight | undefined
}) {
  const t = useTranslations("app.assistant")
  const highlight = useToolHighlight(messages, onHighlight)
  const message = messages[0]
  const rawTitle = message.tool?.title?.trim() ?? ""
  const action = toolAction(rawTitle)
  const hasDetails = messages.some((item) => hasToolDetails(item.text))
  if (!hasDetails) return <EmptyToolMessage messages={messages} highlight={highlight} />
  const heading = (
    <ToolMessageHeading
      message={message}
      count={messages.length}
      hintId={highlight.enabled ? highlight.hintId : undefined}
    />
  )
  return (
    <details className="group mb-2 min-w-0 rounded-md border">
      <summary
        {...(highlight.enabled ? highlight.handlers : {})}
        aria-describedby={highlight.enabled ? highlight.hintId : undefined}
        className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 -rotate-90 group-open:rotate-0"
        />
        {heading}
      </summary>
      <section aria-label={t("toolDetails")} className="max-h-72 overflow-auto border-t p-2">
        {messages.length === 1 ? (
          <>
            <ToolFailureNotice message={message} />
            <AssistantToolDetails action={action.action} identity={rawTitle} text={message.text} />
          </>
        ) : (
          <ol aria-label={t("toolCalls")} className="divide-y">
            {messages.map((item, index) => (
              <ToolCallOutput
                key={item.id}
                message={item}
                number={index + 1}
                onHighlight={onHighlight}
              />
            ))}
          </ol>
        )}
      </section>
    </details>
  )
}

export function AssistantMessages({
  messages,
  onHighlight,
  footer,
}: {
  messages: readonly ChatMessage[]
  onHighlight?: AssistantToolHighlight | undefined
  footer?: ReactNode
}) {
  const t = useTranslations("app.assistant")
  const groups = useMemo(() => groupMessages(messages), [messages])
  const end = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previousMessages = useRef<readonly ChatMessage[] | null>(null)
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observeToggle = (event: Event) => {
      const target = event.target
      const closedTool =
        target instanceof HTMLDetailsElement && target.parentElement === element && !target.open
      following.current = (closedTool || following.current) && nearBottom(element)
    }
    element.addEventListener("toggle", observeToggle, true)
    return () => element.removeEventListener("toggle", observeToggle, true)
  }, [])
  useEffect(() => {
    const previous = previousMessages.current
    previousMessages.current = messages
    // Checkpoint/display publications may clone the transcript without adding content.
    if (following.current && (!previous || !sameTranscript(previous, messages)))
      end.current?.scrollIntoView({ block: "nearest" })
  }, [messages])
  return (
    <div
      ref={log}
      className="min-h-0 flex-1 overflow-y-auto p-3"
      role="log"
      aria-label={t("messages")}
      aria-live="polite"
      aria-relevant="additions text"
      onScrollCapture={(event) => {
        const target = event.target
        following.current =
          nearBottom(event.currentTarget) &&
          (!(target instanceof HTMLElement) || nearBottom(target))
      }}
    >
      {messages.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {groups.map((group) => {
        const message = group[0]
        return message.role === "tool" ? (
          <ToolMessage key={message.id} messages={group} onHighlight={onHighlight} />
        ) : (
          <article key={message.id} className="mb-4 min-w-0">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              {t(`role.${message.role}`)}
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
            {message.attachments && message.attachments.length > 0 && (
              <ul aria-label={t("attachments")} className="mt-1 flex flex-wrap gap-1">
                {message.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="max-w-full truncate rounded-md border px-2 py-1 text-xs text-muted-foreground"
                  >
                    {attachment.name}
                  </li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
      {footer}
      <div ref={end} />
    </div>
  )
}
