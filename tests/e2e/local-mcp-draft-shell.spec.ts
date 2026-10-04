import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type { AutomationDraftInspectionView } from "../../packages/automation-api/src/draft-inspection"
import type { AutomationDraftPreview } from "../../packages/automation-api/src/drafts"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import type { BodyTopoRef } from "../../packages/domain/src/body-topology-reference"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../../packages/domain/src/identifiers"
import {
  createRectangleSketch,
  rectangleSketchProfileSelector,
} from "../../packages/domain/src/rectangle-sketch"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b270-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

function draftTopology(value: AutomationDraftInspectionView) {
  if (value.view.kind !== "org.vibeshape.model.body-topology")
    throw new Error("Expected exact draft faces")
  return value.view
}
function draftBodies(value: AutomationDraftInspectionView) {
  if (value.view.kind !== "org.vibeshape.model.body-measurements")
    throw new Error("Expected exact draft bodies")
  return value.view
}
function featureVolume(geometry: AutomationDraftPreview["geometry"], featureId: string) {
  const entry = geometry.measurements.data.features.find((entry) => entry.featureId === featureId)
  if (entry?.status !== "succeeded") throw new Error("Expected exact feature geometry")
  return entry.shape.volume
}
function withoutDurableIdentity(reference: BodyTopoRef): BodyTopoRef {
  const { semanticRole: _semanticRole, lineageToken: _lineageToken, ...signatureOnly } = reference
  return signatureOnly
}

