import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { pickSourceEdge } from "./source-edge-picking-support"

for (const operation of ["fillet", "chamfer"] as const) {
  test(`uses a circular edge selected before ${operation} and retains Section view through preview`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Cylinder")
    const cylinder = page.getByRole("form", { name: "Create cylinder", exact: true })
    await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const canvas = viewport.locator("canvas")
    const originalCanvas = await canvas.elementHandle()
    await page.getByRole("button", { name: "Standard views", exact: true }).click()
    await page.getByRole("menuitem", { name: "Top", exact: true }).click()
    await page.getByRole("button", { name: "Fit view", exact: true }).click()
    await page.getByRole("button", { name: "Section view", exact: true }).click()
    const section = page.getByRole("dialog", { name: "Section view", exact: true })
    await section.getByRole("radio", { name: "XY plane, normal Z", exact: true }).check()
    await section.getByRole("combobox", { name: "Section offset", exact: true }).fill("10")
    await page.keyboard.press("Escape")
    await page
      .getByRole("combobox", { name: "Selection filter", exact: true })
      .selectOption("edges")
    await pickSourceEdge(page)
    await expect(
      page
        .locator("footer")
        .getByRole("status")
        .filter({ hasText: /Cylinder 1 · 1 edge/ }),
    ).toBeVisible()
    await invokeModelCommand(page, "Modify", operation === "fillet" ? "Fillet" : "Chamfer")
    const form = page.getByRole("form", { name: `Create ${operation}`, exact: true })
    await expect(form.getByRole("button", { name: /^Remove Edge \d+$/ })).toHaveCount(1)
    await expect(viewport).toHaveAttribute("data-section-axis", "z")
    await expect(viewport).toHaveAttribute("data-section-offset", "10")
    await form.getByRole("button", { name: "Pick edges in viewport", exact: true }).click()
    await expect(viewport.getByText("Unsaved edge treatment preview", { exact: true })).toBeVisible(
      { timeout: 30_000 },
    )
    await form.getByRole("button", { name: `Create ${operation}`, exact: true }).click()
    await expect(
      page.getByRole("treeitem", {
        name: `${operation === "fillet" ? "Fillet" : "Chamfer"} 1`,
        exact: true,
      }),
    ).toBeVisible()
    await expect(viewport).toHaveAttribute("data-section-axis", "z")
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(
      true,
    )
    await page.screenshot({ path: test.info().outputPath(`${operation}-circular-section.png`) })
  })
}
