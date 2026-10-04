import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi, openAiConnections, openAutoApplySetup } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
type Local = Awaited<ReturnType<typeof createMcpTestClient>>
const call = async (local: Local, name: string, args: Record<string, unknown>) =>
  (await local.callTool({ name, arguments: args })).structuredContent?.result
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
const body = (n: number, outputRole = "result") => ({
  schemaVersion: 0,
  featureId: id(n),
  outputRole,
})
const feature = (n: number, dependencies: string[], parameters: unknown) => ({
  featureId: id(n),
  label: `MCP feature ${n}`,
  dependencies,
  references: [],
  suppressed: false,
  parameters,
})
const plane = (offset: number) => ({
  mode: "offset",
  support: { kind: "origin-plane", plane: "xy" },
  offset: createLengthQuantity(offset),
})
function exactVolume(
  measurements: {
    data: {
      features: readonly {
        featureId: string
        status: string
        shape?: { volume: number; solidCount: number }
      }[]
    }
  } | null,
  n: number,
) {
  const entry = measurements?.data.features.find(({ featureId }) => featureId === id(n))
  if (entry?.status !== "succeeded" || !entry.shape) throw new Error(`Missing exact feature ${n}.`)
  return entry.shape
}
async function createDraft(local: Local) {
  const base = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    .summary.revision
  const draft = success(
    localToolOutputs.create_draft.parse(await call(local, "create_draft", { baseRevision: base })),
  )
  let revision = draft.revision
  let nextCommand = 100
  return {
    draftId: draft.draftId,
    baseRevision: base,
    async stage(name: string, args: Record<string, unknown>) {
      const added = success(
        localToolOutputs.create_union.parse(
          await call(local, name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: id(nextCommand++),
          }),
        ),
      )
      revision = added.revision
      return added
    },
  }
}

test("creates, repairs, applies and undoes Datum Plane and body combinations through isolated local MCP", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45100 + info.parallelIndex)
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const draft = await createDraft(local)
    await draft.stage("create_datum_plane", feature(1, [], plane(-29.5)))
    await draft.stage("update_datum_plane", feature(1, [], plane(29.5)))
    await draft.stage("create_box", { featureId: id(2), widthMm: 20, depthMm: 10, heightMm: 5 })
    await draft.stage("create_box", { featureId: id(3), widthMm: 10, depthMm: 10, heightMm: 10 })
    await draft.stage("create_box", { featureId: id(4), widthMm: 4, depthMm: 4, heightMm: 10 })
    await draft.stage("create_box", { featureId: id(5), widthMm: 2, depthMm: 2, heightMm: 2 })
    await draft.stage(
      "create_union",
      feature(6, [id(2), id(3)], { bodies: [body(2), body(3, "missing")] }),
    )
    const invalid = success(
      localToolOutputs.preview_draft.parse(
        await call(local, "preview_draft", { draftId: draft.draftId }),
      ),
    )
    expect(invalid.geometry.status).toBe("invalid")
    await draft.stage("update_union", feature(6, [id(2), id(3)], { bodies: [body(2), body(3)] }))
    const united = success(
      localToolOutputs.preview_draft.parse(
        await call(local, "preview_draft", { draftId: draft.draftId }),
      ),
    )
    expect(united.geometry.status, JSON.stringify(united.geometry)).toBe("valid")
    expect(exactVolume(united.geometry.measurements, 6).volume).toBeCloseTo(1500, 6)
    await draft.stage(
      "create_boolean",
      feature(7, [id(6), id(4)], { operation: "subtract", keepTools: true }),
    )
    await draft.stage(
      "update_boolean",
      feature(7, [id(6), id(4)], { operation: "subtract", keepTools: false }),
    )
    const subtracted = success(
      localToolOutputs.preview_draft.parse(
        await call(local, "preview_draft", { draftId: draft.draftId }),
      ),
    )
    expect(subtracted.geometry.status, JSON.stringify(subtracted.geometry)).toBe("valid")
    expect(exactVolume(subtracted.geometry.measurements, 7)).toMatchObject({ solidCount: 1 })
    expect(exactVolume(subtracted.geometry.measurements, 7).volume).toBeCloseTo(1340, 6)
    const slots = [
      { slotId: id(20), targetBody: body(7) },
      { slotId: id(21), targetBody: body(5) },
    ]
    await draft.stage("create_compound", feature(8, [id(7), id(5)], { slots }))
    await draft.stage(
      "update_compound",
      feature(8, [id(5), id(7)], { slots: [...slots].reverse() }),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(
        await call(local, "preview_draft", { draftId: draft.draftId }),
      ),
    )
    expect(preview.geometry.status, JSON.stringify(preview.geometry)).toBe("valid")
    expect(exactVolume(preview.geometry.measurements, 8)).toMatchObject({ solidCount: 2 })
    expect(exactVolume(preview.geometry.measurements, 8).volume).toBeCloseTo(1348, 6)
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
    for (const [n, version, parameters] of [
      [1, 1, plane(29.5)],
      [6, 2, { bodies: [body(2), body(3)] }],
      [7, 1, { operation: "subtract", keepTools: false }],
      [8, 2, { slots: [...slots].reverse() }],
    ] as const) {
      const entity = success(
        localToolOutputs.model_entity.parse(
          await call(local, "model_entity", {
            revision: committed.revision,
            entity: { kind: "feature", id: id(n) },
          }),
        ),
      )
      if (entity.data.entityKind !== "feature") throw new Error("Expected saved feature.")
      expect(entity.data.record.type.schemaVersion).toBe(version)
      expect(entity.data.record.parameters).toEqual(parameters)
    }
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect(
      page.getByRole("treeitem", { name: "MCP feature 8", exact: true }),
    ).not.toBeVisible()
    await expect
      .poll(
        async () =>
          success(localToolOutputs.model_info.parse(await call(local, "model_info", {}))).summary
            .revision,
      )
      .toBe(committed.revision + 1)
    const undone = success(
      localToolOutputs.model_tree.parse(
        await call(local, "model_tree", {
          revision: committed.revision + 1,
          cursor: null,
          limit: 20,
        }),
      ),
    )
    expect(undone.data.items).toHaveLength(0)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Redo", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "MCP feature 8", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "MCP feature 8", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const saved = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    expect(saved.summary.revision).toBe(committed.revision + 2)
    expect(exactVolume(saved.measurements, 8).volume).toBeCloseTo(1348, 6)
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})

test("requires browser opt-in before automatically applying an exact Union v2 draft", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45200 + info.parallelIndex)
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    await openAiConnections(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await expect(page.getByText("AI on · Auto-apply on", { exact: true })).toBeVisible()
    const draft = await createDraft(local)
    await draft.stage("create_box", { featureId: id(2), widthMm: 20, depthMm: 10, heightMm: 5 })
    await draft.stage("create_box", { featureId: id(3), widthMm: 10, depthMm: 10, heightMm: 10 })
    await draft.stage("create_union", feature(6, [id(2), id(3)], { bodies: [body(2), body(3)] }))
    const committed = success(
      localToolOutputs.commit_draft.parse(
        await call(local, "commit_draft", { draftId: draft.draftId }),
      ),
    )
    await expect(
      page.getByRole("region", { name: "Review AI changes", exact: true }),
    ).not.toBeVisible()
    expect(committed.revision).toBe(draft.baseRevision + 3)
    const saved = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
    expect(exactVolume(saved.measurements, 6).volume).toBeCloseTo(1500, 6)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect(
      page.getByRole("treeitem", { name: "MCP feature 6", exact: true }),
    ).not.toBeVisible()
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
