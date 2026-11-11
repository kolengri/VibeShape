import { readFile } from "node:fs/promises"
import type { Download } from "@playwright/test"
import type { FeatureRecord } from "../../packages/domain/src/feature-graph"
import {
  chamferFeatureParametersV3Schema,
  readFilletFeatureParametersV3,
} from "../../packages/domain/src/part-design"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

for (const operation of ["fillet", "chamfer"] as const) {
  test(`keeps selected ${operation} edges through upstream edits, undo, reopen and native backup`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await invokeModelCommand(page, "Primitives", "Box")
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const name of ["Width", "Depth", "Height"])
      await boxForm.getByRole("combobox", { name, exact: true }).fill("20 mm")
    await boxForm.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const title = operation === "fillet" ? "Fillet" : "Chamfer"
    await invokeModelCommand(page, "Modify", title)
    const form = page.getByRole("form", { name: `Create ${operation}` })
    await expect(form.getByRole("radio", { name: "Selected edges", exact: true })).toBeChecked()
    await expect(form.getByRole("status")).toHaveText(
      operation === "chamfer" ? "No targets selected" : "No edges selected",
    )
    if (operation === "chamfer")
      await expect(
        form.getByRole("checkbox", { name: "Propagate along tangent edges" }),
      ).toBeChecked()
    await expect(
      form.getByRole("button", { name: `Create ${operation}`, exact: true }),
    ).toBeDisabled()
    await form.getByText("Keyboard choices", { exact: true }).focus()
    await form.getByText("Keyboard choices", { exact: true }).click()
    await form.getByRole("button", { name: "Box 1 · Edge 1", exact: true }).click()
    await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
    const accept = form.getByRole("button", { name: `Create ${operation}`, exact: true })
    await expect(accept).toBeEnabled()
    const beforeFocus = await accept.boundingBox()
    if (!beforeFocus) throw new Error("Expected visible edge-treatment acceptance control.")
    await accept.focus()
    await expect.poll(async () => (await accept.boundingBox())?.y).toBe(beforeFocus.y)
    await accept.click()
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
    await expect(edit.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
    await expect(
      edit.getByRole("button", { name: `Update ${operation}`, exact: true }),
    ).toBeEnabled()
    await page.locator("html").evaluate((element, dark) => {
      const root = element as unknown as {
        classList: { toggle: (token: string, force: boolean) => boolean }
      }
      root.classList.toggle("dark", dark)
    }, operation === "fillet")
    await page.screenshot({ path: test.info().outputPath(`selected-${operation}.png`) })
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    const downloading = page.waitForEvent("download")
    await openApplicationMenuItem(page, "Save project (.vshape)")
    await expectSelectedNativeBackup(await downloading, `${title} 1`, operation)
  })
}

