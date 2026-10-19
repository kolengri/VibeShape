import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import type { ModelMeasurementEntry } from "../../packages/domain/src/model-measurements"
import { createLengthQuantity } from "../../packages/domain/src/units"
import {
  lifecycleId as id,
  primitiveNames,
  primitiveParameters,
  primitiveVolumes,
} from "../support/primitive-lifecycle"
import { enableLocalAi, openAiConnections, openAutoApplySetup } from "./application-menu-support"
import { expect, test } from "./fixtures"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
function verifyPrimitives(
  measurements: readonly ModelMeasurementEntry[] | undefined,
  scale: number,
) {
  for (const [index, name] of primitiveNames.entries()) {
    const measured = measurements?.find(({ featureId }) => featureId === id(10 + index))
    if (measured?.status !== "succeeded" || !measured.shape)
      throw new Error(`Missing exact ${name} measurements.`)
    expect(measured.shape.valid).toBe(true)
    expect(measured.shape.solidCount).toBe(1)
    expect(measured.shape.volume / (primitiveVolumes[name] * scale ** 3)).toBeCloseTo(1, 6)
  }
}

test("authors registered primitive geometry and review-bound lifecycle changes through real MCP with dependency repair and Undo/Redo", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45660 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await enableLocalAi(page)
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    let draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.summary.revision }),
      ),
    )
    let sequence = 100
    async function command(name: string, args: Record<string, unknown>) {
      const result = localToolOutputs.update_box.parse(
        await call(name, {
          ...args,
          draftId: draft.draftId,
          baseRevision: draft.revision,
          commandId: id(sequence++),
        }),
      )
      if (result.ok) draft = result.value
      return result
    }
    async function preview() {
      return success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
    }
    async function apply(destructive = false) {
      const pending = local.callTool({
        name: "commit_draft",
        arguments: { draftId: draft.draftId },
      })
      const review = page.getByRole("region", { name: "Review AI changes", exact: true })
      await expect(review).toBeVisible({ timeout: 30_000 })
      await review.getByRole("button", { name: "Apply", exact: true }).click()
      if (destructive) {
        const confirmation = page.getByRole("alertdialog", {
          name: "Apply destructive changes?",
        })
        await expect(confirmation).toBeVisible()
        await confirmation.getByRole("button", { name: "Apply changes", exact: true }).click()
      }
      return success(localToolOutputs.commit_draft.parse((await pending).structuredContent?.result))
    }
    success(
      await command("create_box", {
        featureId: id(10),
        label: "Primitive box",
        widthMm: 8,
        depthMm: 6,
        heightMm: 12,
      }),
    )
    for (const [index, name] of primitiveNames.entries()) {
      if (name === "box") continue
      success(
        await command(`create_${name}`, {
          featureId: id(10 + index),
          label: `Primitive ${name}`,
          suppressed: false,
          parameters: primitiveParameters(name),
        }),
      )
    }
    const created = await preview()
    expect(created.geometry.status).toBe("valid")
    verifyPrimitives(created.geometry.measurements?.data.features, 1)
    for (const [index, name] of primitiveNames.entries())
      success(
        await command(`update_${name}`, {
          featureId: id(10 + index),
          label: `Primitive ${name}`,
          suppressed: false,
          parameters: primitiveParameters(name, 2),
        }),
      )
    const updated = await preview()
    expect(updated.geometry.status).toBe("valid")
    verifyPrimitives(updated.geometry.measurements?.data.features, 2)
    success(
      await command("create_fillet", {
        featureId: id(20),
        label: "Box dependent",
        targetFeatureId: id(10),
        radiusMm: 0.25,
      }),
    )
    const sketch = {
      schemaVersion: 0,
      id: id(30),
      label: "Lifecycle profile",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: id(31), type: "point", x: 200, y: 0, construction: false },
        {
          schemaVersion: 0,
          id: id(32),
          type: "circle",
          centerPointId: id(31),
          radius: 2,
          construction: false,
        },
      ],
      constraints: [
        { schemaVersion: 0, id: id(33), type: "fixed", pointId: id(31) },
        {
          schemaVersion: 0,
          id: id(34),
          type: "radius",
          curveId: id(32),
          value: createLengthQuantity(2),
        },
      ],
    }
    success(await command("create_sketch", { sketch }))
    success(
      await command("create_extrude", {
        featureId: id(35),
        label: "Sketch dependent",
        dependencies: [],
        references: [],
        suppressed: false,
        parameters: {
          profile: {
            schemaVersion: 0,
            sketchId: id(30),
            outerBoundaryEntityIds: [id(32)],
            holeBoundaryEntityIds: [],
          },
          operation: "new",
          distance: createLengthQuantity(3),
          symmetric: false,
        },
      }),
    )
    expect((await preview()).geometry.status).toBe("valid")
    const fixtureCommit = await apply()
    await openAiConnections(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: fixtureCommit.revision }),
      ),
    )
    const beforeBlocked = draft.revision
    expect(await command("remove_feature", { featureId: id(10) })).toMatchObject({
      ok: false,
      diagnostic: { code: "feature-in-use" },
    })
    expect(await command("remove_sketch", { sketchId: id(30) })).toMatchObject({
      ok: false,
      diagnostic: { code: "sketch-in-use" },
    })
    expect(draft.revision).toBe(beforeBlocked)
    success(await command("set_feature_suppressed", { featureId: id(10), suppressed: true }))
    expect((await preview()).geometry.status).toBe("invalid")
    success(await command("set_feature_suppressed", { featureId: id(10), suppressed: false }))
    expect((await preview()).geometry.status).toBe("valid")
    success(await command("remove_feature", { featureId: id(20) }))
    success(await command("remove_feature", { featureId: id(10) }))
    success(await command("remove_feature", { featureId: id(35) }))
    success(await command("remove_sketch", { sketchId: id(30) }))
    success(await command("set_feature_suppressed", { featureId: id(13), suppressed: true }))
    success(await command("rename_project", { name: "Lifecycle reviewed" }))
    expect((await preview()).geometry.status).toBe("valid")
    const committed = await apply(true)
    const saved = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(saved.summary.revision).toBe(committed.revision)
    expect(saved.summary.data.name).toBe("Lifecycle reviewed")
    const sphere = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: committed.revision,
          entity: { kind: "feature", id: id(13) },
        }),
      ),
    )
    if (sphere.data.entityKind !== "feature") throw new Error("Expected a saved Sphere.")
    expect(sphere.data.record.suppressed).toBe(true)
    expect(sphere.data.record.parameters).toEqual(primitiveParameters("sphere", 2))
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect
      .poll(
        async () =>
          success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.data
            .name,
      )
      .toBe(initial.summary.data.name)
    const undone = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const restored = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: undone.summary.revision,
          entity: { kind: "feature", id: id(10) },
        }),
      ),
    )
    if (restored.data.entityKind !== "feature") throw new Error("Expected restored Box intent.")
    expect(restored.data.record.parameters).toEqual(primitiveParameters("box", 2))
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect
      .poll(
        async () =>
          success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.data
            .name,
      )
      .toBe("Lifecycle reviewed")
    await page.reload()
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(
        async () =>
          success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.data
            .name,
      )
      .toBe("Lifecycle reviewed")
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
