import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
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

test("auto-applies Shell replacement with Mirror and Extrusion v6, then another CAD edit", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(44940 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  try {
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await enableLocalAi(page)
    await openAiConnections(page)
    await openAutoApplySetup(page)
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    let draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", {
          baseRevision: success(localToolOutputs.model_info.parse(await call("model_info", {})))
            .summary.revision,
        }),
      ),
    )
    let sequence = 100
    async function stage(name: string, args: Record<string, unknown>) {
      draft = success(
        localToolOutputs.create_box.parse(
          await call(name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId: id(sequence++),
          }),
        ),
      )
    }
    async function commit() {
      const result = success(
        localToolOutputs.commit_draft.parse(await call("commit_draft", { draftId: draft.draftId })),
      )
      await expect(review).toHaveCount(0)
      expect(
        success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
      ).toBe(result.revision)
      return result
    }
    async function nextDraft() {
      draft = success(
        localToolOutputs.create_draft.parse(
          await call("create_draft", {
            baseRevision: success(localToolOutputs.model_info.parse(await call("model_info", {})))
              .summary.revision,
          }),
        ),
      )
    }
    await stage("create_box", {
      featureId: id(10),
      label: "Original solid",
      widthMm: 10,
      depthMm: 20,
      heightMm: 30,
    })
    const original = await commit()
    const topology = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: original.revision,
          featureId: id(10),
          outputRole: "result",
          topologyKind: "face",
          limit: 100,
        }),
      ),
    )
    await nextDraft()
    await stage("create_shell", {
      featureId: id(11),
      label: "Shell to replace",
      dependencies: [id(10)],
      references: [],
      suppressed: false,
      parameters: {
        targetBody: { schemaVersion: 0, featureId: id(10), outputRole: "result" },
        thickness: createLengthQuantity(1),
        direction: "inward",
        sourceContentHash: topology.contentHash,
        openings: [],
      },
    })
    await commit()
    await nextDraft()
    await stage("remove_feature", { featureId: id(11) })
    await stage("create_mirror", {
      featureId: id(12),
      label: "Replacement Mirror",
      dependencies: [id(10)],
      references: [],
      suppressed: false,
      parameters: {
        targetBody: { schemaVersion: 0, featureId: id(10), outputRole: "result" },
        plane: "YZ",
        offset: createLengthQuantity(-10),
        preserveSource: true,
      },
    })
    await stage("create_sketch", {
      sketch: {
        schemaVersion: 0,
        id: id(20),
        label: "Hook profile",
        plane: "xy",
        entities: [
          { schemaVersion: 0, id: id(21), type: "point", x: 50, y: 0, construction: false },
          {
            schemaVersion: 0,
            id: id(22),
            type: "circle",
            centerPointId: id(21),
            radius: 2,
            construction: false,
          },
        ],
        constraints: [
          { schemaVersion: 0, id: id(23), type: "fixed", pointId: id(21) },
          {
            schemaVersion: 0,
            id: id(24),
            type: "radius",
            curveId: id(22),
            value: createLengthQuantity(2),
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
            sketchId: id(20),
            outerBoundaryEntityIds: [id(22)],
            holeBoundaryEntityIds: [],
          },
        ],
      },
      distance: createLengthQuantity(4),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      operation: "new",
      targetBody: null,
      startOffset: createLengthQuantity(0),
      draftAngle: createAngleQuantity(0),
      endCondition: { kind: "distance" },
    }
    const feature = {
      featureId: id(25),
      label: "Hook Extrude",
      dependencies: [],
      references: [],
      suppressed: false,
    }
    await stage("create_extrude", { ...feature, parameters })
    const replacement = await commit()
    await expect(page.getByRole("treeitem", { name: "Shell to replace", exact: true })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole("treeitem", { name: "Replacement Mirror", exact: true }),
    ).toBeVisible()
    const saved = success(
      localToolOutputs.model_entity.parse(
        await call("model_entity", {
          revision: replacement.revision,
          entity: { kind: "feature", id: id(25) },
        }),
      ),
    )
    if (saved.data.entityKind !== "feature") throw new Error("Expected saved Extrusion.")
    expect(saved.data.record.type.schemaVersion).toBe(6)
    await nextDraft()
    await stage("update_extrude", {
      ...feature,
      parameters: { ...parameters, distance: createLengthQuantity(7) },
    })
    await commit()
    const measured = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const hook = measured.measurements?.data.features.find(({ featureId }) => featureId === id(25))
    if (hook?.status !== "succeeded") throw new Error("Missing exact Hook measurements.")
    expect(hook.shape.valid).toBe(true)
    expect(hook.shape.volume).toBeCloseTo(28 * Math.PI, 6)
  } finally {
    await local.close()
  }
})
