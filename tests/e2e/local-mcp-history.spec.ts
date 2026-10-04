import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi, openAiConnections } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  value: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!value.ok) throw new Error(value.diagnostic.message)
  return value.value
}

test("navigates exact saved geometry through named MCP manual history review even with auto-apply, then reloads the saved result", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const failures: { url: string; status: number; body: string }[] = []
  page.on("response", async (response) => {
    if (response.url().includes("/__vibeshape/automation/") && response.status() >= 400)
      failures.push({
        url: response.url(),
        status: response.status(),
        body: (await response.text()).slice(0, 2048),
      })
  })
  const local = await createMcpTestClient(44101 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  const apply = async (name: string, args: Record<string, unknown>) => {
    const pending = call(name, args)
    await expect(review).toBeVisible({ timeout: 60_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const receipt = await pending
    await expect(review).toHaveCount(0)
    return receipt
  }
  const info = async () => success(localToolOutputs.model_info.parse(await call("model_info", {})))
  try {
    const tools = await local.client.listTools()
    expect(tools.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["model_history_state", "undo_model", "redo_model"]),
    )
    expect(
      tools.tools.find(({ name }) => name === "model_history_state")?.annotations?.readOnlyHint,
    ).toBe(true)
    expect(tools.tools.find(({ name }) => name === "undo_model")?.annotations?.readOnlyHint).toBe(
      false,
    )
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const initial = (await info()).summary
    const documentId = initial.documentId
    const state = async (revision: number) =>
      success(
        localToolOutputs.model_history_state.parse(
          await call("model_history_state", { documentId, revision }),
        ),
      )
    expect(await state(initial.revision)).toMatchObject({ canUndo: false, canRedo: false })
    const addBox = async (
      baseRevision: number,
      offset: number,
      dimensions: [number, number, number],
    ) => {
      const draft = success(
        localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision })),
      )
      expect(
        await call("create_box", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(offset),
          featureId: id(offset + 1),
          label: `Saved box ${offset}`,
          widthMm: dimensions[0],
          depthMm: dimensions[1],
          heightMm: dimensions[2],
        }),
      ).toMatchObject({ ok: true })
      return success(
        localToolOutputs.commit_draft.parse(
          await apply("commit_draft", { draftId: draft.draftId }),
        ),
      )
    }
    const first = await addBox(initial.revision, 10, [10, 20, 30])
    const second = await addBox(first.revision, 20, [4, 5, 6])
    expect(await state(second.revision)).toMatchObject({ canUndo: true, canRedo: false })
    await openAiConnections(page)
    await page.getByRole("button", { name: "Set up auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Close AI connections", exact: true }).click()
    await expect(page.getByText("Auto-apply on", { exact: true })).toBeVisible()
    const rejected = call("undo_model", {
      documentId,
      baseRevision: second.revision,
      commandId: id(30),
    })
    await expect(review.getByText("Undo saved change", { exact: true })).toBeVisible()
    await expect(review.getByText("Features: 1", { exact: true })).toBeVisible()
    await expect(review.getByText("Exact saved-target preview", { exact: true })).toBeVisible()
    await review.getByRole("button", { name: "Discard", exact: true }).click()
    expect(await rejected).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-rejected" },
    })
    expect((await info()).summary.revision).toBe(second.revision)
    expect(
      await call("undo_model", { documentId, baseRevision: second.revision, commandId: id(30) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-command-id" } })
    const undone = success(
      localToolOutputs.undo_model.parse(
        await apply("undo_model", { documentId, baseRevision: second.revision, commandId: id(31) }),
      ),
    )
    expect(undone).toMatchObject({
      direction: "undo",
      targetRevision: first.revision,
      revision: second.revision + 1,
      commandId: id(31),
    })
    const undoneInfo = await info()
    expect(undoneInfo.measurements?.data.features).toHaveLength(1)
    expect(undoneInfo.measurements?.data.features[0]).toMatchObject({
      featureId: id(11),
      status: "succeeded",
      shape: { valid: true, volume: 6000 },
    })
    expect(await state(undone.revision)).toMatchObject({ canUndo: true, canRedo: true })
    const redone = success(
      localToolOutputs.redo_model.parse(
        await apply("redo_model", { documentId, baseRevision: undone.revision, commandId: id(32) }),
      ),
    )
    expect(redone).toMatchObject({
      direction: "redo",
      targetRevision: second.revision,
      revision: undone.revision + 1,
      commandId: id(32),
    })
    const restored = await info()
    expect(restored.measurements?.data.features).toHaveLength(2)
    expect(
      restored.measurements?.data.features.find(({ featureId }) => featureId === id(21)),
    ).toMatchObject({ status: "succeeded", shape: { valid: true, volume: 120 } })
    // Redo previews a complete v4 checkpoint, including its frozen exact assembly source.
    const parts = success(
      localToolOutputs.model_parts.parse(await call("model_parts", { revision: redone.revision })),
    )
    const part = parts.parts.find(({ body }) => body.featureId === id(11))
    if (!part) throw new Error("Missing authored source part")
    const bodies = success(
      localToolOutputs.model_body_measurements.parse(
        await call("model_body_measurements", {
          revision: redone.revision,
          featureId: part.body.featureId,
          outputRole: part.body.outputRole,
        }),
      ),
    )
    const body = bodies.data.bodies[0]
    if (!body) throw new Error("Missing exact source body")
    let assembly = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: redone.revision }),
      ),
    )
    const assemblyArgs = () => ({
      draftId: assembly.draftId,
      baseRevision: assembly.baseRevision,
      draftVersion: assembly.draftVersion,
    })
    const stageAssembly = async (name: string, args: Record<string, unknown> = {}) => {
      assembly = success(
        localToolOutputs.upgrade_assembly.parse(await call(name, { ...assemblyArgs(), ...args })),
      )
    }
    await stageAssembly("upgrade_assembly")
    const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
    await stageAssembly("create_assembly_definition", {
      definition: {
        schemaVersion: 1,
        id: id(50),
        name: "Saved exact definition",
        sources: [
          { kind: "part", partId: part.id, body: part.body, contentHash: body.contentHash },
        ],
        sourceFrame: pose,
      },
    })
    await stageAssembly("create_assembly_instance", {
      instance: {
        schemaVersion: 2,
        id: id(51),
        definitionId: id(50),
        name: "Saved occurrence",
        grounded: true,
        worldFrame: pose,
      },
    })
    const assembled = success(
      localToolOutputs.commit_assembly_draft.parse(
        await apply("commit_assembly_draft", assemblyArgs()),
      ),
    )
    const unassembled = success(
      localToolOutputs.undo_model.parse(
        await apply("undo_model", {
          documentId,
          baseRevision: assembled.revision,
          commandId: id(52),
        }),
      ),
    )
    expect(
      success(
        localToolOutputs.model_assembly.parse(
          await call("model_assembly", { revision: unassembled.revision }),
        ),
      ).instances,
    ).toHaveLength(0)
    const redoAssembly = call("redo_model", {
      documentId,
      baseRevision: unassembled.revision,
      commandId: id(53),
    })
    await expect(review.getByText("Redo saved change", { exact: true })).toBeVisible()
    await expect(review.getByText("1 frozen body occurrence", { exact: true })).toBeVisible()
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const reassembled = success(localToolOutputs.redo_model.parse(await redoAssembly))
    expect(
      success(
        localToolOutputs.inspect_assembly.parse(
          await call("inspect_assembly", { revision: reassembled.revision }),
        ),
      ).occurrences,
    ).toHaveLength(1)
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 20_000,
    })
    expect((await info()).summary.revision).toBe(reassembled.revision)
    expect((await info()).measurements?.data.features).toHaveLength(2)
    expect(await state(reassembled.revision)).toMatchObject({ canUndo: false, canRedo: false })
    expect(
      await call("undo_model", {
        documentId,
        baseRevision: reassembled.revision,
        commandId: id(31),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-command-id" } })
    expect(
      await call("undo_model", {
        documentId: id(99),
        baseRevision: reassembled.revision,
        commandId: id(33),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "document-mismatch" } })
    await expect(review).toHaveCount(0)
  } finally {
    if (failures.length)
      await testInfo.attach("automation-http-failures", {
        body: JSON.stringify(failures),
        contentType: "application/json",
      })
    await local.close()
  }
})
