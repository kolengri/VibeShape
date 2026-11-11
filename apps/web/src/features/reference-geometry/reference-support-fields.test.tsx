import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { bodyTopoRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  type ReferencePlane,
  referenceAxisSchema,
  referencePlaneSchema,
} from "@vibeshape/domain/reference-frame"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useState } from "react"
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

function UnsetPlaneHarness(props: {
  options: Parameters<typeof ReferencePlaneSelection>[0]["options"]
  onChange: (value: ReferencePlane | null) => void
}) {
  const [value, setValue] = useState<ReferencePlane | null>(null)
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ReferencePlaneSelection
        value={value}
        options={props.options}
        onChange={(next) => {
          props.onChange(next)
          setValue(next)
        }}
      >
        {null}
      </ReferencePlaneSelection>
    </I18nProvider>
  )
}
const planeSource = () =>
  screen.getByRole("combobox", { name: "Reference source" }) as HTMLSelectElement
const invalidCopy = /Enter finite coordinates/

describe("unset reference support", () => {
  const face = referencePlaneSchema.parse({ kind: "planar-face", reference: reference("face", 10) })
  const options = { planes: [{ key: "top", label: "Top face", support: face }], axes: [] }

  it("starts on a placeholder without coordinates or an error", () => {
    render(<UnsetPlaneHarness options={options} onChange={vi.fn()} />)
    expect(planeSource().selectedOptions[0]?.textContent).toBe("Choose a plane")
    expect(screen.getByText("Choose a reference source before applying.")).toBeTruthy()
    expect(screen.queryByText(invalidCopy)).toBeNull()
    expect(screen.queryByRole("spinbutton")).toBeNull()
  })

  it.each([
    ["origin", { kind: "origin-plane", plane: "XY" }],
    ["top", face],
    ["explicit", { kind: "explicit-plane", origin: [0, 0, 0], normal: [0, 0, 1] }],
  ] as const)("commits the %s source on first choice", async (key, expected) => {
    const onChange = vi.fn()
    render(<UnsetPlaneHarness options={options} onChange={onChange} />)
    await userEvent.selectOptions(planeSource(), key)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expected)
    expect(screen.queryByRole("option", { name: "Choose a plane" })).toBeNull()
    expect(screen.queryByText(invalidCopy)).toBeNull()
  })

  it("reports unfinished explicit coordinates once a source was chosen", async () => {
    const onChange = vi.fn()
    render(<UnsetPlaneHarness options={options} onChange={onChange} />)
    await userEvent.selectOptions(planeSource(), "explicit")
    await userEvent.clear(screen.getByRole("spinbutton", { name: "Direction Z" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(planeSource().selectedOptions[0]?.textContent).toBe("Explicit reference")
    expect(screen.getByText(invalidCopy)).toBeTruthy()
  })
})
