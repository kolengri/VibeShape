import { useActivityPending } from "@vibeshape/ui/components/activity"

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
    </strong>
  )
}
