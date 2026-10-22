import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test.describe("Task-panel lifecycle actions", () => {
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
    await heading.evaluate((element) => {
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
    expect(headingSize.fontSize).toBe("16px")
    expect(headingSize.lineHeight).toBe("24px")
    expect(headingSize.height).toBeGreaterThan(24)
    expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(footer).toBeInViewport()
  })
})
