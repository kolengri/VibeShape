import type { Page } from "@playwright/test"
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
  const feature = value.measurements?.data.features.find((item) => item.featureId === featureId)
  if (feature?.status !== "succeeded" || !feature.shape) throw new Error("Missing feature volume.")
  return feature.shape.volume
}

for (const operation of ["fillet", "chamfer"] as const) {
  const offset = operation === "fillet" ? 0 : 10
  const size = (value: number) =>
    operation === "fillet" ? { radiusMm: value } : { distanceMm: value }
  const initialExpectedVolume = operation === "fillet" ? 1_000 - 4 * (1 - Math.PI / 4) * 10 : 980
  test(`creates and repairs a selected ${operation} through real local MCP`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000)
    const local = await createMcpTestClient(43900 + testInfo.parallelIndex)
    const call = async (name: string, args: Record<string, unknown>) =>
      (await local.callTool({ name, arguments: args })).structuredContent?.result
    const boxId = id(offset + 1)
    const treatmentId = id(offset + 2)
    const updateCommand = id(offset + 7)
    try {
      await page.goto(local.origin)
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()

      const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
        .revision
      const draft = success(
        localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
      )
      const box = success(
        localToolOutputs.create_box.parse(
          await call("create_box", {
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId: id(offset + 3),
            featureId: boxId,
            label: "MCP edge box",
            widthMm: 10,
            depthMm: 10,
            heightMm: 10,
          }),
        ),
      )
      const committingBox = local.callTool({
        name: "commit_draft",
        arguments: { draftId: draft.draftId },
      })
      const boxCommit = success(
        localToolOutputs.commit_draft.parse(await applyCommit(page, committingBox)),
      )
      const boxInfo = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      expect(boxInfo.summary.revision).toBe(boxCommit.revision)
      expect(volumeFor(boxInfo, boxId)).toBeCloseTo(1_000, 6)
      expect(box.revision).toBe(draft.revision + 1)

      const firstPage = success(
        localToolOutputs.model_edges.parse(
          await call("model_edges", {
            revision: boxCommit.revision,
            featureId: boxId,
            cursor: null,
            limit: 1,
          }),
        ),
      )
      const edges = [...firstPage.data.edges]
      let cursor = firstPage.nextCursor
      while (cursor !== null) {
        const next = success(
          localToolOutputs.model_edges.parse(
            await call("model_edges", {
              revision: boxCommit.revision,
              featureId: boxId,
              cursor,
              limit: 1,
            }),
          ),
        )
        edges.push(...next.data.edges)
        cursor = next.nextCursor
      }
      expect(edges).toHaveLength(12)
      expect(edges.every((edge) => edge.resolution === "resolved")).toBe(true)
      const selected = edges.find(
        ({ reference }) => reference.semanticRole === "primitive.box.edge.x.y-min.z-min",
      )
      expect(selected).toBeDefined()
      if (!selected) throw new Error("The primitive box edge role was not returned.")
      expect(
        await call("model_edges", {
          revision: boxCommit.revision - 1,
          featureId: boxId,
          cursor: null,
          limit: 1,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })

      const treatmentDraft = success(
        localToolOutputs.create_draft.parse(
          await call("create_draft", {
            baseRevision: boxCommit.revision,
          }),
        ),
      )
      const createArgs = {
        draftId: treatmentDraft.draftId,
        baseRevision: treatmentDraft.revision,
        commandId: id(offset + 4),
        featureId: treatmentId,
        targetFeatureId: boxId,
        label: `MCP ${operation}`,
        edges: [selected.reference],
        ...size(2),
      }
      success(
        localToolOutputs[`create_${operation}`].parse(
          await call(`create_${operation}`, createArgs),
        ),
      )
      const validPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", {
            draftId: treatmentDraft.draftId,
          }),
        ),
      )
      expect(validPreview.geometry.status).toBe("valid")
      const initialVolume = volumeFor(validPreview.geometry, treatmentId)
      expect(initialVolume).toBeCloseTo(initialExpectedVolume, 4)
      const initialCommitRequest = local.callTool({
        name: "commit_draft",
        arguments: { draftId: treatmentDraft.draftId },
      })
      const treatmentCommit = success(
        localToolOutputs.commit_draft.parse(await applyCommit(page, initialCommitRequest)),
      )

      const invalidDraft = success(
        localToolOutputs.create_draft.parse(
          await call("create_draft", {
            baseRevision: treatmentCommit.revision,
          }),
        ),
      )
      const invalidReference = {
        ...selected.reference,
        semanticRole: "primitive.box.edge.missing",
        signature: {
          ...selected.reference.signature,
          centroid: [999, 999, 999] as [number, number, number],
        },
      }
      const invalidArgs = {
        ...createArgs,
        draftId: invalidDraft.draftId,
        baseRevision: invalidDraft.revision,
        commandId: id(offset + 5),
        edges: [invalidReference],
      }
      const invalidUpdate = success(
        localToolOutputs[`update_${operation}`].parse(
          await call(`update_${operation}`, invalidArgs),
        ),
      )
      const invalidPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", {
            draftId: invalidDraft.draftId,
          }),
        ),
      )
      expect(invalidPreview.geometry.status).toBe("invalid")
      expect(await call("commit_draft", { draftId: invalidDraft.draftId })).toMatchObject({
        ok: false,
        diagnostic: { code: "draft-geometry-invalid" },
      })
      expect(invalidUpdate.revision).toBe(invalidDraft.revision + 1)

      success(
        localToolOutputs[`update_${operation}`].parse(
          await call(`update_${operation}`, {
            ...createArgs,
            draftId: invalidDraft.draftId,
            baseRevision: invalidUpdate.revision,
            commandId: updateCommand,
            ...size(1),
          }),
        ),
      )
      const repairedPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", {
            draftId: invalidDraft.draftId,
          }),
        ),
      )
      expect(repairedPreview.geometry.status).toBe("valid")
      expect(volumeFor(repairedPreview.geometry, treatmentId)).toBeGreaterThan(initialVolume)
      const repairedCommitRequest = local.callTool({
        name: "commit_draft",
        arguments: { draftId: invalidDraft.draftId },
      })
      const repairedCommit = success(
        localToolOutputs.commit_draft.parse(await applyCommit(page, repairedCommitRequest)),
      )
      expect(repairedCommit.revision).toBeGreaterThan(treatmentCommit.revision)

      const entity = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: repairedCommit.revision,
            entity: { kind: "feature", id: treatmentId },
          }),
        ),
      )
      if (entity.data.entityKind !== "feature") throw new Error("Expected a feature record.")
      expect(entity.data.record.type.schemaVersion).toBe(2)
      expect(entity.data.record.references).toEqual([selected.reference])
      expect(JSON.stringify(entity.data.record)).not.toContain("candidateId")
      expect(JSON.stringify(entity.data.record)).not.toContain("edgePolyline")

      await page
        .getByRole("toolbar", { name: "Model commands" })
        .getByRole("button", { name: "Undo", exact: true })
        .click()
      await expect
        .poll(
          async () =>
            success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
              .revision,
          {
            timeout: 30_000,
          },
        )
        .toBeGreaterThan(repairedCommit.revision)
      await page.reload()
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
      const restored = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      expect(volumeFor(restored, treatmentId)).toBeCloseTo(initialVolume, 4)
    } finally {
      await local.close()
    }
  })
}
