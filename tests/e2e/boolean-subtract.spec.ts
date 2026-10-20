import { saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand, openModelCommand } from "./model-command-support"

test.describe("Boolean subtraction", () => {
  test("restores selectable sources after a failed cut and preserves saved repair inputs", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto("/")
    const viewport = page.getByRole("region", { name: "3D viewport" })
    for (const label of ["Box 1", "Box 2"]) {
      await invokeModelCommand(page, "Primitives", "Box")
      const form = page.getByRole("form", { name: "Create box" })
      await form
        .getByRole("combobox", { name: "Height", exact: true })
        .fill(label === "Box 1" ? "40 mm" : "20 mm")
      await form.getByRole("button", { name: "Create box", exact: true }).click()
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toBeVisible()
    }
    await invokeModelCommand(page, "Modify", "Subtract")
    await expect(
      page
        .getByRole("form", { name: "Subtract solids" })
        .getByRole("button", { name: "Subtract", exact: true }),
    ).toBeEnabled({ timeout: 10_000 })
    await page
      .getByRole("form", { name: "Subtract solids" })
      .getByRole("button", { name: "Subtract", exact: true })
      .click()
    const failedFeature = page.getByRole("treeitem", { name: "Subtract 1", exact: true })
    await expect(failedFeature).toBeVisible()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    const sourceForm = page.getByRole("form", { name: "Edit box", exact: true })
    await sourceForm.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
    await sourceForm.getByRole("button", { name: "Update box", exact: true }).click()
    await expect(sourceForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeEnabled()
    await page.keyboard.press("Escape")
    await invokeModelCommand(page, "Modify", "Subtract")
    const createForm = page.getByRole("form", { name: "Subtract solids" })
    await expect(
      createForm.getByRole("combobox", { name: "Target solid" }).locator('option:not([value=""])'),
    ).toHaveText(["Box 1", "Box 2"])
    await createForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await failedFeature.click()
    const editForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      editForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      editForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Box 2")
    await editForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeEnabled()
    await page.keyboard.press("Escape")
  })

  test("creates, edits, reopens, and safely deletes ordered solid inputs", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeDisabled()
    await page.keyboard.press("Escape")

    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()

    async function createCylinder(radius: string, label: string) {
      await invokeModelCommand(page, "Primitives", "Cylinder")
      const form = page.getByRole("form", { name: "Create cylinder" })
      await form.getByRole("combobox", { name: "Radius" }).fill(radius)
      await form.getByRole("combobox", { name: "Height" }).fill("40 mm")
      await form.getByRole("checkbox", { name: "Center height about placement origin" }).check()
      await form.getByRole("button", { name: "Create cylinder" }).click()
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toBeVisible()
    }

    await createCylinder("5 mm", "Cylinder 1")
    await createCylinder("6 mm", "Cylinder 2")
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeEnabled()
    await invokeModelCommand(page, "Modify", "Subtract")

    const createForm = page.getByRole("form", { name: "Subtract solids" })
    const createTarget = createForm.getByRole("combobox", { name: "Target solid" })
    const createTool = createForm.getByRole("combobox", { name: "Tool solid" })
    await expect(createTarget.locator("option:checked")).toHaveText("Box 1")
    await expect(createTool.locator("option:checked")).toHaveText("Cylinder 1")
    const joined = await createTarget.evaluate((select) => {
      const button = select.parentElement?.parentElement?.querySelector("button")
      if (!button) throw new Error("Expected the joined viewport picker.")
      const main = button.getBoundingClientRect()
      const dropdown = select.getBoundingClientRect()
      return {
        heightDifference: Math.abs(main.height - dropdown.height),
        gap: dropdown.left - main.right,
      }
    })
    expect(joined.heightDifference).toBeLessThanOrEqual(1)
    expect(Math.abs(joined.gap)).toBeLessThanOrEqual(1)
    await createForm.screenshot({
      path: test.info().outputPath("joined-reference-picker-dark.png"),
    })
    const dark = await page.locator("html").evaluate((element) => {
      const dark = element.classList.contains("dark")
      element.classList.remove("dark")
      return dark
    })
    await createForm.screenshot({
      path: test.info().outputPath("joined-reference-picker-light.png"),
    })
    if (dark) await page.locator("html").evaluate((element) => element.classList.add("dark"))
    await expect(createForm.getByRole("checkbox", { name: "Keep tool solid" })).not.toBeChecked()
    await createForm.getByRole("button", { name: "Subtract" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()

    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    const editForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      editForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    const editTool = editForm.getByRole("combobox", { name: "Tool solid" })
    await expect(editTool.locator("option:checked")).toHaveText("Cylinder 1")
    await editTool.selectOption({ label: "Cylinder 2" })
    await editForm.getByRole("checkbox", { name: "Keep tool solid" }).check()
    await editForm.getByRole("button", { name: "Update subtraction" }).dblclick()
    await expect(editForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit subtraction" })
    await expect(
      reopenedForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      reopenedForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Cylinder 2")

    await expect(reopenedForm.getByRole("checkbox", { name: "Keep tool solid" })).toBeChecked()
    await reopenedForm.getByRole("checkbox", { name: "Keep tool solid" }).uncheck()
    await reopenedForm.getByRole("button", { name: "Update subtraction" }).click()
    await expect(reopenedForm).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await invokeModelCommand(page, "Modify", "Subtract")
    const nextForm = page.getByRole("form", { name: "Subtract solids" })
    // A terminal result retains its authored part name when its producing feature changes.
    await expect(
      nextForm.getByRole("combobox", { name: "Target solid" }).locator('option:not([value=""])'),
    ).toHaveText(["Cylinder 1", "Box 1"])
    await nextForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(nextForm).not.toBeVisible()

    const baseline = (await saveProject(page)).project.snapshot
    const savedBox = baseline.features.find(({ label }) => label === "Box 1")
    const savedSubtract = baseline.features.find(({ label }) => label === "Subtract 1")
    if (!savedBox || !savedSubtract)
      throw new Error("Expected both ordered source and Boolean records.")
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    await expect(page.getByRole("form", { name: "Edit box", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Delete feature" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Delete and keep references" })).toHaveCount(0)
    // Retained History removal keeps the downstream recipe repairable (ADR-0103).
    await page.getByRole("button", { name: "Delete feature", exact: true }).click()
    const sourceDeleteDialog = page.getByRole("alertdialog", { name: "Delete Box 1?", exact: true })
    await sourceDeleteDialog.getByRole("button", { name: "Delete feature", exact: true }).click()
    await expect(sourceDeleteDialog).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(0)
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
    await expect(
      page.locator(`[data-history-id="${savedSubtract.id}"]`).getByRole("img", {
        name: "Missing references — open this item to select replacement inputs.",
        exact: true,
      }),
    ).toBeVisible()
    const removed = (await saveProject(page)).project.snapshot
    if (removed.schemaVersion !== 5)
      throw new Error("Retained removal must preserve V5 repair authority.")
    const repair = removed.repairIntents.find(
      (intent) => intent.kind === "feature" && intent.authored.id === savedSubtract.id,
    )
    expect(repair?.authored).toEqual(savedSubtract)
    expect(repair?.missingInputs).toContainEqual({ kind: "feature", id: savedBox.id })
    expect(removed.features.find(({ id }) => id === savedSubtract.id)?.type.typeId).toBe(
      "org.vibeshape.feature.history.missing-input",
    )
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    const restored = (await saveProject(page)).project.snapshot
    if (restored.schemaVersion !== 5) throw new Error("Undo must retain V5 repair authority.")
    expect(restored.features).toEqual(baseline.features)
    expect(restored.repairIntents).toEqual([])
    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    const restoredForm = page.getByRole("form", { name: "Edit subtraction", exact: true })
    await expect(
      restoredForm.getByRole("combobox", { name: "Target solid" }).locator("option:checked"),
    ).toHaveText("Box 1")
    await expect(
      restoredForm.getByRole("combobox", { name: "Tool solid" }).locator("option:checked"),
    ).toHaveText("Cylinder 2")
    await expect(restoredForm.getByRole("checkbox", { name: "Keep tool solid" })).not.toBeChecked()
    await restoredForm.getByRole("button", { name: "Cancel", exact: true }).click()

    await page.getByRole("treeitem", { name: "Subtract 1", exact: true }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete Subtract 1?" })
    await expect(deleteDialog).toContainText("Later sketches and features are kept")
    await expect(deleteDialog).toContainText("Undo restores the feature and its references.")
    await deleteDialog.getByRole("button", { name: "Delete feature", exact: true }).dblclick()
    await expect(deleteDialog).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "3")

    await page.getByRole("treeitem", { name: "Cylinder 2", exact: true }).click()
    await page.getByRole("button", { name: "Delete feature" }).click()
    await page
      .getByRole("alertdialog", { name: "Delete Cylinder 2?" })
      .getByRole("button", { name: "Delete feature", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("treeitem", { name: "Subtract 1", exact: true })).not.toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Cylinder 2", exact: true })).not.toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()

    await page.getByRole("button", { name: "Compound", exact: true }).click()
    const compound = page.getByRole("form", { name: "Create Compound", exact: true })
    await compound.getByRole("button", { name: "Add part Box 1", exact: true }).click()
    await compound.getByRole("button", { name: "Add part Cylinder 1", exact: true }).click()
    await compound.getByRole("button", { name: "Create", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).toBeVisible()
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeEnabled()
    await invokeModelCommand(page, "Modify", "Subtract")
    const compoundCut = page.getByRole("form", { name: "Subtract solids" })
    await expect(
      compoundCut.getByRole("combobox", { name: "Target solid" }).locator('option:not([value=""])'),
    ).toHaveText(["Box 1", "Cylinder 1"])
    await expect(
      compoundCut.getByRole("combobox", { name: "Tool solid" }).locator('option:not([value=""])'),
    ).toHaveText(["Box 1", "Cylinder 1"])
    await compoundCut.getByRole("button", { name: "Cancel", exact: true }).click()
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Compound 1", exact: true })).not.toBeVisible()
    await expect(await openModelCommand(page, "Modify", "Subtract")).toBeEnabled()
  })
})
