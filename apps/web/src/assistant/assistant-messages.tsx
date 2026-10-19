import { useTranslations } from "@vibeshape/i18n"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { useEffect, useRef } from "react"
import type { ChatMessage } from "./chat-history"

export function AssistantMessages({ messages }: { messages: readonly ChatMessage[] }) {
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
      {messages.map((message) =>
        message.role === "tool" ? (
          <details key={message.id} className="group mb-2 min-w-0 rounded-md border">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 py-1 text-xs focus-visible:outline focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronDown
                aria-hidden="true"
                className="size-3 shrink-0 -rotate-90 group-open:rotate-0"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {message.tool?.title || t("role.tool")}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {t("toolStatus", { status: message.tool?.status ?? "unknown" })}
              </span>
            </summary>
            <section aria-label={t("toolDetails")} className="max-h-72 overflow-auto border-t p-2">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {message.text}
              </pre>
            </section>
          </details>
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
        ),
      )}
      <div ref={end} />
    </div>
  )
}
