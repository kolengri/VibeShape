export function TaskProgress({ status, label }: { status: string; label: string }) {
  return (
    <div className="grid w-full max-w-xs gap-2 rounded-md border bg-popover p-4 text-popover-foreground shadow-md">
      <p role="status" className="text-sm" aria-live="polite">
        {status}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={status}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full w-full animate-pulse bg-primary motion-reduce:animate-none" />
      </div>
    </div>
  )
}
