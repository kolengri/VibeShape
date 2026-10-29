import type { NumericalJobStatus } from "@vibeshape/automation-api/numerical-jobs"
import { useTranslations } from "@vibeshape/i18n"
import { LoadingIcon } from "@vibeshape/ui/components/icons"

const toolLabels = {
  analyze_lightweighting: "structuralAnalysis",
  request_lightweighting: "structuralGeneration",
  analyze_quick_lightweighting: "quickAnalysis",
  request_quick_lightweighting: "quickGeneration",
  analyze_print_optimization: "printAnalysis",
  request_print_optimization: "printGeneration",
} as const

function completedStatus(job: Extract<NumericalJobStatus, { status: "completed" }>) {
  if (job.result.ok) return "completed"
  return job.result.diagnostic.code === "request-cancelled" ? "cancelled" : "failed"
}

function AssistantNumericalJob({ job }: { job: NumericalJobStatus }) {
  const t = useTranslations("app.assistant.numericalJobs")
  const pending = job.status !== "completed"
  const failure = job.status === "completed" && !job.result.ok ? job.result.diagnostic : null
  const status = job.status === "completed" ? completedStatus(job) : job.status
  return (
    <div role="status" aria-live="polite" className="space-y-1 text-xs">
      <div className="flex items-center gap-2 font-medium">
        {pending && (
          <LoadingIcon
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
        )}
        <span>{t("status", { tool: t(toolLabels[job.tool]), status })}</span>
      </div>
      {pending && <p className="text-muted-foreground">{t("automaticNotification")}</p>}
      {failure && <p className="break-words text-muted-foreground">{failure.message}</p>}
    </div>
  )
}

export function AssistantNumericalJobs({
  jobs = [],
}: {
  jobs?: readonly NumericalJobStatus[] | undefined
}) {
  const t = useTranslations("app.assistant.numericalJobs")
  if (!jobs.length) return null
  return (
    <section
      aria-label={t("title")}
      className="max-h-48 shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2"
    >
      {jobs.map((job) => (
        <AssistantNumericalJob key={job.jobId} job={job} />
      ))}
    </section>
  )
}
