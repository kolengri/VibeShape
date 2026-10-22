import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  createRectangleSketch,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { SketchCornerTreatmentPanel } from "./sketch-corner-treatment-panel"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
afterEach(cleanup)
function cornerDraft() {
  let entity = 1,
    constraint = 100
  return createRectangleSketch({
    id: sketchIdSchema.parse(id(200)),
    label: "Corner",
    plane: "xy",
    width: createLengthQuantity(10),
    height: createLengthQuantity(8),
    createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
  })
}
it("previews exact corner geometry, rejects oversized input, applies once and cancels without editing", async () => {
  const draft = cornerDraft()
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

it("retains independent chamfer expressions across selection changes and applies them to the current draft", async () => {
  const draft = cornerDraft()
  const onApply = vi.fn((sketch: SketchRecord) => sketch)
  const selected = [sketchEntityIdSchema.parse(id(5)), sketchEntityIdSchema.parse(id(6))]
  const tree = (current: SketchRecord, selection = selected) => (
    <I18nProvider i18n={i18n}>
      <DocumentDisplayUnitsProvider displayUnits={{ length: "mm", angle: "deg" }}>
        <SketchCornerTreatmentPanel
          draft={current}
          kind="chamfer"
          selectedEntityIds={selection}
          solvedPoints={new Map()}
          variables={[]}
          onApply={onApply}
          onCancel={vi.fn()}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>
  )
  const view = render(tree(draft))
  const user = userEvent.setup()
  const first = screen.getByRole("textbox", { name: "First setback" }) as HTMLInputElement
  const second = screen.getByRole("textbox", { name: "Second setback" }) as HTMLInputElement
  await user.clear(first)
  await user.type(first, "1 mm")
  await user.clear(second)
  await user.type(second, "3 mm")
  view.rerender(tree(draft, []))
  expect(screen.getByRole("button", { name: "Apply corner treatment" }).matches(":disabled")).toBe(
    true,
  )
  expect(first.value).toBe("1 mm")
  expect(second.value).toBe("3 mm")
  view.rerender(tree({ ...draft, label: "Updated while selecting" }))
  await user.click(screen.getByRole("button", { name: "Apply corner treatment" }))
  expect(onApply).toHaveBeenCalledTimes(1)
  const applied = onApply.mock.calls[0]?.[0]
  expect(applied?.label).toBe("Updated while selecting")
  expect(
    applied?.entities.some((entity) => entity.type === "point" && entity.x === 9 && entity.y === 0),
  ).toBe(true)
  expect(
    applied?.entities.some(
      (entity) => entity.type === "point" && entity.x === 10 && entity.y === 3,
    ),
  ).toBe(true)
  expect(draft.entities).toHaveLength(8)
})
