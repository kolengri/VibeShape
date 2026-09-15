import { expect, type Page, test } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"

const commandId = "0195b5ac-b250-7a2c-8c33-000000000002"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000003"

function successValue<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

async function dismissErrorReview(page: Page) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  if (!(await review.isVisible().catch(() => false))) return
  const close = review.getByRole("button", { name: "Close", exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function cancelReview(
  mode: "client-abort" | "browser-disable" | "client-close",
  input: { page: Page; controller: AbortController; close: () => Promise<void> },
) {
  if (mode === "client-abort") input.controller.abort()
  if (mode === "browser-disable")
    await input.page.getByRole("button", { name: /Disable AI session/ }).click()
  if (mode === "client-close") await input.close()
}

for (const mode of ["client-abort", "browser-disable", "client-close"] as const) {
  test(`cancels a real MCP commit when ${mode}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const local = await createMcpTestClient(43400 + testInfo.parallelIndex)
    try {
      await page.goto(local.origin)
      await expect(
        page.getByRole("button", { name: "Enable AI session", exact: true }),
      ).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
      await expect(page.getByRole("button", { name: /Disable AI session/ })).toBeVisible()

      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await local.callTool({ name, arguments: args })
        return response.structuredContent?.result
      }
      const info = localToolOutputs.model_info.parse(await call("model_info", {}))
      const baseRevision = successValue(info).summary.revision
      const draft = localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision }),
      )
      const draftId = successValue(draft).draftId
      expect(
        await call("create_box", {
          draftId,
          baseRevision,
          commandId,
          featureId,
          label: "Cancelled MCP box",
          widthMm: 10,
          depthMm: 20,
          heightMm: 30,
        }),
      ).toMatchObject({ ok: true })

      const abortController = new AbortController()
      const committing = local.callTool(
        { name: "commit_draft", arguments: { draftId } },
        { timeout: 120_000, signal: abortController.signal },
      )
      const settled = committing.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const review = page.getByRole("region", { name: "Review AI changes", exact: true })
      await expect(review).toBeVisible()
      await cancelReview(mode, { page, controller: abortController, close: local.close })
      const commitOutcome = await settled
      if (commitOutcome.ok)
        expect(
          localToolOutputs.commit_draft.parse(commitOutcome.value.structuredContent?.result).ok,
        ).toBe(false)
      else expect(commitOutcome.error).toBeDefined()
      await expect(
        page.getByRole("button", { name: "Enable AI session", exact: true }),
      ).toBeVisible()
      await dismissErrorReview(page)
      await expect(
        page.getByRole("treeitem", { name: "Cancelled MCP box", exact: true }),
      ).toHaveCount(0)
      if (mode !== "client-close") {
        await page.reload()
        await expect(
          page.getByRole("treeitem", { name: "Cancelled MCP box", exact: true }),
        ).toHaveCount(0)
      }
      expect(errors).toEqual([])
    } finally {
      await local.close()
    }
  })
}
