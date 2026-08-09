import { VSHAPE_MAX_ARCHIVE_BYTES, VSHAPE_MEDIA_TYPE } from "@vibeshape/formats/vshape"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { type ChangeEvent, useRef, useState } from "react"
import {
  activateImportedProject,
  type DocumentControllerState,
  exportActiveProjectBackup,
  importProjectBackup,
} from "./document-controller"
import { downloadProjectBackup } from "./document-project-file"

type ProjectActivity = "idle" | "backing-up" | "opening"

type ProjectFeedback = Readonly<{
  key: string
  kind: "error" | "status"
}>

function ProjectFileCard({
  action,
  description,
  disabled,
  loading,
  onAction,
  title,
}: {
  action: string
  description: string
  disabled: boolean
  loading: boolean
  onAction: () => unknown
  title: string
}) {
  return (
    <section className="grid content-start gap-3 rounded-md border bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button type="button" disabled={disabled} isLoading={loading} onClick={onAction}>
        {action}
      </Button>
    </section>
  )
}

function feedbackForImport(code: string) {
  if (code === "document-already-exists") return "errors.alreadyExists"
  if (code === "resource-limit") return "errors.tooLarge"
  return "errors.openFailed"
}

export function DocumentProjectDialog({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.projectFile")
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activity, setActivity] = useState<ProjectActivity>("idle")
  const [feedback, setFeedback] = useState<ProjectFeedback | null>(null)
  const disabled = controller.status !== "ready" || activity !== "idle"

  const backup = async () => {
    setActivity("backing-up")
    setFeedback({ key: "status.backingUp", kind: "status" })
    try {
      const result = await exportActiveProjectBackup()
      if (!result.ok) {
        setFeedback({ key: "errors.backupFailed", kind: "error" })
        return
      }
      downloadProjectBackup(result)
      setFeedback({ key: "status.downloaded", kind: "status" })
      setOpen(false)
    } finally {
      setActivity("idle")
    }
  }

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setActivity("opening")
    setFeedback({ key: "status.opening", kind: "status" })
    try {
      if (file.size > VSHAPE_MAX_ARCHIVE_BYTES) {
        setFeedback({ key: "errors.tooLarge", kind: "error" })
        return
      }
      const imported = await importProjectBackup(new Uint8Array(await file.arrayBuffer()))
      if (!imported.ok) {
        setFeedback({ key: feedbackForImport(imported.diagnostic.code), kind: "error" })
        return
      }
      setFeedback({ key: "status.switching", kind: "status" })
      await activateImportedProject(imported.documentId)
    } catch {
      setFeedback({ key: "errors.openFailed", kind: "error" })
    } finally {
      input.value = ""
      setActivity("idle")
    }
  }

  return (
    <>
      {feedback?.kind === "status" ? (
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {t(feedback.key)}
        </span>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("closeLabel")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProjectFileCard
              action={t("backup.action")}
              description={t("backup.description")}
              disabled={disabled}
              loading={activity === "backing-up"}
              onAction={backup}
              title={t("backup.title")}
            />
            <ProjectFileCard
              action={t("open.action")}
              description={t("open.description")}
              disabled={disabled}
              loading={activity === "opening"}
              onAction={() => inputRef.current?.click()}
              title={t("open.title")}
            />
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept={`.vshape,${VSHAPE_MEDIA_TYPE}`}
              aria-label={t("open.inputLabel")}
              onChange={openFile}
            />
          </div>
          {feedback?.kind === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {t(feedback.key)}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={activity !== "idle"}>
                {t("close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