test("fillets a named Pattern output with a variable radius and restores it after reload", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const boxForm = page.getByRole("form", { name: "Create box" })
  await boxForm.getByRole("button", { name: "Create box", exact: true }).click()
  const box = page.getByRole("treeitem", { name: "Part Box 1", exact: true })
  await expect(box).toBeVisible({ timeout: 30_000 })
  await saved(page)
  await box.click()
  await page.getByRole("button", { name: "Pattern", exact: true }).click()
  const pattern = page.getByRole("form", { name: "Pattern body", exact: true })
  await expect(pattern).toBeVisible()
  await pattern.getByRole("combobox", { name: "Instance count", exact: true }).fill("2")
  await pattern.getByRole("combobox", { name: "Spacing", exact: true }).fill("40 mm")
  const applyPattern = pattern.getByRole("button", { name: "Apply feature", exact: true })
  await expect(applyPattern).toBeEnabled({ timeout: 30_000 })
  await applyPattern.click()
  await expect(pattern).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: "Pattern 1", exact: true })).toBeVisible()
  await saved(page)
  await invokeModelCommand(page, "Modify", "Fillet")
  const form = page.getByRole("form", { name: "Create fillet" })
  await expect(form.getByText(/complete tangent chain of each picked edge/)).toBeVisible()
  await form.getByText("Keyboard choices", { exact: true }).focus()
  await form.getByText("Keyboard choices", { exact: true }).click()
  const firstEdges = form.getByRole("button", { name: / · Edge 1$/ })
  await expect(firstEdges).toHaveCount(2)
  await firstEdges.nth(1).click()
  await expect(form.getByRole("radio", { name: "All edges", exact: true })).toBeDisabled()
  await form.getByRole("checkbox", { name: "Variable radius for Edge 1", exact: true }).check()
  await form.getByRole("combobox", { name: "End radius for Edge 1", exact: true }).fill("1.5 mm")
  await form
    .getByRole("checkbox", { name: "Reverse radius direction for Edge 1", exact: true })
    .check()
  const accept = form.getByRole("button", { name: "Create fillet", exact: true })
  await expect(accept).toBeEnabled({ timeout: 30_000 })
  await accept.click()
  const treatment = page.getByRole("treeitem", { name: "Fillet 1", exact: true })
  await expect(treatment).toBeVisible()
  await saved(page)
  const archive = await saveProject(page)
  const fillet = archive.project.snapshot.features.find(({ label }) => label === "Fillet 1")
  const parameters = fillet ? readFilletFeatureParametersV3(fillet) : null
  expect(fillet?.references).toEqual([])
  expect(parameters?.targetBody.outputRole).toMatch(/^pattern\.instance\.\d+$/)
  expect(parameters?.targets).toEqual([
    expect.objectContaining({
      kind: "edge",
      variableRadius: expect.objectContaining({
        startRadius: expect.objectContaining({ value: 1 }),
        endRadius: expect.objectContaining({ value: 1.5 }),
        reverse: true,
      }),
    }),
  ])
  await page.reload()
  await expect(treatment).toBeVisible()
  await treatment.click()
  const edit = page.getByRole("form", { name: "Edit fillet" })
  await expect(
    edit.getByRole("checkbox", { name: "Reverse radius direction for Edge 1", exact: true }),
  ).toBeChecked()
  await expect(
    edit.getByRole("combobox", { name: "End radius for Edge 1", exact: true }),
  ).toHaveValue("1.5 mm")
  await expect(edit.getByRole("button", { name: "Update fillet", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
})

async function expectSelectedNativeBackup(
  download: Download,
  label: string,
  operation: "fillet" | "chamfer",
) {
  const file = await download.path()
  if (!file) throw new Error("Expected a native backup.")
  const archive = await readAuthoredVShape(new Uint8Array(await readFile(file)))
  if (!archive.ok || archive.value.version !== 3)
    throw new Error("Expected replay-proven selected-edge history.")
  const saved = archive.value.project.snapshot.features.find((feature) => feature.label === label)
  if (!saved) throw new Error(`Expected the saved ${label} feature.`)
  const references = selectedTreatmentReferences(saved, operation)
  expect(references).toHaveLength(1)
  expect(references[0]?.kind).toBe("edge")
  expect(references[0]?.semanticRole).toBeTruthy()
  expect(JSON.stringify(references)).not.toContain("edgePolyline")
  expect(JSON.stringify(references)).not.toContain("candidateId")
}

function selectedTreatmentReferences(
  feature: Pick<FeatureRecord, "type" | "parameters" | "references">,
  operation: "fillet" | "chamfer",
) {
  if (operation === "fillet") {
    expect(feature.type.schemaVersion).toBe(2)
    return feature.references
  }
  expect(feature.type.schemaVersion).toBe(3)
  const parameters = chamferFeatureParametersV3Schema.parse(feature.parameters)
  expect(parameters.tangentPropagation).toBe(true)
  return parameters.targets.flatMap((target) => (target.kind === "edge" ? [target.edge] : []))
}
