import { useActivityPending } from "@vibeshape/ui/components/activity"
import { LoadingIcon } from "@vibeshape/ui/components/icons"

export function ApplicationWordmark({ busy = false }: { busy?: boolean }) {
  const pending = useActivityPending() || busy
  return (
    <strong
      className="relative inline-flex items-center text-sm"
      data-application-wordmark
      data-loading={pending || undefined}
      aria-busy={pending || undefined}
    >
      <span
        className={pending ? "application-wordmark-ink" : undefined}
        data-global-loader={pending || undefined}
      >
        VibeShape
      </span>
      <span
        className="ml-2 inline-flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {pending && (
          <LoadingIcon
            data-slot="application-activity-indicator"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
      </span>
    </strong>
  )
}
