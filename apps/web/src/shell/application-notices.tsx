import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { AcceptIcon, X } from "@vibeshape/ui/components/icons"
import {
  Notification,
  NotificationClose,
  NotificationProvider,
  NotificationViewport,
} from "@vibeshape/ui/components/notification"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from "react"

type NoticeTone = "error" | "success"
type Notice = Readonly<{ message: string; attempt: number; tone: NoticeTone; dismissed: boolean }>
type Report = (id: string, message: string | null, attempt: number, tone: NoticeTone) => void
const ApplicationNoticesContext = createContext<Report | null>(null)

function ApplicationNotices({
  notices,
  onDismiss,
}: {
  notices: ReadonlyMap<string, Notice>
  onDismiss: (id: string) => void
}) {
  const t = useTranslations("app.shell.notices")
  return (
    <NotificationProvider label={t("title")}>
      <TooltipProvider>
        {[...notices]
          .filter(([, notice]) => !notice.dismissed)
          .map(([id, notice]) => (
            <Notification
              key={id}
              open
              tone={notice.tone}
              onOpenChange={(open) => {
                if (!open) onDismiss(id)
              }}
            >
              {notice.tone === "success" && (
                <AcceptIcon aria-hidden="true" className="size-5 shrink-0" />
              )}
              <p className="min-w-0 flex-1 break-words text-sm">{notice.message}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <NotificationClose asChild>
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={t("dismiss")}>
                      <X aria-hidden="true" />
                    </Button>
                  </NotificationClose>
                </TooltipTrigger>
                <TooltipContent>{t("dismiss")}</TooltipContent>
              </Tooltip>
            </Notification>
          ))}
      </TooltipProvider>
      <NotificationViewport
        label={t("title")}
        className="right-auto left-1/2 z-60 w-3/4 max-w-sm -translate-x-1/2 sm:right-auto sm:left-1/2"
      />
    </NotificationProvider>
  )
}

export function ApplicationNoticesProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<ReadonlyMap<string, Notice>>(() => new Map())
  const report = useCallback<Report>((id, message, attempt, tone) => {
    setNotices((current) => {
      const previous = current.get(id)
      if (previous?.message === message && previous.attempt === attempt && previous.tone === tone)
        return current
      if (message === null && !previous) return current
      const next = new Map(current)
      if (message === null) next.delete(id)
      else next.set(id, { message, attempt, tone, dismissed: false })
      return next
    })
  }, [])
  const dismiss = useCallback((id: string) => {
    setNotices((current) => {
      const notice = current.get(id)
      if (!notice) return current
      const next = new Map(current)
      next.set(id, { ...notice, dismissed: true })
      return next
    })
  }, [])
  return (
    <ApplicationNoticesContext.Provider value={report}>
      {children}
      <ApplicationNotices notices={notices} onDismiss={dismiss} />
    </ApplicationNoticesContext.Provider>
  )
}

/** Returns whether the app owns presentation; standalone consumers may retain a fallback. */
export function useReportApplicationError(message: string | null, attempt = 0) {
  return useReportApplicationNotice(message, attempt, "error")
}

export function useReportApplicationSuccess(message: string | null, attempt = 0) {
  return useReportApplicationNotice(message, attempt, "success")
}

function useReportApplicationNotice(message: string | null, attempt: number, tone: NoticeTone) {
  const report = useContext(ApplicationNoticesContext)
  const id = useId()
  useEffect(() => {
    report?.(id, message, attempt, tone)
    return () => report?.(id, null, 0, tone)
  }, [id, message, attempt, report, tone])
  return report !== null
}
