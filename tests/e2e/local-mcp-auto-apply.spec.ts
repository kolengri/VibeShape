import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Page, test as recoveryTest } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import {
  enableLocalAi,
  openAiConnections,
  openApplicationMenuItem,
  openAutoApplySetup,
} from "./application-menu-support"
import { createEditorProject, expect, test } from "./fixtures"

test.use({ actionTimeout: 15_000 })

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
type Local = Awaited<ReturnType<typeof createMcpTestClient>>
const call = async (local: Local, name: string, args: Record<string, unknown>) =>
  (await local.callTool({ name, arguments: args })).structuredContent?.result
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
async function boxDraft(local: Local, n: number, label: string) {
  const info = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
  const draft = success(
    localToolOutputs.create_draft.parse(
      await call(local, "create_draft", {
        baseRevision: info.summary.revision,
      }),
    ),
  )
  const added = success(
    localToolOutputs.create_box.parse(
      await call(local, "create_box", {
        draftId: draft.draftId,
        baseRevision: draft.revision,
        commandId: id(n),
        featureId: id(n + 1),
        label,
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      }),
    ),
  )
  return added
}
async function enableAutoApply(page: Page) {
  await openAiConnections(page)
  await openAutoApplySetup(page)
  await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
  await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
}
async function inspectControls(page: Page) {
  for (const [width, height, dark] of [
    [512, 384, false],
    [390, 844, true],
  ] as const) {
    await page.setViewportSize({ width, height })
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), dark)
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeInViewport()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeInViewport()
    await page.getByRole("button", { name: "Stop AI", exact: true }).click({ trial: true })
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath(`auto-apply-${width}.png`),
    })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator("html").evaluate((element) => element.classList.remove("dark"))
}

test("keeps manual consent by default and scopes auto-apply, recovery and Stop to one paired project", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  // Acceptance can target an isolated production bundle while a user's editor remains running.
  const entry = process.env.VIBESHAPE_TEST_MCP_ENTRY
  const local = await createMcpTestClient(
    44800 + info.parallelIndex,
    entry ? { command: "bun", args: [entry] } : undefined,
  )
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    expect(await call(local, "model_info", {})).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toHaveCount(0)
    await enableLocalAi(page)
    const manual = await boxDraft(local, 10, "Manual box")
    const pendingManual = call(local, "commit_draft", { draftId: manual.draftId })
    await expect(review).toBeVisible()
    await openAiConnections(page)
    await page.getByRole("button", { name: "AI connection and approval mode", exact: true }).click()
    await expect(
      page.getByRole("menuitemradio", { name: "Apply automatically", exact: true }),
    ).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("treeitem", { name: "Manual box", exact: true })).toHaveCount(0)
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    expect(await pendingManual).toMatchObject({ ok: true })
    await openAutoApplySetup(page)
    await page.setViewportSize({ width: 512, height: 384 })
    const details = page.getByRole("region", { name: "Set up auto-apply", exact: true })
    await details.focus()
    await details.press("End")
    await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await details.press("Home")
    await expect(
      page.getByRole("button", { name: "Enable auto-apply", exact: true }),
    ).toBeInViewport()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .first()
      .click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await enableAutoApply(page)
    await inspectControls(page)

    // Returning to manual review keeps the same pairing and requires Apply again.
    await page.getByRole("button", { name: "AI connection and approval mode", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Approve each change", exact: true }).click()
    await expect(
      page.getByText("AI access on · Approve each change", { exact: true }),
    ).toBeVisible()
    expect(await call(local, "model_info", {})).toMatchObject({ ok: true })
    const switchedManual = await boxDraft(local, 800, "Manual after auto-apply")
    const manualAfterAuto = call(local, "commit_draft", { draftId: switchedManual.draftId })
    await expect(review).toBeVisible()
    await expect(
      page.getByRole("treeitem", { name: "Manual after auto-apply", exact: true }),
    ).toHaveCount(0)
    await review.getByRole("button", { name: "Discard", exact: true }).click()
    expect(await manualAfterAuto).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-rejected" },
    })
    await enableAutoApply(page)

    const automatic = await boxDraft(local, 20, "Automatic box")
    const fillet = success(
      localToolOutputs.create_fillet.parse(
        await call(local, "create_fillet", {
          draftId: automatic.draftId,
          baseRevision: automatic.revision,
          commandId: id(22),
          featureId: id(23),
          targetFeatureId: id(21),
          label: "Automatic fillet",
          radiusMm: 100,
        }),
      ),
    )
    expect(await call(local, "commit_draft", { draftId: automatic.draftId })).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    await expect(page.getByRole("treeitem", { name: "Automatic box", exact: true })).toHaveCount(0)
    const repaired = success(
      localToolOutputs.update_fillet.parse(
        await call(local, "update_fillet", {
          draftId: automatic.draftId,
          baseRevision: fillet.revision,
          commandId: id(24),
          featureId: id(23),
          targetFeatureId: id(21),
          label: "Automatic fillet",
          radiusMm: 1,
        }),
      ),
    )
    expect(
      await call(local, "create_variable", {
        draftId: automatic.draftId,
        baseRevision: repaired.revision,
        commandId: id(25),
        variable: { schemaVersion: 0, id: id(26), name: "spareDimension", expression: "2 mm" },
      }),
    ).toMatchObject({ ok: true })
    expect(await call(local, "commit_draft", { draftId: automatic.draftId })).toMatchObject({
      ok: true,
    })
    await expect(review).toHaveCount(0)
    await expect(
      page.getByRole("treeitem", { name: "Automatic fillet", exact: true }),
    ).toBeVisible()
    const measured = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    expect(
      measured.measurements?.data.features.every((feature) => feature.status === "succeeded"),
    ).toBe(true)
    expect(measured.measurements?.data.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureId: id(11),
          status: "succeeded",
          shape: expect.objectContaining({ volume: expect.closeTo(6000, 6) }),
        }),
      ]),
    )
    const rounded = measured.measurements?.data.features.find(
      (feature) => feature.featureId === id(23),
    )
    if (rounded?.status !== "succeeded") throw new Error("Missing exact fillet measurements")
    // The committed summary lists terminal outputs; the source box is consumed by the fillet.
    expect(measured.measurements?.data.features).toHaveLength(2)
    expect(rounded.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(rounded.shape.volume).toBeCloseTo(5949.834793498635, 6)
    const stale = await boxDraft(local, 30, "Stale box")
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Automatic box", exact: true })).toHaveCount(0)
    await expect(page.getByRole("treeitem", { name: "Manual box", exact: true })).toBeVisible()
    expect(await call(local, "commit_draft", { draftId: stale.draftId })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(
      page.getByRole("treeitem", { name: "Automatic fillet", exact: true }),
    ).toBeVisible()

    const current = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    const destructive = success(
      localToolOutputs.create_draft.parse(
        await call(local, "create_draft", { baseRevision: current.summary.revision }),
      ),
    )
    expect(
      await call(local, "rename_project", {
        draftId: destructive.draftId,
        baseRevision: destructive.revision,
        commandId: id(40),
        name: "Metadata awaiting Stop",
      }),
    ).toMatchObject({ ok: true })
    const pendingRemoval = call(local, "commit_draft", { draftId: destructive.draftId })
    await expect(review).toBeVisible()
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    expect(await pendingRemoval).toMatchObject({ ok: false })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toHaveCount(0)
    expect(await call(local, "model_info", {})).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
    await page.reload()
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole("treeitem", { name: "Automatic fillet", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Stale box", exact: true })).toHaveCount(0)
    await enableLocalAi(page)
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toHaveCount(0)
    const reopened = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    const variables = success(
      localToolOutputs.model_variables.parse(
        await call(local, "model_variables", { revision: reopened.summary.revision }),
      ),
    )
    expect(variables.data.variables.some((variable) => variable.definition.id === id(26))).toBe(
      true,
    )
    await enableAutoApply(page)
    const switching = success(
      localToolOutputs.create_draft.parse(
        await call(local, "create_draft", { baseRevision: reopened.summary.revision }),
      ),
    )
    expect(
      await call(local, "rename_project", {
        draftId: switching.draftId,
        baseRevision: switching.revision,
        commandId: id(41),
        name: "Metadata awaiting project switch",
      }),
    ).toMatchObject({ ok: true })
    const pendingSwitch = call(local, "commit_draft", { draftId: switching.draftId })
    await expect(review).toBeVisible()
    await openApplicationMenuItem(page, "Projects")
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("alert").filter({ hasText: /Finish or cancel the current edit/ }),
    ).toBeVisible()
    await expect(review).toBeVisible()
    await page.getByRole("button", { name: "Dismiss notification", exact: true }).click()
    await review.getByRole("button", { name: "Discard", exact: true }).click()
    expect(await pendingSwitch).toMatchObject({ ok: false })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    await openApplicationMenuItem(page, "Projects")
    await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "New project", exact: true }).click()
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toHaveCount(0)
    await openAiConnections(page)
    expect(await call(local, "model_info", {})).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
  } finally {
    await local.close()
  }
})

