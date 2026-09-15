import type { Page } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import {
  commandIdSchema,
  featureIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../../packages/domain/src/identifiers"
import {
  createRectangleSketch,
  rectangleSketchProfileSelector,
} from "../../packages/domain/src/rectangle-sketch"
import { sketchRecordSchema } from "../../packages/domain/src/sketch"
import { createAngleQuantity, createLengthQuantity } from "../../packages/domain/src/units"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const command = (n: number) => commandIdSchema.parse(id(n))

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message?: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message ?? "Local MCP operation failed.")
  return result.value
}

function rectangleSketch(sketchId: string, width: number, height: number, label: string) {
  return createRectangleSketch({
    id: sketchIdSchema.parse(sketchId),
    label,
    plane: "xy",
    width: createLengthQuantity(width),
    height: createLengthQuantity(height),
    createEntityId: (() => {
      let next = 1
      return () => sketchEntityIdSchema.parse(id(100 + next++))
    })(),
    createConstraintId: (() => {
      let next = 1
      return () => sketchConstraintIdSchema.parse(id(200 + next++))
    })(),
  })
}

function changedWidth(sketch: ReturnType<typeof rectangleSketch>, width: number) {
  return sketchRecordSchema.parse({
    ...sketch,
    constraints: sketch.constraints.map((constraint) =>
      constraint.type === "horizontal-distance"
        ? { ...constraint, value: createLengthQuantity(width) }
        : constraint,
    ),
  })
}

function featureVolume(
  value: {
    measurements: {
      data: {
        features: readonly { featureId: string; status: string; shape?: { volume: number } }[]
      }
    } | null
  },
  featureId: string,
) {
  if (!value.measurements) throw new Error("Exact model measurements are unavailable.")
  const entry = value.measurements.data.features.find(
    (candidate) => candidate.featureId === featureId,
  )
  if (entry?.status !== "succeeded" || !entry.shape)
    throw new Error(`No exact volume for ${featureId}.`)
  return entry.shape.volume
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

test("creates and updates a sketch-backed extrusion through real local MCP and browser Apply", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(43600 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    const info = localToolOutputs.model_info.parse(await call("model_info", {}))
    const base = success(info).summary.revision
    const sketchId = sketchIdSchema.parse(id(1))
    const featureId = featureIdSchema.parse(id(2))
    const sketch = rectangleSketch(sketchId, 20, 10, "MCP sketch")
    const profile = rectangleSketchProfileSelector(sketch)
    if (!profile) throw new Error("The rectangle fixture must expose one profile.")
    const [firstBoundaryEntityId] = profile.outerBoundaryEntityIds
    if (!firstBoundaryEntityId) throw new Error("The rectangle profile boundary is empty.")
    const badProfile = {
      ...profile,
      outerBoundaryEntityIds: [firstBoundaryEntityId],
    }
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    const createdSketch = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: command(3),
          sketch,
        }),
      ),
    )
    revision = createdSketch.revision
    const createdFeature = success(
      localToolOutputs.create_extrude.parse(
        await call("create_extrude", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: command(4),
          featureId,
          label: "MCP extrusion",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile: badProfile,
            distance: createLengthQuantity(5),
            symmetric: false,
            operation: "new",
          },
        }),
      ),
    )
    revision = createdFeature.revision
    const invalidPreview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(invalidPreview.geometry.status).toBe("invalid")
    const repaired = success(
      localToolOutputs.update_extrude.parse(
        await call("update_extrude", {
          draftId: draft.draftId,
          baseRevision: createdFeature.revision,
          commandId: command(50),
          featureId,
          label: "MCP extrusion",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile,
            distance: createLengthQuantity(5),
            symmetric: false,
            operation: "new",
          },
        }),
      ),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(repaired.revision).toBe(createdFeature.revision + 1)
    expect(preview.geometry.status).toBe("valid")
    expect(featureVolume(preview.geometry, featureId)).toBeCloseTo(1_000, 6)
    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const commit = success(localToolOutputs.commit_draft.parse(await applyCommit(page, committing)))
    const afterCreate = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(afterCreate.summary.revision).toBe(commit.revision)
    expect(featureVolume(afterCreate, featureId)).toBeCloseTo(1_000, 6)

    const tree = success(
      localToolOutputs.model_tree.parse(
        await call("model_tree", { revision: commit.revision, cursor: null, limit: 20 }),
      ),
    )
    expect(tree.revision).toBe(commit.revision)
    expect(tree.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sketch", id: sketchId }),
        expect.objectContaining({ kind: "feature", id: featureId }),
      ]),
    )
    const entity = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: commit.revision,
          entity: { kind: "feature", id: featureId },
        }),
      ),
    )
    expect(entity.revision).toBe(commit.revision)
    expect(entity.data.entityKind).toBe("feature")
    if (entity.data.entityKind !== "feature")
      throw new Error("Expected a feature inspection record.")
    const sketchEntity = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: commit.revision,
          entity: { kind: "sketch", id: sketchId },
        }),
      ),
    )
    expect(sketchEntity.data.entityKind).toBe("sketch")
    if (sketchEntity.data.entityKind !== "sketch")
      throw new Error("Expected a sketch inspection record.")
    expect(sketchEntity.data.record.id).toBe(sketchId)
    expect(entity.data.record.id).toBe(featureId)
    expect(
      await call("model_tree", { revision: commit.revision - 1, cursor: null, limit: 20 }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })

    const nextDraft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: commit.revision }),
      ),
    )
    revision = nextDraft.revision
    const updatedSketch = changedWidth(sketchEntity.data.record, 30)
    const sketchUpdate = success(
      localToolOutputs.update_sketch.parse(
        await call("update_sketch", {
          draftId: nextDraft.draftId,
          baseRevision: revision,
          commandId: command(5),
          sketch: updatedSketch,
        }),
      ),
    )
    revision = sketchUpdate.revision
    const updatedProfile = rectangleSketchProfileSelector(updatedSketch)
    if (!updatedProfile) throw new Error("The updated rectangle fixture must expose one profile.")
    const existingParameters = entity.data.record.parameters
    const featureUpdate = success(
      localToolOutputs.update_extrude.parse(
        await call("update_extrude", {
          draftId: nextDraft.draftId,
          baseRevision: revision,
          commandId: command(6),
          featureId,
          label: "MCP extrusion",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            ...existingParameters,
            profile: updatedProfile,
            distance: createLengthQuantity(7),
            symmetric: false,
            operation: "new",
          },
        }),
      ),
    )
    revision = featureUpdate.revision
    const updatedPreview = success(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { draftId: nextDraft.draftId }),
      ),
    )
    expect(updatedPreview.geometry.status).toBe("valid")
    expect(featureVolume(updatedPreview.geometry, featureId)).toBeCloseTo(2_100, 6)
    const committingUpdate = local.callTool({
      name: "commit_draft",
      arguments: { draftId: nextDraft.draftId },
    })
    const updateCommit = success(
      localToolOutputs.commit_draft.parse(await applyCommit(page, committingUpdate)),
    )
    const afterUpdate = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(afterUpdate.summary.revision).toBe(updateCommit.revision)
    expect(featureVolume(afterUpdate, featureId)).toBeCloseTo(2_100, 6)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect
      .poll(
        async () => {
          const result = localToolOutputs.model_info.parse(await call("model_info", {}))
          return result.ok ? result.value.summary.revision : -1
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(updateCommit.revision)
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "MCP extrusion", exact: true })).toBeVisible()
    const afterUndo = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(featureVolume(afterUndo, featureId)).toBeCloseTo(1_000, 6)
  } finally {
    await local.close()
  }
})

