import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("inspects saved sketch and feature dependencies in UI and MCP without changing History", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const local = await createMcpTestClient(44310 + testInfo.parallelIndex)
  const call = async (name: string, arguments_: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: arguments_ })).structuredContent?.result
  try {
    await page.goto(local.origin)
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1")
    await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
    if ((await viewport.getAttribute("data-selected-sketch-profile-count")) === "0")
      await viewport
        .getByRole("combobox", { name: "Select saved profile", exact: true })
        .selectOption({ label: "Sketch 1 · Profile 1" })
    const form = page.getByRole("form", { name: "Extrude profile", exact: true })
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-preview-status",
      "ready",
      { timeout: 30_000 },
    )
    await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
    await expandHistoryDetails(page)
    const history = page.getByRole("region", { name: "Feature history", exact: true })
    const sketchActions = history.getByRole("button", { name: "Actions for Sketch 1", exact: true })
    await sketchActions.click()
    await page.getByRole("menuitem", { name: "Inspect dependencies", exact: true }).click()
    const sketchDialog = page.getByRole("dialog", { name: "Dependencies of Sketch 1", exact: true })
    await expect(sketchDialog.getByRole("list", { name: "Used by", exact: true })).toContainText(
      "Extrusion 1",
    )
    await sketchDialog.getByRole("button", { name: "Include indirect links", exact: true }).click()
    await expect(
      sketchDialog.getByRole("button", { name: "Include indirect links", exact: true }),
    ).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("Escape")
    await expect(sketchActions).toBeFocused()

    const featureActions = history.getByRole("button", {
      name: "Actions for Extrusion 1",
      exact: true,
    })
    await featureActions.click()
    await page.getByRole("menuitem", { name: "Inspect dependencies", exact: true }).click()
    const featureDialog = page.getByRole("dialog", {
      name: "Dependencies of Extrusion 1",
      exact: true,
    })
    await featureDialog.getByRole("button", { name: "Depends on", exact: true }).click()
    await expect(
      featureDialog.getByRole("list", { name: "Depends on", exact: true }),
    ).toContainText("Sketch 1")
    await page.setViewportSize({ width: 1024, height: 768 })
    for (const theme of ["light", "dark"]) {
      await page
        .locator("html")
        .evaluate((root, theme) => root.classList.toggle("dark", theme === "dark"), theme)
      await page.screenshot({ path: testInfo.outputPath(`dependencies-${theme}.png`) })
    }
    await page.setViewportSize({ width: 512, height: 384 })
    await expect(
      featureDialog.getByRole("button", { name: "Close dependencies", exact: true }),
    ).toBeInViewport()
    await featureDialog.getByRole("button", { name: "Close dependencies", exact: true }).click()
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(featureActions).toBeFocused()

    await enableLocalAi(page)
    const before = localToolOutputs.model_info.parse(await call("model_info", {}))
    if (!before.ok) throw new Error(before.diagnostic.message)
    const revision = before.value.summary.revision
    const tree = localToolOutputs.model_tree.parse(
      await call("model_tree", { revision, cursor: null, limit: 100 }),
    )
    if (!tree.ok) throw new Error(tree.diagnostic.message)
    const sketch = tree.value.data.items.find((item) => item.kind === "sketch")
    if (!sketch) throw new Error("Expected a saved sketch.")
    const request = { revision, entity: { kind: "sketch", id: sketch.id } }
    const inspected = localToolOutputs.model_dependencies.parse(
      await call("model_dependencies", request),
    )
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        revision,
        direction: "dependents",
        transitive: false,
        nextCursor: null,
        data: { coverage: "complete", total: 1, items: [{ label: "Extrusion 1", distance: 1 }] },
      },
    })
    expect(await call("model_dependencies", { ...request, revision: revision - 1 })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    const after = localToolOutputs.model_info.parse(await call("model_info", {}))
    expect(after).toMatchObject({ ok: true, value: { summary: { revision } } })
    await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(
      0,
    )
  } finally {
    await local.close()
  }
})