recoveryTest(
  "recovers approved local auto-apply across reload and bridge restart without replay",
  async ({ page }, info) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const directory = mkdtempSync(join(tmpdir(), "vibeshape-recovery-e2e-"))
    const port = 43520 + info.parallelIndex
    let local = await createMcpTestClient(port, undefined, { recoveryDirectory: directory })
    try {
      await page.goto(local.origin)
      await createEditorProject(page)
      await expect(
        page
          .getByRole("status", { name: "Project save status", exact: true })
          .filter({ hasText: /^Saved$/ }),
      ).toBeVisible()
      await enableLocalAi(page)
      await enableAutoApply(page)
      const before = await boxDraft(local, 100, "Before restart")
      expect(await call(local, "commit_draft", { draftId: before.draftId })).toMatchObject({
        ok: true,
      })
      const committed = success(
        localToolOutputs.model_info.parse(await call(local, "model_info", {})),
      )
      await page.reload()
      await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await local.close()
      await expect(page.getByText("Reconnecting AI…", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
      local = await createMcpTestClient(port, undefined, { recoveryDirectory: directory })
      await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible({
        timeout: 30_000,
      })
      const recovered = success(
        localToolOutputs.model_info.parse(await call(local, "model_info", {})),
      )
      expect(recovered.summary.revision).toBe(committed.summary.revision)
      await expect(page.getByRole("treeitem", { name: "Before restart", exact: true })).toHaveCount(
        1,
      )
      const after = await boxDraft(local, 110, "After restart")
      expect(await call(local, "commit_draft", { draftId: after.draftId })).toMatchObject({
        ok: true,
      })
      await expect(
        page.getByRole("region", { name: "Review AI changes", exact: true }),
      ).toHaveCount(0)
      await page.getByRole("button", { name: "Stop AI", exact: true }).click()
      await page.reload()
      await expect(
        page
          .getByRole("status", { name: "Project save status", exact: true })
          .filter({ hasText: /^Saved$/ }),
      ).toBeVisible()
      await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toHaveCount(0)
      expect(await call(local, "model_info", {})).toMatchObject({
        ok: false,
        diagnostic: { code: "not-paired" },
      })
      expect(errors).toEqual([])
    } finally {
      await local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
