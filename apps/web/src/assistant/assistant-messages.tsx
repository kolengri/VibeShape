import { useTranslations } from "@vibeshape/i18n"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { useEffect, useRef } from "react"
import { AssistantToolDetails, hasToolDetails } from "./assistant-tool-details"
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

function ToolMessage({ messages }: { messages: MessageGroup }) {
  const t = useTranslations("app.assistant")
  const message = messages[0]
  const rawTitle = message.tool?.title?.trim() ?? ""
  const action = toolAction(rawTitle)
  const title = rawTitle ? t("toolAction", action) : t("role.tool")
  const hasDetails = messages.some((item) => hasToolDetails(item.text))
  const heading = (
    <>
      <span className="min-w-0 flex-1 break-words font-medium" title={rawTitle || undefined}>
        {title}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {t("toolStatus", { status: message.tool?.status ?? "unknown" })}
      </span>
      {messages.length > 1 && (
        <span className="shrink-0 rounded bg-panel-muted px-1.5 py-0.5 font-medium tabular-nums">
          <span aria-hidden="true">{messages.length}</span>
          <span className="sr-only">{t("toolCallCount", { count: messages.length })}</span>
        </span>
      )}
    </>
  )
  if (!hasDetails) {
    return (
      <div className="mb-2 flex min-h-8 min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-xs">
        {heading}
      </div>
    )
  }
  return (
    <details className="group mb-2 min-w-0 rounded-md border">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 -rotate-90 group-open:rotate-0"
        />
        {heading}
      </summary>
      <section aria-label={t("toolDetails")} className="max-h-72 overflow-auto border-t p-2">
        {messages.length === 1 ? (
          <AssistantToolDetails action={action.action} identity={rawTitle} text={message.text} />
        ) : (
          <ol aria-label={t("toolCalls")} className="divide-y">
            {messages.map((item, index) => (
              <li key={item.id} className="space-y-2 py-2 first:pt-0 last:pb-0">
                <h4 className="text-xs font-medium">{t("toolCall", { number: index + 1 })}</h4>
                {hasToolDetails(item.text) ? (
                  <AssistantToolDetails
                    action={action.action}
                    identity={rawTitle}
                    text={item.text}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">{t("toolEmptyValue")}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </details>
  )
}

export function AssistantMessages({ messages }: { messages: readonly ChatMessage[] }) {
  const t = useTranslations("app.assistant")
  const end = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const following = useRef(true)
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
    if (following.current) end.current?.scrollIntoView({ block: "nearest" })
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
      {groupMessages(messages).map((group) => {
        const message = group[0]
        return message.role === "tool" ? (
          <ToolMessage key={message.id} messages={group} />
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
      <div ref={end} />
    </div>
  )
}
