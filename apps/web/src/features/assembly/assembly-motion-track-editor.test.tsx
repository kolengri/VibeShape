import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AssemblyMotionStudy } from "@vibeshape/domain/assembly-authority"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useState } from "react"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { asBuiltUiFixture } from "./assembly-as-built-test-fixture"
import { identityAssemblyPose } from "./assembly-model"
import { AssemblyMotionTrackEditor } from "./assembly-motion-track-editor"

type JointKind = "revolute" | "prismatic" | "cylindrical"

function fixture(kind: JointKind = "revolute") {
  const f = asBuiltUiFixture()
  const joints = [0, 1].map((index) =>
    assemblyJointRecordSchema.parse({
      schemaVersion: kind === "cylindrical" ? 2 : 1,
      id: id(800 + index),
      kind,
      parentInstanceId: f.assembly.instances[0]?.id,
      childInstanceId: f.assembly.instances[index + 1]?.id,
      parentFrame: identityAssemblyPose,
      childFrame: identityAssemblyPose,
      axis: [0, 0, 1],
      ...(kind === "cylindrical"
        ? {
            angle: 0,
            angleLimits: { min: -Math.PI, max: Math.PI },
            rotationDriven: true,
            translation: 0,
            translationLimits: { min: -100, max: 100 },
            translationDriven: true,
          }
        : {
            value: 0,
            limits: {
              min: kind === "revolute" ? -Math.PI : -100,
              max: kind === "revolute" ? Math.PI : 100,
            },
          }),
    }),
  )
  const first = joints[0]
  if (!first) throw new Error("Expected initial drive joint.")
  const study: AssemblyMotionStudy = {
    schemaVersion: 1,
    id: id(810),
    name: "Six cranks",
    duration: 2,
    tracks: [
      {
        id: id(811),
        jointId: first.id,
        coordinate: kind === "prismatic" ? "translation" : "angle",
        keys: [
          { time: 0, value: 0 },
          { time: 2, value: kind === "prismatic" ? 12.7 : Math.PI / 2 },
        ],
      },
    ],
  }
  return { view: { assembly: { ...f.assembly, joints } }, study }
}
function setup({
  kind = "revolute",
  angle = "deg",
  length = "mm",
  disabled = false,
}: {
  kind?: JointKind
  angle?: "deg" | "rad"
  length?: "mm" | "in"
  disabled?: boolean
} = {}) {
  const f = fixture(kind)
  let current = f.study
  function Harness() {
    const [study, setStudy] = useState(f.study)
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle, length }}>
          <form aria-label="Study editor" onSubmit={(event) => event.preventDefault()}>
            <AssemblyMotionTrackEditor
              {...f}
              study={study}
              disabled={disabled}
              edit={(next) => {
                current = next
                setStudy(next)
              }}
            />
          </form>
        </DocumentDisplayUnitsProvider>
      </I18nProvider>
    )
  }
  render(<Harness />)
  return { ...f, current: () => current }
}
function elementAt(elements: HTMLElement[], index: number) {
  const element = elements[index]
  if (!element) throw new Error(`Expected control at index ${index}.`)
  return element
}
const inputValue = (input: HTMLElement) => (input as HTMLInputElement).value
async function replace(input: HTMLElement, value: string) {
  await userEvent.clear(input)
  await userEvent.type(input, value)
  await userEvent.tab()
}
afterEach(cleanup)

