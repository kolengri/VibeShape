import { useTranslations } from "@vibeshape/i18n"
import { useBlockingActivity } from "@vibeshape/ui/components/activity"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { LightweightingViewportInteraction } from "./lightweighting-dialog"
import type { LightweightingSource } from "./lightweighting-model"
import { faceTriangleIndices } from "./lightweighting-surface-selection"
import {
  type PrintOptimizationFields,
  samePrintOptimizationSource,
} from "./print-optimization-model"

function sourceOwnsFace(source: LightweightingSource, selection: ViewerSelection) {
  return (
    selection.featureId === source.featureId &&
    (selection.outputRole ?? "result") === source.outputRole &&
    faceTriangleIndices(source, [selection.faceId]).length > 0
  )
}
function capturedFields(source: LightweightingSource, fields: PrintOptimizationFields) {
  if (samePrintOptimizationSource(source, fields.captured)) return fields
  return { ...fields, captured: source, bedFace: null, preserveFaces: [] }
}

export function usePrintOptimizationFaces({
  source,
  fields,
  disabled,
  onChange,
  onInteractionChange,
}: {
  source: LightweightingSource | null
  fields: PrintOptimizationFields
  disabled: boolean
  onChange: (fields: PrintOptimizationFields) => void
  onInteractionChange: (interaction: LightweightingViewportInteraction | null) => void
}) {
  const t = useTranslations("app.printOptimization")
  const blocking = useBlockingActivity() !== null
  const [picking, setPicking] = useState<"bed" | "preserve" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const current = samePrintOptimizationSource(source, fields.captured)
  const capturedSource = current ? fields.captured : null
  const latest = useRef({ source, fields, disabled, onChange, picking, wrongBody: t("wrongBody") })
  useLayoutEffect(() => {
    latest.current = { source, fields, disabled, onChange, picking, wrongBody: t("wrongBody") }
  })
  useEffect(() => {
    if (!current || disabled) setPicking(null)
  }, [current, disabled])
  useEffect(() => {
    if (!picking || blocking) return
    const cancelPicking = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setPicking(null)
    }
    window.addEventListener("keydown", cancelPicking, true)
    return () => window.removeEventListener("keydown", cancelPicking, true)
  }, [picking, blocking])
  const onFacePick = useCallback((selection: ViewerSelection | null) => {
    const captured = latest.current
    const { source, fields, picking, disabled, onChange } = captured
    if (!source || !selection || !picking || disabled) return false
    if (!sourceOwnsFace(source, selection)) {
      setMessage(captured.wrongBody)
      return true
    }
    const next = capturedFields(source, fields)
    setMessage(null)
    if (picking === "bed") {
      onChange({ ...next, bedFace: selection.faceId })
      setPicking(null)
    } else {
      const faces = next.preserveFaces
      onChange({
        ...next,
        preserveFaces: faces.includes(selection.faceId)
          ? faces.filter((face) => face !== selection.faceId)
          : [...faces, selection.faceId],
      })
    }
    return true
  }, [])
  const interaction = useMemo<LightweightingViewportInteraction | null>(
    () =>
      capturedSource
        ? {
            source: capturedSource,
            onFacePick,
            picking: !disabled && picking !== null,
            overlays: current
              ? [
                  {
                    kind: "face",
                    mesh: {
                      ...capturedSource.body.mesh,
                      featureId: capturedSource.featureId,
                      outputRole: capturedSource.outputRole,
                    },
                    faceIds: fields.bedFace === null ? [] : [fields.bedFace],
                    role: "support",
                  },
                  {
                    kind: "face",
                    mesh: {
                      ...capturedSource.body.mesh,
                      featureId: capturedSource.featureId,
                      outputRole: capturedSource.outputRole,
                    },
                    faceIds: fields.preserveFaces,
                    role: "preserve",
                  },
                ]
              : [],
          }
        : null,
    [capturedSource, onFacePick, current, fields.bedFace, fields.preserveFaces, disabled, picking],
  )
  useEffect(() => {
    onInteractionChange(interaction)
    return () => onInteractionChange(null)
  }, [interaction, onInteractionChange])
  return {
    picking,
    message,
    pick: (target: "bed" | "preserve") => {
      setMessage(null)
      setPicking((previous) => (previous === target ? null : target))
    },
  }
}
