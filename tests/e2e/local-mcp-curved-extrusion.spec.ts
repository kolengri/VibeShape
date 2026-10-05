import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import type { ModelMeasurementEntry } from "../../packages/domain/src/model-measurements"
import { createAngleQuantity, createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi, openAiConnections, openAutoApplySetup } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

function shapeOf(measurements: readonly ModelMeasurementEntry[] | undefined) {
  const entry = measurements?.find(({ featureId }) => featureId === id(6))
  if (entry?.status !== "succeeded") throw new Error("Missing exact curved extrusion measurements.")
  return entry.shape
}

test("authors a finite spherical v7 endpoint through MCP, rejects stale support, and preserves native intent in UI edits and reload", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45690 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await toolbar.getByRole("button", { name: "Sphere", exact: true }).click()
    const sphereForm = page.getByRole("form", { name: "Create sphere" })
    await sphereForm.getByRole("combobox", { name: "Radius", exact: true }).fill("4 mm")
    await sphereForm.getByRole("combobox", { name: "Origin Z", exact: true }).fill("8 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await sphereForm.getByRole("button", { name: "Create sphere", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Sphere 1", exact: true })).toBeVisible()
    await enableLocalAi(page)
    await openAiConnections(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await expect(page.getByText("AI access on · Auto-apply on", { exact: true })).toBeVisible()
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const history = success(
      localToolOutputs.model_history.parse(
        await call("model_history", { revision: initial.summary.revision }),
      ),
    )
    const sphere = history.items.find(({ label }) => label === "Sphere 1")
    if (sphere?.ref.kind !== "feature") throw new Error("Expected the authored endpoint Sphere.")
    const body = { schemaVersion: 0, featureId: sphere.ref.id, outputRole: "result" }
    const topology = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: initial.summary.revision,
          featureId: body.featureId,
          outputRole: body.outputRole,
          topologyKind: "face",
          limit: 100,
        }),
      ),
    )
    const selected = topology.data.topology.find(
      ({ reference, resolution }) =>
        resolution === "resolved" &&
        reference.kind === "face" &&
        reference.signature.geometryClass === "SPHERE",
    )
    if (!selected) throw new Error("Expected current exact spherical face topology.")
    let draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.summary.revision }),
      ),
    )
    let sequence = 100
    async function stage(name: string, args: Record<string, unknown>) {
      draft = success(
        localToolOutputs.create_face_extent_extrude.parse(
          await call(name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId: id(sequence++),
          }),
        ),
      )
    }
    await stage("create_sketch", {
      sketch: {
        schemaVersion: 0,
        id: id(1),
        label: "Curved profile",
        plane: "xy",
        entities: [
          { schemaVersion: 0, id: id(2), type: "point", x: 0, y: 0, construction: false },
          {
            schemaVersion: 0,
            id: id(3),
            type: "circle",
            centerPointId: id(2),
            radius: 1,
            construction: false,
          },
        ],
        constraints: [
          { schemaVersion: 0, id: id(4), type: "fixed", pointId: id(2) },
          {
            schemaVersion: 0,
            id: id(5),
            type: "radius",
            curveId: id(3),
            value: createLengthQuantity(1),
          },
        ],
      },
    })
    const parameters = {
      profiles: {
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId: id(1),
            outerBoundaryEntityIds: [id(3)],
            holeBoundaryEntityIds: [],
          },
        ],
      },
      operation: "new",
      distance: createLengthQuantity(10),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      targetBody: null,
      startOffset: createLengthQuantity(0),
      draftAngle: createAngleQuantity(0),
      endCondition: {
        kind: "up-to-face",
        targetBody: body,
        sourceContentHash: topology.contentHash,
        face: selected.reference,
      },
    }
    const feature = (parameters: unknown) => ({
      featureId: id(6),
      label: "Curved extrusion",
      dependencies: [body.featureId],
      references: [],
      suppressed: false,
      parameters,
    })
    await stage("create_face_extent_extrude", feature(parameters))
    async function preview() {
      return success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
    }
    const created = await preview()
    expect(created.geometry.status, JSON.stringify(created.geometry)).toBe("valid")
    const shape = shapeOf(created.geometry.measurements?.data.features)
    expect(shape.solidCount).toBe(1)
    expect(shape.volume).toBeGreaterThan(4 * Math.PI)
    expect(shape.volume).toBeLessThan(4.2 * Math.PI)
    await stage(
      "update_face_extent_extrude",
      feature({
        ...parameters,
        endCondition: { ...parameters.endCondition, sourceContentHash: "c".repeat(64) },
      }),
    )
    expect((await preview()).geometry.status).toBe("invalid")
    const updated = { ...parameters, startOffset: createLengthQuantity(1) }
    await stage("update_face_extent_extrude", feature(updated))
    const repaired = await preview()
    expect(repaired.geometry.status, JSON.stringify(repaired.geometry)).toBe("valid")
    expect(shapeOf(repaired.geometry.measurements?.data.features).volume).toBeCloseTo(
      shape.volume - Math.PI,
      5,
    )
    const committing = local.callTool({
      name: "commit_draft",
      arguments: { draftId: draft.draftId },
    })
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    const committed = success(
      localToolOutputs.commit_draft.parse((await committing).structuredContent?.result),
    )
    await expect(review).toHaveCount(0)
    async function saved() {
      const current = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      const entity = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: current.summary.revision,
            entity: { kind: "feature", id: id(6) },
          }),
        ),
      )
      if (entity.data.entityKind !== "feature") throw new Error("Expected the saved v7 feature.")
      return entity.data.record
    }
    expect(await saved()).toMatchObject({ type: { schemaVersion: 7 }, parameters: updated })
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision: committed.revision }),
      ),
    )
    expect(
      parts.parts.find(({ body: partBody }) => partBody.featureId === body.featureId)?.consumedBy,
    ).toBeNull()
    const item = page.getByRole("treeitem", { name: "Curved extrusion", exact: true })
    await item.click()
    const edit = page.getByRole("form", { name: "Edit extrusion" })
    await expect(edit.getByLabel("End condition")).toHaveValue("up-to-face")
    await expect(edit.getByLabel("End face")).toHaveValue(JSON.stringify(selected.reference))
    await edit.getByRole("combobox", { name: "Start offset", exact: true }).fill("2 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready")
    await edit.getByRole("button", { name: "Update extrusion", exact: true }).click()
    await expect(edit).not.toBeVisible()
    expect(await saved()).toMatchObject({
      type: { schemaVersion: 7 },
      parameters: {
        ...updated,
        distance: createLengthQuantity(10, "mm", "10 mm"),
        startOffset: createLengthQuantity(2, "mm", "2 mm"),
        draftAngle: createAngleQuantity(0, "rad", "0 rad"),
      },
    })
    await page.reload()
    await expect(item).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
    await item.click()
    await expect(edit.getByRole("combobox", { name: "Start offset", exact: true })).toHaveValue(
      "2 mm",
    )
    await expect(edit.getByLabel("End face")).toHaveValue(JSON.stringify(selected.reference))
    expect(await saved()).toMatchObject({ type: { schemaVersion: 7 } })
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
