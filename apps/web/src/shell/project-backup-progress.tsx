import { useTranslations } from "@vibeshape/i18n"
import { createPortal } from "react-dom"
import { TaskProgress } from "../components/task-progress"
import type { ProjectBackupStage } from "../document/project-backup-contract"

export function ProjectBackupFeedback({
  pending,
  stage,
  error,
}: {
  pending: boolean
  stage: ProjectBackupStage
  error: string | null
}) {
  const t = useTranslations("app.projectFile.backup")
  return (
    <>
      {error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
      {pending &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-6">
            <TaskProgress status={t(`stages.${stage}`)} label={t("progress")} />
          </div>,
          document.body,
        )}
    </>
  )
}
