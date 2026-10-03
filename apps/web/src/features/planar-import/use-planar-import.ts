import { useEffect, useRef, useState } from "react"
import { commitAuthoredTransaction } from "../../document/document-controller"
import { type ImportDocumentContext, importContextIsStale } from "../import/import-model"
import {
  createPlanarImportTransaction,
  PlanarFileError,
  type PlanarSource,
  type PlanarUnit,
  planarFormat,
  readPlanarSource,
} from "./import-model"
import { inspectPlanarSource, PlanarParserError } from "./parser-client"
import type { PlanarInspection } from "./parser-contract"

export type PlanarImportCopy = {
  format: string
  budget: string
  filename: string
  units: string
  inspectFailed: string
  timeout: string
  saveFailed: string
  stale: string
  diagnostic: (message: string, source?: string) => string
  sketchLabel: (filename: string) => string
}
type Ready = { source: PlanarSource; inspection: PlanarInspection; context: ImportDocumentContext }
function errorMessage(error: unknown, copy: PlanarImportCopy) {
  if (error instanceof PlanarFileError) return copy[error.code]
  if (error instanceof PlanarParserError && error.code === "timeout") return copy.timeout
  return copy.inspectFailed
}
export function usePlanarImport({
  context,
  disabled,
  copy,
  onImported,
  onApplyingChange,
}: {
  context: ImportDocumentContext
  disabled: boolean
  copy: PlanarImportCopy
  onImported: () => void
  onApplyingChange: (value: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [unit, setUnit] = useState<PlanarUnit | null>(null)
  const [plane, setPlane] = useState<"xy" | "xz" | "yz">("xy")
  const [ready, setReady] = useState<Ready | null>(null)
  const [activity, setActivity] = useState<"idle" | "inspecting" | "applying">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const lifecycle = useRef({
    mounted: false,
    locked: false,
    generation: 0,
    abort: null as AbortController | null,
  })
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    return () => {
      state.mounted = false
      state.generation++
      state.abort?.abort()
    }
  }, [])
  const clear = () => {
    setReady(null)
    setMessage(null)
  }
  const stale = importContextIsStale(context, ready?.context)
  const format = file ? planarFormat(file.name) : null
  const validUnits =
    unit !== null && (format === "svg" ? unit !== "declared" : format === "dxf" && unit !== "px")
  const canInspect = !disabled && activity === "idle" && file !== null && validUnits
  const run = async (
    activity: "inspecting" | "applying",
    action: (publish: (update: () => void) => void) => Promise<void>,
    failure: (error: unknown) => string,
  ) => {
    const state = lifecycle.current
    if (state.locked || disabled) return
    state.locked = true
    const generation = ++state.generation
    const publish = (update: () => void) => {
      if (state.mounted && generation === state.generation) update()
    }
    setActivity(activity)
    setMessage(null)
    onApplyingChange(activity === "applying")
    try {
      await action(publish)
    } catch (error) {
      publish(() => setMessage(failure(error)))
    } finally {
      state.locked = false
      publish(() => {
        onApplyingChange(false)
        setActivity("idle")
      })
    }
  }
  const inspect = async () => {
    if (!file || !canInspect || lifecycle.current.locked) return
    const abort = new AbortController()
    lifecycle.current.abort = abort
    await run(
      "inspecting",
      async (publish) => {
        publish(clear)
        const source = await readPlanarSource(file, unit)
        const inspection = await inspectPlanarSource(source.input, abort.signal)
        publish(() => {
          if (inspection.ok) setReady({ source, inspection, context })
          else
            setMessage(copy.diagnostic(inspection.diagnostic.message, inspection.diagnostic.source))
        })
      },
      (error) => errorMessage(error, copy),
    )
  }
  const canApply = !disabled && activity === "idle" && ready !== null && !stale
  const apply = async () => {
    if (!ready || !canApply) return
    await run(
      "applying",
      async (publish) => {
        const transaction = createPlanarImportTransaction(
          ready.context,
          ready.source,
          ready.inspection,
          plane,
          copy.sketchLabel(ready.source.filename.slice(0, 90)),
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
    plane,
    format,
    ready,
    activity,
    canInspect,
    canApply,
    stale,
    message: stale ? copy.stale : message,
    chooseFile: (next: File | null) => {
      clear()
      setFile(next)
      setUnit(next && planarFormat(next.name) === "dxf" ? "declared" : null)
    },
    chooseUnit: (next: PlanarUnit) => {
      clear()
      setUnit(next)
    },
    choosePlane: setPlane,
    inspect,
    apply,
  }
}
export type PlanarImportState = ReturnType<typeof usePlanarImport>
