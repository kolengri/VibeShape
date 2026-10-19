import { VSHAPE_MAX_ARCHIVE_BYTES, VSHAPE_MEDIA_TYPE } from "@vibeshape/formats/vshape"
import { useTranslations } from "@vibeshape/i18n"
import type { LocalProjectSummary } from "@vibeshape/persistence"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { FolderOpen } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import { useCallback, useEffect, useRef, useState } from "react"
import { type DropEvent, type FileRejection, useDropzone } from "react-dropzone"
import { ProjectLibrary, type ProjectLibraryState } from "../projects/project-library"
import { ProjectLibraryPageLayout } from "../projects/project-library-page-layout"
import { useReportApplicationError } from "../shell/application-notices"
import {
  activateLocalProject,
  createNewLocalProject,
  type DocumentControllerState,
  duplicateLocalProject,
  getProjectActionBlock,
  importProjectBackup,
  listLocalProjects,
  showProjectLibrary,
} from "./document-controller"
import { formatProjectCopyName } from "./versioned-project-file"

type ProjectActivity =
  | "idle"
  | "creating"
  | "deleting"
  | "duplicating"
  | "opening-file"
  | "switching"

type ProjectFeedback = Readonly<{
  key: string
  kind: "error" | "status"
}>

function ProjectFileDropzone({
  disabled,
  loading,
  onImport,
  onRejected,
}: {
  disabled: boolean
  loading: boolean
  onImport: (files: readonly File[], input?: HTMLInputElement) => void
  onRejected: (tooLarge: boolean) => void
}) {
  const t = useTranslations("app.projectFile")
  const onDrop = (acceptedFiles: File[], fileRejections: FileRejection[], event: DropEvent) => {
    if (fileRejections.length > 0) {
      onRejected(fileRejections.some(({ file }) => file.size > VSHAPE_MAX_ARCHIVE_BYTES))
      return
    }
    const input = event.target instanceof HTMLInputElement ? event.target : undefined
    onImport(acceptedFiles, input)
  }
  const { getInputProps, getRootProps, isDragActive } = useDropzone({
    accept: { [VSHAPE_MEDIA_TYPE]: [".vshape"] },
    disabled,
    maxFiles: 1,
    maxSize: VSHAPE_MAX_ARCHIVE_BYTES,
    multiple: false,
    onDrop,
  })

  return (
    <section
      className="grid content-start gap-3 rounded-md border bg-card p-4"
      aria-labelledby="open-project-file-title"
    >
      <div className="grid gap-1">
        <h3 id="open-project-file-title" className="text-sm font-medium">
          {t("open.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("open.dropDescription")}</p>
      </div>
      <div
        {...getRootProps({
          className: cn(
            "grid min-h-24 cursor-pointer place-items-center rounded-sm border border-dashed p-4 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDragActive ? "border-primary bg-primary/5" : "border-border",
            disabled && "opacity-50",
          ),
          "aria-disabled": disabled,
          "aria-label": t("open.dropTitle"),
          "aria-busy": loading,
          role: "button",
          tabIndex: disabled ? -1 : 0,
        })}
      >
        <input {...getInputProps({ "aria-label": t("open.inputLabel") })} />
        <div className="grid justify-items-center gap-2">
          <FolderOpen aria-hidden="true" className="size-5 text-muted-foreground" />
          <p>{t("open.dropTitle")}</p>
        </div>
      </div>
    </section>
  )
}

function feedbackForImport(code: string) {
  if (code === "document-already-exists") return "errors.alreadyExists"
  if (code === "resource-limit") return "errors.tooLarge"
  if (code === "checkpoint-read-only") return "errors.checkpoint"
  if (code === "project-action-blocked") return "errors.activeWork"
  return "errors.openFailed"
}

function feedbackForFiles(files: readonly File[]) {
  if (files.length !== 1) return "open.invalidFile"
  const file = files[0]
  if (!file?.name.toLowerCase().endsWith(".vshape")) return "open.invalidFile"
  if (file.size > VSHAPE_MAX_ARCHIVE_BYTES) return "errors.tooLarge"
  return null
}

function resetProjectFileInput(input: HTMLInputElement | undefined) {
  if (input) input.value = ""
}

function ProjectFileFeedback({ feedback }: { feedback: ProjectFeedback | null }) {
  const t = useTranslations("app.projectFile")
  const centralized = useReportApplicationError(feedback?.kind === "error" ? t(feedback.key) : null)
  if (!feedback || (feedback.kind === "error" && centralized)) return null
  return (
    <p
      className={
        feedback.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
      }
      role={feedback.kind === "error" ? "alert" : "status"}
      aria-live={feedback.kind === "status" ? "polite" : undefined}
    >
      {t(feedback.key)}
    </p>
  )
}

function ProjectGuardFeedback({ blockedReason }: { blockedReason: string | null }) {
  const t = useTranslations("app.projectFile")
  if (!blockedReason) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t(blockedReason === "save-error" ? "errors.saveError" : "errors.activeWork")}
    </p>
  )
}