test("selects unsaved Extrude faces for Shell, retains durable openings and repairs unresolved references before one commit", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(44200 + testInfo.parallelIndex)
  const call = async (name: string, argumentsInput: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: argumentsInput })).structuredContent?.result
  const sourceId = id(2)
  const shellId = id(3)
  try {
    expect((await local.client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["draft_body_measurements", "draft_body_topology", "create_shell"]),
    )
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.summary.revision }),
      ),
    )
    let entity = 100
    let constraint = 200
    const sketch = createRectangleSketch({
      id: sketchIdSchema.parse(id(1)),
      label: "Draft shell profile",
      plane: "xy",
      width: createLengthQuantity(20),
      height: createLengthQuantity(10),
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
    })
    const profile = rectangleSketchProfileSelector(sketch)
    if (!profile) throw new Error("Missing rectangle profile")
    const createdSketch = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(10),
          sketch,
        }),
      ),
    )
    const parameters = {
      profile,
      distance: createLengthQuantity(10),
      symmetric: false,
      operation: "new",
    }
    const producer = {
      draftId: draft.draftId,
      featureId: sourceId,
      label: "Draft shell source",
      dependencies: [],
      references: [],
      suppressed: false,
    }
    const extrude = success(
      localToolOutputs.create_extrude.parse(
        await call("create_extrude", {
          ...producer,
          baseRevision: createdSketch.revision,
          commandId: id(11),
          parameters,
        }),
      ),
    )
    const measured = draftBodies(
      success(
        localToolOutputs.draft_body_measurements.parse(
          await call("draft_body_measurements", {
            draftId: draft.draftId,
            revision: extrude.revision,
            featureId: sourceId,
          }),
        ),
      ),
    )
    expect(measured.kind).toBe("org.vibeshape.model.body-measurements")
    expect(measured.data.bodies).toMatchObject([
      { featureId: sourceId, outputRole: "result", shape: { valid: true } },
    ])
    expect(measured.data.bodies[0]?.shape.volume).toBeCloseTo(2000, 6)
    const query = {
      draftId: draft.draftId,
      revision: extrude.revision,
      featureId: sourceId,
      outputRole: "result",
      topologyKind: "face",
    }
    const firstPage = success(
      localToolOutputs.draft_body_topology.parse(
        await call("draft_body_topology", { ...query, limit: 1 }),
      ),
    )
    const firstTopology = draftTopology(firstPage)
    if (!firstTopology.nextCursor) throw new Error("Expected fresh topology cursor")
    const oldCursor = firstTopology.nextCursor
    const secondPage = success(
      localToolOutputs.draft_body_topology.parse(
        await call("draft_body_topology", { ...query, cursor: oldCursor, limit: 1 }),
      ),
    )
    expect(secondPage.view).toMatchObject({
      rebuildId: firstTopology.rebuildId,
      contentHash: firstTopology.contentHash,
    })
    const inspect = async (revision: number) => {
      const value = success(
        localToolOutputs.draft_body_topology.parse(
          await call("draft_body_topology", { ...query, revision, limit: 100 }),
        ),
      )
      const topology = draftTopology(value)
      const opening = topology.data.topology.find(
        (entry) => entry.reference.semanticRole === "extrusion.cap.end",
      )
      if (opening?.reference.kind !== "face" || opening.resolution !== "resolved")
        throw new Error("Missing unambiguous extrusion cap")
      return { sourceContentHash: topology.contentHash, openings: [opening.reference] }
    }
    const selected = await inspect(extrude.revision)
    const shell = {
      draftId: draft.draftId,
      featureId: shellId,
      label: "Draft open shell",
      dependencies: [sourceId],
      references: [],
      suppressed: false,
    }
    const shellParameters = {
      targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
      thickness: createLengthQuantity(1),
      direction: "inward",
      ...selected,
    }
    const createdShell = success(
      localToolOutputs.create_shell.parse(
        await call("create_shell", {
          ...shell,
          baseRevision: extrude.revision,
          commandId: id(12),
          parameters: shellParameters,
        }),
      ),
    )
    const firstPreview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(firstPreview.geometry.status).toBe("valid")
    expect(firstPreview.geometry.diagnostics).toMatchObject({
      status: "valid",
      truncated: false,
      entries: [],
    })
    expect(featureVolume(firstPreview.geometry, shellId)).toBeCloseTo(704, 4)
    const changed = success(
      localToolOutputs.update_extrude.parse(
        await call("update_extrude", {
          ...producer,
          baseRevision: createdShell.revision,
          commandId: id(13),
          parameters: { ...parameters, distance: createLengthQuantity(12) },
        }),
      ),
    )
    expect(
      await call("draft_body_topology", {
        ...query,
        revision: changed.revision,
        cursor: oldCursor,
        limit: 1,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    const retained = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(retained.geometry.status).toBe("valid")
    expect(retained.geometry.diagnostics).toMatchObject({ status: "valid", entries: [] })
    expect(featureVolume(retained.geometry, shellId)).toBeCloseTo(816, 4)
    const current = await inspect(changed.revision)
    expect(current.sourceContentHash).not.toBe(selected.sourceContentHash)
    const signatureOnly = success(
      localToolOutputs.update_shell.parse(
        await call("update_shell", {
          ...shell,
          baseRevision: changed.revision,
          commandId: id(14),
          parameters: {
            ...shellParameters,
            ...current,
            openings: current.openings.map(withoutDurableIdentity),
          },
        }),
      ),
    )
    const exact = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(exact.geometry.status).toBe("valid")
    expect(featureVolume(exact.geometry, shellId)).toBeCloseTo(816, 4)
    const unresolved = success(
      localToolOutputs.update_extrude.parse(
        await call("update_extrude", {
          ...producer,
          baseRevision: signatureOnly.revision,
          commandId: id(15),
          parameters: { ...parameters, distance: createLengthQuantity(14) },
        }),
      ),
    )
    const invalid = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(invalid.geometry.status).toBe("invalid")
    const validProducer = draftBodies(
      success(
        localToolOutputs.draft_body_measurements.parse(
          await call("draft_body_measurements", {
            draftId: draft.draftId,
            revision: unresolved.revision,
            featureId: sourceId,
            outputRole: "result",
          }),
        ),
      ),
    )
    expect(validProducer.data.bodies).toMatchObject([
      { featureId: sourceId, outputRole: "result", shape: { valid: true } },
    ])
    expect(validProducer.data.bodies[0]?.shape.volume).toBeCloseTo(2800, 4)
    expect(invalid.geometry.diagnostics?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: { kind: "feature", id: shellId },
          code: "org.vibeshape.feature.geometry-evaluation-failed",
          values: { reason: "invalid-feature-parameters" },
        }),
      ]),
    )
    expect(await call("commit_draft", { draftId: draft.draftId })).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    const repaired = await inspect(unresolved.revision)
    expect(repaired.sourceContentHash).not.toBe(current.sourceContentHash)
    const updated = success(
      localToolOutputs.update_shell.parse(
        await call("update_shell", {
          ...shell,
          baseRevision: unresolved.revision,
          commandId: id(16),
          parameters: { ...shellParameters, ...repaired },
        }),
      ),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.draft.revision).toBe(updated.revision)
    expect(preview.geometry.status).toBe("valid")
    expect(featureVolume(preview.geometry, shellId)).toBeCloseTo(928, 4)
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(initial.summary.revision)
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
    expect(committed.commandCount).toBe(7)
    await expect(
      page.getByRole("treeitem", { name: "Draft open shell", exact: true }),
    ).toBeVisible()
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).diagnostics,
    ).toMatchObject({ status: "valid", entries: [] })
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Undo", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Draft open shell", exact: true })).toHaveCount(
      0,
    )
    expect(
      await call("draft_body_measurements", { draftId: draft.draftId, revision: updated.revision }),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-not-found" } })
  } finally {
    await local.close()
  }
})
