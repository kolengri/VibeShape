import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { readVShapeV3 } from "../../packages/formats/src/vshape"
import {
  enableLocalAi,
  openAiConnections,
  openApplicationMenuItem,
  openAutoApplySetup,
} from "./application-menu-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
async function createBoxes(page: Page) {
  for (let n = 0; n < 2; n += 1) {
    await invokeModelCommand(page, "Primitives", "Box")
    const form = page.getByRole("form", { name: "Create box", exact: true })
    await form.getByRole("button", { name: "Create box", exact: true }).click()
    await expect(page.locator("[data-part-id]")).toHaveCount(n + 1, { timeout: 30_000 })
  }
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
}

function launch(port: number) {
  const entry = process.env.VIBESHAPE_TEST_MCP_ENTRY
  return createMcpTestClient(port, entry ? { command: "bun", args: [entry] } : undefined)
}

type MetadataCall = (name: string, args: Record<string, unknown>) => Promise<unknown>

async function expectMetadataToolAnnotations(local: Awaited<ReturnType<typeof launch>>) {
  const tools = await local.client.listTools()
  for (const name of ["model_parts", "model_folders", "model_history"])
    expect(tools.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
}

function createReviewedMetadataChange({
  page,
  call,
  readRevision,
  writeRevision,
}: {
  page: Page
  call: MetadataCall
  readRevision: () => number
  writeRevision: (revision: number) => void
}) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  let command = 100
  return async (
    payload: Record<string, unknown>,
    expectedText: string,
    decision: "Apply" | "Discard" = "Apply",
  ) => {
    const commandId = id(command++)
    const before = readRevision()
    const pending = call("change_metadata", { baseRevision: before, commandId, change: payload })
    const ready = await Promise.race([
      expect(review)
        .toBeVisible({ timeout: 30_000 })
        .then(() => ({ stage: "review" })),
      pending.then((result) => ({ stage: "settled", result })),
    ])
    expect(ready).toEqual({ stage: "review" })
    await expect(review.getByText(expectedText, { exact: true })).toBeVisible()
    await review.getByRole("button", { name: decision, exact: true }).click()
    const result = localToolOutputs.change_metadata.parse(await pending)
    if (decision === "Discard") {
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "draft-review-rejected" } })
    } else {
      const saved = success(result)
      expect(saved).toMatchObject({
        commandId,
        baseRevision: before,
        revision: before + 1,
        change: payload,
      })
      writeRevision(saved.revision)
    }
    await expect(review).not.toBeVisible()
    return commandId
  }
}

