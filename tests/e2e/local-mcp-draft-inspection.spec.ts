import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { modelEdgeViewSchema } from "../../packages/automation-api/src/queries"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

for (const operation of ["fillet", "chamfer"] as const) {
  const quantity =
    operation === "fillet"
      ? { radiusMm: 999, radiusExpression: "#edgeSize" }
      : { distanceMm: 999, distanceExpression: "#edgeSize" }
  const expectedVolume = operation === "fillet" ? 1_000 - 4 * (1 - Math.PI / 4) * 10 : 980
  test(`inspects and repairs a complete draft ${operation} before one browser approval`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000)
    const local = await createMcpTestClient(44000 + testInfo.parallelIndex)
    const call = async (name: string, argumentsInput: Record<string, unknown>) =>
      (await local.callTool({ name, arguments: argumentsInput })).structuredContent?.result
    const boxId = id(1)
    const treatmentId = id(2)
    try {
      await page.goto(local.origin)
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
      const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      const base = info.summary.revision
      const draft = success(
        localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
      )
      const variable = success(
        localToolOutputs.create_variable.parse(
          await call("create_variable", {
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId: id(3),
            variable: { schemaVersion: 0, id: id(4), name: "edgeSize", expression: "2 mm" },
          }),
        ),
      )
      const box = success(
        localToolOutputs.create_box.parse(
          await call("create_box", {
            draftId: draft.draftId,
            baseRevision: variable.revision,
            commandId: id(5),
            featureId: boxId,
            label: "Draft source box",
            widthMm: 10,
            depthMm: 10,
            heightMm: 10,
          }),
        ),
      )
      const query = { draftId: draft.draftId, revision: box.revision }
      const tree = success(
        localToolOutputs.draft_tree.parse(await call("draft_tree", { ...query, limit: 1 })),
      )
      expect(tree.view).toMatchObject({
        kind: "org.vibeshape.cad.inspection.list",
        data: { items: [{ kind: "feature", id: boxId }], total: 1 },
      })
      const variables = success(
        localToolOutputs.draft_variables.parse(await call("draft_variables", query)),
      )
      expect(variables.view).toMatchObject({
        data: {
          variables: [{ definition: { name: "edgeSize" }, result: { value: 2, unit: "mm" } }],
        },
      })
      const first = success(
        localToolOutputs.draft_edges.parse(
          await call("draft_edges", { ...query, featureId: boxId, limit: 1 }),
        ),
      )
      const firstView = modelEdgeViewSchema.parse(first.view)
      const edges = [...firstView.data.edges]
      let cursor = firstView.nextCursor
      while (cursor !== null) {
        const envelope = success(
          localToolOutputs.draft_edges.parse(
            await call("draft_edges", { ...query, featureId: boxId, limit: 1, cursor }),
          ),
        )
        const next = modelEdgeViewSchema.parse(envelope.view)
        expect(next.rebuildId).toBe(firstView.rebuildId)
        expect(envelope.draft.expiresAt).toBe(box.expiresAt)
        edges.push(...next.data.edges)
        cursor = next.nextCursor
      }
      expect(edges).toHaveLength(12)
      expect(edges.every((edge) => edge.resolution === "resolved")).toBe(true)
      const selected = edges.find(
        ({ reference }) => reference.semanticRole === "primitive.box.edge.x.y-min.z-min",
      )
      if (!selected) throw new Error("Expected an inspectable box edge")
      expect(await call("draft_tree", { ...query, revision: draft.revision })).toMatchObject({
        ok: false,
        diagnostic: { code: "stale-query-revision" },
      })
      const broken = {
        ...selected.reference,
        semanticRole: "primitive.box.edge.missing",
        signature: { ...selected.reference.signature, centroid: [999, 999, 999] },
      }
      const treatmentArguments = {
        draftId: draft.draftId,
        featureId: treatmentId,
        targetFeatureId: boxId,
        label: `Draft selected ${operation}`,
        ...quantity,
      }
      const invalid = success(
        localToolOutputs[`create_${operation}`].parse(
          await call(`create_${operation}`, {
            ...treatmentArguments,
            baseRevision: box.revision,
            commandId: id(6),
            edges: [broken],
          }),
        ),
      )
      const invalidPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(invalidPreview.geometry.status).toBe("invalid")
      expect(await call("commit_draft", { draftId: draft.draftId })).toMatchObject({
        ok: false,
        diagnostic: { code: "draft-geometry-invalid" },
      })
      expect(
        await call("draft_edges", {
          ...query,
          revision: invalid.revision,
          featureId: boxId,
          cursor: firstView.nextCursor,
          limit: 1,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
      const repairQuery = { draftId: draft.draftId, revision: invalid.revision }
      const authored = success(
        localToolOutputs.draft_entity.parse(
          await call("draft_entity", {
            ...repairQuery,
            entity: { kind: "feature", id: treatmentId },
          }),
        ),
      )
      expect(authored.view).toMatchObject({
        data: { entityKind: "feature", record: { references: [broken] } },
      })
      const repairEdges = modelEdgeViewSchema.parse(
        success(
          localToolOutputs.draft_edges.parse(
            await call("draft_edges", { ...repairQuery, featureId: boxId }),
          ),
        ).view,
      )
      const repairedReference = repairEdges.data.edges.find(
        ({ reference }) => reference.semanticRole === selected.reference.semanticRole,
      )?.reference
      if (!repairedReference) throw new Error("Failed downstream geometry hid the source edges")
      success(
        localToolOutputs[`update_${operation}`].parse(
          await call(`update_${operation}`, {
            ...treatmentArguments,
            baseRevision: invalid.revision,
            commandId: id(7),
            edges: [repairedReference],
          }),
        ),
      )
      const preview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(preview.geometry.status).toBe("valid")
      const shape = preview.geometry.measurements.data.features.find(
        (entry) => entry.featureId === treatmentId,
      )
      if (shape?.status !== "succeeded") throw new Error("Expected exact treatment measurements")
      expect(shape.shape.volume).toBeCloseTo(expectedVolume, 4)
      expect(
        success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
      ).toBe(base)
      const review = page.getByRole("region", { name: "Review AI changes", exact: true })
      await expect(review).toBeHidden()
      const committing = local.callTool({
        name: "commit_draft",
        arguments: { draftId: draft.draftId },
      })
      await expect(review).toBeVisible({ timeout: 30_000 })
      await review.getByRole("button", { name: "Apply", exact: true }).click()
      const committed = success(
        localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
      )
      expect(committed.commandCount).toBe(4)
      await expect(
        page.getByRole("treeitem", { name: `Draft selected ${operation}`, exact: true }),
      ).toBeVisible()
      const after = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: committed.revision,
            entity: { kind: "feature", id: treatmentId },
          }),
        ),
      )
      expect(after.data).toMatchObject({
        entityKind: "feature",
        record: { type: { schemaVersion: 2 }, references: [repairedReference] },
      })
      expect(
        await call("draft_tree", { ...query, revision: preview.draft.revision }),
      ).toMatchObject({ ok: false, diagnostic: { code: "draft-not-found" } })
      await page
        .getByRole("toolbar", { name: "Model commands" })
        .getByRole("button", { name: "Undo", exact: true })
        .click()
      await expect
        .poll(
          async () =>
            success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
              .revision,
          { timeout: 30_000 },
        )
        .toBeGreaterThan(committed.revision)
      await page.reload()
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
      const restored = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      const restoredTree = success(
        localToolOutputs.model_tree.parse(
          await call("model_tree", { revision: restored.summary.revision }),
        ),
      )
      expect(restoredTree.data.total).toBe(0)
      const restoredVariables = success(
        localToolOutputs.model_variables.parse(
          await call("model_variables", { revision: restored.summary.revision }),
        ),
      )
      expect(restoredVariables.data.variables).toEqual([])
    } finally {
      await local.close()
    }
  })
}
