// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  createRectangleSketch,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { SketchCornerTreatmentPanel } from "./sketch-corner-treatment-panel"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
afterEach(cleanup)
it("previews exact corner geometry, rejects oversized input, applies once and cancels without editing", async () => {
  let entity = 1,
    constraint = 100
  const draft = createRectangleSketch({
    id: sketchIdSchema.parse(id(200)),
    label: "Corner",
    plane: "xy",
    width: createLengthQuantity(10),
    height: createLengthQuantity(8),
    createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
  })
  const onApply = vi.fn(),
    onCancel = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <DocumentDisplayUnitsProvider displayUnits={{ length: "mm", angle: "deg" }}>
        <SketchCornerTreatmentPanel
          draft={draft}
          kind="fillet"
          selectedEntityIds={[sketchEntityIdSchema.parse(id(5)), sketchEntityIdSchema.parse(id(6))]}
          solvedPoints={new Map()}
          variables={[]}
          onApply={onApply}
          onCancel={onCancel}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
  const user = userEvent.setup()
  expect(screen.getByRole("img", { name: "Corner treatment preview" })).toBeTruthy()
  expect(onApply).not.toHaveBeenCalled()
  await user.clear(screen.getByRole("textbox", { name: "Radius" }))
  await user.type(screen.getByRole("textbox", { name: "Radius" }), "9 mm")
  expect(
    screen.getByRole("button", { name: "Apply corner treatment" }).hasAttribute("disabled"),
  ).toBe(true)
  await user.clear(screen.getByRole("textbox", { name: "Radius" }))
  await user.type(screen.getByRole("textbox", { name: "Radius" }), "1 mm")
  await user.click(screen.getByRole("button", { name: "Apply corner treatment" }))
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(draft.entities.some(({ type }) => type === "arc")).toBe(false)
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})
