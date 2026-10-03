import type { Locator, Page } from "@playwright/test"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, fitIsometricView } from "./sketch-helpers"
import { exportGeometry } from "./source-import-ui-support"

async function outlineIds(drawing: Locator) {
  return drawing
    .locator("[data-sketch-entity-id]")
    .evaluateAll((elements) =>
      [...new Set(elements.map((element) => element.getAttribute("data-sketch-entity-id")))].sort(),
    )
}
async function openText(page: Page, text = "O") {
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Text", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "Add sketch text", exact: true })
  await dialog.getByRole("textbox", { name: "Text", exact: true }).fill(text)
  return dialog
}
async function applyText(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Apply text", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page
      .getByRole("img", { name: "Editable sketch geometry" })
      .locator('[data-sketch-entity-type="cubic-bezier"]')
      .first(),
  ).toBeVisible()
}
function savedText(source: Awaited<ReturnType<typeof saveProject>>) {
  const sketch = source.project.snapshot.sketches.find(({ label }) => label === "Sketch 1")
  const group = sketch?.textGroups?.[0]
  if (!sketch || !group) throw new Error("Native Save must retain the editable text group.")
  return { sketch, group }
}
async function warnOnManualOutlineEdit(page: Page, drawing: Locator) {
  const picked = await drawing.locator("[data-sketch-plane-projection]").evaluate((element) => {
    const projection = element as unknown as {
      getScreenCTM: () => {
        a: number
        b: number
        c: number
        d: number
        e: number
        f: number
      } | null
      querySelectorAll: (
        selector: string,
      ) => ArrayLike<{ getAttribute: (name: string) => string | null }>
      ownerDocument: {
        elementFromPoint: (
          x: number,
          y: number,
        ) => {
          closest: (selector: string) => { getAttribute: (name: string) => string | null } | null
        } | null
      }
    }
    const matrix = projection.getScreenCTM()
    if (!matrix) throw new Error("The text outline requires a visible sketch projection.")
    for (const candidate of Array.from(
      projection.querySelectorAll('[data-sketch-entity-type="point"]'),
    )) {
      const x = Number(candidate.getAttribute("cx")),
        y = Number(candidate.getAttribute("cy"))
      const screen = {
        x: matrix.a * x - matrix.c * y + matrix.e,
        y: matrix.b * x - matrix.d * y + matrix.f,
      }
      const hit = projection.ownerDocument
        .elementFromPoint(screen.x, screen.y)
        ?.closest('[data-sketch-entity-type="point"]')
      if (
        hit?.getAttribute("data-sketch-entity-id") !==
        candidate.getAttribute("data-sketch-entity-id")
      )
        continue
      return {
        id: candidate.getAttribute("data-sketch-entity-id"),
        before: candidate.getAttribute("cx"),
        from: screen,
        to: {
          x: matrix.a * (x + 3) - matrix.c * y + matrix.e,
          y: matrix.b * (x + 3) - matrix.d * y + matrix.f,
        },
      }
    }
    throw new Error("A text contour point must have a real, uncovered pointer target.")
  })
  const point = drawing.locator(
    `[data-sketch-entity-type="point"][data-sketch-entity-id="${picked.id}"]`,
  )
  const before = picked.before
  await page.keyboard.down("Shift")
  await page.mouse.move(picked.from.x, picked.from.y)
  await page.mouse.down()
  await expect(drawing).toHaveAttribute("data-sketch-dragging-point-id", picked.id ?? "")
  await page.mouse.move(picked.to.x, picked.to.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect(point).not.toHaveAttribute("cx", before ?? "")
  await page.getByRole("button", { name: "Edit text O", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Edit sketch text", exact: true })
  await expect(
    dialog.getByText("These outline curves were edited after the text was generated.", {
      exact: false,
    }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Undo", exact: true })
    .click()
  await expect(point).toHaveAttribute("cx", before ?? "")
}

test("authors editable text, cancels errors, preserves group identity through Undo and native reopen, and extrudes exact contours", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  let dialog = await openText(page)
  await dialog.getByRole("spinbutton", { name: "Capital height (mm)", exact: true }).fill("0")
  await dialog.getByRole("button", { name: "Apply text", exact: true }).click()
  await expect(
    dialog.getByText("Enter a finite capital height from 0.01 to 1,000 mm.", { exact: true }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(drawing.locator("[data-sketch-entity-id]")).toHaveCount(0)
  dialog = await openText(page, "💡")
  await dialog.getByRole("button", { name: "Apply text", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("U+1F4A1")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(drawing.locator("[data-sketch-entity-id]")).toHaveCount(0)

  dialog = await openText(page)
  await dialog.getByRole("spinbutton", { name: "Origin X (mm)", exact: true }).fill("5")
  await dialog.getByRole("spinbutton", { name: "Origin Y (mm)", exact: true }).fill("3")
  await applyText(page, dialog)
  const initialIds = await outlineIds(drawing)
  expect(initialIds.length).toBeGreaterThan(10)
  const groupRow = page.locator("[data-text-group-id]")
  const groupId = await groupRow.getAttribute("data-text-group-id")
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(drawing.locator("[data-sketch-entity-id]")).toHaveCount(0)
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
  expect(await outlineIds(drawing)).toEqual(initialIds)
  await expect(groupRow).toHaveAttribute("data-text-group-id", groupId ?? "")
  await warnOnManualOutlineEdit(page, drawing)

  await page.getByRole("button", { name: "Edit text O", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Edit sketch text", exact: true })
  await expect(dialog.getByRole("spinbutton", { name: "Origin X (mm)", exact: true })).toHaveValue(
    "5",
  )
  await dialog.getByRole("textbox", { name: "Text", exact: true }).fill("C")
  await applyText(page, dialog)
  const editedIds = await outlineIds(drawing)
  expect(editedIds.some((id) => initialIds.includes(id))).toBe(false)
  await expect(groupRow).toHaveAttribute("data-text-group-id", groupId ?? "")
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  expect(await outlineIds(drawing)).toEqual(initialIds)
  await expect(page.getByRole("button", { name: "Edit text O", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Detach text O", exact: true }).click()
  await expect(groupRow).toHaveCount(0)
  expect(await outlineIds(drawing)).toEqual(initialIds)
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(groupRow).toHaveAttribute("data-text-group-id", groupId ?? "")
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  const captured = await saveProject(page)
  const original = savedText(captured)
  expect(original.group).toMatchObject({
    id: groupId,
    origin: [5, 3],
    parameters: {
      text: "O",
      heightMm: 10,
      layoutEngine: "unicode-scalar-kerning-v1",
      outlineSdk: "opentype.js@2.0.0",
    },
  })
  expect(original.group.parameters.font.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(
    original.sketch.entities.filter(({ type }) => type === "cubic-bezier").length,
  ).toBeGreaterThan(0)
  await openProject(page, captured)
  await page.getByRole("treeitem", { name: "Sketch 1", exact: true }).click()
  await expect(drawing).toBeVisible()
  expect(await outlineIds(drawing)).toEqual(initialIds)
  await page.getByRole("button", { name: "Edit text O", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Edit sketch text", exact: true })
  await expect(
    dialog.getByRole("spinbutton", { name: "Capital height (mm)", exact: true }),
  ).toHaveValue("10")
  await dialog.getByRole("spinbutton", { name: "Capital height (mm)", exact: true }).fill("12")
  await applyText(page, dialog)
  await expect(groupRow).toHaveAttribute("data-text-group-id", groupId ?? "")
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  expect(savedText(edited).group).toMatchObject({
    id: groupId,
    parameters: { text: "O", heightMm: 12 },
  })

  await fitIsometricView(page)
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
    timeout: 60_000,
  })
  await viewport
    .getByRole("combobox", { name: "Select saved profile", exact: true })
    .selectOption({ label: "Sketch 1 · Profile 1" })
  await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
  const extrusion = page.getByRole("form", { name: "Extrude profile", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 60_000 })
  await extrusion.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await expect(extrusion).not.toBeVisible()
  await saved(page)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", { timeout: 60_000 })
  expect((await exportGeometry(page, "STEP")).toString("utf8")).toContain("ISO-10303-21")
})
