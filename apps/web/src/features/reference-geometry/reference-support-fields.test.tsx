import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { bodyTopoRefSchema } from "@vibeshape/domain/body-topology-reference"
import { referenceAxisSchema, referencePlaneSchema } from "@vibeshape/domain/reference-frame"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { ReferenceAxisSelection, ReferencePlaneSelection } from "./reference-support-fields"

const reference = (kind: "face" | "edge", measure: number) =>
  bodyTopoRefSchema.parse({
    schemaVersion: 1,
    featureId: "0195b5ac-b250-7a2c-8c33-000000000001",
    outputRole: "result",
    kind,
    semanticRole: kind === "face" ? "box.face.top" : "box.edge.front",
    signature: {
      kind,
      geometryClass: kind === "face" ? "PLANE" : "LINE",
      measure,
      centroid: [0, 0, 5],
      bounds: { min: [0, 0, 0], max: [10, 10, 10] },
      direction: [0, 0, 1],
      directionMode: kind === "face" ? "oriented" : "axis",
      boundaryCount: kind === "face" ? 4 : 2,
      adjacentGeometryClasses: [],
    },
  })
afterEach(cleanup)
it.each(["plane", "axis"] as const)(
  "keeps an authored %s reference visible after its live signature changes",
  async (kind) => {
    const onChange = vi.fn()
    const oldReference = reference(kind === "plane" ? "face" : "edge", 10)
    const freshReference = reference(kind === "plane" ? "face" : "edge", 20)
    const selected =
      kind === "plane"
        ? referencePlaneSchema.parse({ kind: "planar-face", reference: oldReference })
        : referenceAxisSchema.parse({ kind: "linear-edge", reference: oldReference })
    const current =
      kind === "plane"
        ? referencePlaneSchema.parse({ kind: "planar-face", reference: freshReference })
        : referenceAxisSchema.parse({ kind: "linear-edge", reference: freshReference })
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        {kind === "plane" ? (
          <ReferencePlaneSelection
            value={referencePlaneSchema.parse(selected)}
            options={{
              planes: [
                {
                  key: "fresh",
                  label: "Current face",
                  support: referencePlaneSchema.parse(current),
                },
              ],
              axes: [],
            }}
            onChange={onChange}
          >
            Legacy
          </ReferencePlaneSelection>
        ) : (
          <ReferenceAxisSelection
            value={referenceAxisSchema.parse(selected)}
            options={{
              planes: [],
              axes: [
                {
                  key: "fresh",
                  label: "Current edge",
                  support: referenceAxisSchema.parse(current),
                },
              ],
            }}
            onChange={onChange}
          >
            Legacy
          </ReferenceAxisSelection>
        )}
      </I18nProvider>,
    )
    const source = screen.getByRole("combobox", { name: "Reference source" }) as HTMLSelectElement
    expect(source.selectedOptions[0]?.textContent).toBe("Selected reference")
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.selectOptions(source, "fresh")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(current)
  },
)
