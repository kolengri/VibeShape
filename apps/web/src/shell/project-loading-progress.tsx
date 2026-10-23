import { useTranslations } from "@vibeshape/i18n"

export function ProjectLoadingProgress({ refining = false }: { refining?: boolean }) {
  const t = useTranslations("app.shell.projectLoading")
  return (
    <div
      data-project-loading={refining ? "refining" : "reading"}
      className="pointer-events-none absolute inset-x-0 top-0 bottom-[var(--workspace-chrome-bottom,0px)] z-30 flex items-end justify-center p-6"
    >
      <div className="grid w-full max-w-xs gap-2 rounded-md border bg-popover p-4 text-popover-foreground shadow-md">
        <p role="status" className="text-sm" aria-live="polite">
          {t(refining ? "refining" : "reading")}
        </p>
        <div
          role="progressbar"
          aria-label={t("progress")}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full w-full animate-pulse bg-primary motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}
