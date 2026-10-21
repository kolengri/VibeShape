import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { modelBodyTopologyViewSchema } from "../../packages/automation-api/src/queries"
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

const id = (n: number) => `0195b5ac-b290-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("treats an exact sketch corner, aligns body faces and reviews a semantic History move through MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45710 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  const apply = async (name: string, args: Record<string, unknown>) => {
    const pending = call(name, args)
    await Promise.race([
      pending.then((result) => {
        throw new Error(`${name} completed before manual review: ${JSON.stringify(result)}`)
      }),
      expect(review).toBeVisible({ timeout: 60_000 }),
    ])
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const result = await pending
    await expect(review).toHaveCount(0)
    return result
  }
  try {
    await page.goto(local.origin)
    await enableLocalAi(page)
    const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    let draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: info.summary.revision }),
      ),
    )
    let entity = 1,
      constraint = 100
    const sketch = createRectangleSketch({
      id: sketchIdSchema.parse(id(200)),
      label: "Rounded rectangle",
      plane: "xy",
      width: createLengthQuantity(10),
      height: createLengthQuantity(8),
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
    })
    draft = success(
      localToolOutputs.create_sketch.parse(
        await call("create_sketch", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(300),
          sketch,
        }),
      ),
    )
    draft = success(
      localToolOutputs.treat_sketch_corner.parse(
        await call("treat_sketch_corner", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(301),
          sketchId: sketch.id,
          treatment: {
            kind: "fillet",
            firstLineId: id(5),
            secondLineId: id(6),
            radius: createLengthQuantity(2),
          },
        }),
      ),
    )
    const solution = sketchSolutionViewSchema.parse(
      success(
        localToolOutputs.draft_sketch_solution.parse(
          await call("draft_sketch_solution", {
            draftId: draft.draftId,
            revision: draft.revision,
            sketchId: sketch.id,
          }),
        ),
      ).view,
    )
    expect(solution.counts.failedConstraints).toBe(0)
    if (solution.data.section !== "profiles") throw new Error("Expected sketch profiles")
    expect(solution.data.items).toHaveLength(1)
    expect(solution.data.items[0]?.area).toBeCloseTo(80 - (4 - Math.PI), 5)
    for (const [featureId, commandId, heightMm] of [
      [id(400), id(401), 10],
      [id(410), id(411), 20],
    ] as const) {
      draft = success(
        localToolOutputs.create_box.parse(
          await call("create_box", {
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId,
            featureId,
            widthMm: 10,
            depthMm: 10,
            heightMm,
          }),
        ),
      )
    }
    const topFace = async (featureId: string) => {
      const topology = modelBodyTopologyViewSchema.parse(
        success(
          localToolOutputs.draft_body_topology.parse(
            await call("draft_body_topology", {
              draftId: draft.draftId,
              revision: draft.revision,
              featureId,
              outputRole: "result",
              topologyKind: "face",
              limit: 100,
            }),
          ),
        ).view,
      )
      const face = topology.data.topology.find(
        ({ reference, resolution }) =>
          resolution === "resolved" && (reference.signature.direction?.[2] ?? 0) > 0.99,
      )
      if (!face) throw new Error("Expected oriented top face")
      return face.reference
    }
    const sourceFace = await topFace(id(400)),
      targetFace = await topFace(id(410))
    const draftMeasurement = success(
      localToolOutputs.measure_model.parse(
        await call("measure_model", {
          source: "draft",
          draftId: draft.draftId,
          revision: draft.revision,
          targets: [{ reference: sourceFace }, { reference: targetFace }],
        }),
      ),
    )
    expect(draftMeasurement.pair).toMatchObject({
      pointDistanceMm: 10,
      directionAngleRad: 0,
      parallelPlaneSeparationMm: 10,
    })
    draft = success(
      localToolOutputs.create_face_aligned_placement.parse(
        await call("create_face_aligned_placement", {
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(420),
          featureId: id(421),
          label: "Aligned box",
          sourceFace,
          targetFace,
          orientation: "same",
          offsetMm: 5,
        }),
      ),
    )
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    const placed = preview.geometry.measurements.data.features.find(
      ({ featureId }) => featureId === id(421),
    )
    if (placed?.status !== "succeeded") throw new Error("Expected successful exact Placement")
    expect(placed.shape.volume).toBeCloseTo(1000, 6)
    for (const [axis, min, max] of [
      [0, -5, 5],
      [1, -5, 5],
      [2, 15, 25],
    ] as const) {
      expect(placed.shape.bounds.min[axis]).toBeCloseTo(min, 5)
      expect(placed.shape.bounds.max[axis]).toBeCloseTo(max, 5)
    }
    const committed = success(
      localToolOutputs.commit_draft.parse(await apply("commit_draft", { draftId: draft.draftId })),
    )
    const savedTopology = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: committed.revision,
          featureId: id(421),
          outputRole: "result",
          topologyKind: "face",
          limit: 100,
        }),
      ),
    )
    const placedTop = savedTopology.data.topology.find(
      ({ reference }) => (reference.signature.direction?.[2] ?? 0) > 0.99,
    )?.reference
    if (!placedTop) throw new Error("Expected saved placed top face")
    const savedMeasurement = success(
      localToolOutputs.measure_model.parse(
        await call("measure_model", {
          source: "model",
          revision: committed.revision,
          targets: [{ reference: placedTop }, { reference: targetFace }],
        }),
      ),
    )
    expect(savedMeasurement.pair).toMatchObject({
      pointDistanceMm: 5,
      parallelPlaneSeparationMm: 5,
    })
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(committed.revision)
    const moved = success(
      localToolOutputs.move_history_item.parse(
        await apply("move_history_item", {
          documentId: info.summary.documentId,
          baseRevision: committed.revision,
          commandId: id(430),
          item: { kind: "feature", id: id(400) },
          historyAfter: { kind: "feature", id: id(410) },
        }),
      ),
    )
    expect(moved.revision).toBe(committed.revision + 1)
    const history = success(
      localToolOutputs.model_history.parse(
        await call("model_history", { revision: moved.revision }),
      ),
    )
    expect(history.items.map(({ ref }) => ref.id)).toEqual([sketch.id, id(410), id(400), id(421)])
    const undone = success(
      localToolOutputs.undo_model.parse(
        await apply("undo_model", {
          documentId: info.summary.documentId,
          baseRevision: moved.revision,
          commandId: id(431),
        }),
      ),
    )
    const original = success(
      localToolOutputs.model_history.parse(
        await call("model_history", { revision: undone.revision }),
      ),
    )
    expect(original.items.map(({ ref }) => ref.id)).toEqual([sketch.id, id(400), id(410), id(421)])
  } finally {
    await local.close()
  }
})
