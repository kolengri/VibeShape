import { analyzePrintReadiness, type PrintReadinessResult } from "@vibeshape/print-analysis"
import type { PrintPreparationResult } from "@vibeshape/protocol"
import { useEffect, useRef, useState } from "react"

export function usePrintReadinessAnalysis(
  result: PrintPreparationResult,
  onResult: (result: PrintReadinessResult | null) => void,
  analyze = analyzePrintReadiness,
) {
  const [wall, setWall] = useState("0.8")
  const [angle, setAngle] = useState("45")
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<PrintReadinessResult | null>(null)
  const [error, setError] = useState(false)
  const attempt = useRef<AbortController | null>(null)
  useEffect(() => {
    setReport(null)
    onResult(null)
    setPending(false)
    setError(false)
    return () => {
      attempt.current?.abort()
      attempt.current = null
    }
  }, [result, onResult, wall, angle])
  const isActive = (abort: AbortController) => attempt.current === abort && !abort.signal.aborted
  const run = async () => {
    if (attempt.current) return
    const abort = new AbortController()
    attempt.current = abort
    setPending(true)
    setError(false)
    setReport(null)
    onResult(null)
    setProgress(0)
    try {
      const value = await analyze(
        result.meshes.slice(0, result.report.bodyCount),
        { minimumWallMm: Number(wall), overhangAngleDeg: Number(angle) },
        {
          signal: abort.signal,
          yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
          onProgress: (completed, total) => {
            if (isActive(abort)) setProgress(total > 0 ? completed / total : 0)
          },
        },
      )
      if (isActive(abort)) {
        setReport(value)
        onResult(value)
      }
    } catch {
      if (isActive(abort)) setError(true)
    } finally {
      if (attempt.current === abort) {
        attempt.current = null
        setPending(false)
      }
    }
  }
  const cancel = () => {
    attempt.current?.abort()
    attempt.current = null
    setPending(false)
    setReport(null)
    onResult(null)
  }
  return { wall, setWall, angle, setAngle, pending, progress, report, error, run, cancel }
}
