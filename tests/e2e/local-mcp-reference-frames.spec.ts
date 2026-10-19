import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type { AutomationDraftInspectionView } from "../../packages/automation-api/src/draft-inspection"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { createLengthQuantity, createScalarQuantity } from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b280-7a2c-8c33-${String(n).padStart(12, "0")}`
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
  label: `Reference MCP ${n}`,
  dependencies,
  references: [],
  suppressed: false,
  parameters,
})

function verifyMeasurements(measurements: AutomationDraftInspectionView) {
  if (measurements.view.kind !== "org.vibeshape.model.measurements")
    throw new Error("Expected exact draft measurements.")
  const measured = measurements.view.data.features
  for (const [n, volume, solidCount] of [
    [3, 1200, 1],
    [4, 3600, 3],
    [5, 1200, 2],
  ] as const) {
    const result = measured.find((entry) => entry.featureId === id(n))
    expect(result).toMatchObject({ status: "succeeded", shape: { solidCount } })
    if (result?.status !== "succeeded") throw new Error("Expected successful exact feature.")
    expect(result.shape.volume).toBeCloseTo(volume, 6)
  }
}

test("creates and updates reference frames from unsaved exact topology through ordinary MCP review", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45400 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    expect((await local.client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "create_reference_mirror",
        "update_reference_mirror",
        "create_reference_body_pattern",
        "update_reference_body_pattern",
        "create_reference_split",
        "update_reference_split",
      ]),
    )
    await page.goto(local.origin)
    await expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeVisible()
    await enableLocalAi(page)
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.summary.revision }),
      ),
    )
    let revision = draft.revision
    let command = 100
    const stage = async (name: string, args: Record<string, unknown>) => {
      const result = success(
        localToolOutputs.create_reference_mirror.parse(
          await call(name, {
            ...args,
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: id(command++),
          }),
        ),
      )
      revision = result.revision
    }
    await stage("create_box", { featureId: id(1), widthMm: 20, depthMm: 10, heightMm: 6 })
    await stage(
      "create_datum_plane",
      feature(2, [], {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(3),
      }),
    )
    const topology = async (kind: "face" | "edge") => {
      const result = success(
        localToolOutputs.draft_body_topology.parse(
          await call("draft_body_topology", {
            draftId: draft.draftId,
            revision,
            featureId: id(1),
            outputRole: "result",
            topologyKind: kind,
            limit: 100,
          }),
        ),
      )
      if (result.view.kind !== "org.vibeshape.model.body-topology")
        throw new Error("Expected topology inspection.")
      return result.view.data.topology
    }
    const faces = await topology("face")
    const face = faces.find(
      (entry) => entry.resolution === "resolved" && entry.reference.signature.direction?.[0] === 1,
    )
    if (face?.reference.kind !== "face") throw new Error("Missing exact +X planar face.")
    const edges = await topology("edge")
    const edge = edges.find(
      (entry) =>
        entry.resolution === "resolved" &&
        Math.abs(entry.reference.signature.direction?.[0] ?? 0) === 1,
    )
    if (edge?.reference.kind !== "edge") throw new Error("Missing exact LINE axis.")
    const mirror = {
      targetBody: body(1),
      plane: { kind: "explicit-plane", origin: [0, 0, 0], normal: [1, 0, 0] },
      offset: createLengthQuantity(0),
      preserveSource: true,
    }
    await stage("create_reference_mirror", feature(3, [id(1)], mirror))
    await stage(
      "update_reference_mirror",
      feature(3, [id(1)], {
        ...mirror,
        plane: { kind: "planar-face", reference: face.reference },
        offset: createLengthQuantity(-20),
      }),
    )
    const pattern = {
      targetBody: body(3),
      kind: "linear",
      axis: { kind: "datum-axis", featureId: id(2), axis: "x" },
      count: createScalarQuantity(3),
      spacing: createLengthQuantity(30),
    }
    await stage("create_reference_body_pattern", feature(4, [id(3), id(2)], pattern))
    await stage(
      "update_reference_body_pattern",
      feature(4, [id(3), id(1)], {
        ...pattern,
        axis: { kind: "linear-edge", reference: edge.reference },
      }),
    )
    const split = {
      targetBody: body(4, "pattern.instance.0"),
      plane: { kind: "datum-plane", featureId: id(2) },
      offset: createLengthQuantity(0),
    }
    await stage("create_reference_split", feature(5, [id(4), id(2)], split))
    const finalSplit = {
      ...split,
      plane: { kind: "explicit-plane", origin: [0, 0, 3], normal: [0, 0, 1] },
    }
    await stage(
      "update_reference_split",
      feature(5, [id(4)], { ...finalSplit, targetBody: body(4, "missing") }),
    )
    const invalid = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(invalid.geometry.status).toBe("invalid")
    await stage("update_reference_split", feature(5, [id(4)], finalSplit))
    const preview = success(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status, JSON.stringify(preview.geometry)).toBe("valid")
    const measurements = success(
      localToolOutputs.draft_measurements.parse(
        await call("draft_measurements", {
          draftId: draft.draftId,
          revision,
          scope: "all",
          limit: 100,
        }),
      ),
    )
    verifyMeasurements(measurements)
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
    for (const [n, version] of [
      [3, 3],
      [4, 2],
      [5, 2],
    ] as const) {
      const saved = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: committed.revision,
            entity: { kind: "feature", id: id(n) },
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
        await call("model_parts", { revision: committed.revision, cursor: null }),
      ),
    )
    expect(parts).toMatchObject({
      parts: expect.arrayContaining([
        expect.objectContaining({
          body: body(1),
          consumedBy: null,
        }),
      ]),
    })
    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Reference MCP 5", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const reopened = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    expect(reopened.summary.revision).toBe(committed.revision)
    const sourcePart = parts.parts.find(
      (part) => part.body.featureId === id(1) && part.consumedBy === null,
    )
    if (!sourcePart) throw new Error("Expected retained Mirror source part.")
    await page.locator(`[data-part-id="${sourcePart.id}"]`).click()
    await page.getByRole("button", { name: "Pattern", exact: true }).click()
    const patternForm = page.getByRole("form", { name: "Pattern body", exact: true })
    await expect(
      patternForm.getByRole("button", { name: "Apply feature", exact: true }),
    ).toBeEnabled({ timeout: 30_000 })
    await patternForm.getByRole("button", { name: "Apply feature", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Pattern 2", exact: true })).toBeVisible()
    await page.locator(`[data-part-id="${sourcePart.id}"]`).click()
    await page.getByRole("button", { name: "Split", exact: true }).click()
    const splitForm = page.getByRole("form", { name: "Split part", exact: true })
    await expect(splitForm.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await splitForm.getByRole("button", { name: "Apply split", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: "Split 2", exact: true })).toBeVisible()
  } finally {
    await page.goto("about:blank").catch(() => undefined)
    await local.close()
  }
})
