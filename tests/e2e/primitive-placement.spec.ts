import { expect, test } from "./fixtures"

test.describe("Primitive graphical placement", () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test("moves a Box by its world axis, cancels one drag, and persists one applied position", async ({
    page,
  }) => {
    await page.goto("/")
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()

    const form = page.getByRole("form", { name: "Create box" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    const canvas = viewport.locator("canvas")
    const originX = form.getByRole("combobox", { name: "Origin X" })
    const height = form.getByRole("combobox", { name: "Height" })
    await expect(viewport).toHaveAttribute("data-translation-gizmo-position", "0,0,0", {
      timeout: 30_000,
    })
    await height.fill("31 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await expect(viewport).toHaveAttribute("data-translation-gizmo-position", "0,0,0")

    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    // The default fitted camera projects the positive X handle at this stable fixture offset.
    const handle = {
      x: bounds.x + bounds.width / 2 + 82,
      y: bounds.y + bounds.height / 2 + 40,
    }

    const orientationBounds = await viewport.getByRole("img", { name: "World axes" }).boundingBox()
    if (!orientationBounds)
      throw new Error("The camera orientation inset has no measurable bounds.")
    // Compare the rendered axes, excluding the translucent frame and DOM labels.
    const cameraBounds = {
      x: orientationBounds.x + 4,
      y: orientationBounds.y + 4,
      width: orientationBounds.width - 8,
      height: orientationBounds.height - 20,
    }
    const cameraBeforeDrag = await page.screenshot({ clip: cameraBounds })

    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x + 45, handle.y, { steps: 5 })
    await expect(originX).not.toHaveValue("0 mm")
    const firstDragPosition = await originX.inputValue()
    await expect(viewport).toHaveAttribute("data-translation-gizmo-feature", /.+/)
    await page.mouse.move(handle.x + 75, handle.y, { steps: 5 })
    await expect(originX).not.toHaveValue(firstDragPosition)
    expect((await page.screenshot({ clip: cameraBounds })).equals(cameraBeforeDrag)).toBe(true)
    await page.keyboard.press("Escape")
    await expect(originX).toHaveValue("0 mm")
    await expect(height).toHaveValue("31 mm")
    await page.mouse.up()
    await expect(page.locator("footer[role='status']")).toContainText("Selection: None")

    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x + 90, handle.y, { steps: 10 })
    await page.mouse.up()
    await expect(originX).not.toHaveValue("0 mm")
    const movedOrigin = await originX.inputValue()
    expect((await page.screenshot({ clip: cameraBounds })).equals(cameraBeforeDrag)).toBe(true)

    await form.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect(viewport).not.toHaveAttribute("data-translation-gizmo-feature")

    await page.reload()
    await page.getByRole("treeitem", { name: "Box 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Origin X" }),
    ).toHaveValue(movedOrigin)
  })
})
