import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"

test.describe("native project file", () => {
  test("backs up and opens a configurable model in fresh browser storage", async ({
    browser,
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("heading", { name: "Variables", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("width")
    await page.getByRole("textbox", { name: "Variable expression" }).fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).click()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    const createBox = page.getByRole("form", { name: "Create box" })
    await createBox.getByRole("textbox", { name: "Width" }).fill("#width")
    await createBox.getByRole("button", { name: "Create box" }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    await page.getByRole("button", { name: "Project…" }).click()
    const backupDownload = page.waitForEvent("download")
    await page
      .getByRole("dialog", { name: "Projects" })
      .getByRole("button", { name: "Download .vshape" })
      .dblclick()
    const download = await backupDownload
    expect(download.suggestedFilename()).toBe("Untitled project.vshape")
    const backupPath = await download.path()
    if (!backupPath) throw new Error("Playwright did not retain the .vshape download.")
    const backupBytes = await readFile(backupPath)
    expect(backupBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    await page.getByRole("button", { name: "Project…" }).click()
    const currentProjectDialog = page.getByRole("dialog", { name: "Projects" })
    await currentProjectDialog.getByLabel("Choose VibeShape project file").setInputFiles(backupPath)
    await expect(currentProjectDialog.getByRole("alert")).toContainText(
      "This exact project already exists in this browser.",
    )
    await currentProjectDialog.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    const importedContext = await browser.newContext()
    const importedPage = await importedContext.newPage()
    const runtimeErrors: string[] = []
    importedPage.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`)
    })
    importedPage.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`))

    try {
      await importedPage.goto("http://127.0.0.1:4173/")
      await expect(importedPage.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await importedPage.getByRole("button", { name: "Project…" }).click()
      await importedPage.getByLabel("Choose VibeShape project file").setInputFiles(backupPath)

      await expect(importedPage.getByRole("treeitem", { name: "Box 1" })).toBeVisible({
        timeout: 30_000,
      })
      const viewport = importedPage.getByRole("region", { name: "3D viewport" })
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
      await importedPage.getByRole("treeitem", { name: "Variables" }).click()
      await expect(importedPage.getByRole("textbox", { name: "Variable name" })).toHaveValue(
        "width",
      )
      await expect(importedPage.getByRole("textbox", { name: "Variable expression" })).toHaveValue(
        "24 mm",
      )
      await importedPage.getByRole("treeitem", { name: "Box 1" }).click()
      await expect(
        importedPage
          .getByRole("form", { name: "Edit box" })
          .getByRole("textbox", { name: "Width" }),
      ).toHaveValue("#width")
      expect(runtimeErrors).toEqual([])
    } finally {
      await importedContext.close()
    }
  })

  test("creates a new local project and reopens an existing configurable project", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()

    await page.getByRole("button", { name: "Project…" }).click()
    const createdProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await page
      .getByRole("dialog", { name: "Projects" })
      .getByRole("button", {
        name: "New project",
      })
      .click()
    await createdProjectNavigation
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Box 1" })).toHaveCount(0)

    await page.getByRole("button", { name: "Project…" }).click()
    const dialog = page.getByRole("dialog", { name: "Projects" })
    const previousProject = dialog.getByRole("listitem").filter({ hasText: "Revision 2" })
    await expect(previousProject).toHaveCount(1)
    const reopenedProjectNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    )
    await previousProject.getByRole("button", { name: /Open .*revision 2/ }).click()
    await reopenedProjectNavigation

    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible({ timeout: 30_000 })
  })
})
