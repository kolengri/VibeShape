import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi, openAiConnections } from "./application-menu-support"
import { expect, test } from "./fixtures"

test("restores local MCP after reload with fresh consent for auto-apply and respects Stop AI", async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  const local = await createMcpTestClient(43280 + info.workerIndex)
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await enableLocalAi(page)
    const before = localToolOutputs.model_info.parse(
      (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
    )
    if (!before.ok) throw new Error(before.diagnostic.message)
    const dialog = await openAiConnections(page)
    await dialog.getByRole("button", { name: "Set up auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await dialog.getByRole("button", { name: "Close AI connections", exact: true }).click()
    await expect(page.getByText("Auto-apply on", { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText("Auto-apply on", { exact: true })).toHaveCount(0)
    const after = localToolOutputs.model_info.parse(
      (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
    )
    if (!after.ok) throw new Error(after.diagnostic.message)
    expect(after.value.summary.documentId).toBe(before.value.summary.documentId)
    expect(after.value.summary.revision).toBe(before.value.summary.revision)
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const stopped = await openAiConnections(page)
    await expect(
      stopped.getByRole("button", { name: "Enable AI session", exact: true }),
    ).toBeVisible()
    expect(
      (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
  } finally {
    await local.close()
  }
})
