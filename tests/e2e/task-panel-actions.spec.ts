import { expect, test } from "./fixtures"
import { expandHistoryDetails, invokeModelCommand } from "./model-command-support"

test.describe("Task-panel lifecycle actions", () => {
  test("keeps deletion in History while compact editors retain their lifecycle actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    await page
      .getByRole("form", { name: "Create box", exact: true })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await page.getByRole("treeitem", { name: "Box 1", exact: true }).click()
    const form = page.getByRole("form", { name: "Edit box", exact: true })
    await expect(form).toBeVisible()
    await expect(form.getByRole("button", { name: /Delete/ })).toHaveCount(0)
    await expect(form.getByRole("region", { name: "Delete feature", exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 512, height: 384 })
    const footer = form.locator("[data-slot=task-panel-footer]")
    await expect(footer.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
    await expect(footer.getByRole("button", { name: "Update box", exact: true })).toBeInViewport()
    await footer.getByRole("button", { name: "Cancel", exact: true }).click()
    await expandHistoryDetails(page)
    await page.getByRole("button", { name: "Actions for Box 1", exact: true }).click()
    await page.getByRole("menuitem", { name: "Delete Box 1…", exact: true }).click()
    const confirmation = page.getByRole("alertdialog", { name: "Delete Box 1?", exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole("button", { name: "Keep feature", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Actions for Box 1", exact: true }).click()
    await page.getByRole("menuitem", { name: "Delete Box 1…", exact: true }).click()
    await confirmation.getByRole("button", { name: "Delete feature", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toHaveCount(0)
  })

  test("keeps readable feature actions in a separate footer without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await invokeModelCommand(page, "Primitives", "Box")

    const form = page.getByRole("form", { name: "Create box" })
    const footer = form.locator('[data-slot="task-panel-footer"]')
    const cancel = footer.getByRole("button", { name: "Cancel", exact: true })
    const accept = footer.getByRole("button", { name: "Create box", exact: true })
    const [cancelBounds, acceptBounds, panelOverflow] = await Promise.all([
      cancel.boundingBox(),
      accept.boundingBox(),
      form.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    ])
    if (!cancelBounds || !acceptBounds) {
      throw new Error("Feature lifecycle actions are not visible.")
    }

    expect(Math.abs(cancelBounds.y - acceptBounds.y)).toBeLessThanOrEqual(2)
    expect(cancelBounds.width).toBeGreaterThanOrEqual(80)
    expect(acceptBounds.width).toBeGreaterThanOrEqual(80)
    expect(cancelBounds.height).toBe(32)
    expect(acceptBounds.height).toBe(32)
    await expect(cancel).toHaveText("Cancel")
    await expect(accept).toHaveText("Create box")
    await expect(
      form
        .locator('[data-slot="task-panel-header"]')
        .getByRole("button", { name: "Cancel", exact: true }),
    ).toHaveCount(0)
    expect(panelOverflow.scrollWidth).toBe(panelOverflow.clientWidth)
  })

  test("wraps long task titles and footer labels within a narrow panel", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    await page.goto("/")
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box" })
    const heading = form.locator('[data-slot="task-panel-header"] h2')
    await heading.locator("button span").evaluate((element) => {
      element.textContent = "Create a replacement enclosure with a very long feature title"
    })
    const footer = form.locator('[data-slot="task-panel-footer"]')
    await footer
      .getByRole("button", { name: "Create box", exact: true })
      .locator("span.truncate")
      .evaluate((element) => {
        const label = "Create the replacement enclosure and retain its parameters"
        element.textContent = label
        element.closest("button")?.setAttribute("aria-label", label)
      })
    const headingSize = await heading.evaluate((element) => {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element)
      return {
        height: element.getBoundingClientRect().height,
        fontSize: style?.fontSize,
        lineHeight: style?.lineHeight,
      }
    })
    expect(headingSize.fontSize).toBe("14px")
    expect(headingSize.lineHeight).toBe("20px")
    expect(headingSize.height).toBeGreaterThan(20)
    expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(footer).toBeInViewport()
  })
})