describe("Motion study track authoring", () => {
  it.each([
    {
      from: "angle",
      to: "translation",
      offsetLabel: "Angular offset (deg)",
      offset: "30",
      resetLabel: "Value offset (mm)",
    },
    {
      from: "translation",
      to: "angle",
      offsetLabel: "Value offset (mm)",
      offset: "1",
      resetLabel: "Angular offset (deg)",
    },
  ] as const)(
    "resets copy offsets when switching from $from to $to",
    async ({ from, to, offsetLabel, offset, resetLabel }) => {
      const f = setup({ kind: "cylindrical" })
      const first = f.view.assembly.joints[0]
      const second = f.view.assembly.joints[1]
      if (!first || !second) throw new Error("Expected two cylindrical joints.")
      const coordinate = screen.getByRole("combobox", { name: "Coordinate" })
      await userEvent.selectOptions(coordinate, `${first.id}:${from}`)
      await userEvent.click(screen.getByText("Copy to another joint"))
      await replace(screen.getByRole("spinbutton", { name: offsetLabel }), offset)
      await userEvent.selectOptions(coordinate, `${first.id}:${to}`)
      await userEvent.click(screen.getByText("Copy to another joint"))
      expect(
        inputValue(
          screen.getByRole("spinbutton", {
            name: resetLabel,
          }),
        ),
      ).toBe("0")
      await userEvent.click(screen.getByRole("button", { name: "Copy track" }))
      expect(f.current().tracks[1]).toMatchObject({
        jointId: second.id,
        coordinate: to,
        keys: [
          { time: 0, value: 0 },
          { time: 2, value: 0 },
        ],
      })
    },
  )

  it.each(["Time (s)", "Value (deg)"])(
    "clears buffered %s edits before adding or removing key rows",
    async (label) => {
      const f = setup()
      await userEvent.click(screen.getByText("Edit keys (2)"))
      await userEvent.click(screen.getByRole("button", { name: "Add key" }))
      await userEvent.clear(elementAt(screen.getAllByRole("spinbutton", { name: label }), 2))
      await userEvent.click(screen.getByRole("button", { name: "Add key" }))
      expect(screen.getAllByRole("spinbutton", { name: label }).map(inputValue)).toEqual(
        label === "Time (s)" ? ["0", "0.5", "1", "2"] : ["0", "22.5", "45", "90"],
      )
      await userEvent.clear(elementAt(screen.getAllByRole("spinbutton", { name: label }), 1))
      await userEvent.click(elementAt(screen.getAllByRole("button", { name: "Remove key" }), 0))
      expect(screen.getAllByRole("spinbutton", { name: label }).map(inputValue)).toEqual(
        label === "Time (s)" ? ["0.5", "1", "2"] : ["22.5", "45", "90"],
      )
      expect(f.current().tracks[0]?.keys).toEqual([
        { time: 0.5, value: Math.PI / 8 },
        { time: 1, value: Math.PI / 4 },
        { time: 2, value: Math.PI / 2 },
      ])
    },
  )

  it("preserves keyboard focus when removing a key resets the numeric editors", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)"))
    await userEvent.click(screen.getByRole("button", { name: "Add key" }))
    await userEvent.click(screen.getByRole("button", { name: "Add key" }))
    const remove = elementAt(screen.getAllByRole("button", { name: "Remove key" }), 0)
    remove.focus()
    await userEvent.keyboard("{Enter}")
    expect(f.current().tracks[0]?.keys).toHaveLength(3)
    expect(document.activeElement).toBe(remove)
    expect(screen.getAllByRole("button", { name: "Remove key" })).toHaveLength(3)
  })

  it.each(["time", "value"] as const)(
    "keeps a buffered %s edit when the next action drags the same key",
    async (field) => {
      const f = setup()
      await userEvent.click(screen.getByText("Edit keys (2)"))
      const input = elementAt(
        screen.getAllByRole("spinbutton", { name: field === "time" ? "Time (s)" : "Value (deg)" }),
        0,
      )
      await userEvent.clear(input)
      await userEvent.type(input, field === "time" ? "0.4" : "45")
      const slider = elementAt(screen.getAllByRole("slider"), 0) as HTMLButtonElement
      const lane = slider.parentElement
      if (!lane) throw new Error("Expected timeline lane.")
      lane.getBoundingClientRect = () => new DOMRect(0, 0, 200, 32)
      slider.setPointerCapture = () => {}
      slider.hasPointerCapture = () => false
      for (const [type, clientX] of [
        ["pointerdown", 20],
        ["pointermove", 40],
        ["pointerup", 40],
      ] as const) {
        fireEvent(
          slider,
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            clientX,
            button: 0,
            isPrimary: true,
          }),
        )
      }
      const key = f.current().tracks[0]?.keys[0]
      expect(key?.time).toBeCloseTo(field === "time" ? 0.6 : 0.2)
      expect(key?.value).toBeCloseTo(field === "value" ? Math.PI / 4 : 0)
      expect(document.activeElement).toBe(slider)
    },
  )

  it("names joint endpoints and edits degrees while preserving canonical radians", async () => {
    const f = setup()
    const coordinate = screen.getByRole("combobox", { name: "Coordinate" })
    expect(coordinate.textContent).toContain("Member 1 → Member 2")
    expect(coordinate.textContent).not.toContain(id(800))
    await userEvent.click(screen.getByText("Edit keys (2)"))
    const values = screen.getAllByRole("spinbutton", { name: "Value (deg)" })
    expect(inputValue(elementAt(values, 1))).toBe("90")
    await replace(elementAt(values, 1), "-45")
    expect(f.current().tracks[0]?.keys[1]?.value).toBeCloseTo(-Math.PI / 4)
    expect(f.study.tracks[0]?.keys[1]?.value).toBe(Math.PI / 2)
  })

  it("uses selected radian and inch project units without rewriting saved values", async () => {
    const f = setup({ kind: "prismatic", length: "in" })
    await userEvent.click(screen.getByText("Edit keys (2)"))
    const values = screen.getAllByRole("spinbutton", { name: "Value (in)" })
    expect(inputValue(elementAt(values, 1))).toBe("0.5")
    await replace(elementAt(values, 1), "1")
    expect(f.current().tracks[0]?.keys[1]?.value).toBe(25.4)
  })

  it("copies a track to an unused compatible joint with an angular offset and a fresh identity", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Copy to another joint"))
    expect(screen.getByRole("combobox", { name: "Target joint coordinate" }).textContent).toContain(
      "Member 1 → Member 3",
    )
    await replace(screen.getByRole("spinbutton", { name: "Angular offset (deg)" }), "30")
    await userEvent.click(screen.getByRole("button", { name: "Copy track" }))
    const [source, copy] = f.current().tracks
    expect(source).toEqual(f.study.tracks[0])
    expect(copy?.id).not.toBe(source?.id)
    expect(copy?.jointId).toBe(f.view.assembly.joints[1]?.id)
    expect(copy?.keys.map(({ time }) => time)).toEqual([0, 2])
    expect(copy?.keys[0]?.value).toBeCloseTo(Math.PI / 6)
    expect(copy?.keys[1]?.value).toBeCloseTo((2 * Math.PI) / 3)
    expect(copy?.keys).not.toBe(source?.keys)
    const coordinates = screen.getAllByRole("combobox", { name: "Coordinate" })
    expect(
      within(elementAt(coordinates, 0))
        .getByRole("option", { name: /Member 1 → Member 3/ })
        .hasAttribute("disabled"),
    ).toBe(true)
    expect(screen.queryByRole("button", { name: "Copy track" })).toBeNull()
  })

  it("rejects a copied offset outside the target limits without adding a track", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Copy to another joint"))
    await replace(screen.getByRole("spinbutton", { name: "Angular offset (deg)" }), "120")
    await userEvent.click(screen.getByRole("button", { name: "Copy track" }))
    expect(screen.getByRole("alert").textContent).toContain("exceed the target joint limits")
    expect(f.current().tracks).toEqual(f.study.tracks)
  })

  it("preserves an empty numeric draft and blocks invalid or crossed key times", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)"))
    const times = screen.getAllByRole("spinbutton", { name: "Time (s)" })
    await userEvent.clear(elementAt(times, 1))
    await userEvent.tab()
    expect(inputValue(elementAt(times, 1))).toBe("")
    expect(elementAt(times, 1).getAttribute("aria-invalid")).toBe("true")
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(2)
    expect(screen.getByRole("form").querySelector("input:invalid")).not.toBeNull()
    await replace(elementAt(times, 1), "0")
    expect(elementAt(times, 1).getAttribute("aria-invalid")).toBe("true")
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(2)
    await replace(elementAt(times, 1), "1")
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(1)
    expect(elementAt(times, 1).getAttribute("aria-invalid")).toBeNull()
  })

  it("blocks saving a valid buffered number until its displayed value is committed", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)"))
    const value = elementAt(screen.getAllByRole("spinbutton", { name: "Value (deg)" }), 0)
    await userEvent.click(value)
    fireEvent.change(value, { target: { value: "45" } })
    const form = screen.getByRole("form") as HTMLFormElement
    expect(inputValue(value)).toBe("45")
    expect(f.current().tracks[0]?.keys[0]?.value).toBe(0)
    expect(form.checkValidity()).toBe(false)
    expect(screen.getByText("Press Enter or leave this field to confirm the value.")).toBeTruthy()
    fireEvent.blur(value)
    expect(f.current().tracks[0]?.keys[0]?.value).toBeCloseTo(Math.PI / 4)
    expect(form.checkValidity()).toBe(true)
  })

  it("adds an interpolated key and retains the minimum track and key count", async () => {
    const f = setup()
    expect(
      (screen.getByRole("button", { name: "Remove track" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Add key" }))
    expect(f.current().tracks[0]?.keys).toEqual([
      { time: 0, value: 0 },
      { time: 1, value: Math.PI / 4 },
      { time: 2, value: Math.PI / 2 },
    ])
    await userEvent.click(screen.getByText("Edit keys (3)"))
    await userEvent.click(elementAt(screen.getAllByRole("button", { name: "Remove key" }), 1))
    for (const button of screen.getAllByRole("button", { name: "Remove key" }))
      expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps controls and graphical keys disabled during solving", () => {
    setup({ disabled: true })
    expect(
      screen.getByRole("combobox", { name: "Coordinate" }).closest("fieldset[disabled]"),
    ).not.toBeNull()
    for (const slider of screen.getAllByRole("slider"))
      expect((slider as HTMLButtonElement).disabled).toBe(true)
  })
})