test("creates and updates a full revolve through real local MCP", async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(43700 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    const sketchId = sketchIdSchema.parse(id(11))
    const featureId = featureIdSchema.parse(id(12))
    const sketch = rectangleSketch(sketchId, 10, 4, "MCP revolve sketch")
    const profile = rectangleSketchProfileSelector(sketch)
    if (!profile) throw new Error("The revolve fixture must expose one profile.")
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    revision = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: command(13),
          sketch,
        }),
      ),
    ).revision
    revision = success(
      localToolOutputs.create_revolve.parse(
        await call("create_revolve", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: command(14),
          featureId,
          label: "MCP revolve",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile,
            axis: { kind: "origin-axis", axis: "y" },
            angle: createAngleQuantity(360, "deg"),
            operation: "new",
          },
        }),
      ),
    ).revision
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    expect(featureVolume(preview.geometry, featureId)).toBeCloseTo(400 * Math.PI, 6)
    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const commit = success(localToolOutputs.commit_draft.parse(await applyCommit(page, committing)))
    const after = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(after.summary.revision).toBe(commit.revision)
    expect(featureVolume(after, featureId)).toBeCloseTo(400 * Math.PI, 6)

    const nextDraft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: commit.revision }),
      ),
    )
    const updated = success(
      localToolOutputs.update_revolve.parse(
        await call("update_revolve", {
          draftId: nextDraft.draftId,
          baseRevision: nextDraft.revision,
          commandId: command(15),
          featureId,
          label: "MCP revolve",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile,
            axis: { kind: "origin-axis", axis: "y" },
            angle: createAngleQuantity(180, "deg"),
            operation: "new",
          },
        }),
      ),
    )
    const updatedPreview = success(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { draftId: nextDraft.draftId }),
      ),
    )
    expect(updated.revision).toBe(nextDraft.revision + 1)
    expect(updatedPreview.geometry.status).toBe("valid")
    expect(featureVolume(updatedPreview.geometry, featureId)).toBeCloseTo(200 * Math.PI, 6)
    const committingUpdate = local.callTool({
      name: "commit_draft",
      arguments: { draftId: nextDraft.draftId },
    })
    const updateCommit = success(
      localToolOutputs.commit_draft.parse(await applyCommit(page, committingUpdate)),
    )
    const afterUpdate = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(afterUpdate.summary.revision).toBe(updateCommit.revision)
    expect(featureVolume(afterUpdate, featureId)).toBeCloseTo(200 * Math.PI, 6)
  } finally {
    await local.close()
  }
})
