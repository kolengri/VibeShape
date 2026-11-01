import { readFile } from "node:fs/promises"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("runs TypeScript in a real isolated worker, replays atomically, and records newly modeled identities", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await openApplicationMenuItem(page, "Scripts and macros…")
  const dialog = page.getByRole("dialog", { name: "Scripts and macros", exact: true })
  await dialog.getByRole("button", { name: "Load loop example" }).click()
  await dialog.getByRole("button", { name: "Run and preview" }).click()
  await expect(
    dialog.getByText("Geometry validated: 3 features, 0 sketches, 0 variables will be appended."),
  ).toBeVisible({ timeout: 40_000 })
  await dialog.getByRole("button", { name: "Apply recipe", exact: true }).click()
  await expect(
    dialog.getByText("Recipe applied. One Undo removes the complete replay."),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click()
  await saved(page)
  const generated = await saveProject(page)
  expect(generated.project.snapshot.features).toHaveLength(3)
  expect(generated.project.snapshot.parts).toHaveLength(3)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(3)

  await openApplicationMenuItem(page, "Scripts and macros…")
  await dialog.getByRole("button", { name: "Start recording", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("button", { name: "Create box", exact: true }).click()
  await saved(page)
  await openApplicationMenuItem(page, "Scripts and macros…")
  await dialog.getByRole("button", { name: "Stop recording", exact: true }).click()
  await expect(
    dialog.getByText("Recorded 1 new items and included 0 dependency items."),
  ).toBeVisible()
  const source = await dialog.getByRole("textbox", { name: "TypeScript source" }).inputValue()
  expect(source).toContain("org.vibeshape.feature.part-design.box")
  expect(source).not.toContain("org.vibeshape.feature.part-design.sphere")
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download .ts", exact: true }).click()
  const download = await downloading
  const path = await download.path()
  if (!path) throw new Error("The TypeScript download must be retained.")
  expect(await readFile(path, "utf8")).toBe(source)
  await dialog.getByRole("button", { name: "Run and preview" }).click()
  await expect(
    dialog.getByText("Geometry validated: 1 features, 0 sketches, 0 variables will be appended."),
  ).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole("button", { name: "Apply recipe", exact: true }).click()
  await expect(
    dialog.getByText("Recipe applied. One Undo removes the complete replay."),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(5)
  await openApplicationMenuItem(page, "Scripts and macros…")
  await dialog.getByRole("textbox", { name: "TypeScript source" }).fill("while (true) {}")
  await dialog.getByRole("button", { name: "Run and preview" }).click()
  await dialog.getByRole("button", { name: "Cancel preview", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("cancelled")
  await expect(dialog.getByRole("button", { name: "Apply recipe", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("textbox", { name: "TypeScript source" })).toHaveValue(
    "while (true) {}",
  )
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click()
  expect((await saveProject(page)).project.snapshot.features).toHaveLength(5)
})