function useProjectFileTarget(controller: DocumentControllerState, blockedReason: string | null) {
  const latest = useRef({ controller, blockedReason })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    latest.current = { controller, blockedReason }
  }, [controller, blockedReason])
  const target = () => {
    if (latest.current.controller.status === "library") return { kind: "library" } as const
    const snapshot = latest.current.controller.report?.snapshot
    return snapshot ? { documentId: snapshot.id, revision: snapshot.revision } : null
  }
  const stillCurrent = (expected: ReturnType<typeof target>) => {
    const current = target()
    if (!mounted.current || !expected || !current || latest.current.blockedReason) return false
    if ("kind" in expected) return "kind" in current
    if ("kind" in current || getProjectActionBlock()) return false
    return current.documentId === expected.documentId && current.revision === expected.revision
  }
  return { target, stillCurrent }
}

function projectLibraryIsAvailable(status: DocumentControllerState["status"]) {
  return status === "ready" || status === "library"
}

function useProjectLibrary(status: DocumentControllerState["status"]) {
  const [library, setLibrary] = useState<ProjectLibraryState>({ status: "loading", projects: [] })
  const listRequestRef = useRef(0)
  const recoveringRef = useRef(false)
  const loadProjects = useCallback(async () => {
    const request = listRequestRef.current + 1
    listRequestRef.current = request
    setLibrary((current) => ({ status: "loading", projects: current.projects }))
    const result = await listLocalProjects().catch(() => ({ ok: false as const }))
    if (listRequestRef.current !== request) return
    setLibrary(
      result.ok
        ? { status: "ready", projects: result.projects }
        : { status: "error", projects: [] },
    )
  }, [])

  const retryProjects = async () => {
    if (recoveringRef.current) return
    if (status !== "error") return loadProjects()
    recoveringRef.current = true
    const request = ++listRequestRef.current
    setLibrary({ status: "loading", projects: [] })
    const result = await showProjectLibrary().catch(() => ({ ok: false as const }))
    recoveringRef.current = false
    if (request !== listRequestRef.current) return
    if (!result.ok) {
      setLibrary({ status: "error", projects: [] })
      return
    }
    await loadProjects()
  }

  useEffect(() => {
    if (projectLibraryIsAvailable(status)) void loadProjects()
    else setLibrary({ status: status === "error" ? "error" : "loading", projects: [] })
    return () => {
      listRequestRef.current += 1
    }
  }, [status, loadProjects])
  return { library, loadProjects, retryProjects }
}

