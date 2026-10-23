import { boxFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { readShellFeatureParameters } from "../../packages/domain/src/part-design-shell"
import { openApplicationMenuItem } from "./application-menu-support"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

function shellParameters(project: Awaited<ReturnType<typeof saveProject>>, featureId: string) {
  const feature = project.project.snapshot.features.find(({ id }) => id === featureId)
  if (!feature) throw new Error("The authored Shell must survive persistence.")
  const parameters = readShellFeatureParameters(feature)
  if (!parameters) throw new Error("Persisted Shell parameters must remain valid.")
  return parameters
}

test("previews Shell, replaces the same part, edits, undoes, reopens, exports and retains semantic opening faces after source edits", async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Shell", exact: true }).click()
  let form = page.getByRole("form", { name: "Shell", exact: true })
  await expect(form.getByRole("button", { name: "Apply shell", exact: true })).toBeDisabled()
  // The box is symmetric in XY; its top face is the catalog entry with the greatest positive Z center.
  const initialBox = before.project.snapshot.features.find(({ label }) => label === "Box 1")
  const height = boxFeatureParametersSchema.parse(initialBox?.parameters).height.value
  const top = new RegExp(`center \\(0\\.00, 0\\.00, ${height.toFixed(2).replace(".", "\\.")}\\)`)
  await form.locator("summary").click()
  await form.getByRole("checkbox", { name: top }).check()
  await expect(form.getByRole("button", { name: "Apply shell", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  const canceled = await saveProject(page)
  expect(canceled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(canceled.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Shell", exact: true }).click()
  form = page.getByRole("form", { name: "Shell", exact: true })
  await form.locator("summary").click()
  await form.getByRole("checkbox", { name: top }).check()
  await expect(form.getByRole("button", { name: "Apply shell", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply shell", exact: true }).click()
  await saved(page)
  const applied = await saveProject(page)
  const shell = applied.project.snapshot.features.find((feature) =>
    readShellFeatureParameters(feature),
  )
  if (!shell) throw new Error("An authored Shell must be saved.")
  expect(applied.project.snapshot.parts.map(({ id }) => id)).toEqual(
    before.project.snapshot.parts.map(({ id }) => id),
  )
  expect(applied.project.snapshot.features.filter(({ id }) => id !== shell.id)).toEqual(
    before.project.snapshot.features,
  )
  expect(readShellFeatureParameters(shell)?.openings).toHaveLength(1)
  expect(JSON.stringify(shell.parameters)).not.toContain("candidateId")
  await page.getByRole("treeitem", { name: "Shell 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit shell", exact: true })
  await form.locator("summary").click()
  await expect(form.getByRole("checkbox", { name: top })).toBeChecked()
  await form.getByRole("radio", { name: /Outward/ }).check()
  await expect(form.getByRole("button", { name: "Update shell", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update shell", exact: true }).click()
  await saved(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  const reloaded = await saveProject(page)
  expect(shellParameters(reloaded, shell.id).direction).toBe("outward")
  await openProject(page, reloaded)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(reloaded.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(reloaded.project.snapshot.parts)
  await openApplicationMenuItem(page, "Export geometry…")
  const exportDialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await exportDialog.getByRole("combobox", { name: "Export scope", exact: true }).click()
  await page.getByRole("option", { name: "Box 1", exact: true }).click()
  const downloading = page.waitForEvent("download")
  await exportDialog.getByRole("combobox", { name: "File format" }).selectOption("step")
  await exportDialog.getByRole("button", { name: "Save STEP file", exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.step$/)
  await expect(exportDialog).not.toBeVisible()
  await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
  const boxForm = page.getByRole("form", { name: "Edit box", exact: true })
  await boxForm.getByRole("combobox", { name: "Height", exact: true }).fill(`${height + 5} mm`)
  await boxForm.getByRole("button", { name: "Update box", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Shell 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit shell", exact: true })
  await expect(form.getByText(/Reselect all opening faces/)).toHaveCount(0)
  await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(1)
  await expect(form.getByRole("button", { name: "Update shell", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update shell", exact: true }).click()
  await saved(page)
  const repaired = await saveProject(page)
  expect(shellParameters(repaired, shell.id).sourceContentHash).not.toBe(
    readShellFeatureParameters(shell)?.sourceContentHash,
  )
  expect(repaired.project.snapshot.parts.map(({ id }) => id)).toEqual(
    before.project.snapshot.parts.map(({ id }) => id),
  )
})

test("selects opening faces in 3D and switches to a persisted closed cavity", async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await commands.getByRole("button", { name: "Shell", exact: true }).click()
  const form = page.getByRole("form", { name: "Shell", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const bounds = await viewport.boundingBox()
  if (!bounds) throw new Error("Shell requires a visible source viewport.")
  const point = { x: bounds.x + bounds.width * 0.43, y: bounds.y + bounds.height * 0.44 }
  await page.mouse.click(point.x, point.y)
  await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(1)
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await page.mouse.click(point.x, point.y)
  await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-preview-status", "idle")
  await form.getByRole("radio", { name: "Closed cavity", exact: true }).check()
  await expect(form.getByRole("checkbox")).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Apply shell", exact: true }).click()
  await saved(page)
  const archive = await saveProject(page)
  const feature = archive.project.snapshot.features.find((candidate) =>
    readShellFeatureParameters(candidate),
  )
  if (!feature) throw new Error("The closed cavity must be authored.")
  expect(feature.type.schemaVersion).toBe(2)
  expect(readShellFeatureParameters(feature)?.openings).toEqual([])
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Shell 1", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await openProject(page, archive)
  await page.getByRole("treeitem", { name: "Shell 1", exact: true }).click()
  await expect(
    page
      .getByRole("form", { name: "Edit shell", exact: true })
      .getByRole("radio", { name: "Closed cavity", exact: true }),
  ).toBeChecked()
})
