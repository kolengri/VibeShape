import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { useTranslations } from "@vibeshape/i18n"
import type { TranscriptArchiveSummary } from "@vibeshape/persistence/transcript-store"
import { Button } from "@vibeshape/ui/components/button"
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react"

type ChatHistoryProps = {
  chats: readonly TranscriptArchiveSummary[]
  disabled: boolean
  onOpen: (id: string) => Promise<void>
}

export function AssistantChatHistory({ chats, disabled, onOpen }: ChatHistoryProps) {
  const t = useTranslations("app.assistant")
  const opening = useRef(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const open = async (id: string) => {
    if (disabled || opening.current) return
    opening.current = true
    setOpeningId(id)
    try {
      await onOpen(id)
    } finally {
      opening.current = false
      setOpeningId(null)
    }
  }
  const actions = { disabled: disabled || openingId !== null, onOpen: open }
  return (
    <section
      aria-label={t("chatHistory")}
      aria-busy={openingId !== null || undefined}
      className="flex max-h-52 shrink-0 flex-col gap-1 overflow-hidden border-b p-2"
    >
      <p className="px-2 text-xs font-medium text-muted-foreground">{t("chatHistory")}</p>
      {chats.length > 80 ? (
        <VirtualChatList chats={chats} {...actions} openingId={openingId} />
      ) : chats.length ? (
        <ul className="min-h-0 space-y-1 overflow-y-auto">
          {chats.map((chat) => (
            <li key={chat.id}>
              <ChatHistoryButton chat={chat} {...actions} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("noPreviousChats")}</p>
      )}
    </section>
  )
}

function ChatHistoryButton({
  chat,
  disabled,
  onOpen,
  onFocus,
  onKeyDown,
}: Pick<ChatHistoryProps, "disabled" | "onOpen"> & {
  chat: TranscriptArchiveSummary
  onFocus?: (() => void) | undefined
  onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined
}) {
  const t = useTranslations("app.assistant")
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      disabled={disabled}
      onClick={() => onOpen(chat.id)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <span className="truncate">{chat.title || t("untitledChat")}</span>
    </Button>
  )
}

function VirtualChatList({
  chats,
  disabled,
  onOpen,
  openingId,
}: ChatHistoryProps & { openingId: string | null }) {
  const root = useRef<HTMLUListElement>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const requestedFocus = useRef<string | null>(null)
  const focusedIndex = chats.findIndex((chat) => chat.id === focusedId)
  const openingIndex = chats.findIndex((chat) => chat.id === openingId)
  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => root.current,
    getItemKey: (index) => chats[index]?.id ?? index,
    estimateSize: () => 32,
    gap: 4,
    overscan: 4,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), focusedIndex, openingIndex])]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b),
  })
  useLayoutEffect(() => {
    if (requestedFocus.current === null) return
    const index = chats.findIndex((chat) => chat.id === requestedFocus.current)
    const button = root.current?.querySelector<HTMLButtonElement>(
      `[data-chat-index="${index}"] button`,
    )
    if (button) {
      requestedFocus.current = null
      button.focus({ preventScroll: true })
    }
  })
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const targets: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: chats.length - 1,
      Tab: index + (event.shiftKey ? -1 : 1),
    }
    const next = targets[event.key]
    const chat = next === undefined ? undefined : chats[next]
    if (!chat || next === undefined) return
    event.preventDefault()
    requestedFocus.current = chat.id
    setFocusedId(chat.id)
    virtualizer.scrollToIndex(next, { align: "auto" })
  }
  return (
    <ul
      ref={root}
      className="relative max-h-40 min-h-0 overflow-y-auto"
      style={{ overflowAnchor: "none" }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
      }}
    >
      <li aria-hidden="true" style={{ height: virtualizer.getTotalSize() }} />
      {virtualizer.getVirtualItems().map((item) => {
        const chat = chats[item.index]
        return chat ? (
          <li
            key={item.key}
            ref={virtualizer.measureElement}
            aria-setsize={chats.length}
            aria-posinset={item.index + 1}
            data-index={item.index}
            data-chat-index={item.index}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <ChatHistoryButton
              chat={chat}
              disabled={disabled}
              onOpen={onOpen}
              onFocus={() => setFocusedId(chat.id)}
              onKeyDown={(event) => navigate(event, item.index)}
            />
          </li>
        ) : null
      })}
    </ul>
  )
}
