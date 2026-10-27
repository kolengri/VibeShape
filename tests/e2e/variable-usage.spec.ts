import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"
import { closeVariablesDialog } from "./variables-ui-support"

test("inspects direct and indirect saved variable uses in the editor and local MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const local = await createMcpTestClient(44350 + testInfo.parallelIndex)
  const call = async (name: string, arguments_: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: arguments_ })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    for (const [index, name, expression] of [
      [0, "width", "20 mm"],
      [1, "doubleWidth", "#width * 2"],
    ] as const) {
      await page.getByRole("button", { name: "Add variable", exact: true }).click()
      await page.getByRole("textbox", { name: "Variable name", exact: true }).nth(index).fill(name)
      await page
        .getByRole("combobox", { name: "Variable expression", exact: true })
        .nth(index)
        .fill(expression)
    }
    await page.getByRole("button", { name: "Apply variables", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Where is #width used?", exact: true }),
    ).toBeVisible()
    await closeVariablesDialog(page)
    const toolbar = page.getByRole("toolbar", { name: "Model commands", exact: true })
    await toolbar.getByRole("button", { name: "Create sketch", exact: true }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1")
    await toolbar.getByRole("button", { name: "Extrude", exact: true }).click()
    if ((await viewport.getAttribute("data-selected-sketch-profile-count")) === "0")
      await viewport
        .getByRole("combobox", { name: "Select saved profile", exact: true })
        .selectOption({ label: "Sketch 1 · Profile 1" })
    const form = page.getByRole("form", { name: "Extrude profile", exact: true })
    await form.getByRole("combobox", { name: "Distance", exact: true }).fill("#doubleWidth")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
    await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1", exact: true })).toBeVisible()
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )

    await enableLocalAi(page)
    const before = localToolOutputs.model_info.parse(await call("model_info", {}))
    if (!before.ok) throw new Error(before.diagnostic.message)
    const revision = before.value.summary.revision
    const variables = localToolOutputs.model_variables.parse(
      await call("model_variables", { revision, cursor: null, limit: 100 }),
    )
    if (!variables.ok) throw new Error(variables.diagnostic.message)
    const variable = variables.value.data.variables.find(
      ({ definition }) => definition.name === "width",
    )
    if (!variable) throw new Error("Expected saved width variable.")
    const request = { revision, variableId: variable.definition.id }
    expect(
      localToolOutputs.model_variable_usage.parse(await call("model_variable_usage", request)),
    ).toMatchObject({
      ok: true,
      value: {
        variableName: "width",
        transitive: false,
        data: {
          coverage: "complete",
          total: 1,
          items: [{ kind: "variable", name: "doubleWidth", distance: 1 }],
        },
      },
    })
    const pageOne = localToolOutputs.model_variable_usage.parse(
      await call("model_variable_usage", { ...request, transitive: true, limit: 1 }),
    )
    expect(pageOne).toMatchObject({
      ok: true,
      value: {
        nextCursor: "1",
        data: { total: 2, items: [{ kind: "variable", name: "doubleWidth" }] },
      },
    })
    const pageTwo = localToolOutputs.model_variable_usage.parse(
      await call("model_variable_usage", { ...request, transitive: true, limit: 1, cursor: "1" }),
    )
    expect(pageTwo).toMatchObject({
      ok: true,
      value: {
        nextCursor: null,
        data: { total: 2, items: [{ kind: "feature", label: "Extrusion 1", distance: 2 }] },
      },
    })
    expect(
      await call("model_variable_usage", { ...request, revision: revision - 1 }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })

    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    const expression = page
      .getByRole("combobox", { name: "Variable expression", exact: true })
      .nth(0)
    await expression.fill("99 mm")
    const trigger = page.getByRole("button", { name: "Where is #width used?", exact: true })
    await trigger.click()
    const inspector = page.getByRole("region", { name: "Uses of #width", exact: true })
    await expect(
      inspector.getByRole("heading", { name: "Uses of #width", exact: true }),
    ).toBeFocused()
    await expect(inspector.getByText("1 use", { exact: true })).toBeVisible()
    await inspector
      .getByRole("button", { name: "Include indirect uses through other variables", exact: true })
      .click()
    await expect(inspector.getByText("2 uses", { exact: true })).toBeVisible()
    await expect(inspector.getByText("Extrusion 1", { exact: true })).toBeVisible()
    await expect(inspector).toContainText("/parameters/distance")
    await expect(inspector).toContainText(
      `Saved revision ${revision}. Unapplied edits in this table are not included.`,
    )
    await expect(expression).toHaveValue("99 mm")
    await page.setViewportSize({ width: 1024, height: 768 })
    for (const theme of ["light", "dark"]) {
      await page
        .locator("html")
        .evaluate((root, value) => root.classList.toggle("dark", value === "dark"), theme)
      await page.screenshot({
        path: `artifacts/variable-usage/usage-${theme}.png`,
        animations: "disabled",
      })
    }
    await page.setViewportSize({ width: 512, height: 384 })
    const close = inspector.getByRole("button", { name: "Close variable uses", exact: true })
    await close.scrollIntoViewIfNeeded()
    await expect(close).toBeInViewport()
    await close.click()
    await expect(trigger).toBeFocused()
    await expect(expression).toHaveValue("99 mm")
    const after = localToolOutputs.model_info.parse(await call("model_info", {}))
    expect(after).toMatchObject({ ok: true, value: { summary: { revision } } })
    await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(
      0,
    )
  } finally {
    await local.close()
  }
})
