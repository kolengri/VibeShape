import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("previews, updates, and commits Connect Mounts through real MCP with browser review and one Undo", async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const local = await createMcpTestClient(45740 + info.parallelIndex)
  const featureId = "0195b5ac-b250-7a2c-8c33-000000001010"
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    const tools = await local.client.listTools()
    expect(tools.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["create_connect_mounts", "update_connect_mounts"]),
    )
    await page.goto(local.origin)
    await saved(page)
    await enableLocalAi(page)
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    let draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.summary.revision }),
      ),
    )
    const parameters = {
      points: [
        [0, 0, 0],
        [20, 0, 0],
        [0, 20, 0],
      ],
      nodeRadius: 3,
      strutRadius: 1.5,
      connectionMode: "tree",
    }
    draft = success(
      localToolOutputs.create_connect_mounts.parse(
        await call("create_connect_mounts", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: "0195b5ac-b250-7a2c-8c33-000000001011",
          featureId,
          label: "MCP connector",
          suppressed: false,
          parameters,
        }),
      ),
    )
    const first = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(first.geometry.status).toBe("valid")
    const shape = first.geometry.measurements?.data.features.find(
      (entry) => entry.featureId === featureId,
    )
    expect(shape).toMatchObject({ status: "succeeded", shape: { valid: true, solidCount: 1 } })
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(initial.summary.revision)
    draft = success(
      localToolOutputs.update_connect_mounts.parse(
        await call("update_connect_mounts", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: "0195b5ac-b250-7a2c-8c33-000000001012",
          featureId,
          label: "MCP connector",
          suppressed: false,
          parameters: { ...parameters, nodeRadius: 4, connectionMode: "complete" },
        }),
      ),
    )
    const updated = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(updated.geometry.status).toBe("valid")
    const pending = local.callTool({ name: "commit_draft", arguments: { draftId: draft.draftId } })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    success(localToolOutputs.commit_draft.parse((await pending).structuredContent?.result))
    await saved(page)
    const savedInfo = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const entity = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: savedInfo.summary.revision,
          entity: { kind: "feature", id: featureId },
        }),
      ),
    )
    expect(entity.data).toMatchObject({
      entityKind: "feature",
      record: { parameters: { nodeRadius: 4, connectionMode: "complete" } },
    })
    await expect(page.getByRole("treeitem", { name: "MCP connector", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await saved(page)
    await expect(page.getByRole("treeitem", { name: "MCP connector", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await saved(page)
    await expect(page.getByRole("treeitem", { name: "MCP connector", exact: true })).toBeVisible()
  } finally {
    await local.close()
  }
})
