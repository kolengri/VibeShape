import type { Locator } from "@playwright/test"
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
    // Ending the manipulator must not resume a camera gesture from the same pointer-down.
    await page.mouse.move(handle.x + 140, handle.y + 60, { steps: 5 })
    expect((await page.screenshot({ clip: cameraBounds })).equals(cameraBeforeDrag)).toBe(true)
    await page.mouse.up()
    await expect(page.locator("footer[role='status']")).toContainText("Selection: None")

    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x + 90, handle.y, { steps: 10 })
    await page.mouse.up()
    await expect(originX).not.toHaveValue("0 mm")
    const movedOrigin = await originX.inputValue()
    await page.mouse.move(handle.x + 200, handle.y + 80, { steps: 5 })
    expect((await page.screenshot({ clip: cameraBounds })).equals(cameraBeforeDrag)).toBe(true)

    // Camera navigation resumes only with a new gesture away from the manipulator.
    await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.1)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.15, {
      steps: 5,
    })
    await page.mouse.up()
    expect((await page.screenshot({ clip: cameraBounds })).equals(cameraBeforeDrag)).toBe(false)
    await expect(originX).toHaveValue(movedOrigin)

    await form.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect(viewport).not.toHaveAttribute("data-translation-gizmo-feature")

    await page.reload()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(
      page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Origin X" }),
    ).toHaveValue(movedOrigin)
  })

  for (const { editing, releaseOnly } of [
    { editing: false, releaseOnly: false },
    { editing: true, releaseOnly: false },
    { editing: true, releaseOnly: true },
  ]) {
    test(`retains a ${releaseOnly ? "coalesced" : "rapid"} ${editing ? "edited" : "new"} Box placement after pointer-up`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        releaseOnly && browserName !== "chromium",
        "Native release coordinates require CDP.",
      )
      await page.goto("/")
      await page
        .getByRole("toolbar", { name: "Model commands" })
        .getByRole("button", { name: "Box", exact: true })
        .click()
      const viewport = page.getByRole("region", { name: "3D viewport" })
      const canvas = viewport.locator("canvas")
      if (editing) {
        await page
          .getByRole("form", { name: "Create box" })
          .getByRole("button", { name: "Create box" })
          .click()
        await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
      }
      const form = page.getByRole("form", { name: editing ? "Edit box" : "Create box" })
      const originX = form.getByRole("combobox", { name: "Origin X" })
      await expect(viewport).toHaveAttribute("data-preview-status", "ready")
      await expect(viewport).toHaveAttribute("data-translation-gizmo-position", "0,0,0")
      const { x, y } = await translationXAxisHandle(canvas)
      await page.mouse.move(x, y)
      await page.mouse.down()
      if (releaseOnly) {
        const session = await page.context().newCDPSession(page)
        // Deliver the release endpoint without a preceding pointer-move sample.
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: x + 90,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        })
        await session.detach()
      } else {
        await page.mouse.move(x + 90, y)
      }
      await page.mouse.up()
      await expect(originX).not.toHaveValue("0 mm")
      const releasedPosition = await originX.inputValue()
      await expect(viewport).toHaveAttribute("data-preview-status", "ready")
      await expect(originX).toHaveValue(releasedPosition)
      await expect(viewport).not.toHaveAttribute("data-translation-gizmo-position", "0,0,0")
      await form.getByRole("button", { name: editing ? "Update box" : "Create box" }).click()
      await expect(form).not.toBeVisible()
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
      await expect(
        page.getByRole("form", { name: "Edit box" }).getByRole("combobox", { name: "Origin X" }),
      ).toHaveValue(releasedPosition)
    })
  }
})

async function translationXAxisHandle(canvas: Locator) {
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
  const origin = await canvas.getAttribute("data-translation-gizmo-origin")
  if (!origin) throw new Error("The translation gizmo has no projected origin.")
  const [originScreenX, originScreenY] = origin.split(",").map(Number)
  if (originScreenX === undefined || originScreenY === undefined)
    throw new Error("Invalid gizmo origin.")
  return { x: bounds.x + originScreenX + 82, y: bounds.y + originScreenY + 40 }
}
