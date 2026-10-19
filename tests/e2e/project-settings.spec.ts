import { openApplicationMenuItem } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

for (const width of [1440, 512, 390]) {
  test(`keeps File and Settings discoverable and persists browser preferences at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 512 ? 384 : 844 })
    await page.goto("/")
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
      {
        timeout: 30_000,
      },
    )
    const trigger = page.getByRole("button", { name: "Application menu", exact: true })
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await trigger.click()
    await expect(
      page.getByRole("menuitem", { name: "Save project (.vshape)", exact: true }),
    ).toBeInViewport()
    await page.getByRole("menuitem", { name: "Projects", exact: true }).click()
    const projects = page.getByRole("main")
    await expect(
      projects.getByRole("heading", { level: 1, name: "Projects", exact: true }),
    ).toBeVisible()
    const openProject = projects.getByRole("button", {
      name: "Drop a .vshape project",
      exact: true,
    })
    await openProject.scrollIntoViewIfNeeded()
    await expect(openProject).toBeInViewport({ ratio: 1 })
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath(`file-${width}-dark.png`),
    })
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
    await expect(settings.getByRole("tabpanel")).toHaveCount(1)
    await settings.getByRole("tab", { name: "Workspace", exact: true }).click()
    await settings.getByRole("checkbox", { name: /Automatically hide sketches/ }).uncheck()
    await settings.getByRole("tab", { name: "Export preferences", exact: true }).click()
    await settings.getByRole("combobox", { name: "Preferred export format", exact: true }).click()
    await page.getByRole("option", { name: "STEP", exact: true }).click()
    await settings.getByRole("button", { name: "Done", exact: true }).click()
    await expect(trigger).toBeFocused()
    await projects.getByRole("button", { name: /^Open Untitled project, revision / }).click()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await page.reload()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    await openApplicationMenuItem(page, "Settings…")
    await expect(settings.getByRole("combobox", { name: "Theme", exact: true })).toContainText(
      "Light",
    )
    await settings.getByRole("tab", { name: "Workspace", exact: true }).click()
    await expect(
      settings.getByRole("checkbox", { name: /Automatically hide sketches/ }),
    ).not.toBeChecked()
    await settings.getByRole("tab", { name: "Export preferences", exact: true }).click()
    await expect(
      settings.getByRole("combobox", { name: "Preferred export format", exact: true }),
    ).toContainText("STEP")
    await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
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
    await expect(exporting.getByRole("combobox", { name: "File format", exact: true })).toHaveValue(
      "step",
    )
  })
}

test("keeps an active feature draft intact while Save and Projects guard blocked actions", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
    {
      timeout: 30_000,
    },
  )
  await invokeModelCommand(page, "Primitives", "Box")
  const form = page.getByRole("form", { name: "Create box", exact: true })
  await form.getByRole("combobox", { name: "Width", exact: true }).fill("23 mm")
  await page.getByRole("button", { name: "Application menu", exact: true }).click()
  await expect(
    page.getByRole("menuitem", { name: "Save project (.vshape)", exact: true }),
  ).toBeDisabled()
  await page.getByRole("menuitem", { name: "Projects", exact: true }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: /Finish or cancel the current edit/ }),
  ).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByLabel("Choose VibeShape project file")).toHaveCount(0)
  await expect(form.getByRole("combobox", { name: "Width", exact: true })).toHaveValue("23 mm")
})
