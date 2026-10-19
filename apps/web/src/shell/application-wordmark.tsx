import { useActivityPending } from "@vibeshape/ui/components/activity"

export function ApplicationWordmark({ busy = false }: { busy?: boolean }) {
  const pending = useActivityPending() || busy
  return (
    <strong
      className="relative inline-flex items-center text-sm"
      data-application-wordmark
      data-loading={pending || undefined}
    >
      <span className={pending ? "invisible" : undefined} aria-hidden={pending || undefined}>
        VibeShape
      </span>
      {pending && (
        <span
          aria-hidden="true"
          data-global-loader
          className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-primary/20"
        >
          <span className="application-progress-segment block h-full w-1/2 rounded-full bg-primary" />
        </span>
      )}
    </strong>
  )
}
