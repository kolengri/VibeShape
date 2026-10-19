import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../../packages/domain/src/identifiers"
import {
  createRectangleSketch,
  rectangleSketchProfileSelector,
} from "../../packages/domain/src/rectangle-sketch"
import { createSketchProfileSet } from "../../packages/domain/src/sketch-profile-selector"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"
import { openModelCommand } from "./model-command-support"

const id = (n: number) => `0195b5ac-b290-7a2c-8c33-${String(n).padStart(12, "0")}`
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
  label: `Exact MCP ${n}`,
  dependencies,
  references: [],
  suppressed: false,
  parameters,
})

function verifyMeasurements(
  view: Extract<
    ReturnType<typeof localToolOutputs.draft_measurements.parse>,
    { ok: true }
  >["value"],
  operation: string,
) {
  if (view.view.kind !== "org.vibeshape.model.measurements")
    throw new Error("Expected exact measurements.")
  for (const [n, volume] of [
    [4, 48],
    [
      5,
      operation === "add"
        ? 64 + 4 * Math.PI
        : operation === "remove"
          ? 64 - 4 * Math.PI
          : 4 * Math.PI,
    ],
  ]) {
    const measured = view.view.data.features.find((entry) => entry.featureId === id(n ?? 0))
    expect(measured).toMatchObject({ status: "succeeded", shape: { solidCount: 1 } })
    if (measured?.status !== "succeeded") throw new Error("Expected successful geometry.")
    expect(measured.shape.volume).toBeCloseTo(volume ?? 0, 5)
  }
}
test("repairs and applies exact-body Subtract/Revolve through MCP and restores selectors in the editor", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45500 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  let nextCommand = 100
  const openDraft = async () => {
    const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    return {
      draftId: draft.draftId,
      get revision() {
        return revision
      },
      async stage(name: string, args: Record<string, unknown>) {
        revision = success(
          localToolOutputs.create_body_subtract.parse(
            await call(name, {
              ...args,
              draftId: draft.draftId,
              baseRevision: revision,
              commandId: id(nextCommand++),
            }),
          ),
        ).revision
      },
    }
  }
  const commit = async (draftId: string) => {
    const committing = local.callTool({ name: "commit_draft", arguments: { draftId } })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    return success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
  }
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await enableLocalAi(page)
    const initial = await openDraft()
    await initial.stage("create_box", { featureId: id(1), widthMm: 4, depthMm: 4, heightMm: 4 })
    await initial.stage(
      "create_body_pattern",
      feature(2, [id(1)], {
        kind: "linear",
        targetBody: body(1),
        axis: "X",
        count: createScalarQuantity(3),
        spacing: createLengthQuantity(3),
      }),
    )
    expect(
      success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: initial.draftId }),
        ),
      ).geometry.status,
    ).toBe("valid")
    await commit(initial.draftId)
    const subtract = await openModelCommand(page, "Modify", "Subtract")
    await expect(subtract).toBeEnabled()
    await subtract.click()
    const form = page.getByRole("form", { name: "Subtract solids" })
    await expect(
      form.getByRole("combobox", { name: "Target solid" }).locator("option"),
    ).toHaveCount(3)
    await expect(form.getByRole("button", { name: "Subtract", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    const draft = await openDraft()
    let entity = 300,
      constraint = 400
    const sketch = createRectangleSketch({
      id: sketchIdSchema.parse(id(3)),
      label: "Exact profile",
      plane: "xy",
      width: createLengthQuantity(2),
      height: createLengthQuantity(2),
      createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
      createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
    })
    await draft.stage("create_sketch", { sketch })
    const cut = {
      operation: "subtract",
      targetBody: body(2, "pattern.instance.1"),
      toolBody: body(2, "pattern.instance.0"),
      keepTools: true,
    }
    await draft.stage("create_body_subtract", feature(4, [id(2)], cut))
    await draft.stage(
      "update_body_subtract",
      feature(4, [id(2)], { ...cut, toolBody: body(2, "missing") }),
    )
    expect(
      success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      ).geometry.status,
    ).toBe("invalid")
    await draft.stage("update_body_subtract", feature(4, [id(2)], cut))
    const profile = rectangleSketchProfileSelector(sketch)
    if (!profile) throw new Error("Expected rectangle profile selector.")
    const revolve = {
      profiles: createSketchProfileSet([profile]),
      targetBody: body(2, "pattern.instance.0"),
      axis: { kind: "origin-axis", axis: "x" },
      angle: createAngleQuantity(360, "deg"),
      operation: "add",
    }
    await draft.stage("create_body_revolve", feature(5, [id(2)], revolve))
    for (const operation of ["remove", "intersect", "add"]) {
      await draft.stage("update_body_revolve", feature(5, [id(2)], { ...revolve, operation }))
      expect(
        success(
          localToolOutputs.preview_draft.parse(
            await call("preview_draft", { draftId: draft.draftId }),
          ),
        ).geometry.status,
      ).toBe("valid")
      const view = success(
        localToolOutputs.draft_measurements.parse(
          await call("draft_measurements", {
            draftId: draft.draftId,
            revision: draft.revision,
            scope: "all",
            limit: 100,
          }),
        ),
      )
      verifyMeasurements(view, operation)
    }
    const applied = await commit(draft.draftId)
    for (const [n, version] of [
      [4, 2],
      [5, 7],
    ]) {
      const saved = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: applied.revision,
            entity: { kind: "feature", id: id(n ?? 0) },
          }),
        ),
      )
      expect(saved.data).toMatchObject({
        entityKind: "feature",
        record: { type: { schemaVersion: version } },
      })
    }
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision: applied.revision, cursor: null }),
      ),
    )
    expect(parts.parts).toHaveLength(3)
    expect(parts.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: body(2, "pattern.instance.2"), consumedBy: null }),
      ]),
    )
    await page.reload()
    await page.getByRole("treeitem", { name: "Exact MCP 4", exact: true }).click()
    const edit = page.getByRole("form", { name: "Edit subtraction" })
    await expect(edit.getByRole("combobox", { name: "Target solid" })).toHaveValue(
      JSON.stringify([id(2), "pattern.instance.1"]),
    )
    await expect(edit.getByRole("combobox", { name: "Tool solid" })).toHaveValue(
      JSON.stringify([id(2), "pattern.instance.0"]),
    )
    await expect(edit.getByRole("checkbox", { name: "Keep tool solid" })).toBeChecked()
    await edit.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("treeitem", { name: "Exact MCP 5", exact: true }).click()
    await expect(
      page
        .getByRole("form", { name: "Edit revolve" })
        .getByRole("combobox", { name: "Target body" }),
    ).toHaveValue(JSON.stringify([id(2), "pattern.instance.0"]))
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
