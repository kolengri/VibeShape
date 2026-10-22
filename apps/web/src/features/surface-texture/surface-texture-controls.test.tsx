import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useState } from "react"
import { surfaceTextureProjectFixture } from "../../../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { SurfaceTextureControls } from "./surface-texture-controls"

function setup(disabled = false) {
  const update = vi.fn()
  function Controls() {
    const [layer, setLayer] = useState(surfaceTextureProjectFixture().layer)
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <fieldset disabled={disabled}>
          <SurfaceTextureControls
            layer={layer}
            update={(patch: Partial<SurfaceTextureLayer>) => {
              update(patch)
              setLayer((current) => ({ ...current, ...patch }))
            }}
          />
        </fieldset>
      </I18nProvider>
    )
  }
  render(<Controls />)
  return update
}

afterEach(cleanup)

it("keeps linked dimensions coupled and toggles linking through the visible label", async () => {
  const user = userEvent.setup()
  const update = setup()
  const width = screen.getByRole("spinbutton", { name: "Pattern width (mm)" })
  const height = screen.getByRole("spinbutton", { name: "Pattern height (mm)" })
  await user.clear(width)
  await user.type(width, "8")
  expect(update).toHaveBeenLastCalledWith({ sizeUMm: 8, sizeVMm: 8 })
  expect((height as HTMLInputElement).value).toBe("8")

  await user.click(screen.getByText("Link width and height"))
  expect(
    (screen.getByRole("checkbox", { name: "Link width and height" }) as HTMLInputElement).checked,
  ).toBe(false)
  await user.clear(width)
  await user.type(width, "9")
  expect(update).toHaveBeenLastCalledWith({ sizeUMm: 9 })
  expect((height as HTMLInputElement).value).toBe("8")

  await user.click(screen.getByText("Link width and height"))
  expect(update).toHaveBeenLastCalledWith({ sizeVMm: 9 })
})

it("retains the inversion callback and inherited disabled state for texture toggles", async () => {
  const user = userEvent.setup()
  const update = setup()
  await user.click(screen.getByText("Advanced"))
  await user.click(screen.getByText("Invert heightmap"))
  expect(update).toHaveBeenLastCalledWith({ invert: true })
  expect(
    (screen.getByRole("checkbox", { name: "Invert heightmap" }) as HTMLInputElement).checked,
  ).toBe(true)

  cleanup()
  const disabledUpdate = setup(true)
  await user.click(screen.getByText("Advanced"))
  for (const name of ["Link width and height", "Invert heightmap"]) {
    const toggle = screen.getByRole("checkbox", { name })
    expect(toggle.matches(":disabled")).toBe(true)
    await user.click(toggle)
  }
  expect(disabledUpdate).not.toHaveBeenCalled()
})
