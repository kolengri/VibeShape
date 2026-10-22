import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("clips the viewport with reversible sections while preserving saved solids", async ({
  page,
}) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const original = await saveProject(page)
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  await page.getByRole("button", { name: "Section view", exact: true }).click()
  const sectionButton = page.getByRole("button", { name: "Section view", exact: true })
  const section = page.getByRole("dialog", { name: "Section view", exact: true })
  const viewControls = page
    .getByRole("button", { name: "Standard views", exact: true })
    .locator("..")
  await expect(
    viewControls.getByRole("button", { name: "Section view", exact: true }),
  ).toBeVisible()
  await section.getByRole("radio", { name: "XY plane, normal Z", exact: true }).check()
  await expect(section.getByRole("radio", { name: "XY plane, normal Z" })).toBeChecked()
  await section.getByRole("radio", { name: "XY plane, normal Z" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(section.getByRole("radio", { name: "XZ plane, normal Y" })).toBeChecked()
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
    "data-section-axis",
    "y",
  )
  await section.getByRole("radio", { name: "XY plane, normal Z" }).check()
  // A 512 x 384 CSS viewport represents 200% reflow on a 1024 x 768 display.
  await page.setViewportSize({ width: 512, height: 384 })
  await expect
    .poll(async () => {
      const bounds = await section.boundingBox()
      return bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= 384
    })
    .toBe(true)
  await section.getByRole("button", { name: "Keep the opposite side", exact: true }).click()
  await expect(
    section.getByRole("button", { name: "Keep the opposite side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await section.getByRole("button", { name: "Keep the opposite side", exact: true }).press("Space")
  await expect(
    section.getByRole("button", { name: "Keep the opposite side", exact: true }),
  ).toHaveAttribute("aria-pressed", "false")
  await page.setViewportSize({ width: 1440, height: 900 })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-section-axis", "z")
  await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("1 cm")
  await expect(section.getByRole("combobox", { name: "Section offset", exact: true })).toHaveValue(
    "1 cm",
  )
  await expect(viewport).toHaveAttribute("data-section-offset", "10")
  await page.screenshot({ path: test.info().outputPath("section-lower.png") })
  await section.getByRole("button", { name: "Keep the opposite side", exact: true }).click()
  await page.screenshot({ path: test.info().outputPath("section-upper.png") })
  await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("100001")
  await expect(section.getByText(/Enter a length between/)).toBeVisible()
  await expect(viewport).toHaveAttribute("data-section-offset", "10")
  await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("5")
  await section.getByRole("radio", { name: "YZ plane, normal X" }).check()
  await expect(viewport).toHaveAttribute("data-section-axis", "x")
  await page.keyboard.press("Escape")
  await expect(sectionButton).toBeFocused()
  const sectioned = await saveProject(page)
  expect(sectioned.project.snapshot.features).toEqual(original.project.snapshot.features)
  expect(sectioned.project.snapshot.parts).toEqual(original.project.snapshot.parts)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await page
    .getByRole("complementary", { name: "Sketch task panel" })
    .getByRole("button", { name: "XY plane", exact: true })
    .click()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await sectionButton.click()
  await expect(section.getByRole("radio", { name: "YZ plane, normal X" })).toBeChecked()
  await expect(
    section.getByRole("button", { name: "Keep the opposite side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await section.getByRole("radio", { name: "XY plane, normal Z" }).check()
  await section.getByRole("button", { name: "Keep the opposite side", exact: true }).click()
  await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("-100")
  await page.keyboard.press("Escape")
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("Viewport canvas must be visible.")
  await canvas.hover({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  await expect(viewport).not.toHaveAttribute("data-preselected-feature")
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  await expect(viewport).not.toHaveAttribute("data-selected-feature")
  await sectionButton.click()
  await section.getByRole("radio", { name: "Disable section view", exact: true }).check()
  await expect(viewport).not.toHaveAttribute("data-section-axis")
  await page.reload()
  await saved(page)
  await expect(page.getByRole("region", { name: "3D viewport", exact: true })).not.toHaveAttribute(
    "data-section-axis",
  )
})

for (const theme of ["light", "dark"] as const) {
  test(`drags and cancels a filled section in ${theme} theme without changing the document`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await saved(page)
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible()
    await saved(page)
    const original = await saveProject(page)
    await page
      .locator("html")
      .evaluate("(element, dark) => element.classList.toggle('dark', dark)", theme === "dark")
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    const canvas = viewport.locator("canvas")
    await viewport.getByRole("button", { name: "Fit view", exact: true }).click()
    const trigger = viewport.getByRole("button", { name: "Section view", exact: true })
    await expect(trigger).toHaveText("")
    await page.mouse.move(10, 10)
    await trigger.hover()
    await expect(page.getByRole("tooltip", { name: "Section view", exact: true })).toBeVisible()
    await trigger.click()
    const section = page.getByRole("dialog", { name: "Section view", exact: true })
    await section.getByRole("radio", { name: "XY plane, normal Z", exact: true }).check()
    await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("10")
    await expect(canvas).toHaveAttribute("data-section-cap-count", "1")
    await page.keyboard.press("Escape")
    const handle = async () => {
      const position = (await canvas.getAttribute("data-section-gizmo-handle"))
        ?.split(",")
        .map(Number)
      const bounds = await canvas.boundingBox()
      if (position?.length !== 2 || !bounds)
        throw new Error("A visible section handle is required.")
      return { x: bounds.x + (position[0] ?? 0), y: bounds.y + (position[1] ?? 0) }
    }
    const start = await handle()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await expect(canvas).toHaveAttribute("data-section-dragging", "true")
    await page.mouse.move(start.x, start.y - 30, { steps: 12 })
    await page.mouse.up()
    await expect(canvas).not.toHaveAttribute("data-section-dragging")
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-section-offset")))
      .toBeGreaterThan(10)
    const offset = await canvas.getAttribute("data-section-offset")
    await trigger.click()
    await expect(
      section.getByRole("combobox", { name: "Section offset", exact: true }),
    ).toHaveValue(`${Number(Number(offset).toPrecision(12))} mm`)
    await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("10")
    await page.keyboard.press("Escape")
    const cancelStart = await handle()
    await page.mouse.move(cancelStart.x, cancelStart.y)
    await page.mouse.down()
    await page.mouse.move(cancelStart.x, cancelStart.y - 15, { steps: 5 })
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-section-offset")))
      .toBeGreaterThan(10)
    await page.keyboard.press("Escape")
    await expect(canvas).not.toHaveAttribute("data-section-dragging")
    await expect(canvas).toHaveAttribute("data-section-offset", "10")
    await page.mouse.up()
    // A cancelled pointer gesture also releases navigation and restores the original offset.
    const pointerCancelStart = await handle()
    await page.mouse.move(pointerCancelStart.x, pointerCancelStart.y)
    await page.mouse.down()
    await page.mouse.move(pointerCancelStart.x, pointerCancelStart.y - 15, { steps: 5 })
    await canvas.dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true })
    await expect(canvas).not.toHaveAttribute("data-section-dragging")
    await expect(canvas).toHaveAttribute("data-section-offset", "10")
    await page.mouse.up()
    // Middle-button navigation outside the handle still works after cancellation.
    const beforeOrbit = await canvas.getAttribute("data-section-gizmo-handle")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The canvas must remain visible after section dragging.")
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down({ button: "middle" })
    await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 20, {
      steps: 8,
    })
    await page.mouse.up({ button: "middle" })
    await expect(canvas).not.toHaveAttribute("data-section-gizmo-handle", beforeOrbit ?? "")
    await expect(canvas).toHaveAttribute("data-section-offset", "10")
    await page.mouse.move(10, 10)
    await page.screenshot({
      path: `artifacts/native-assistant-workflows/section-view/section-${theme}.png`,
    })
    const after = await saveProject(page)
    expect(after.project.snapshot).toEqual(original.project.snapshot)
  })
}
