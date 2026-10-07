import { test as recoveryTest } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi, openAiConnections, openAutoApplySetup } from "./application-menu-support"
import { expect, test } from "./fixtures"

test("restores local MCP and auto-apply after reload and respects Stop AI", async ({
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
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
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

test("remembers local AI access and approval mode across a fresh browser session", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000)
  const local = await createMcpTestClient(43290 + info.workerIndex)
  try {
    await page.goto(local.origin)
    await enableLocalAi(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    const storageState = await page.context().storageState({ indexedDB: true })
    await page.close()
    const freshContext = await browser.newContext({ storageState })
    try {
      const fresh = await freshContext.newPage()
      await fresh.goto(local.origin)
      await expect(fresh.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
      expect(
        (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
      ).toMatchObject({ ok: true })
      await fresh.reload()
      await expect(fresh.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
      await fresh
        .getByRole("button", { name: "AI connection and approval mode", exact: true })
        .click()
      await fresh.getByRole("menuitemradio", { name: "Approve each change", exact: true }).click()
      await fresh.reload()
      await expect(
        fresh.getByText("AI access on · Approve each change", { exact: true }),
      ).toBeVisible()
      await fresh.getByRole("button", { name: "Stop AI", exact: true }).click()
      await fresh.reload()
      await expect(
        fresh.getByRole("button", { name: "Enable AI session", exact: true }),
      ).toBeVisible()
      expect(
        (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
      ).toMatchObject({ ok: false, diagnostic: { code: "not-paired" } })
    } finally {
      await freshContext.close()
    }
  } finally {
    await local.close()
  }
})

recoveryTest(
  "restores remembered access when the local MCP process loses its recovery session",
  async ({ page }, info) => {
    recoveryTest.setTimeout(90_000)
    const port = 43300 + info.workerIndex
    let local = await createMcpTestClient(port)
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    try {
      await page.goto(local.origin)
      await enableLocalAi(page)
      await openAutoApplySetup(page)
      await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
      await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
      await local.close()
      await expect(page.getByText("Reconnecting AI…", { exact: true })).toBeVisible()
      // A fresh launcher directory deliberately omits the old authenticated recovery record.
      local = await createMcpTestClient(port)
      await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible({
        timeout: 30_000,
      })
      expect(
        (await local.callTool({ name: "model_info", arguments: {} })).structuredContent?.result,
      ).toMatchObject({ ok: true })
      expect(pageErrors).toEqual([])
      await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    } finally {
      await local.close()
    }
  },
)
