import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { sketchSolutionViewSchema } from "../../packages/automation-api/src/sketch-solution-queries"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../../packages/domain/src/identifiers"
import { createRectangleSketch } from "../../packages/domain/src/rectangle-sketch"
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
test("discovers native draft profiles, uses their stable selector and reads the committed solution without saving inspection", async ({
  page,
}, testInfo) => {
  test.setTimeout(240000)
  const local = await createMcpTestClient(44100 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    const tools = await local.client.listTools()
    for (const name of ["model_sketch_solution", "draft_sketch_solution"]) {
      expect(tools.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
      })
    }
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30000,
    })
    await enableLocalAi(page)
    const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: info.summary.revision }),
      ),
    )
    let entity = 100,
      constraint = 200
    const sketch = createRectangleSketch({
      id: sketchIdSchema.parse(id(1)),
      label: "Inspected rectangle",
      plane: "xy",
      width: createLengthQuantity(10),
      height: createLengthQuantity(8),
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
    })
    const staged = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(2),
          sketch,
        }),
      ),
    )
    const args = { draftId: draft.draftId, revision: staged.revision, sketchId: sketch.id }
    const profiles = sketchSolutionViewSchema.parse(
      success(
        localToolOutputs.draft_sketch_solution.parse(await call("draft_sketch_solution", args)),
      ).view,
    )
    expect(profiles.summary).toMatchObject({ status: "fully-constrained", degreesOfFreedom: 0 })
    expect(profiles.data.section).toBe("profiles")
    if (profiles.data.section !== "profiles") throw new Error("Missing profile discovery")
    const profile = profiles.data.items[0]
    if (!profile) throw new Error("Missing stable rectangle profile")
    expect(profile).toMatchObject({
      area: 80,
      perimeter: 36,
      selector: {
        outerBoundaryEntityIds: [id(104), id(105), id(106), id(107)],
        holeBoundaryEntityIds: [],
      },
    })
    const points = sketchSolutionViewSchema.parse(
      success(
        localToolOutputs.draft_sketch_solution.parse(
          await call("draft_sketch_solution", { ...args, section: "points", limit: 2 }),
        ),
      ).view,
    )
    expect(points.inspectionId).toBe(profiles.inspectionId)
    expect(points.data).toMatchObject({ section: "points", total: 4 })
    expect(points.nextCursor).toMatchObject({ section: "points", offset: 2 })
    const next = sketchSolutionViewSchema.parse(
      success(
        localToolOutputs.draft_sketch_solution.parse(
          await call("draft_sketch_solution", {
            ...args,
            section: "points",
            limit: 2,
            cursor: points.nextCursor,
          }),
        ),
      ).view,
    )
    expect(next.nextCursor).toBeNull()
    expect(next.inspectionId).toBe(points.inspectionId)
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(info.summary.revision)
    const solid = success(
      localToolOutputs.create_extrude.parse(
        await call("create_extrude", {
          draftId: draft.draftId,
          baseRevision: staged.revision,
          commandId: id(3),
          featureId: id(4),
          label: "Discovered profile extrusion",
          dependencies: [],
          references: [],
          suppressed: false,
          parameters: {
            profile: profile.selector,
            distance: createLengthQuantity(3),
            symmetric: false,
            operation: "new",
          },
        }),
      ),
    )
    expect(
      await call("draft_sketch_solution", {
        ...args,
        revision: solid.revision,
        section: "points",
        cursor: points.nextCursor,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    const committing = local.callTool(
      { name: "commit_draft", arguments: { draftId: draft.draftId } },
      { timeout: 120000 },
    )
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const saved = success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
    const committed = success(
      localToolOutputs.model_sketch_solution.parse(
        await call("model_sketch_solution", { revision: saved.revision, sketchId: sketch.id }),
      ),
    )
    expect(committed.summary).toMatchObject({ status: "fully-constrained", degreesOfFreedom: 0 })
    expect(committed.data).toMatchObject({
      section: "profiles",
      items: [{ area: 80, selector: profile.selector }],
    })
    const after = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(after.summary.revision).toBe(saved.revision)
    expect(after.measurements?.data.features).toMatchObject([{ shape: { volume: 240 } }])
  } finally {
    await local.close()
  }
})
