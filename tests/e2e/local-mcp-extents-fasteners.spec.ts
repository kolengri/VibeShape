import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import type { ModelMeasurementEntry } from "../../packages/domain/src/model-measurements"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const body = (n: number) => ({ schemaVersion: 0, featureId: id(n), outputRole: "result" })
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
function shapeOf(measurements: readonly ModelMeasurementEntry[] | undefined, n: number) {
  const entry = measurements?.find(({ featureId }) => featureId === id(n))
  if (entry?.status !== "succeeded" || !entry.shape)
    throw new Error(`Expected exact shape for fastener ${n}.`)
  return entry.shape
}

test("creates and updates advanced extrusion, recess and thread intent through real MCP and browser review", async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(45400 + info.parallelIndex)
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
    const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
      .revision
    const draft = success(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    let sequence = 100
    async function stage(name: string, args: Record<string, unknown>) {
      const added = success(
        localToolOutputs.create_extrude.parse(
          await call(name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: id(sequence++),
          }),
        ),
      )
      revision = added.revision
    }
    async function exactPreview() {
      const preview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(preview.geometry.status, JSON.stringify(preview.geometry)).toBe("valid")
      return preview.geometry.measurements?.data.features
    }
    const sketch = {
      schemaVersion: 0,
      id: id(1),
      label: "Fastener profile",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: id(2), type: "point", x: 0, y: 0, construction: false },
        {
          schemaVersion: 0,
          id: id(3),
          type: "circle",
          centerPointId: id(2),
          radius: 5,
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
          value: createLengthQuantity(5),
        },
      ],
    }
    await stage("create_sketch", { sketch })
    const feature = (n: number, dependencies: string[], parameters: unknown) => ({
      featureId: id(n),
      label: `Fastener ${n}`,
      dependencies,
      references: [],
      suppressed: false,
      parameters,
    })
    const extrude = {
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
      distance: createLengthQuantity(8),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      targetBody: null,
      startOffset: createLengthQuantity(1),
      draftAngle: createAngleQuantity(0),
      endCondition: { kind: "distance" },
    }
    await stage("create_extrude", feature(6, [], extrude))
    await stage(
      "update_extrude",
      feature(6, [], { ...extrude, startOffset: createLengthQuantity(0) }),
    )
    expect(shapeOf(await exactPreview(), 6).volume).toBeCloseTo(200 * Math.PI, 6)
    const hole = {
      sketchId: id(1),
      pointIds: [id(2)],
      diameter: createLengthQuantity(2),
      direction: "forward",
      extent: "through-all",
      targetBody: body(6),
      treatment: {
        kind: "counterbore",
        diameter: createLengthQuantity(4),
        depth: createLengthQuantity(1),
      },
    }
    await stage("create_hole", feature(7, [id(6)], hole))
    const countersink = {
      kind: "countersink",
      diameter: createLengthQuantity(4),
      angle: createAngleQuantity(90, "deg"),
    }
    await stage("update_hole", feature(7, [id(6)], { ...hole, treatment: countersink }))
    const recessed = shapeOf(await exactPreview(), 7)
    expect(recessed.volume).toBeCloseTo((200 - 8 - 4 / 3) * Math.PI, 6)
    const thread = {
      targetBody: body(7),
      kind: "external",
      axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 1] },
      handedness: "right",
      nominalDiameter: createLengthQuantity(10),
      pitch: createLengthQuantity(2),
      length: createLengthQuantity(6),
      depth: createLengthQuantity(0.5),
      clearance: createLengthQuantity(0.1),
      starts: createScalarQuantity(1),
      phase: createAngleQuantity(0),
      runIn: createLengthQuantity(0),
      runOut: createLengthQuantity(0),
    }
    await stage("create_thread", feature(8, [id(7)], thread))
    const changedThread = { ...thread, phase: createAngleQuantity(15, "deg") }
    await stage("update_thread", feature(8, [id(7)], changedThread))
    const threaded = shapeOf(await exactPreview(), 8)
    expect(threaded.solidCount).toBe(1)
    expect(threaded.volume).toBeLessThan(recessed.volume)
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
    for (const [n, version, parameters] of [
      [6, 6, { ...extrude, startOffset: createLengthQuantity(0) }],
      [7, 3, { ...hole, treatment: countersink }],
      [8, 2, changedThread],
    ] as const) {
      const entity = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: committed.revision,
            entity: { kind: "feature", id: id(n) },
          }),
        ),
      )
      if (entity.data.entityKind !== "feature") throw new Error("Expected saved fastener feature.")
      expect(entity.data.record.type.schemaVersion).toBe(version)
      expect(entity.data.record.parameters).toEqual(parameters)
    }
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Fastener 8", exact: true })).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
