import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

for (const kind of ["fillet", "chamfer"] as const) {
  test(`previews, cancels, applies and undoes sketch ${kind} as one draft edit`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Create sketch", exact: true })
      .click()
    await confirmSketchPlane(page, "xy")
    const drawing = await drawRectangle(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", {
        name: kind === "fillet" ? "Sketch fillet" : "Sketch chamfer",
        exact: true,
      })
      .click()
    const lines = drawing.locator('[data-sketch-entity-type="line"]')
    for (const index of [0, 1]) {
      const bounds = await lines.nth(index).boundingBox()
      if (!bounds) throw new Error("The selected corner line is not visible.")
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }
    const form = page.getByRole("form", {
      name: kind === "fillet" ? "Sketch fillet" : "Sketch chamfer",
      exact: true,
    })
    await expect(form.getByRole("img", { name: "Corner treatment preview" })).toBeVisible()
    await expect(form.getByRole("button", { name: "Apply corner treatment" })).toBeEnabled()
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(lines).toHaveCount(4)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(0)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", {
        name: kind === "fillet" ? "Sketch fillet" : "Sketch chamfer",
        exact: true,
      })
      .click()
    await form.getByRole("button", { name: "Apply corner treatment" }).click()
    await expect(lines).toHaveCount(kind === "fillet" ? 6 : 7)
    await expect(drawing.locator('[data-sketch-entity-type="arc"]')).toHaveCount(
      kind === "fillet" ? 1 : 0,
    )
    await expect(drawing.locator("[data-sketch-profile-index]")).toHaveCount(1)
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(lines).toHaveCount(4)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(lines).toHaveCount(kind === "fillet" ? 6 : 7)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  })
}
