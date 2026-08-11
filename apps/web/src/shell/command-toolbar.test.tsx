// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { CommandToolbar } from "./command-toolbar"

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { features: [] },
  },
} as unknown as DocumentControllerState

afterEach(cleanup)

describe("CommandToolbar", () => {
  it("presents Sketch and eligible Extrude before secondary direct solids", async () => {
    const user = userEvent.setup()
    const onCreateExtrusion = vi.fn()
    const onCreateSketch = vi.fn()

    const { rerender } = render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <CommandToolbar
          activeCommand={null}
          controller={controller}
          extrusionAvailable={false}
          workspace="model"
          onCreateBox={vi.fn()}
          onCreateCylinder={vi.fn()}
          onCreateExtrusion={onCreateExtrusion}
          onCreateSketch={onCreateSketch}
          onCreateSubtract={vi.fn()}
          onWorkspaceChange={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole("toolbar", { name: "Model commands" })).toBeTruthy()
    const buttons = screen.getAllByRole("button")
    expect(buttons.indexOf(screen.getByRole("button", { name: "Create sketch" }))).toBeLessThan(
      buttons.indexOf(screen.getByRole("button", { name: "Box" })),
    )
    expect(screen.getByText("Direct solids", { exact: true })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Extrude" }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await user.click(screen.getByRole("button", { name: "Create sketch" }))
    expect(onCreateSketch).toHaveBeenCalledOnce()

    rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <CommandToolbar
          activeCommand={null}
          controller={controller}
          extrusionAvailable
          workspace="sketch"
          onCreateBox={vi.fn()}
          onCreateCylinder={vi.fn()}
          onCreateExtrusion={onCreateExtrusion}
          onCreateSketch={onCreateSketch}
          onCreateSubtract={vi.fn()}
          onWorkspaceChange={vi.fn()}
        />
      </I18nProvider>,
    )

    const extrude = screen.getByRole("button", { name: "Extrude" })
    expect((extrude as HTMLButtonElement).disabled).toBe(false)
    await user.click(extrude)
    expect(onCreateExtrusion).toHaveBeenCalledOnce()
  })
})