export function DocumentProjectPage({
  controller,
  blockedReason = null,
}: {
  controller: DocumentControllerState
  blockedReason?: string | null
}) {
  const t = useTranslations("app.projectFile")
  const { target, stillCurrent } = useProjectFileTarget(controller, blockedReason)
  const importInProgressRef = useRef(false)
  const [activity, setActivity] = useState<ProjectActivity>("idle")
  const [feedback, setFeedback] = useState<ProjectFeedback | null>(null)
  const { library, loadProjects, retryProjects } = useProjectLibrary(controller.status)
  const [switchingDocumentId, setSwitchingDocumentId] = useState<string | null>(null)
  const [duplicatingDocumentId, setDuplicatingDocumentId] = useState<string | null>(null)
  useReportActivity(activity !== "idle" || library.status === "loading")
  const available = projectLibraryIsAvailable(controller.status)
  const disabled = !available || blockedReason !== null || activity !== "idle"

  const importAndActivate = async (
    file: File,
    expected: NonNullable<ReturnType<typeof target>>,
  ) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!stillCurrent(expected)) {
      setFeedback({ key: "errors.activeWork", kind: "error" })
      return
    }
    const imported = await importProjectBackup(bytes, (name) => t("open.copyName", { name }))
    if (!imported.ok) {
      setFeedback({ key: feedbackForImport(imported.diagnostic.code), kind: "error" })
      return
    }
    if (!stillCurrent(expected)) {
      setFeedback({ key: "errors.activeWork", kind: "error" })
      return
    }
    setFeedback({ key: "status.switching", kind: "status" })
    const activated = await activateLocalProject(
      imported.documentId,
      "kind" in expected ? undefined : expected,
    )
    if (!activated.ok) setFeedback({ key: "errors.switchFailed", kind: "error" })
  }

  const importFiles = async (files: readonly File[], input?: HTMLInputElement) => {
    if (disabled || importInProgressRef.current) {
      resetProjectFileInput(input)
      return
    }
    const validationFeedback = feedbackForFiles(files)
    if (validationFeedback) {
      setFeedback({ key: validationFeedback, kind: "error" })
      resetProjectFileInput(input)
      return
    }
    const file = files[0]
    const expected = target()
    if (!file || !expected) return

    // State updates do not block a second event in the same render; claim the import synchronously.
    importInProgressRef.current = true
    setActivity("opening-file")
    setFeedback({ key: "status.opening", kind: "status" })
    try {
      await importAndActivate(file, expected)
    } catch {
      setFeedback({ key: "errors.openFailed", kind: "error" })
    } finally {
      resetProjectFileInput(input)
      importInProgressRef.current = false
      setActivity("idle")
    }
  }

  const createProject = async () => {
    setActivity("creating")
    setSwitchingDocumentId("new")
    setFeedback({ key: "status.creating", kind: "status" })
    try {
      const result = await createNewLocalProject()
      if (!result.ok) setFeedback({ key: "errors.newFailed", kind: "error" })
    } catch {
      setFeedback({ key: "errors.newFailed", kind: "error" })
    } finally {
      setSwitchingDocumentId(null)
      setActivity("idle")
    }
  }

  const openProject = async (documentId: string) => {
    setActivity("switching")
    setSwitchingDocumentId(documentId)
    setFeedback({ key: "status.switching", kind: "status" })
    try {
      const result = await activateLocalProject(documentId)
      if (!result.ok) setFeedback({ key: "errors.switchFailed", kind: "error" })
    } catch {
      setFeedback({ key: "errors.switchFailed", kind: "error" })
    } finally {
      setSwitchingDocumentId(null)
      setActivity("idle")
    }
  }

  const duplicateProject = async (project: LocalProjectSummary) => {
    setActivity("duplicating")
    setDuplicatingDocumentId(project.documentId)
    setFeedback({ key: "status.duplicating", kind: "status" })
    try {
      const copyName = formatProjectCopyName(project.name, (name) =>
        t("library.duplicate.copyName", { name }),
      )
      const result = await duplicateLocalProject(project.documentId, project.headRevision, copyName)
      if (!result.ok) {
        setFeedback({ key: "errors.duplicateFailed", kind: "error" })
        return
      }
      await loadProjects()
      setFeedback({ key: "status.duplicated", kind: "status" })
    } catch {
      setFeedback({ key: "errors.duplicateFailed", kind: "error" })
    } finally {
      setDuplicatingDocumentId(null)
      setActivity("idle")
    }
  }

  const rejectFiles = (tooLarge: boolean) => {
    if (disabled || importInProgressRef.current) return
    setFeedback({ key: tooLarge ? "errors.tooLarge" : "open.invalidFile", kind: "error" })
  }
  const changeDeletePending = (pending: boolean) => setActivity(pending ? "deleting" : "idle")

  return (
    <ProjectLibraryPageLayout
      controller={controller}
      busy={activity !== "idle"}
      title={t("title")}
      description={t("library.description")}
    >
      <ProjectFileFeedback feedback={feedback?.kind === "status" ? feedback : null} />
      <ProjectGuardFeedback blockedReason={blockedReason} />
      <ProjectFileFeedback feedback={feedback?.kind === "error" ? feedback : null} />
      <ProjectFileDropzone
        disabled={disabled || importInProgressRef.current}
        loading={activity === "opening-file"}
        onImport={(files, input) => void importFiles(files, input)}
        onRejected={rejectFiles}
      />
      <ProjectLibrary
        activeDocumentId={controller.report?.snapshot.id}
        controller={controller}
        disabled={disabled}
        duplicatingDocumentId={duplicatingDocumentId}
        library={library}
        onCreate={createProject}
        onDeleted={loadProjects}
        onDuplicate={duplicateProject}
        onOpen={openProject}
        onPendingDeleteChange={changeDeletePending}
        onRenamed={() => void loadProjects()}
        onRetry={retryProjects}
        switchingDocumentId={switchingDocumentId}
      />
    </ProjectLibraryPageLayout>
  )
}
