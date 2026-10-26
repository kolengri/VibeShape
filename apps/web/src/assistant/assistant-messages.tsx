import { useVirtualizer } from "@tanstack/react-virtual"
import type { AssistantToolTargets } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type FocusEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AssistantMarkdown } from "./assistant-markdown"
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

function useToolDisclosure(id: string, expanded: Set<string>) {
  const [open, setOpen] = useState(expanded.has(id))
  const remember = useCallback(
    (next: boolean) => {
      if (next) expanded.add(id)
      else expanded.delete(id)
    },
    [expanded, id],
  )
  const mount = useCallback(
    (element: HTMLDetailsElement | null) => {
      if (!element) return
      element.open = expanded.has(id)
      // Native toggle events can arrive after a virtual row has left the window.
      return () => remember(element.open)
    },
    [expanded, id, remember],
  )
  const update = (next: boolean) => {
    remember(next)
    setOpen(next)
  }
  return {
    open,
    mount,
    onToggle(event: import("react").SyntheticEvent<HTMLDetailsElement>) {
      if (event.currentTarget.isConnected) update(event.currentTarget.open)
    },
  }
}

function ToolMessage({
  messages,
  onHighlight,
  expanded,
  lazy = false,
}: {
  messages: MessageGroup
  onHighlight?: AssistantToolHighlight | undefined
  expanded: Set<string>
  lazy?: boolean | undefined
}) {
  const t = useTranslations("app.assistant")
  const highlight = useToolHighlight(messages, onHighlight)
  const message = messages[0]
  const disclosure = useToolDisclosure(message.id, expanded)
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
    <details
      className="group mb-2 min-w-0 rounded-md border"
      ref={disclosure.mount}
      onToggle={disclosure.onToggle}
    >
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
      {(!lazy || disclosure.open) && (
        <section aria-label={t("toolDetails")} className="max-h-72 overflow-auto border-t p-2">
          {messages.length === 1 ? (
            <>
              <ToolFailureNotice message={message} />
              <AssistantToolDetails
                action={action.action}
                identity={rawTitle}
                text={message.text}
              />
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
      )}
    </details>
  )
}

function isNewUserTurn(previous: readonly ChatMessage[] | null, messages: readonly ChatMessage[]) {
  const latest = messages.filter((message) => message.role === "user").at(-1)
  return Boolean(previous && latest && !previous.some((message) => message.id === latest.id))
}

function transcriptChanged(
  previous: readonly ChatMessage[] | null,
  messages: readonly ChatMessage[],
) {
  return previous === null || !sameTranscript(previous, messages)
}

function useAssistantTranscriptScroll(
  log: RefObject<HTMLDivElement | null>,
  messages: readonly ChatMessage[],
  active: boolean,
  scrollToEnd: () => void,
) {
  const following = useRef(true)
  const wasActive = useRef(false)
  const [canJump, setCanJump] = useState(false)
  const previousMessages = useRef<readonly ChatMessage[] | null>(null)
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observeToggle = (event: Event) => {
      const target = event.target
      const closedTool =
        target instanceof HTMLDetailsElement &&
        (target.parentElement === element || target.parentElement?.hasAttribute("data-index")) &&
        !target.open
      following.current = (closedTool || following.current) && nearBottom(element)
      setCanJump(!nearBottom(element))
    }
    element.addEventListener("toggle", observeToggle, true)
    return () => element.removeEventListener("toggle", observeToggle, true)
  }, [log])
  useLayoutEffect(() => {
    const previous = previousMessages.current
    previousMessages.current = messages
    const reopened = active && !wasActive.current
    wasActive.current = active
    if (!active) return
    // Opening chat and sending a new turn return to the live conversation.
    if (reopened || isNewUserTurn(previous, messages)) following.current = true
    // Checkpoint/display publications may clone the transcript without adding content.
    const element = log.current
    // Keep automatic following inside the transcript; scrolling an end marker can move ancestors.
    if (!element) return
    const changed = transcriptChanged(previous, messages)
    if (following.current && (reopened || changed)) {
      scrollToEnd()
      setCanJump(false)
    } else setCanJump(!nearBottom(element))
  }, [log, messages, active, scrollToEnd])
  useEffect(() => {
    const element = log.current
    if (!element || !active || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!element.clientHeight) return
      if (following.current) scrollToEnd()
      setCanJump(!nearBottom(element))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [log, active, scrollToEnd])
  return {
    canJump,
    onScroll(event: UIEvent<HTMLDivElement>) {
      const target = event.target
      following.current =
        nearBottom(event.currentTarget) && (!(target instanceof HTMLElement) || nearBottom(target))
      setCanJump(!nearBottom(event.currentTarget))
    },
    followLatest() {
      following.current = true
      scrollToEnd()
      setCanJump(false)
    },
  }
}

export function AssistantMessages({
  messages,
  onHighlight,
  footer,
  active = true,
}: {
  messages: readonly ChatMessage[]
  onHighlight?: AssistantToolHighlight | undefined
  footer?: ReactNode
  active?: boolean | undefined
}) {
  const t = useTranslations("app.assistant")
  const groups = useMemo(() => groupMessages(messages), [messages])
  const log = useRef<HTMLDivElement>(null)
  const expanded = useRef(new Set<string>())
  const virtualized = groups.length > 80
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => log.current,
    getItemKey: (index) => groups[index]?.[0].id ?? index,
    estimateSize: () => 120,
    overscan: 6,
    enabled: virtualized && active,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 48,
  })
  const scrollToEnd = useCallback(() => {
    if (virtualized) virtualizer.scrollToEnd()
    else log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [virtualized, virtualizer])
  const scrolling = useAssistantTranscriptScroll(log, messages, active, scrollToEnd)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={log}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        role="log"
        aria-label={t("messages")}
        aria-live="polite"
        aria-relevant="additions text"
        style={virtualized ? { overflowAnchor: "none" } : undefined}
        onScrollCapture={scrolling.onScroll}
      >
        {messages.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        {virtualized ? (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize(), overflowAnchor: "none" }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const group = groups[item.index]
              return group ? (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 flow-root w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <AssistantMessageGroup
                    group={group}
                    onHighlight={onHighlight}
                    expanded={expanded.current}
                    lazy
                  />
                </div>
              ) : null
            })}
          </div>
        ) : (
          groups.map((group) => (
            <AssistantMessageGroup
              key={group[0].id}
              group={group}
              onHighlight={onHighlight}
              expanded={expanded.current}
            />
          ))
        )}
        {footer}
      </div>
      {scrolling.canJump && (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("jumpToLatest")}
          className="absolute right-3 bottom-2 rounded-full bg-background shadow-md"
          onClick={scrolling.followLatest}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

function AssistantMessageGroup({
  group,
  onHighlight,
  expanded,
  lazy,
}: {
  group: MessageGroup
  onHighlight?: AssistantToolHighlight | undefined
  expanded: Set<string>
  lazy?: boolean | undefined
}) {
  const t = useTranslations("app.assistant")
  const message = group[0]
  return message.role === "tool" ? (
    <ToolMessage messages={group} onHighlight={onHighlight} expanded={expanded} lazy={lazy} />
  ) : (
    <article
      data-message-role={message.role}
      className={cn(
        "mb-4 min-w-0",
        message.role === "user" &&
          "ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-secondary px-3 py-2 text-secondary-foreground",
      )}
    >
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
        {t(`role.${message.role}`)}
      </h3>
      {message.role === "assistant" ? (
        <AssistantMarkdown text={message.text} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
      )}
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
}
