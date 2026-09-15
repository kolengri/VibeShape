import { expect, type Page, test } from "@playwright/test"

type BodySelectionObservation = Readonly<{ pickedRole: string | null }>

function pickedRole(page: Page) {
  return page.evaluate<BodySelectionObservation>(() => {
    const state = Reflect.get(globalThis, "__VIBESHAPE_BODY_SELECTION__") as
      | { pickedRole?: unknown }
      | undefined
    return { pickedRole: typeof state?.pickedRole === "string" ? state.pickedRole : null }
  })
}

test.describe("body selection identity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/spikes/body-selection.html")
    await expect(page.getByRole("tree")).toBeVisible()
    await expect(page.locator("canvas")).toBeVisible()
  })

  test("keeps sibling body roles distinct in the tree and viewport", async ({ page }, testInfo) => {
    const bodyRows = page.locator("[data-body-id]")
    await expect(bodyRows).toHaveCount(2)

    await bodyRows.nth(1).getByRole("treeitem").hover()
    await expect(page.locator("[data-preselected-body-role]")).toHaveAttribute(
      "data-preselected-body-role",
      "pattern.instance.1",
    )
    await bodyRows.nth(1).getByRole("treeitem").click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await viewport.focus()
    await viewport.hover()
    await expect(page.locator("[data-preselected-body-role]")).toHaveCount(0)

    await expect(page.locator("[data-selected-body-role]")).toHaveAttribute(
      "data-selected-body-role",
      "pattern.instance.1",
    )

    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("body-selection-dark.png"),
      fullPage: true,
    })
    await page.locator("html").evaluate((element) => element.classList.remove("dark"))
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("body-selection-light.png"),
      fullPage: true,
    })

    await page.getByTestId("remove-selected-body").click()
    await expect(bodyRows).toHaveCount(1)
    await expect(page.locator("[data-selected-body-role]")).toHaveCount(0)
  })

  test("picks each separated sibling body with the same face id", async ({ page }) => {
    const canvas = page.locator("canvas")
    await page.getByRole("button", { name: /standard views/i }).click()
    await page.getByRole("menuitem", { name: /top/i }).click()
    await page.getByRole("button", { name: /fit/i }).click()

    const box = await canvas.boundingBox()
    if (!box) throw new Error("The body selection canvas has no bounds.")
    const y = box.y + box.height / 2
    await page.mouse.click(box.x + box.width * 0.38, y)
    await expect.poll(() => pickedRole(page)).toEqual({ pickedRole: "pattern.instance.0" })

    await page.mouse.click(box.x + box.width * 0.62, y)
    await expect.poll(() => pickedRole(page)).toEqual({ pickedRole: "pattern.instance.1" })

    await page.locator("[data-body-id]").nth(1).getByRole("treeitem").click()
    await expect(page.locator("[data-selected-body-role]")).toHaveAttribute(
      "data-selected-body-role",
      "pattern.instance.1",
    )
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await expect(page.locator("[data-selected-body-role]")).toHaveCount(0)
  })
})
