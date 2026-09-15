import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { expect, test } from "./fixtures"

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`

function expectDraftInspectionAnnotations(
  tools: readonly { name: string; annotations?: unknown }[],
) {
  for (const name of [
    "draft_tree",
    "draft_entity",
    "draft_variables",
    "draft_edges",
    "model_body_measurements",
    "model_body_topology",
  ]) {
    expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    })
  }
}

test("creates, repairs, reviews, commits and exports a model through real local stdio MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(43210 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await local.callTool({ name, arguments: args })
    return result.structuredContent?.result
  }
  try {
    const tools = await local.client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "commit_draft",
      "create_box",
      "create_chamfer",
      "create_draft",
      "create_extrude",
      "create_fillet",
      "create_hole",
      "create_revolve",
      "create_sketch",
      "create_variable",
      "discard_draft",
      "draft_edges",
      "draft_entity",
      "draft_tree",
      "draft_variables",
      "export_model",
      "model_body_measurements",
      "model_body_topology",
      "model_edges",
      "model_entity",
      "model_info",
      "model_tree",
      "model_variables",
      "preview_draft",
      "remove_variable",
      "rename_variable",
      "replace_variable_table",
      "set_variable_expression",
      "update_chamfer",
      "update_extrude",
      "update_fillet",
      "update_hole",
      "update_revolve",
      "update_sketch",
    ])
    expectDraftInspectionAnnotations(tools.tools)
    expect(
      tools.tools.find((tool) => tool.name === "preview_draft")?.annotations?.idempotentHint,
    ).toBe(false)
    expect(
      tools.tools.find((tool) => tool.name === "preview_draft")?.annotations?.readOnlyHint,
    ).toBe(false)
    expect(
      (await local.client.listResources()).resources.map((resource) => resource.uri),
    ).toContain("vibeshape://model")
    expect(await call("model_info", {})).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
    expect(await call("model_body_measurements", { revision: 0 })).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("button", { name: /Disable AI session/ })).toBeVisible()
    const info = localToolOutputs.model_info.parse(await call("model_info", {}))
    expect(info.ok).toBe(true)
    const baseRevision = success(info).summary.revision
    const created = localToolOutputs.create_draft.parse(
      await call("create_draft", { baseRevision }),
    )
    const draftId = success(created).draftId
    expect(
      await call("create_box", {
        draftId,
        baseRevision,
        commandId: id(1),
        featureId: id(2),
        label: "MCP box",
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      }),
    ).toMatchObject({ ok: true })
    expect(
      await call("create_fillet", {
        draftId,
        baseRevision: baseRevision + 1,
        commandId: id(3),
        featureId: id(4),
        targetFeatureId: id(2),
        label: "MCP fillet",
        radiusMm: 100,
      }),
    ).toMatchObject({ ok: true })
    const invalidPreview = await call("preview_draft", { draftId })
    expect(invalidPreview, JSON.stringify(invalidPreview)).toMatchObject({
      ok: true,
      value: { geometry: { status: "invalid" } },
    })
    expect(await call("commit_draft", { draftId })).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    expect(
      await call("update_fillet", {
        draftId,
        baseRevision: baseRevision + 2,
        commandId: id(5),
        featureId: id(4),
        targetFeatureId: id(2),
        label: "MCP fillet",
        radiusMm: 1,
      }),
    ).toMatchObject({ ok: true })
    const preview = localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId }))
    const previewValue = success(preview)
    expect(previewValue.geometry.status).toBe("valid")
    const stages: string[] = []
    const committing = local.callTool(
      { name: "commit_draft", arguments: { draftId } },
      {
        timeout: 120_000,
        onprogress: (progress) => {
          if (progress.message) stages.push(progress.message)
        },
      },
    )
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect.poll(() => stages, { timeout: 30_000 }).toContain("review")
    await expect(review).toBeVisible()
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const committed = localToolOutputs.commit_draft.parse(
      (await committing).structuredContent?.result,
    )
    const commitValue = success(committed)
    await expect(page.getByRole("treeitem", { name: "MCP fillet", exact: true })).toBeVisible()
    const after = localToolOutputs.model_info.parse(await call("model_info", {}))
    const afterValue = success(after)
    expect(afterValue.summary.revision).toBe(commitValue.revision)
    expect(afterValue.measurements?.data.features).toEqual(
      previewValue.geometry.measurements.data.features,
    )
    const bodies = success(
      localToolOutputs.model_body_measurements.parse(
        await call("model_body_measurements", { revision: commitValue.revision, limit: 1 }),
      ),
    )
    expect(bodies.data.total).toBe(1)
    expect(bodies.data.bodies[0]).toMatchObject({ featureId: id(4), outputRole: "result" })
    const historicalBox = success(
      localToolOutputs.model_body_measurements.parse(
        await call("model_body_measurements", {
          revision: commitValue.revision,
          featureId: id(2),
          outputRole: "result",
        }),
      ),
    )
    expect(historicalBox.data.bodies[0]?.shape.volume).toBeCloseTo(6000, 6)
    expect(
      await call("model_body_measurements", {
        revision: commitValue.revision,
        featureId: id(4),
        outputRole: "pattern.instance.1",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "body-not-found" } })
    expect(await call("model_body_measurements", { revision: baseRevision })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    const exported = await local.callTool({
      name: "export_model",
      arguments: { revision: commitValue.revision, format: "step" },
    })
    const link = exported.content.find((item) => item.type === "resource_link")
    if (link?.type !== "resource_link") throw new Error("The export resource link is missing.")
    const resource = await local.client.readResource({ uri: link.uri })
    const blob = resource.contents[0]
    if (!blob || !("blob" in blob) || typeof blob.blob !== "string")
      throw new Error("The export blob is missing.")
    expect(Buffer.from(blob.blob, "base64").toString("utf8")).toContain("ISO-10303-21;")
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "MCP box", exact: true })).toHaveCount(0)
    await expect(page.getByRole("treeitem", { name: "MCP fillet", exact: true })).toHaveCount(0)
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "MCP fillet", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /Disable AI session/ }).click()
    expect(await call("model_info", {})).toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired" },
    })
    await expect(local.client.readResource({ uri: link.uri })).rejects.toThrow("unavailable")
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "MCP fillet", exact: true })).toBeVisible()
    expect(local.stderr()).not.toContain("Bearer")
  } finally {
    await local.close()
  }
})
