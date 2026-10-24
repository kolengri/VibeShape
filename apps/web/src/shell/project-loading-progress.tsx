import { useTranslations } from "@vibeshape/i18n"
import { TaskProgress } from "../components/task-progress"

export function ProjectLoadingProgress({
  phase = "reading",
}: {
  phase?: "reading" | "refining" | "viewport"
}) {
  const t = useTranslations("app.shell.projectLoading")
  return (
    <div
      data-project-loading={phase}
      className="pointer-events-none absolute left-[var(--workspace-chrome-left,0px)] right-[var(--workspace-chrome-right,0px)] top-0 bottom-[var(--workspace-chrome-bottom,0px)] z-40 flex items-end justify-center p-6"
    >
      <TaskProgress status={t(phase)} label={t("progress")} />
    </div>
  )
}
