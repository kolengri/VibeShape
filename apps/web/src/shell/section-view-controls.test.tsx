import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { DocumentDisplayUnits } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ViewerMesh, ViewerSection } from "@vibeshape/viewer/three-viewport"
import { vi } from "../../../../tests/unit/support/bun-test"
import { DocumentDisplayUnitsProvider } from "../document/document-display-units"
import { i18n } from "../i18n"
import { SectionViewControls } from "./section-view-controls"

afterEach(cleanup)

beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)

const meshes: readonly ViewerMesh[] = [
  {
    featureId: "box",
    positions: new Float32Array([0, 0, 0, 20, 20, 20]),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    triangleFaceIds: new Uint32Array(),
  },
]

function renderSection(initialUnit: DocumentDisplayUnits["length"] = "mm") {
  let section: ViewerSection | null = { axis: "z", offset: 0, flipped: false }
  let unit = initialUnit
  const onChange = vi.fn((next: ViewerSection | null) => {
    section = next
    view.rerender(content())
  })
  function content() {
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ length: unit, angle: "deg" }}>
          <TooltipProvider>
            <SectionViewControls
              disabled={false}
              section={section}
              onChange={onChange}
              meshes={meshes}
            />
          </TooltipProvider>
        </DocumentDisplayUnitsProvider>
      </I18nProvider>
    )
  }
  const view = render(content())
  return {
    onChange,
    update(offset: number, nextUnit = unit) {
      section = { axis: "z", offset, flipped: section?.flipped ?? false }
      unit = nextUnit
      view.rerender(content())
    },
  }
}

describe("SectionViewControls offset", () => {
  it("converts supported inline units and retains the raw expression through side changes", async () => {
    const { onChange } = renderSection()
    await userEvent.click(screen.getByRole("button", { name: "Section view" }))
    const input = screen.getByRole("combobox", { name: "Section offset" }) as HTMLInputElement
    expect(input.value).toBe("0 mm")
    await userEvent.clear(input)
    await userEvent.type(input, "1 in")
    expect(onChange).toHaveBeenLastCalledWith({ axis: "z", offset: 25.4, flipped: false })
    expect(input.value).toBe("1 in")
    await userEvent.click(screen.getByRole("button", { name: "Keep the opposite side" }))
    expect(onChange).toHaveBeenLastCalledWith({ axis: "z", offset: 25.4, flipped: true })
    expect(input.value).toBe("1 in")
    await userEvent.clear(input)
    await userEvent.type(input, "-2 cm")
    expect(onChange).toHaveBeenLastCalledWith({ axis: "z", offset: -20, flipped: true })
    expect(input.value).toBe("-2 cm")
  })

  it("uses project units for bare numbers and resynchronizes externally moved sections", async () => {
    const view = renderSection("in")
    await userEvent.click(screen.getByRole("button", { name: "Section view" }))
    const input = screen.getByRole("combobox", { name: "Section offset" }) as HTMLInputElement
    expect(input.value).toBe("0 in")
    await userEvent.clear(input)
    await userEvent.type(input, "2")
    expect(view.onChange).toHaveBeenLastCalledWith({ axis: "z", offset: 50.8, flipped: false })
    view.update(76.2)
    expect(input.value).toBe("3 in")
    view.update(76.2, "cm")
    expect(input.value).toBe("7.62 cm")
    await userEvent.click(screen.getByRole("radio", { name: "XZ plane, normal Y" }))
    expect(input.value).toBe("1 cm")
    expect(view.onChange).toHaveBeenLastCalledWith({ axis: "y", offset: 10, flipped: false })
  })

  it("keeps the last valid cut when an expression has invalid dimensions or exceeds the canonical range", async () => {
    const { onChange } = renderSection()
    await userEvent.click(screen.getByRole("button", { name: "Section view" }))
    const input = screen.getByRole("combobox", { name: "Section offset" }) as HTMLInputElement
    for (const expression of ["1 deg", "100001 mm", "4000 in", "NaN", "#missing"]) {
      await userEvent.clear(input)
      onChange.mockClear()
      await userEvent.paste(expression)
      expect(onChange).not.toHaveBeenCalled()
      expect(input.getAttribute("aria-invalid")).toBe("true")
      expect(input.value).toBe(expression)
    }
  })
})
