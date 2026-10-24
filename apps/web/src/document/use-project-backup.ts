import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { useRef, useState } from "react"
import { useReportApplicationError } from "../shell/application-notices"
import {
  type DocumentControllerState,
  exportActiveProjectBackup,
  getDocumentControllerState,
  getProjectActionBlock,
} from "./document-controller"
import { downloadProjectBackup } from "./document-project-file"
import type { ProjectBackupStage } from "./project-backup-contract"

function availableBackupSnapshot(controller: DocumentControllerState) {
  const snapshot = controller.report?.snapshot
  if (controller.status !== "ready" || !snapshot || getProjectActionBlock()) return null
  return snapshot
}

function backupSnapshotIsCurrent(
  snapshot: NonNullable<ReturnType<typeof availableBackupSnapshot>>,
) {
  const current = getDocumentControllerState().report?.snapshot
  return current?.id === snapshot.id && current.revision === snapshot.revision
}

export function useProjectBackup(controller: DocumentControllerState) {
  const t = useTranslations("app.projectFile")
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [stage, setStage] = useState<ProjectBackupStage>("reading-project")
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const centralized = useReportApplicationError(error, attempt)
  useReportActivity(pending)
  const save = async () => {
    if (lock.current) return
    setAttempt((value) => value + 1)
    setError(null)
    const snapshot = availableBackupSnapshot(controller)
    if (!snapshot) {
      setError(t("errors.activeWork"))
      return
    }
    lock.current = true
    setStage("reading-project")
    setPending(true)
    try {
      const result = await exportActiveProjectBackup(setStage)
      if (!result.ok) {
        setError(
          t(
            result.diagnostic.code === "project-action-blocked"
              ? "errors.activeWork"
              : "errors.backupFailed",
          ),
        )
        return
      }
      if (!backupSnapshotIsCurrent(snapshot)) {
        setError(t("errors.activeWork"))
        return
      }
      downloadProjectBackup(result)
    } catch {
      setError(t("errors.backupFailed"))
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return { save, pending, stage, error: centralized ? null : error }
}
