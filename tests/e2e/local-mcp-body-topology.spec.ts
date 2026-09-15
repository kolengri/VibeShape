import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("inspects exact body faces and edges through MCP and rejects stale cursors after a UI edit", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const local = await createMcpTestClient(44030 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    expect(
      await call("create_box", {
        draftId: draft.draftId,
        baseRevision: draft.revision,
        commandId: id(1),
        featureId: id(2),
        label: "Topology box",
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      }),
    ).toMatchObject({ ok: true })
    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const committed = success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
    const args = {
      revision: committed.revision,
      featureId: id(2),
      outputRole: "result",
      topologyKind: "edge",
      limit: 2,
    }
    const first = success(
      localToolOutputs.model_body_topology.parse(await call("model_body_topology", args)),
    )
    expect(first.data.total).toBe(12)
    expect(first.data.topology).toHaveLength(2)
    expect(first.nextCursor?.offset).toBe(2)
    for (const entry of first.data.topology) {
      expect(entry).toMatchObject({
        resolution: "resolved",
        reference: { schemaVersion: 1, featureId: id(2), outputRole: "result", kind: "edge" },
      })
      expect(entry.reference).not.toHaveProperty("candidateId")
      expect(entry.reference).not.toHaveProperty("edgePolyline")
    }
    const second = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", { ...args, cursor: first.nextCursor }),
      ),
    )
    expect(second.nextCursor?.offset).toBe(4)
    expect(second.data.topology).not.toEqual(first.data.topology)
    const faces = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", { ...args, topologyKind: "face", limit: 100 }),
      ),
    )
    expect(faces.data.total).toBe(6)
    expect(faces.data.topology).toHaveLength(6)
    expect(
      faces.data.topology.every(
        ({ reference, resolution }) =>
          reference.kind === "face" &&
          reference.signature.geometryClass === "PLANE" &&
          resolution === "resolved",
      ),
    ).toBe(true)
    expect(
      await call("model_body_topology", { ...args, outputRole: "pattern.instance.1" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "body-not-found" } })
    expect(
      await call("model_body_topology", {
        ...args,
        topologyKind: "face",
        cursor: first.nextCursor,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    const legacy = success(
      localToolOutputs.model_edges.parse(
        await call("model_edges", { revision: committed.revision, featureId: id(2) }),
      ),
    )
    expect(legacy.data.total).toBe(12)
    expect(legacy.data.edges.every(({ reference }) => reference.schemaVersion === 0)).toBe(true)

    await page.getByRole("treeitem", { name: "Topology box", exact: true }).click()
    const edit = page.getByRole("form", { name: "Edit box", exact: true })
    await edit.getByRole("combobox", { name: "Width", exact: true }).fill("15 mm")
    await edit.getByRole("button", { name: "Update box", exact: true }).click()
    await expect(edit).toHaveCount(0)
    const current = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    expect(current).toBeGreaterThan(committed.revision)
    expect(await call("model_body_topology", args)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    expect(
      await call("model_body_topology", { ...args, revision: current, cursor: first.nextCursor }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    const refreshed = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", { ...args, revision: current }),
      ),
    )
    expect(refreshed.contentHash).not.toBe(first.contentHash)
    expect(refreshed.rebuildId).not.toBe(first.rebuildId)
    expect(refreshed.data.total).toBe(12)
  } finally {
    await local.close()
  }
})
