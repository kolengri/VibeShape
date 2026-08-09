// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RectangleSketchParameterPanel } from "./rectangle-sketch-parameter-panel"

afterEach(cleanup)

describe("RectangleSketchParameterPanel", () => {
  it("keeps its fields state-agnostic and usable as ordinary uncontrolled controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <RectangleSketchParameterPanel
        copy={{
          title: "Create rectangle sketch",
          description: "Create a constrained profile.",
          dimensions: "Sketch definition",
          cancel: "Cancel",
        }}
        planeField={
          <NativeSelectField label="Plane" defaultValue="xy">
            <option value="xy">XY</option>
            <option value="xz">XZ</option>
          </NativeSelectField>
        }
        fields={
          <>
            <TextField label="Width" defaultValue="40 mm" />
            <TextField label="Height" defaultValue="30 mm" />
          </>
        }
        footerAction={<button type="button">Create sketch</button>}
        onCancel={onCancel}
      />,
    )

    const width = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement
    await user.clear(width)
    await user.type(width, "#width")
    await user.selectOptions(screen.getByRole("combobox", { name: "Plane" }), "xz")
    expect(width.value).toBe("#width")
    expect((screen.getByRole("combobox", { name: "Plane" }) as HTMLSelectElement).value).toBe("xz")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
