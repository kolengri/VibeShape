import { useTranslations } from "@vibeshape/i18n"
import { useEffect, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { lightweightingSource } from "./lightweighting-model"
import { prepareExactPrintSnapshot } from "./prepare-exact-print-snapshot"
import {
  initialPrintOptimizationFields,
  type PrintOptimizationFields,
  preparePrintFields,
  samePrintOptimizationSource,
} from "./print-optimization-model"
import { useLightweightingTask } from "./use-lightweighting-task"

export type PrintOptimizationTaskOptions = {
  controller: DocumentControllerState
  initialPartId?: string
  blocked: boolean
  onClose: () => void
  onApplyingChange?: (applying: boolean) => void
  onApplied?: () => void
}

export function usePrintOptimizationTask({
  controller,
  initialPartId = "",
  blocked,
  onClose,
  onApplied,
  onApplyingChange,
}: PrintOptimizationTaskOptions) {
  const t = useTranslations("app.printOptimization")
  const l = useTranslations("app.lightweighting")
  const [applying, setApplying] = useState(false)
  const [fields, setFields] = useState(() =>
    initialPrintOptimizationFields(lightweightingSource(controller, initialPartId)),
  )
  const unavailable =
    blocked ||
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    controller.report?.mode !== "read-write"
  const state = useLightweightingTask({
    controller,
    initialPartId,
    disabled: unavailable && !applying,
    inputBuilder: (source, material) => {
      const prepared = preparePrintFields(source, material, fields)
      if (!prepared) return null
      const input = { ...prepared.input, includeVoxelGrid: true }
      return {
        ...prepared,
        input,
        prepareSnapshot: (result, options) =>
          prepareExactPrintSnapshot({
            ...options,
            source,
            input,
            result,
            preserveFaceIds: [...fields.preserveFaces],
            frame: prepared.frame,
            toPrintMesh: prepared.toPrintMesh,
          }),
      }
    },
    onApplied: onApplied ?? onClose,
    onApplyingChange: (value) => {
      setApplying(value)
      onApplyingChange?.(value)
    },
    copy: {
      initialCaseName: l("defaultCaseName", { index: 1 }),
      failed: l("failed"),
      stale: l("stale"),
      saveFailed: l("saveFailed"),
      solverFailed: (code) => l("solverFailed", { code }),
      featureLabel: (part) => t("featureLabel", { part }),
    },
  })
  useEffect(() => {
    if (
      state.source &&
      fields.captured &&
      !samePrintOptimizationSource(state.source, fields.captured)
    ) {
      state.cancel()
      setFields(initialPrintOptimizationFields(state.source))
    }
  }, [state.source, fields.captured, state.cancel])
  const change = (next: PrintOptimizationFields) => {
    if (applying) return
    state.cancel()
    setFields(next)
  }
  const sourceState = {
    ...state,
    choosePart: (id: string) => {
      state.choosePart(id)
      setFields(initialPrintOptimizationFields(lightweightingSource(controller, id)))
    },
  }
  return { state, fields, applying, unavailable, change, sourceState }
}
