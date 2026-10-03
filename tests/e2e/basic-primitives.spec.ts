import { expect as baseExpect, test } from "./fixtures"

test.setTimeout(60_000)
const expect = baseExpect.configure({ timeout: 15_000 })

const primitives = [
  { name: "Sphere", fields: { Radius: "14 mm" } },
  { name: "Cone", fields: { Radius: "12 mm", Height: "35 mm" } },
  { name: "Torus", fields: { "Major radius": "24 mm", "Minor radius": "6 mm" } },
] as const

for (const primitive of primitives) {
  test(`${primitive.name} previews, commits once, supports undo, and restores editable parameters`, async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await toolbar.getByRole("button", { name: primitive.name, exact: true }).click()
    const createForm = page.getByRole("form", { name: `Create ${primitive.name.toLowerCase()}` })
    for (const [name, value] of Object.entries(primitive.fields)) {
      await createForm.getByRole("combobox", { name, exact: true }).fill(value)
    }
    await createForm.getByRole("combobox", { name: "Origin X", exact: true }).fill("40 mm")
    await createForm.getByRole("combobox", { name: "Origin Y", exact: true }).fill("-8 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    const treeItem = page.getByRole("treeitem", { name: `${primitive.name} 1`, exact: true })
    await expect(treeItem).toHaveCount(0)
    await createForm
      .getByRole("button", { name: `Create ${primitive.name.toLowerCase()}`, exact: true })
      .dblclick()
    await expect(treeItem).toHaveCount(1)
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(treeItem).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(treeItem).toBeVisible()
    await treeItem.click()
    const editForm = page.getByRole("form", { name: `Edit ${primitive.name.toLowerCase()}` })
    for (const [name, value] of Object.entries(primitive.fields)) {
      await expect(editForm.getByRole("combobox", { name, exact: true })).toHaveValue(value)
    }
    await editForm.getByRole("combobox", { name: "Origin X", exact: true }).fill("52 mm")
    await editForm
      .getByRole("button", { name: `Update ${primitive.name.toLowerCase()}`, exact: true })
      .click()
    await expect(editForm).not.toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await treeItem.click()
    for (const [name, value] of Object.entries(primitive.fields)) {
      await expect(editForm.getByRole("combobox", { name, exact: true })).toHaveValue(value)
    }
    await expect(editForm.getByRole("combobox", { name: "Origin X", exact: true })).toHaveValue(
      "52 mm",
    )
    await expect(editForm.getByRole("combobox", { name: "Origin Y", exact: true })).toHaveValue(
      "-8 mm",
    )
  })
}

test("Torus rejects overlapping radii and cancels its preview without a committed feature", async ({
  page,
}) => {
  await page.goto("/")
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await toolbar.getByRole("button", { name: "Torus", exact: true }).click()
  const form = page.getByRole("form", { name: "Create torus" })
  await form.getByRole("combobox", { name: "Major radius", exact: true }).fill("10 mm")
  await form.getByRole("combobox", { name: "Minor radius", exact: true }).fill("12 mm")
  await form.getByRole("combobox", { name: "Minor radius", exact: true }).blur()
  await expect(form.getByRole("button", { name: "Create torus", exact: true })).toBeDisabled()
  await expect(form.getByRole("combobox", { name: "Minor radius", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  )
  await expect(form).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Torus 1", exact: true })).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await form.getByRole("combobox", { name: "Minor radius", exact: true }).fill("3 mm")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready")
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(form).not.toBeVisible()
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  await expect(page.getByRole("treeitem", { name: "Torus 1", exact: true })).toHaveCount(0)
  await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeDisabled()
})