test("lists and manually edits authored metadata through real MCP, preserving geometry, Undo and native reload", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const local = await launch(45400 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  let completed = false
  try {
    await expectMetadataToolAnnotations(local)
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await createBoxes(page)
    await enableLocalAi(page)
    const original = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    let revision = original.summary.revision
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision, cursor: null, limit: 1 }),
      ),
    )
    expect(parts.total).toBe(2)
    expect(parts.parts).toHaveLength(1)
    expect(parts.nextCursor).toBe(1)
    const second = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision, cursor: parts.nextCursor, limit: 1 }),
      ),
    )
    expect(second.parts[0]?.id).not.toBe(parts.parts[0]?.id)
    expect(second.nextCursor).toBeNull()
    const part = parts.parts[0]
    if (!part) throw new Error("Expected an authored part")
    const tree = success(
      localToolOutputs.model_history.parse(
        await call("model_history", { revision, cursor: null, limit: 20 }),
      ),
    )
    const history = tree.items.map((item) => item.ref)
    expect(history).toHaveLength(2)
    const change = createReviewedMetadataChange({
      page,
      call,
      readRevision: () => revision,
      writeRevision: (value) => {
        revision = value
      },
    })
    await change(
      { kind: "part.rename", partId: part.id, name: "Discarded name" },
      "Name: Discarded name",
      "Discard",
    )
    expect(
      success(localToolOutputs.model_parts.parse(await call("model_parts", { revision }))).parts[0]
        ?.name,
    ).toBe(part.name)
    // The browser grant for CAD never grants metadata consent.
    await openAiConnections(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    const renameId = await change(
      { kind: "part.rename", partId: part.id, name: "MCP housing" },
      "Name: MCP housing",
    )
    await expect(
      page.getByRole("treeitem", { name: "Part MCP housing", exact: true }),
    ).toBeVisible()
    expect(
      await call("change_metadata", {
        baseRevision: revision,
        commandId: renameId,
        change: { kind: "part.rename", partId: part.id, name: "Duplicate" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-command-id" } })
    expect(await call("model_parts", { revision: original.summary.revision })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    await change({ kind: "part.set-visibility", partId: part.id, visible: false }, "Hide this part")
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("region", { name: "3D viewport", exact: true })).toHaveAttribute(
      "data-rendered-feature-count",
      "2",
    )
    revision = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    expect(
      success(localToolOutputs.model_parts.parse(await call("model_parts", { revision }))).parts[0],
    ).toMatchObject({ id: part.id, name: "MCP housing", visible: true })
    const folderId = id(200)
    await change(
      {
        kind: "folder.create",
        folder: { schemaVersion: 0, id: folderId, name: "MCP assembly", items: history },
      },
      "Create History folder",
    )
    await change(
      { kind: "folder.rename", folderId, name: "Reviewed assembly" },
      "Name: Reviewed assembly",
    )
    await change(
      { kind: "folder.set-items", folderId, items: [history[0]] },
      "Change History folder range",
    )
    const folders = success(
      localToolOutputs.model_folders.parse(await call("model_folders", { revision, limit: 1 })),
    )
    expect(folders.folders).toEqual([
      {
        id: folderId,
        name: "Reviewed assembly",
        first: history[0],
        last: history[0],
        itemCount: 1,
      },
    ])
    await change(
      { kind: "folder.remove", folderId },
      "Ungroup these History items. All features and geometry are preserved.",
    )
    expect(
      success(localToolOutputs.model_folders.parse(await call("model_folders", { revision })))
        .folders,
    ).toEqual([])
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(
      page.getByRole("treeitem", { name: "Folder Reviewed assembly", exact: true }),
    ).toBeVisible()
    const final = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(
      final.measurements?.data.features.map((item) =>
        item.status === "succeeded" ? item.shape : item.status,
      ),
    ).toEqual(
      original.measurements?.data.features.map((item) =>
        item.status === "succeeded" ? item.shape : item.status,
      ),
    )
    const downloading = page.waitForEvent("download")
    await openApplicationMenuItem(page, "Save project (.vshape)")
    const downloaded = await downloading
    const path = await downloaded.path()
    if (!path) throw new Error("Expected a native project archive")
    const archive = await readVShapeV3(new Uint8Array(await readFile(path)))
    if (!archive.ok) throw new Error(JSON.stringify(archive.diagnostic))
    expect(archive.value.snapshot).toMatchObject({
      schemaVersion: 2,
      parts: expect.arrayContaining([
        expect.objectContaining({ id: part.id, name: "MCP housing", visible: true }),
      ]),
      folders: [{ id: folderId, name: "Reviewed assembly", items: [history[0]] }],
    })
    expect(archive.value.versionedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: renameId,
          actor: expect.objectContaining({ type: "mcp" }),
        }),
      ]),
    )
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Part MCP housing", exact: true })).toBeVisible(
      { timeout: 30_000 },
    )
    await expect(
      page.getByRole("treeitem", { name: "Folder Reviewed assembly", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const reopened = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(reopened.summary.revision).toBe(final.summary.revision)
    expect(
      success(
        localToolOutputs.model_parts.parse(
          await call("model_parts", { revision: reopened.summary.revision }),
        ),
      ).parts[0],
    ).toMatchObject({ id: part.id, name: "MCP housing", visible: true })
    // This reaches the persistent journal duplicate check in a fresh paired session.
    expect(
      await call("change_metadata", {
        baseRevision: reopened.summary.revision,
        commandId: renameId,
        change: { kind: "part.rename", partId: part.id, name: "Duplicate after reload" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-command-id" } })
    completed = true
  } finally {
    if (completed) await page.goto("about:blank")
    await local.close()
  }
})

test("cancels a real MCP metadata proposal before writing on browser disconnect", async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const local = await launch(45500 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  let completed = false
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await createBoxes(page)
    await enableLocalAi(page)
    const before = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision: before.summary.revision }),
      ),
    )
    const pending = call("change_metadata", {
      baseRevision: before.summary.revision,
      commandId: id(300),
      change: { kind: "part.rename", partId: parts.parts[0]?.id, name: "Cancelled metadata" },
    })
    await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    await page.reload()
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await enableLocalAi(page)
    const after = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(after.summary.revision).toBe(before.summary.revision)
    expect(
      success(
        localToolOutputs.model_parts.parse(
          await call("model_parts", { revision: after.summary.revision }),
        ),
      ).parts[0]?.name,
    ).toBe(parts.parts[0]?.name)
    completed = true
  } finally {
    if (completed) await page.goto("about:blank")
    await local.close()
  }
})
