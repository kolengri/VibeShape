import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { DocumentDisplayUnitsProvider } from "../document/document-display-units"
import { i18n } from "../i18n"
import { QuickTopologyMeasurement } from "./quick-topology-measurement"

afterEach(cleanup)

it("shows face area and analytical radius in document units above the axes", () => {
  render(
    <I18nProvider i18n={i18n}>
      <DocumentDisplayUnitsProvider displayUnits={{ length: "cm", angle: "deg" }}>
        <QuickTopologyMeasurement measurement={{ kind: "face", measure: 250, radius: 5 }} />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
  expect(screen.getByText("Face area")).toBeTruthy()
  expect(screen.getByText("2.5 cm²")).toBeTruthy()
  expect(screen.getByText("0.5 cm")).toBeTruthy()
  expect(screen.getByText("1 cm")).toBeTruthy()
  expect(screen.getByRole("status").classList.contains("bottom-24")).toBe(true)
})

it("does not invent a measurement when exact evidence is unavailable", () => {
  render(
    <I18nProvider i18n={i18n}>
      <QuickTopologyMeasurement measurement={undefined} />
    </I18nProvider>,
  )
  expect(screen.getByRole("status").textContent).toBe(
    "Exact topology measurements are unavailable for this body revision.",
  )
  expect(screen.queryByText("Radius")).toBeNull()
})
