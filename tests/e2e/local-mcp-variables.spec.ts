import type { Page } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { variableIdSchema } from "../../packages/domain/src/identifiers"
import { chamferFeatureParametersSchema } from "../../packages/domain/src/part-design"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

async function applyCommit(
  page: Page,
  committing: ReturnType<Awaited<ReturnType<typeof createMcpTestClient>>["callTool"]>,
) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  return (await committing).structuredContent?.result
}

function volumeFor(
  value: {
    measurements: {
      data: {
        features: readonly { featureId: string; status: string; shape?: { volume: number } }[]
      }
    } | null
  },
  featureId: string,
) {
  const entry = value.measurements?.data.features.find((feature) => feature.featureId === featureId)
  if (entry?.status !== "succeeded" || !entry.shape)
    throw new Error(`No exact volume for ${featureId}.`)
  return entry.shape.volume
}

test("creates and repairs a variable-driven chamfer through real local MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(43800 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const variableId = variableIdSchema.parse(id(1))
  const boxId = id(2)
  const chamferId = id(3)
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()

    const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const baseRevision = info.summary.revision
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision })),
    )
    let revision = draft.revision
    const variable = success(
      localToolOutputs.create_variable.parse(
        await call("create_variable", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(4),
          variable: { schemaVersion: 0, id: variableId, name: "edgeSize", expression: "2 mm" },
        }),
      ),
    )
    revision = variable.revision
    const box = success(
      localToolOutputs.create_box.parse(
        await call("create_box", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(5),
          featureId: boxId,
          label: "Variable box",
          widthMm: 10,
          depthMm: 10,
          heightMm: 10,
        }),
      ),
    )
    revision = box.revision
    const chamfer = success(
      localToolOutputs.create_chamfer.parse(
        await call("create_chamfer", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(6),
          featureId: chamferId,
          targetFeatureId: boxId,
          distanceMm: 99,
        }),
      ),
    )
    revision = chamfer.revision
    const invalid = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(invalid.geometry.status).toBe("invalid")
    expect(await call("commit_draft", { draftId: draft.draftId })).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    const repaired = success(
      localToolOutputs.update_chamfer.parse(
        await call("update_chamfer", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(7),
          featureId: chamferId,
          targetFeatureId: boxId,
          distanceMm: 99,
          distanceExpression: "#edgeSize",
        }),
      ),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(repaired.revision).toBe(revision + 1)
    expect(preview.geometry.status).toBe("valid")
    const originalVolume = volumeFor(preview.geometry, chamferId)
    expect(originalVolume).toBeGreaterThan(0)
    expect(originalVolume).toBeLessThan(1_000)

    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const commit = success(localToolOutputs.commit_draft.parse(await applyCommit(page, committing)))
    const committed = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(committed.summary.revision).toBe(commit.revision)
    const variables = success(
      localToolOutputs.model_variables.parse(
        await call("model_variables", { revision: commit.revision, cursor: null, limit: 20 }),
      ),
    )
    expect(variables.data.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definition: expect.objectContaining({
            id: variableId,
            name: "edgeSize",
            expression: "2 mm",
          }),
        }),
      ]),
    )
    expect(
      await call("model_variables", { revision: commit.revision - 1, cursor: null, limit: 20 }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    const entity = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: commit.revision,
          entity: { kind: "feature", id: chamferId },
        }),
      ),
    )
    if (entity.data.entityKind !== "feature") throw new Error("Expected a chamfer feature record.")
    const chamferParameters = chamferFeatureParametersSchema.parse(entity.data.record.parameters)
    expect(chamferParameters.distance.source.expression).toBe("#edgeSize")

    const changedDraft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: commit.revision }),
      ),
    )
    success(
      localToolOutputs.set_variable_expression.parse(
        await call("set_variable_expression", {
          draftId: changedDraft.draftId,
          baseRevision: changedDraft.revision,
          commandId: id(8),
          variableId,
          expression: "1 mm",
        }),
      ),
    )
    const changedPreview = success(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { draftId: changedDraft.draftId }),
      ),
    )
    expect(changedPreview.geometry.status).toBe("valid")
    const changedVolume = volumeFor(changedPreview.geometry, chamferId)
    expect(changedVolume).toBeGreaterThan(originalVolume)
    expect(changedVolume).toBeLessThanOrEqual(1_000)
    const committingChanged = local.callTool({
      name: "commit_draft",
      arguments: { draftId: changedDraft.draftId },
    })
    const changedCommit = success(
      localToolOutputs.commit_draft.parse(await applyCommit(page, committingChanged)),
    )
    expect(changedCommit.revision).toBeGreaterThan(commit.revision)

    const disposable = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: changedCommit.revision }),
      ),
    )
    const temporaryId = variableIdSchema.parse(id(9))
    const temporary = success(
      localToolOutputs.create_variable.parse(
        await call("create_variable", {
          draftId: disposable.draftId,
          baseRevision: disposable.revision,
          commandId: id(10),
          variable: { schemaVersion: 0, id: temporaryId, name: "temporary", expression: "3 mm" },
        }),
      ),
    )
    const renamed = success(
      localToolOutputs.rename_variable.parse(
        await call("rename_variable", {
          draftId: disposable.draftId,
          baseRevision: temporary.revision,
          commandId: id(11),
          variableId: temporaryId,
          name: "renamedTemporary",
        }),
      ),
    )
    const removed = success(
      localToolOutputs.remove_variable.parse(
        await call("remove_variable", {
          draftId: disposable.draftId,
          baseRevision: renamed.revision,
          commandId: id(12),
          variableId: temporaryId,
        }),
      ),
    )
    expect(removed.revision).toBe(renamed.revision + 1)
    const replaced = success(
      localToolOutputs.replace_variable_table.parse(
        await call("replace_variable_table", {
          draftId: disposable.draftId,
          baseRevision: removed.revision,
          commandId: id(13),
          variables: [{ schemaVersion: 0, id: variableId, name: "edgeSize", expression: "3 mm" }],
        }),
      ),
    )
    const replacedPreview = success(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { draftId: disposable.draftId }),
      ),
    )
    expect(replaced.revision).toBeGreaterThan(removed.revision)
    expect(replacedPreview.geometry.status).toBe("valid")
    expect(volumeFor(replacedPreview.geometry, chamferId)).toBeLessThan(changedVolume)
    expect(await call("discard_draft", { draftId: disposable.draftId })).toMatchObject({ ok: true })
    const retained = success(
      localToolOutputs.model_variables.parse(
        await call("model_variables", {
          revision: changedCommit.revision,
          cursor: null,
          limit: 20,
        }),
      ),
    )
    expect(retained.data.variables[0]?.definition.expression).toBe("1 mm")

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect
      .poll(
        async () => {
          const current = localToolOutputs.model_info.parse(await call("model_info", {}))
          return current.ok ? current.value : null
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ summary: { revision: expect.any(Number) } })
    const undone = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(undone.summary.revision).toBeGreaterThan(changedCommit.revision)
    expect(volumeFor(undone, chamferId)).toBe(originalVolume)
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    const restoredInfo = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const restored = success(
      localToolOutputs.model_variables.parse(
        await call("model_variables", {
          revision: restoredInfo.summary.revision,
          cursor: null,
          limit: 20,
        }),
      ),
    )
    expect(restored.data.variables[0]?.definition.expression).toBe("2 mm")
    expect(volumeFor(restoredInfo, chamferId)).toBe(originalVolume)
  } finally {
    await local.close()
  }
})
