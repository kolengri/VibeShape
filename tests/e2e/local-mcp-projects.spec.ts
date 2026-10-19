import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { generateUuidV7 } from "../../packages/domain/src/identifiers"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("creates two projects, authors each, and returns to their saved models over one MCP pairing", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45780 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const model = async () => success(localToolOutputs.model_info.parse(await call("model_info", {})))
  const source = async () => {
    const current = await model()
    return {
      expectedProjectId: current.summary.documentId,
      expectedRevision: current.summary.revision,
    }
  }
  const id = (offset: number) =>
    generateUuidV7({
      timestampMs: 1_700_000_000_000 + offset,
      randomBytes: new Uint8Array(10).fill(offset),
    })
  async function authorBox(projectId: string, offset: number) {
    const current = await model()
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { projectId, baseRevision: current.summary.revision }),
      ),
    )
    success(
      localToolOutputs.create_box.parse(
        await call("create_box", {
          projectId,
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(offset),
          featureId: id(offset + 1),
          widthMm: 10 + offset,
          depthMm: 10,
          heightMm: 10,
        }),
      ),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { projectId, draftId: draft.draftId }),
      ),
    )
    expect(preview.geometry.status).toBe("valid")
    const committed = local.callTool({
      name: "commit_draft",
      arguments: { projectId, draftId: draft.draftId },
    })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible()
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    success(localToolOutputs.commit_draft.parse((await committed).structuredContent?.result))
    return draft.draftId
  }
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await enableLocalAi(page)
    const denied = localToolOutputs.list_projects.parse(await call("list_projects", {}))
    expect(denied).toMatchObject({ ok: false, diagnostic: { code: "project-management-disabled" } })
    await page.getByRole("button", { name: "AI connection and approval mode", exact: true }).click()
    await page
      .getByRole("menuitemcheckbox", { name: "Allow project management", exact: true })
      .click()
    const projectA = success(
      localToolOutputs.create_project.parse(
        await call("create_project", { ...(await source()), name: "MCP project A" }),
      ),
    )
    let documentNavigations = 0
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) documentNavigations += 1
    })
    const draftA = await authorBox(projectA.projectId, 10)
    const projectB = success(
      localToolOutputs.create_project.parse(
        await call("create_project", { ...(await source()), name: "MCP project B" }),
      ),
    )
    expect(projectB.projectId).not.toBe(projectA.projectId)
    expect(
      localToolOutputs.create_draft.parse(
        await call("create_draft", {
          projectId: projectA.projectId,
          baseRevision: projectB.revision,
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "project-target-mismatch" } })
    expect(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draftA })),
    ).toMatchObject({ ok: false })
    await authorBox(projectB.projectId, 30)
    const list = success(
      localToolOutputs.list_projects.parse(await call("list_projects", { limit: 1 })),
    )
    expect(list.projects).toHaveLength(1)
    expect(list.nextCursor).not.toBeNull()
    success(
      localToolOutputs.open_project.parse(
        await call("open_project", { ...(await source()), projectId: projectA.projectId }),
      ),
    )
    const restoredA = await model()
    expect(restoredA.summary.data.name).toBe("MCP project A")
    expect(restoredA.measurements?.data.features).toHaveLength(1)
    success(
      localToolOutputs.open_project.parse(
        await call("open_project", { ...(await source()), projectId: projectB.projectId }),
      ),
    )
    expect((await model()).summary.data.name).toBe("MCP project B")
    expect((await model()).measurements?.data.features).toHaveLength(1)
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
    expect(documentNavigations).toBe(0)
  } finally {
    await local.close()
  }
})
