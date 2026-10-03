import type { AssemblyExportSettings, GeometryExportFormat } from "@vibeshape/protocol"
import { useEffect, useRef, useState } from "react"
import { exportActiveAssembly } from "../../document/document-controller"
import { downloadDocumentExport } from "../../document/document-export"

export function useAssemblyExport() {
  const [pending, setPending] = useState<GeometryExportFormat | null>(null)
  const [failed, setFailed] = useState(false)
  const [downloaded, setDownloaded] = useState<GeometryExportFormat | null>(null)
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current?.abort()
    }
  }, [])
  const run = async (settings: AssemblyExportSettings) => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort
    setPending(settings.format)
    setFailed(false)
    setDownloaded(null)
    try {
      const result = await exportActiveAssembly(settings, abort.signal)
      if (!mounted.current || abort.signal.aborted) return
      if (!result.ok) {
        setFailed(true)
        return
      }
      downloadDocumentExport(result)
      setDownloaded(result.format)
    } catch {
      if (mounted.current && !abort.signal.aborted) setFailed(true)
    } finally {
      operation.current = null
      if (mounted.current) setPending(null)
    }
  }
  return { pending, failed, downloaded, run }
}
