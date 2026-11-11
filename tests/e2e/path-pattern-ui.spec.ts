import type { Locator, Page } from "@playwright/test"
import { readPatternFeatureParametersV3 } from "../../packages/domain/src/part-design-pattern-path"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane } from "./sketch-helpers"

type ScreenMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }
async function clickSketchPoint(
  page: Page,
  drawing: Locator,
  x: number,
  y: number,
  snapOrigin = false,
) {
  const position = await drawing.locator("[data-sketch-plane-projection]").evaluate(
    (element, point) => {
      const geometry = element as unknown as { getScreenCTM?: () => ScreenMatrix | null }
      const matrix = geometry.getScreenCTM?.()
      if (!matrix) throw new Error("The sketch must expose its real drawing projection.")
      return {
        x: matrix.a * point.x - matrix.c * point.y + matrix.e,
        y: matrix.b * point.x - matrix.d * point.y + matrix.f,
      }
    },
    { x, y },
  )
  if (snapOrigin) {
    await page.mouse.move(position.x, position.y)
    await expect(drawing.locator('[data-sketch-inference="coincident"]')).toBeVisible()
  }
  await page.mouse.click(position.x, position.y)
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

test("patterns a body along a picked sketch path, applies once, undoes, redoes and reopens", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  await page.getByRole("button", { name: "Line", exact: true }).click()
  await clickSketchPoint(page, drawing, 0, 0, true)
  await clickSketchPoint(page, drawing, 0, 60)
  await page.keyboard.press("Escape")
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(1)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)

  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Pattern", exact: true }).click()
  const form = page.getByRole("form", { name: "Pattern body", exact: true })
  await form.getByRole("radio", { name: "Path", exact: true }).check()
  const apply = form.getByRole("button", { name: "Apply feature", exact: true })
  await expect(apply).toBeDisabled()
  await form
    .getByRole("combobox", { name: "Path sketch", exact: true })
    .selectOption({ label: "Sketch 1" })
  // The viewport's keyboard picker drives the same picking channel as clicking the curve.
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const picker = viewport.getByRole("combobox", {
    name: "Pattern path curve selection",
    exact: true,
  })
  await picker.focus()
  await picker.selectOption({ index: 1 })
  const curve = form.getByRole("checkbox", { name: /^Line \d+$/ })
  await expect(curve).toBeChecked()
  const start = form.getByRole("combobox", { name: "Path start point", exact: true })
  const origin = required(
    (
      await start.locator("option").evaluateAll((options) =>
        options.map((option) => ({
          value: (option as HTMLOptionElement).value,
          label: option.textContent ?? "",
        })),
      )
    ).find(({ label }) => label.includes("(0, 0, 0)")),
    "The path must expose its origin endpoint.",
  )
  await start.selectOption(origin.value)
  await form.getByRole("radio", { name: "Fixed distance", exact: true }).check()
  await form
    .getByRole("combobox", { name: "Distance between instances", exact: true })
    .fill("25 mm")
  await form.getByRole("combobox", { name: "Instance count", exact: true }).fill("3")
  await form.getByRole("radio", { name: "Follow path", exact: true }).check()
  await expect(apply).toBeEnabled({ timeout: 30_000 })
  await apply.dblclick()
  await saved(page)
  const applied = await saveProject(page)
  const feature = required(
    applied.project.snapshot.features.find((item) => readPatternFeatureParametersV3(item)),
    "The path pattern feature must persist.",
  )
  expect(feature.type.schemaVersion).toBe(3)
  expect(readPatternFeatureParametersV3(feature)).toMatchObject({
    kind: "path",
    count: { value: 3 },
    path: { startPointId: origin.value },
    spacing: { mode: "fixed", distance: { value: 25 } },
    orientation: "follow",
    reverse: false,
  })
  expect(
    applied.project.snapshot.features.filter((item) => readPatternFeatureParametersV3(item)),
  ).toHaveLength(1)
  const instances = applied.project.snapshot.parts.filter(({ bodyHistory }) =>
    bodyHistory.some(({ featureId }) => featureId === feature.id),
  )
  expect(instances.map(({ bodyHistory }) => bodyHistory.at(-1)?.outputRole).sort()).toEqual([
    "pattern.instance.0",
    "pattern.instance.1",
    "pattern.instance.2",
  ])
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 2)
  for (const instance of instances)
    await expect(page.locator(`[data-part-id="${instance.id}"]`)).toHaveAttribute(
      "data-part-status",
      "available",
    )

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(undone.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(applied.project.snapshot.features)
  expect(reloaded.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  await openProject(page, reloaded)
  const reopened = await saveProject(page)
  expect(reopened.project.snapshot.features).toEqual(applied.project.snapshot.features)
  await page.getByRole("treeitem", { name: "Pattern 1", exact: true }).click()
  const edit = page.getByRole("form", { name: "Edit body pattern", exact: true })
  await expect(edit.getByRole("radio", { name: "Path", exact: true })).toBeChecked()
  await expect(edit.getByRole("checkbox", { name: /^Line \d+$/ })).toBeChecked()
  await expect(
    edit.getByRole("combobox", { name: "Distance between instances", exact: true }),
  ).toHaveValue("25 mm")
})
