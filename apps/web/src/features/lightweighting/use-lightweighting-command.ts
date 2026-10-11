import type { PartId } from "@vibeshape/domain/identifiers"
import { useCallback, useState } from "react"
import {
  type DocumentControllerState,
  getProjectActiveWorkBlock,
} from "../../document/document-controller"
import { selectedPlacementPart } from "../part-design/authored-part-selection"
import { availableLightweightingParts } from "./lightweighting-model"

export function useLightweightingCommand({
  controller,
  selectedPartId,
  selectedBody,
  selection = null,
  assemblyActive = false,
}: {
  controller: DocumentControllerState
  selectedPartId: PartId | null
  selectedBody: { featureId: string; outputRole?: string } | null
  selection?: { featureId: string; outputRole?: string } | null
  assemblyActive?: boolean
}) {
  const [dialog, setDialog] = useState({
    open: false,
    initialPartId: "",
    mode: "structural" as "structural" | "quick" | "generative",
  })
  const setOpen = useCallback((open: boolean) => {
    setDialog((current) => ({ ...current, open }))
  }, [])
  return {
    ...dialog,
    blocked: getProjectActiveWorkBlock() !== null || assemblyActive,
    show(mode: "structural" | "quick" | "generative" = "structural") {
      const selected = selectedPlacementPart(
        availableLightweightingParts(controller),
        selectedPartId,
        selectedBody ?? selection,
      )
      setDialog({ open: true, initialPartId: selected?.part.id ?? "", mode })
    },
    setOpen,
  }
}
