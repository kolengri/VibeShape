import { useTranslations } from "@vibeshape/i18n"
import { LoadingIcon } from "@vibeshape/ui/components/icons"
import { useSyncExternalStore } from "react"

/** The active project's existing API or native chat controller; connection is not activity. */
export type ProjectAssistantActivity = Readonly<{
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Readonly<{ busy: boolean }>
}>

const subscribeIdle = () => () => {}
const idle = () => false

export function ProjectAssistantStatus({
  activity,
}: {
  activity?: ProjectAssistantActivity | undefined
}) {
  const t = useTranslations("app.shell.applicationBar")
  const busy = useSyncExternalStore(
    activity?.subscribe ?? subscribeIdle,
    activity ? () => activity.getSnapshot().busy : idle,
    idle,
  )
  return (
    <span className="grid shrink-0 items-center whitespace-nowrap text-xs text-muted-foreground">
      {/* Reserve the localized label's width even while the project is idle. */}
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 inline-flex items-center gap-1"
      >
        <span className="size-3 shrink-0" />
        <span>{t("assistantWorking")}</span>
      </span>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="col-start-1 row-start-1 inline-flex items-center gap-1"
      >
        {busy && (
          <>
            <LoadingIcon className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            <span>{t("assistantWorking")}</span>
          </>
        )}
      </span>
    </span>
  )
}
