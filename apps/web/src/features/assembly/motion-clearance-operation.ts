import { printFitClearance } from "@vibeshape/domain"
import {
  getDocumentControllerState,
  previewAssemblyChanges,
} from "../../document/document-controller"
import {
  createMotionClearanceInspector,
  type MotionClearanceCapture,
} from "./assembly-motion-clearance"

export function captureMotionClearance(): MotionClearanceCapture | null {
  const state = getDocumentControllerState()
  const snapshot = state.authoredSnapshot
  if (
    state.status !== "ready" ||
    !snapshot ||
    snapshot.schemaVersion < 4 ||
    !("assembly" in snapshot)
  )
    return null
  return {
    documentId: snapshot.id,
    revision: snapshot.revision,
    assembly: snapshot.assembly,
    defaultMinimumGap: printFitClearance(snapshot.variables) ?? 0.2,
  }
}
/** Root MCP integration calls this same bounded operation with its authenticated actor and signal. */
export const inspectMotionClearance = createMotionClearanceInspector({
  capture: captureMotionClearance,
  preview: (changes, revision, interferencePairs, signal) =>
    previewAssemblyChanges(changes, revision, [], signal, { interferencePairs }),
})
