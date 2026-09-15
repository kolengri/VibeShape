import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"

for (const operation of ["fillet", "chamfer"] as const) {
  test(`${operation} previews, rejects invalid geometry, edits and reopens a variable-driven body`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const title = operation === "fillet" ? "Fillet" : "Chamfer"
    const dimension = operation === "fillet" ? "Radius" : "Distance"
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await expect(toolbar.getByRole("button", { name: title, exact: true })).toBeDisabled()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("edgeSize")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("1 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const box = page.getByRole("form", { name: "Create box" })
    for (const name of ["Width", "Depth", "Height"]) {
      await box.getByRole("combobox", { name }).fill("20 mm")
    }
    await box.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await toolbar.getByRole("button", { name: title, exact: true }).click()
    const form = page.getByRole("form", { name: `Create ${operation}` })
    const size = form.getByRole("combobox", { name: dimension, exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await size.fill("100 mm")
    await expect(
      viewport.getByText(
        "The edge treatment could not be previewed. Reduce its size or choose another body.",
      ),
    ).toBeVisible({ timeout: 60_000 })
    await expect(form.getByRole("button", { name: `Create ${operation}` })).toBeDisabled()
    await expect(page.getByRole("treeitem", { name: `${title} 1`, exact: true })).toHaveCount(0)
    await size.fill("#edgeSize")
    await expect(viewport.getByText("Unsaved edge treatment preview", { exact: true })).toBeVisible(
      { timeout: 60_000 },
    )
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: `${title} 1`, exact: true })).toHaveCount(0)
    await toolbar.getByRole("button", { name: title, exact: true }).click()
    await size.fill("#edgeSize")
    await form.getByRole("button", { name: `Create ${operation}` }).dblclick()
    const item = page.getByRole("treeitem", { name: `${title} 1`, exact: true })
    await expect(item).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await item.click()
    const edit = page.getByRole("form", { name: `Edit ${operation}` })
    await expect(edit.getByRole("combobox", { name: dimension, exact: true })).toHaveValue(
      "#edgeSize",
    )
    await edit.getByRole("combobox", { name: dimension, exact: true }).fill("#edgeSize * 2")
    await edit.getByRole("button", { name: `Update ${operation}` }).click()
    await expect(edit).not.toBeVisible()
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await item.click()
    await expect(edit.getByRole("combobox", { name: dimension, exact: true })).toHaveValue(
      "#edgeSize * 2",
    )
    await expect(edit.getByRole("combobox", { name: "Target body", exact: true })).toContainText(
      "Box 1",
    )
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), operation === "fillet")
    await expect(edit.getByRole("button", { name: `Update ${operation}` })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Delete feature", exact: true })).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath(`${operation}-editor.png`) })
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Export…", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Export model" })
    const downloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: /Export STEP/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.step$/)
    expect(await download.failure()).toBeNull()
    const path = await download.path()
    if (!path) throw new Error("The STEP export was not retained.")
    const bytes = await readFile(path)
    expect(bytes.subarray(0, 13).toString("ascii")).toBe("ISO-10303-21;")
    await page.keyboard.press("Escape")
    await item.click()
    await page.getByRole("button", { name: "Delete feature", exact: true }).click()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete feature", exact: true })
      .click()
    await expect(item).toHaveCount(0)
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
  })
}
