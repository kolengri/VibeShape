import { meshImportInspectionSchema, sourceImportInspectionSchema } from "@vibeshape/protocol"
import { useEffect, useRef, useState } from "react"
import { ZodError } from "zod"
import {
  commitAuthoredTransaction,
  inspectGeometrySource,
  inspectTriangleMeshSource,
} from "../../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"
import {
  createImportTransaction,
  hasImportSourceUnitIntent,
  type ImportDocumentContext,
  ImportFileError,
  type ImportSourceUnit,
  importContextIsStale,
  importFormat,
  type PreparedImportSource,
  readImportSource,
} from "./import-model"

export type ImportTaskMessages = {
  invalidFormat: string
  invalidBudget: string
  invalidFilename: string
  invalidUnits: string
  inspectFailed: string
  saveFailed: string
  staleRevision: string
  featureLabel: (filename: string) => string
}
export type ReadyImport = {
  prepared: PreparedImportSource
  inspection:
    | ReturnType<typeof sourceImportInspectionSchema.parse>
    | ReturnType<typeof meshImportInspectionSchema.parse>
  context: ImportDocumentContext
}
type Activity = "idle" | "inspecting" | "applying"
function inspectionError(error: unknown, copy: ImportTaskMessages) {
  if (error instanceof ImportFileError)
    return {
      format: copy.invalidFormat,
      budget: copy.invalidBudget,
      filename: copy.invalidFilename,
      units: copy.invalidUnits,
    }[error.code]
  if (error instanceof ZodError) return copy.inspectFailed
  return error instanceof Error && error.message ? error.message : copy.inspectFailed
}
async function inspectPreparedSource(prepared: PreparedImportSource) {
  if (prepared.representation === "triangle-mesh")
    return meshImportInspectionSchema.parse(await inspectTriangleMeshSource(prepared.input))
  return sourceImportInspectionSchema.parse(
    await inspectGeometrySource({
      source: prepared.source,
      bytes: prepared.bytes,
      mesh: PRODUCT_MESH_POLICY,
    }),
  )
}
export function useImportTask({
  context,
  disabled,
  copy,
  onImported,
  onApplyingChange,
}: {
  context: ImportDocumentContext
  disabled: boolean
  copy: ImportTaskMessages
  onImported: () => void
  onApplyingChange: (applying: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [unit, setUnit] = useState<ImportSourceUnit | null>(null)
  const [ready, setReady] = useState<ReadyImport | null>(null)
  const [activity, setActivity] = useState<Activity>("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const lock = useRef(false),
    active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const clear = () => {
    setReady(null)
    setPreviewReady(false)
    setMessage(null)
  }
  const stale = importContextIsStale(context, ready?.context)
  const publish = (update: () => void) => {
    if (active.current) update()
  }
  const run = async (
    activity: Exclude<Activity, "idle">,
    action: () => Promise<void>,
    errorMessage: (error: unknown) => string,
  ) => {
    if (lock.current || disabled) return
    lock.current = true
    setActivity(activity)
    onApplyingChange(activity === "applying")
    try {
      await action()
    } catch (error) {
      publish(() => setMessage(errorMessage(error)))
    } finally {
      lock.current = false
      onApplyingChange(false)
      publish(() => setActivity("idle"))
    }
  }
  const format = file ? importFormat(file.name) : null
  const requiresUnits = format !== "3mf"
  const actionEnabled = !disabled && activity === "idle"
  const canInspect = actionEnabled && hasImportSourceUnitIntent(file, unit)
  const inspect = async () => {
    if (!file || !canInspect) return
    await run(
      "inspecting",
      async () => {
        clear()
        const prepared = await readImportSource(file, requiresUnits ? unit : null)
        if (!active.current) return
        const inspection = await inspectPreparedSource(prepared)
        publish(() => setReady({ prepared, inspection, context }))
      },
      (error) => inspectionError(error, copy),
    )
  }
  const apply = async () => {
    if (!ready || !previewReady) return
    if (stale) {
      setMessage(copy.staleRevision)
      return
    }
    await run(
      "applying",
      async () => {
        setMessage(null)
        const transaction = createImportTransaction(
          ready.context,
          ready.prepared,
          ready.inspection,
          copy.featureLabel(ready.prepared.filename),
        )
        const result = await commitAuthoredTransaction(ready.context.revision, transaction)
        publish(() => {
          if (result.ok) onImported()
          else setMessage(result.diagnostic.message)
        })
      },
      () => copy.saveFailed,
    )
  }
  return {
    file,
    unit,
    format,
    requiresUnits,
    ready,
    activity,
    message: stale ? copy.staleRevision : message,
    stale,
    previewReady,
    canInspect,
    canApply: actionEnabled && ready !== null && previewReady && !stale,
    setPreviewReady,
    chooseFile: (next: File | null) => {
      clear()
      setFile(next)
    },
    chooseUnit: (next: ImportSourceUnit) => {
      clear()
      setUnit(next)
    },
    inspect,
    apply,
  }
}

export type ImportTaskState = ReturnType<typeof useImportTask>
