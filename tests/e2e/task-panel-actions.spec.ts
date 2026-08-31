import { expect, test } from "./fixtures"

test.describe("Task-panel lifecycle actions", () => {
  test("keeps feature actions compact in the command header without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Box", exact: true })
      .click()

    const form = page.getByRole("form", { name: "Create box" })
    const cancel = form.getByRole("button", { name: "Cancel", exact: true })
    const accept = form.getByRole("button", { name: "Create box", exact: true })
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
    expect(cancelBounds.width).toBeLessThanOrEqual(36)
    expect(acceptBounds.width).toBeLessThanOrEqual(36)
    expect(panelOverflow.scrollWidth).toBe(panelOverflow.clientWidth)
  })
})
