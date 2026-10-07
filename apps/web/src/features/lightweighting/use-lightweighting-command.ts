import type { PartId } from "@vibeshape/domain/identifiers"
import { useState } from "react"
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
  const [dialog, setDialog] = useState({ open: false, initialPartId: "" })
  return {
    ...dialog,
    blocked: getProjectActiveWorkBlock() !== null || assemblyActive,
    show() {
      const selected = selectedPlacementPart(
        availableLightweightingParts(controller),
        selectedPartId,
        selectedBody ?? selection,
      )
      setDialog({ open: true, initialPartId: selected?.part.id ?? "" })
    },
    setOpen(open: boolean) {
      setDialog((current) => ({ ...current, open }))
    },
  }
}
