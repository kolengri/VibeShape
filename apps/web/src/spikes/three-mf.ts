import { type ThreeMfExportReport, writeThreeMf } from "@vibeshape/formats/three-mf"
import { createThreeMfInteroperabilityDocument } from "@vibeshape/test-models"
import { isError } from "is-what"

interface ThreeMfSpikeState {
  state: "running" | "passed" | "failed"
  bytes: number[] | null
  report: ThreeMfExportReport | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_THREE_MF_SPIKE__: ThreeMfSpikeState
  }
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The 3MF spike status element is missing.")
  return element
}

const statusElement = requireStatusElement()
const state: ThreeMfSpikeState = {
  state: "running",
  bytes: null,
  report: null,
  error: null,
}
window.__VIBESHAPE_THREE_MF_SPIKE__ = state

try {
  const result = writeThreeMf(createThreeMfInteroperabilityDocument())
  state.bytes = Array.from(result.bytes)
  state.report = result.report
  state.state = "passed"
  statusElement.dataset.state = "passed"
  statusElement.textContent = "Browser 3MF export completed."
} catch (error) {
  state.state = "failed"
  state.error = isError(error) ? error.message : String(error)
  statusElement.dataset.state = "failed"
  statusElement.textContent = state.error
}
