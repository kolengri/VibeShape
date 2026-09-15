import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { expect, test } from "./fixtures"

test("keeps the local AI connection controls visible in both themes and a compact editor", async ({
  page,
}, info) => {
  const local = await createMcpTestClient(43600 + info.parallelIndex)
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Disable AI session", exact: true }),
    ).toBeVisible()
    for (const dark of [false, true]) {
      await page
        .locator("html")
        .evaluate((element, dark) => element.classList.toggle("dark", dark), dark)
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(dark ? "local-mcp-dark.png" : "local-mcp-light.png"),
      })
    }
    await page.setViewportSize({ width: 512, height: 384 })
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await expect(
      page.getByRole("button", { name: "Disable AI session", exact: true }),
    ).toBeInViewport()
    await page.screenshot({
      animations: "disabled",
      path: info.outputPath("local-mcp-compact.png"),
    })
    await page.getByRole("button", { name: "Disable AI session", exact: true }).click()
  } finally {
    await local.close()
  }
})
