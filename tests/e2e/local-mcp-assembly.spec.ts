import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import {
  type AssemblyDraftState,
  assemblyDraftStateSchema,
} from "../../packages/automation-api/src/assembly-tools"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi, openAiConnections } from "./application-menu-support"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const draftArguments = (draft: AssemblyDraftState) => ({
  draftId: draft.draftId,
  baseRevision: draft.baseRevision,
  draftVersion: draft.draftVersion,
})
function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

test("authors owned assembly and library drafts through paired MCP, exact preview, review and reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(44087 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const apply = async (name: string, args: Record<string, unknown>) => {
    const pending = call(name, args)
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible({ timeout: 60_000 })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    const result = await pending
    await expect(review).toHaveCount(0)
    return result
  }
  const stage = async (
    name: string,
    draft: AssemblyDraftState,
    args: Record<string, unknown> = {},
  ) =>
    assemblyDraftStateSchema.parse(
      success(
        localToolOutputs.upgrade_assembly.parse(
          await call(name, { ...draftArguments(draft), ...args }),
        ),
      ),
    )
  try {
    const listed = await local.client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "model_assembly",
        "inspect_assembly",
        "create_assembly_draft",
        "create_assembly_joint",
        "preview_assembly_draft",
        "commit_assembly_draft",
        "library_items",
        "library_version",
        "save_library_definition",
        "insert_library_version",
        "update_library_metadata",
      ]),
    )
    const resources = await local.client.listResources()
    expect(resources.resources.some(({ uri }) => uri === "vibeshape://session")).toBe(true)
    expect(
      (await local.client.readResource({ uri: "vibeshape://session" })).contents.length,
    ).toBeGreaterThan(0)
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await enableLocalAi(page)
    const initial = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
    const cad = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: initial.revision }),
      ),
    )
    expect(
      await call("create_box", {
        draftId: cad.draftId,
        baseRevision: cad.revision,
        commandId: id(1),
        featureId: id(2),
        label: "MCP bracket",
        widthMm: 10,
        depthMm: 20,
        heightMm: 30,
      }),
    ).toMatchObject({ ok: true })
    const created = success(
      localToolOutputs.commit_draft.parse(await apply("commit_draft", { draftId: cad.draftId })),
    )
    await openAiConnections(page)
    await page.getByRole("button", { name: "Set up auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Enable auto-apply", exact: true }).click()
    await page.getByRole("button", { name: "Close AI connections", exact: true }).click()
    await expect(page.getByText("Auto-apply on", { exact: true })).toBeVisible()
    const parts = success(
      localToolOutputs.model_parts.parse(await call("model_parts", { revision: created.revision })),
    )
    const part = parts.parts.find(({ consumedBy }) => consumedBy === null)
    if (!part) throw new Error("The committed source part is unavailable.")
    const measurements = success(
      localToolOutputs.model_body_measurements.parse(
        await call("model_body_measurements", {
          revision: created.revision,
          featureId: part.body.featureId,
          outputRole: part.body.outputRole,
        }),
      ),
    )
    const body = measurements.data.bodies[0]
    if (!body) throw new Error("The exact source body is unavailable.")
    const empty = success(
      localToolOutputs.model_assembly.parse(
        await call("model_assembly", { revision: created.revision }),
      ),
    )
    expect(empty.instances).toHaveLength(0)
    let draft = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: created.revision }),
      ),
    )
    draft = await stage("upgrade_assembly", draft)
    draft = await stage("create_assembly_definition", draft, {
      definition: {
        schemaVersion: 1,
        id: id(10),
        name: "Frozen bracket",
        sources: [
          { kind: "part", partId: part.id, body: part.body, contentHash: body.contentHash },
        ],
        sourceFrame: pose,
      },
    })
    draft = await stage("create_assembly_instance", draft, {
      instance: {
        schemaVersion: 2,
        id: id(11),
        definitionId: id(10),
        name: "Ground",
        grounded: true,
        worldFrame: pose,
      },
    })
    draft = await stage("create_assembly_instance", draft, {
      instance: {
        schemaVersion: 2,
        id: id(12),
        definitionId: id(10),
        name: "Follower",
        grounded: false,
        initialFrame: pose,
      },
    })
    const joint = {
      schemaVersion: 2,
      id: id(13),
      kind: "ball",
      parentInstanceId: id(11),
      childInstanceId: id(12),
      parentFrame: pose,
      childFrame: pose,
    }
    draft = await stage("create_assembly_joint", draft, { joint })
    const ball = success(
      localToolOutputs.preview_assembly_draft.parse(
        await call("preview_assembly_draft", draftArguments(draft)),
      ),
    )
    expect(ball.inspection.kinematics).toMatchObject({
      status: "under-constrained",
      degreesOfFreedom: 3,
    })
    expect(ball.inspection.occurrences).toHaveLength(2)
    expect(JSON.stringify(ball)).not.toContain('"mesh"')
    const committed = success(
      localToolOutputs.commit_assembly_draft.parse(
        await apply("commit_assembly_draft", draftArguments(draft)),
      ),
    )
    const topology = success(
      localToolOutputs.inspect_assembly.parse(
        await call("inspect_assembly", {
          revision: committed.revision,
          interferencePairs: [{ leftInstanceId: id(11), rightInstanceId: id(12) }],
          topology: { instanceId: id(11), sourceIndex: 0, limit: 100 },
        }),
      ),
    )
    expect(topology.interference[0]).toMatchObject({ status: "interference", volume: 6000 })
    const selected = topology.topology?.references.find(
      ({ geometry, resolution }) => geometry === "planar-face" && resolution === "resolved",
    )
    if (!selected || !topology.topology)
      throw new Error("The frozen planar frame reference is unavailable.")
    expect(selected.reference).not.toHaveProperty("candidateId")
    draft = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: committed.revision }),
      ),
    )
    const binding = {
      sourceIndex: 0,
      pinRevision: topology.topology.pinRevision,
      body: topology.topology.body,
      reference: selected.reference,
      geometry: selected.geometry,
      originHint: [0, 0, 0],
      xDirection: [1, 1, 1],
    }
    draft = await stage("update_assembly_joint", draft, {
      joint: { ...joint, parentBinding: binding, childBinding: binding },
    })
    draft = await stage("create_assembly_joint", draft, {
      joint: {
        ...joint,
        id: id(14),
        kind: "cylindrical",
        axis: [0, 0, 1],
        angle: 0,
        angleLimits: { min: -Math.PI, max: Math.PI },
        rotationDriven: false,
        translation: 0,
        translationLimits: { min: -100, max: 100 },
        translationDriven: false,
        parentBinding: binding,
        childBinding: binding,
      },
    })
    const constrained = success(
      localToolOutputs.preview_assembly_draft.parse(
        await call("preview_assembly_draft", draftArguments(draft)),
      ),
    )
    expect(constrained.inspection.kinematics).toMatchObject({
      status: "under-constrained",
      degreesOfFreedom: 1,
    })
    const constrainedReceipt = success(
      localToolOutputs.commit_assembly_draft.parse(
        await apply("commit_assembly_draft", draftArguments(draft)),
      ),
    )
    let conflicting = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: constrainedReceipt.revision }),
      ),
    )
    conflicting = await stage("create_assembly_joint", conflicting, {
      joint: {
        ...joint,
        id: id(15),
        kind: "fixed",
        parentFrame: { ...pose, translation: [1, 0, 0] },
      },
    })
    expect(await call("preview_assembly_draft", draftArguments(conflicting))).toMatchObject({
      ok: false,
      diagnostic: {
        code: "conflicting-mates",
        assembly: { jointIds: expect.arrayContaining([id(15)]) },
      },
    })
    expect(await call("commit_assembly_draft", draftArguments(conflicting))).toMatchObject({
      ok: false,
      diagnostic: { code: "conflicting-mates" },
    })
    await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(
      0,
    )
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(constrainedReceipt.revision)
    expect(await call("discard_assembly_draft", draftArguments(conflicting))).toMatchObject({
      ok: true,
    })
    let stale = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: constrainedReceipt.revision }),
      ),
    )
    stale = await stage("update_assembly_joint", stale, {
      joint: {
        ...joint,
        parentBinding: { ...binding, pinRevision: binding.pinRevision + 1 },
        childBinding: binding,
      },
    })
    expect(await call("preview_assembly_draft", draftArguments(stale))).toMatchObject({
      ok: false,
      diagnostic: { code: "topology-stale" },
    })
    expect(await call("discard_assembly_draft", draftArguments(stale))).toMatchObject({ ok: true })
    const frozen = success(
      localToolOutputs.save_library_definition.parse(
        await apply("save_library_definition", {
          baseRevision: constrainedReceipt.revision,
          source: { kind: "definition", id: id(10) },
          name: "Library bracket",
          tags: ["mcp"],
          expectedMetadataRevision: null,
        }),
      ),
    )
    expect(frozen.version).toBe(1)
    expect(frozen.definition).not.toHaveProperty("pinnedModels")
    const library = success(
      localToolOutputs.library_items.parse(
        await call("library_items", {
          revision: constrainedReceipt.revision,
          query: "Library bracket",
        }),
      ),
    )
    expect(library.items.some(({ id: itemId }) => itemId === frozen.item.id)).toBe(true)
    draft = success(
      localToolOutputs.create_assembly_draft.parse(
        await call("create_assembly_draft", { baseRevision: constrainedReceipt.revision }),
      ),
    )
    draft = await stage("insert_library_version", draft, {
      itemId: frozen.item.id,
      version: frozen.version,
      mode: "reference",
      definitionId: id(20),
      definitionName: "Library reference",
      instanceId: id(21),
      instanceName: "Library occurrence",
      worldFrame: { ...pose, translation: [40, 0, 0] },
    })
    const insertion = success(
      localToolOutputs.preview_assembly_draft.parse(
        await call("preview_assembly_draft", draftArguments(draft)),
      ),
    )
    expect(
      insertion.assembly.definitions.find(({ id: definitionId }) => definitionId === id(20))
        ?.libraryBinding,
    ).toEqual({ itemId: frozen.item.id, version: 1 })
    expect(insertion.inspection.occurrences).toHaveLength(3)
    const inserted = success(
      localToolOutputs.commit_assembly_draft.parse(
        await apply("commit_assembly_draft", draftArguments(draft)),
      ),
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const undone = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
    expect(undone.revision).toBe(inserted.revision + 1)
    expect(
      success(
        localToolOutputs.model_assembly.parse(
          await call("model_assembly", { revision: undone.revision }),
        ),
      ).instances,
    ).toHaveLength(2)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const redone = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
    expect(redone.revision).toBe(inserted.revision + 2)
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const reloaded = success(
      localToolOutputs.model_info.parse(await call("model_info", {})),
    ).summary
    expect(reloaded.revision).toBe(redone.revision)
    const model = success(
      localToolOutputs.model_assembly.parse(
        await call("model_assembly", { revision: redone.revision }),
      ),
    )
    expect(model.instances).toHaveLength(3)
    expect(model.joints).toHaveLength(2)
    expect(await call("inspect_assembly", { revision: created.revision })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
  } finally {
    await local.close()
  }
})
