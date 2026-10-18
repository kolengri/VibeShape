import type { UiPluginManifest } from "./ui-plugin-package"

export const sampleUiPlugin: UiPluginManifest = {
  schemaVersion: 1,
  profile: "declarative-ui",
  id: "org.vibeshape.examples.print-fit",
  version: "1.0.0",
  name: "Print fit calculator",
  description:
    "Calculate a bore diameter from a part diameter and radial clearance. This calculator does not read or change your project.",
  license: "CC0-1.0",
  capabilities: ["ui.command", "ui.panel"],
  commands: [{ id: "calculate-fit", label: "Calculate print fit", panelId: "fit" }],
  panels: [
    {
      id: "fit",
      title: "Print fit calculator",
      description:
        "Bore diameter = part diameter + twice the radial clearance. Verify the fit with a test print.",
      inputs: [
        {
          id: "diameter",
          label: "Part diameter",
          unit: "mm",
          min: 0.01,
          max: 10000,
          default: 10,
          step: 0.1,
        },
        {
          id: "clearance",
          label: "Radial clearance",
          unit: "mm",
          min: -10,
          max: 10,
          default: 0.2,
          step: 0.01,
        },
      ],
      outputs: [
        {
          id: "bore",
          label: "Bore diameter",
          unit: "mm",
          constant: 0,
          terms: [
            { inputId: "diameter", coefficient: 1 },
            { inputId: "clearance", coefficient: 2 },
          ],
        },
      ],
    },
  ],
}

export function downloadSampleUiPlugin() {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(sampleUiPlugin, null, 2)}\n`], { type: "application/json" }),
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "print-fit.vsui.json"
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
