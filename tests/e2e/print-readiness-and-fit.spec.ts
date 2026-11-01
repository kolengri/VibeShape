import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { closeVariablesDialog } from "./variables-ui-support"

test("checks actual print orientation and retains shared radial clearance through save, Undo and reload", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Print fit clearance", exact: true }).click()
  const fit = page.getByRole("region", { name: "Print fit clearance", exact: true })
  await expect(fit).toContainText("#tolerance is absent")
  await fit.getByRole("button", { name: "Normal · 0.2 mm", exact: true }).click()
  await expect(fit).toContainText("Current radial allowance: 0.2 mm")
  await fit.screenshot({ path: test.info().outputPath("fit-clearance.png") })
  await closeVariablesDialog(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  await box.getByRole("combobox", { name: "Height", exact: true }).fill("2 * #tolerance")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).not.toBeVisible()
  await openApplicationMenuItem(page, "Export geometry…")
  const dialog = page.getByRole("dialog", { name: "Export model", exact: true })
  await dialog.getByRole("button", { name: "Prepare print…", exact: true }).click()
  await dialog.getByLabel("Tilt around X (degrees)").fill("0")
  await dialog.getByRole("button", { name: "Generate print preview", exact: true }).click()
  const analysis = dialog.getByRole("region", { name: "Print readiness", exact: true })
  await analysis.getByRole("button", { name: "Analyze print copy", exact: true }).click()
  await expect(analysis).toContainText("Review highlighted samples before printing")
  await expect(analysis).toContainText("Sampled minimum: 0.4 mm")
  await expect(analysis).toContainText("Thin: 4 triangles")
  await analysis
    .getByRole("spinbutton", { name: "Minimum sampled wall thickness (mm)", exact: true })
    .fill("0.2")
  await expect(analysis).not.toContainText("Review highlighted samples before printing")
  await analysis.getByRole("button", { name: "Analyze print copy", exact: true }).click()
  await expect(analysis).toContainText("No issues found in measured samples")
  await dialog.getByLabel("Tilt around X (degrees)").fill("30")
  await expect(analysis).not.toBeVisible()
  await dialog.getByRole("button", { name: "Generate print preview", exact: true }).click()
  await analysis.getByRole("button", { name: "Analyze print copy", exact: true }).click()
  await expect(analysis).toContainText("Overhang: 2 triangles")
  await expect(analysis).toContainText("Review highlighted samples before printing")
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const dark of [true, false]) {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page
      .locator("html")
      .evaluate((element, value) => element.classList.toggle("dark", value), dark)
    const canvas = dialog.getByLabel("Prepared print model and breakaway fins", { exact: true })
    await canvas.scrollIntoViewIfNeeded()
    await canvas.screenshot({
      path: test.info().outputPath(`readiness-shading-${dark ? "dark" : "light"}.png`),
    })
    await analysis.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath(`readiness-${dark ? "dark" : "light"}.png`),
    })
  }
  await page.setViewportSize({ width: 512, height: 384 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await analysis.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Print fit clearance", exact: true }).click()
  await fit.getByRole("button", { name: "Loose · 0.3 mm", exact: true }).click()
  await expect(fit).toContainText("Current radial allowance: 0.3 mm")
  await closeVariablesDialog(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  await page.reload()
  await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
  await page.getByRole("button", { name: "Print fit clearance", exact: true }).click()
  await expect(fit).toContainText("Current radial allowance: 0.2 mm")
})
