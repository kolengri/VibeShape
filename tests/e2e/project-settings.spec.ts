import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"

for (const width of [1440, 512, 390]) {
  test(`keeps File and Settings discoverable and persists browser preferences at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 512 ? 384 : 844 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeAttached({
      timeout: 30_000,
    })
    const trigger = page.getByRole("button", { name: "Application menu", exact: true })
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await openApplicationMenuItem(page, "Files and projects…")
    const projects = page.getByRole("dialog", { name: "Projects", exact: true })
    await expect(
      projects.getByRole("button", { name: "Save project (.vshape)", exact: true }),
    ).toBeInViewport()
    const openProject = projects.getByRole("button", {
      name: "Open project (.vshape)",
      exact: true,
    })
    await openProject.scrollIntoViewIfNeeded()
    await expect(openProject).toBeInViewport({ ratio: 1 })
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath(`file-${width}-dark.png`),
    })
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
    await openApplicationMenuItem(page, "Settings…")
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    await expect(page.getByRole("dialog")).toHaveCount(1)
    await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
    await page.getByRole("option", { name: "Light", exact: true }).click()
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath(`settings-${width}-light.png`),
    })
    await settings.getByRole("checkbox", { name: /Automatically hide sketches/ }).uncheck()
    await settings.getByRole("combobox", { name: "Preferred export format", exact: true }).click()
    await page.getByRole("option", { name: "STEP", exact: true }).click()
    await settings.getByRole("button", { name: "Done", exact: true }).click()
    await expect(trigger).toBeFocused()
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeAttached()
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    await openApplicationMenuItem(page, "Settings…")
    await expect(settings.getByRole("combobox", { name: "Theme", exact: true })).toContainText(
      "Light",
    )
    await expect(
      settings.getByRole("checkbox", { name: /Automatically hide sketches/ }),
    ).not.toBeChecked()
    await expect(
      settings.getByRole("combobox", { name: "Preferred export format", exact: true }),
    ).toContainText("STEP")
    await settings.getByRole("combobox", { name: "Theme", exact: true }).click()
    await page.getByRole("option", { name: "Dark", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath(`settings-${width}-dark.png`),
    })
    await settings.getByRole("button", { name: "Done", exact: true }).click()
    await openApplicationMenuItem(page, "Export geometry…")
    const exporting = page.getByRole("dialog", { name: "Export model", exact: true })
    await expect(
      exporting
        .locator("section")
        .filter({ has: page.getByText("Preferred", { exact: true }) })
        .getByRole("heading"),
    ).toContainText("STEP")
    await expect(exporting.getByText("Preferred", { exact: true })).toBeVisible()
  })
}

test("keeps an active feature draft intact while File explains blocked actions", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Box", exact: true })
    .click()
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("combobox", { name: "Width", exact: true }).fill("23 mm")
  await openApplicationMenuItem(page, "Files and projects…")
  const projects = page.getByRole("dialog", { name: "Projects", exact: true })
  await expect(
    projects.getByRole("button", { name: "Save project (.vshape)", exact: true }),
  ).toBeDisabled()
  await expect(
    projects.getByRole("button", { name: "Open project (.vshape)", exact: true }),
  ).toBeDisabled()
  await expect(projects.getByRole("button", { name: "New project", exact: true })).toBeDisabled()
  await expect(projects.getByText(/Finish or cancel the current edit/)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(form.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("23 mm")
})
