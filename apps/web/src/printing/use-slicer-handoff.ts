import { useTranslations } from "@vibeshape/i18n"
import type {
  NativeMeshFormat,
  NativeSlicerApi,
  NativeSlicerFailure,
  NativeSlicerTarget,
} from "@vibeshape/slicer-handoff/native"
import { useEffect, useRef, useState } from "react"
import type { ActiveDocumentExportResult } from "../document/document-controller"
import { createDocumentExportFilename, downloadDocumentExport } from "../document/document-export"
import {
  getNativeSlicer,
  readNativeSlicerPreference,
  saveNativeSlicerPreference,
} from "./native-slicer-client"

type Status = { key: string; failed: boolean; fileId?: string }
export type SlicerHandoffActions = {
  onBusyChange: (busy: boolean) => void
  onOpened: (message: string) => void
  prepareMesh: (format: NativeMeshFormat) => Promise<ActiveDocumentExportResult>
}
const failures: Record<NativeSlicerFailure["reason"], string> = {
  "invalid-request": "invalidRequest",
  forbidden: "unavailable",
  busy: "busy",
  capacity: "capacity",
  "not-installed": "notInstalled",
  "write-failed": "writeFailed",
  "launch-failed": "launchFailed",
  "choose-failed": "chooseFailed",
  unavailable: "unavailable",
}
function useSlicerApplications(native: NativeSlicerApi | undefined) {
  const [targets, setTargets] = useState<NativeSlicerTarget[]>([])
  const [loading, setLoading] = useState(Boolean(native))
  const [error, setError] = useState<Status | null>(null)
  useEffect(() => {
    if (!native) return
    let active = true
    void native
      .listApplications()
      .then((result) => {
        if (!active) return
        if (result.ok) setTargets(result.targets)
        else setError({ key: failures[result.reason], failed: true })
      })
      .catch(() => {
        if (active) setError({ key: "unavailable", failed: true })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [native])
  return { targets, setTargets, loading, error, clearError: () => setError(null) }
}
export function useSlicerHandoff({ onBusyChange, onOpened, prepareMesh }: SlicerHandoffActions) {
  const t = useTranslations("app.export.slicer.native")
  const common = useTranslations("app.export")
  const native = getNativeSlicer()
  const [preference, setPreference] = useState(readNativeSlicerPreference)
  const {
    targets,
    setTargets,
    loading,
    error: discoveryError,
    clearError,
  } = useSlicerApplications(native)
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const [status, setStatus] = useState<Status | null>(null)
  const selected = targets.find((target) => target.id === preference.slicerId) ?? targets[0]
  function choosePreference(slicerId: NativeSlicerTarget["id"] | null, format: NativeMeshFormat) {
    setPreference({ slicerId, format })
    saveNativeSlicerPreference(slicerId, format)
    setStatus(null)
    clearError()
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setPending(true)
    onBusyChange(true)
    try {
      await action()
    } catch {
      setStatus({ key: "unavailable", failed: true })
    } finally {
      locked.current = false
      setPending(false)
      onBusyChange(false)
    }
  }
  async function chooseApplication() {
    if (!native) return
    await run(async () => {
      const result = await native.chooseApplication()
      if (!result.ok) {
        setStatus({ key: failures[result.reason], failed: true })
        return
      }
      if (!result.target) return
      const target = result.target
      setTargets((current) => [...current.filter((item) => item.id !== target.id), target])
      choosePreference(target.id, preference.format)
    })
  }
  async function prepare() {
    try {
      const exported = await prepareMesh(preference.format)
      if (exported.ok && exported.format === preference.format) return exported
    } catch {
      /* The export failure has catalog copy below. */
    }
    setStatus({ key: "exportFailed", failed: true })
    return null
  }
  async function send() {
    await run(async () => {
      setStatus(null)
      const exported = await prepare()
      if (!exported) return
      if (!native) {
        downloadDocumentExport(exported)
        onOpened(
          common(preference.format === "3mf" ? "status.exportedThreeMf" : "status.exportedStl"),
        )
        return
      }
      if (!selected) {
        setStatus({ key: "notInstalled", failed: true })
        return
      }
      const result = await native.send({
        slicerId: selected.id,
        format: preference.format,
        filename: createDocumentExportFilename(exported.documentName, preference.format),
        file: exported.file,
      })
      if (result.ok) onOpened(t("started", { slicer: result.slicerName }))
      else
        setStatus({
          key: failures[result.reason],
          failed: true,
          ...(result.fileId ? { fileId: result.fileId } : {}),
        })
    })
  }
  async function reveal() {
    if (status?.fileId && native && !(await native.reveal(status.fileId)))
      setStatus({ key: "unavailable", failed: true })
  }
  const canSend = !loading && (native === undefined || selected !== undefined)
  const canReveal = status?.fileId !== undefined
  const targetLabel = selected ?? { name: t("targetLabel") }
  const formatLabels = { "3mf": "3MF", stl: "STL" }
  const sendLabel = native
    ? t("send", { slicer: targetLabel.name })
    : t("download", { format: formatLabels[preference.format] })
  return {
    native,
    canSend,
    canReveal,
    sendLabel,
    preference,
    targets,
    loading,
    pending,
    status: status ?? discoveryError,
    selected,
    choosePreference,
    chooseApplication,
    send,
    reveal,
  }
}
