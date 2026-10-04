import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { sketchSolutionViewSchema } from "../../packages/automation-api/src/sketch-solution-queries"
import { createAngleQuantity, createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b280-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
test("authors, regenerates and detaches exact sketch text, then places its extruded named body through real MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45600 + testInfo.parallelIndex)
  const call = async (name: string, arguments_: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: arguments_ })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await enableLocalAi(page)
    const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: info.summary.revision }),
      ),
    )
    let revision = info.summary.revision
    const sketch = {
      schemaVersion: 0,
      id: id(1),
      label: "Editable lettering",
      plane: "xy",
      entities: [],
      constraints: [],
    }
    revision = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(2),
          sketch,
        }),
      ),
    ).revision
    const intent = {
      text: "O",
      heightMm: 10,
      trackingMm: 0,
      alignment: { horizontal: "left", vertical: "baseline" },
      kerning: true,
    }
    const textBase = { draftId: draft.draftId, sketchId: sketch.id, groupId: id(3), origin: [0, 0] }
    revision = success(
      localToolOutputs.create_sketch_text.parse(
        await call("create_sketch_text", {
          ...textBase,
          baseRevision: revision,
          commandId: id(4),
          intent,
        }),
      ),
    ).revision
    revision = success(
      localToolOutputs.update_sketch_text.parse(
        await call("update_sketch_text", {
          ...textBase,
          baseRevision: revision,
          commandId: id(5),
          intent: { ...intent, text: "D" },
          removeAttachedConstraints: false,
        }),
      ),
    ).revision
    const readProfiles = async () =>
      sketchSolutionViewSchema.parse(
        success(
          localToolOutputs.draft_sketch_solution.parse(
            await call("draft_sketch_solution", {
              draftId: draft.draftId,
              revision,
              sketchId: sketch.id,
            }),
          ),
        ).view,
      )
    const beforeDetach = await readProfiles()
    expect(beforeDetach.summary.status).toBe("under-constrained")
    if (beforeDetach.data.section !== "profiles" || !beforeDetach.data.items[0])
      throw new Error("Expected exact lettering profile.")
    const profile = beforeDetach.data.items[0]
    expect(profile.selector.holeBoundaryEntityIds).toHaveLength(1)
    revision = success(
      localToolOutputs.detach_sketch_text.parse(
        await call("detach_sketch_text", {
          draftId: draft.draftId,
          sketchId: sketch.id,
          groupId: id(3),
          baseRevision: revision,
          commandId: id(6),
        }),
      ),
    ).revision
    const afterDetach = await readProfiles()
    expect(afterDetach.data).toEqual(beforeDetach.data)
    revision = success(
      localToolOutputs.create_extrude.parse(
        await call("create_extrude", {
          draftId: draft.draftId,
          baseRevision: revision,
          commandId: id(7),
          featureId: id(8),
          label: "Letter solid",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile: profile.selector,
            distance: createLengthQuantity(2),
            symmetric: false,
            operation: "new",
          },
        }),
      ),
    ).revision
    const placementBase = {
      draftId: draft.draftId,
      featureId: id(9),
      label: "Placed lettering",
      dependencies: [id(8)],
      references: [],
      suppressed: false,
    }
    const parameters = {
      targetBody: { schemaVersion: 0, featureId: id(8), outputRole: "result" },
      translation: {
        x: createLengthQuantity(12),
        y: createLengthQuantity(0),
        z: createLengthQuantity(0),
      },
      rotation: { x: createAngleQuantity(0), y: createAngleQuantity(0), z: createAngleQuantity(0) },
    }
    revision = success(
      localToolOutputs.create_placement.parse(
        await call("create_placement", {
          ...placementBase,
          baseRevision: revision,
          commandId: id(10),
          parameters,
        }),
      ),
    ).revision
    revision = success(
      localToolOutputs.update_placement.parse(
        await call("update_placement", {
          ...placementBase,
          baseRevision: revision,
          commandId: id(11),
          parameters: {
            ...parameters,
            translation: { ...parameters.translation, x: createLengthQuantity(15) },
          },
        }),
      ),
    ).revision
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    const placed = preview.geometry.measurements.data.features.find(
      (feature) => feature.featureId === id(9),
    )
    if (placed?.status !== "succeeded") throw new Error("Expected exact placed lettering geometry.")
    expect(placed.shape.volume).toBeCloseTo(profile.area * 2, 5)
    const committing = local.callTool(
      { name: "commit_draft", arguments: { draftId: draft.draftId } },
      { timeout: 120_000 },
    )
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const committed = success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
    expect(committed.revision).toBe(revision)
    await expect(
      page.getByRole("treeitem", { name: "Placed lettering", exact: true }),
    ).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Placed lettering", exact: true })).toHaveCount(
      0,
    )
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(
      page.getByRole("treeitem", { name: "Placed lettering", exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Placed lettering", exact: true })).toBeVisible(
      { timeout: 30_000 },
    )
  } finally {
    await local.close()
  }
})
