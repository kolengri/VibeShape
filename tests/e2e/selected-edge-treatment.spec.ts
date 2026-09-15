import { readFile } from "node:fs/promises"
import type { Download } from "@playwright/test"
import { readVersionedVShape } from "../../packages/formats/src/vshape"
import { expect, test } from "./fixtures"

for (const operation of ["fillet", "chamfer"] as const) {
  test(`keeps selected ${operation} edges through upstream edits, undo, reopen and native backup`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const name of ["Width", "Depth", "Height"])
      await boxForm.getByRole("combobox", { name, exact: true }).fill("20 mm")
    await boxForm.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const title = operation === "fillet" ? "Fillet" : "Chamfer"
    await toolbar.getByRole("button", { name: title, exact: true }).click()
    const form = page.getByRole("form", { name: `Create ${operation}` })
    await form.getByRole("radio", { name: "Selected edges", exact: true }).check()
    await expect(
      form.getByRole("button", { name: `Create ${operation}`, exact: true }),
    ).toBeDisabled()
    const picker = viewport.getByRole("combobox", { name: "Select an edge", exact: true })
    await picker.focus()
    await picker.selectOption({ index: 1 })
    await expect(form.getByRole("button", { name: "Remove edge", exact: true })).toHaveCount(1)
    await form.getByRole("button", { name: `Create ${operation}`, exact: true }).click()
    const treatment = page.getByRole("treeitem", { name: `${title} 1`, exact: true })
    await expect(treatment).toBeVisible()
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(treatment).toHaveCount(0)
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(treatment).toBeVisible()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    const boxEdit = page.getByRole("form", { name: "Edit box" })
    await boxEdit.getByRole("combobox", { name: "Height", exact: true }).fill("30 mm")
    await boxEdit.getByRole("button", { name: "Update box", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await page.reload()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await treatment.click()
    const edit = page.getByRole("form", { name: `Edit ${operation}` })
    await expect(edit.getByRole("radio", { name: "Selected edges", exact: true })).toBeChecked()
    await expect(edit.getByRole("button", { name: "Remove edge", exact: true })).toHaveCount(1)
    await expect(
      edit.getByRole("button", { name: `Update ${operation}`, exact: true }),
    ).toBeEnabled()
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), operation === "fillet")
    await page.screenshot({ path: test.info().outputPath(`selected-${operation}.png`) })
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Project…" }).click()
    const downloading = page.waitForEvent("download")
    await page
      .getByRole("dialog", { name: "Projects" })
      .getByRole("button", { name: "Download .vshape" })
      .click()
    await expectSelectedNativeBackup(await downloading, `${title} 1`)
  })
}

async function expectSelectedNativeBackup(download: Download, label: string) {
  const file = await download.path()
  if (!file) throw new Error("Expected a native backup.")
  const archive = await readVersionedVShape(new Uint8Array(await readFile(file)))
  if (!archive.ok || archive.value.version !== 2)
    throw new Error("Expected replay-proven selected-edge history.")
  const saved = archive.value.project.snapshot.features.find((feature) => feature.label === label)
  expect(saved?.type.schemaVersion).toBe(2)
  expect(saved?.references).toHaveLength(1)
  expect(saved?.references[0]?.kind).toBe("edge")
  expect(saved?.references[0]?.semanticRole).toBeTruthy()
  expect(JSON.stringify(saved?.references)).not.toContain("edgePolyline")
  expect(JSON.stringify(saved?.references)).not.toContain("candidateId")
}
