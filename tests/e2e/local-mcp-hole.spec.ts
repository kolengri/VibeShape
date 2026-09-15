import type { Page } from "@playwright/test"
import { unzipSync } from "fflate"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import {
  commandIdSchema,
  featureIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  variableIdSchema,
} from "../../packages/domain/src/identifiers"
import type { ModelMeasurementEntry } from "../../packages/domain/src/model-measurements"
import { createRectangleSketch } from "../../packages/domain/src/rectangle-sketch"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { expect, test } from "./fixtures"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const command = (n: number) => commandIdSchema.parse(id(n))

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message?: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message ?? "Local MCP operation failed.")
  return result.value
}

async function applyCommit(
  page: Page,
  committing: ReturnType<Awaited<ReturnType<typeof createMcpTestClient>>["callTool"]>,
) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  return (await committing).structuredContent?.result
}

function measurementOf(features: readonly ModelMeasurementEntry[] | undefined, featureId: string) {
  const measurement = features?.find((entry) => entry.featureId === featureId)
  if (measurement?.status !== "succeeded") throw new Error("Expected successful Hole measurements.")
  return measurement
}

async function exportedBytes(
  local: Awaited<ReturnType<typeof createMcpTestClient>>,
  revision: number,
  format: "step" | "stl" | "3mf",
) {
  const exported = await local.callTool({ name: "export_model", arguments: { revision, format } })
  const link = exported.content.find((item) => item.type === "resource_link")
  if (link?.type !== "resource_link") throw new Error("Expected an MCP export resource link.")
  const resource = await local.client.readResource({ uri: link.uri })
  const blob = resource.contents[0]
  if (!blob || !("blob" in blob) || typeof blob.blob !== "string")
    throw new Error("Expected readable export bytes.")
  return Buffer.from(blob.blob, "base64")
}

function binaryStlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80)
  expect(bytes.length).toBe(84 + count * 50)
  let volume = 0
  for (let triangle = 0; triangle < count; triangle += 1) {
    const offset = 84 + triangle * 50 + 12
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, index) =>
      bytes.readFloatLE(offset + index * 4),
    ) as [number, number, number, number, number, number, number, number, number]
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return Math.abs(volume / 6)
}

async function expectHoleExports(
  local: Awaited<ReturnType<typeof createMcpTestClient>>,
  revision: number,
  volume: number,
) {
  const step = await exportedBytes(local, revision, "step")
  expect(step.toString("utf8")).toContain("ISO-10303-21;")
  expect(step.toString("utf8")).toContain("CYLINDRICAL_SURFACE")
  const stl = await exportedBytes(local, revision, "stl")
  expect(Math.abs(binaryStlVolume(stl) - volume)).toBeLessThan(volume * 0.002)
  const archive = unzipSync(await exportedBytes(local, revision, "3mf"))
  const model = new TextDecoder().decode(archive["3D/3dmodel.model"])
  expect(model).toContain('<model unit="millimeter"')
  expect(model.match(/<object /g)).toHaveLength(1)
  expect(model.match(/<triangle /g)?.length).toBeGreaterThan(12)
}

async function expectHoleBodyTopology(
  local: Awaited<ReturnType<typeof createMcpTestClient>>,
  revision: number,
  featureId: string,
) {
  for (const topologyKind of ["edge", "face"]) {
    const response = await local.callTool({
      name: "model_body_topology",
      arguments: { revision, featureId, outputRole: "result", topologyKind, limit: 100 },
    })
    const view = success(
      localToolOutputs.model_body_topology.parse(response.structuredContent?.result),
    )
    expect(view.data.total).toBeGreaterThan(0)
    expect(view.nextCursor).toBeNull()
    expect(
      view.data.topology.every(
        ({ reference }) =>
          reference.schemaVersion === 1 &&
          reference.featureId === featureId &&
          reference.outputRole === "result" &&
          reference.kind === topologyKind,
      ),
    ).toBe(true)
    if (topologyKind === "face")
      expect(
        view.data.topology.some(
          ({ reference }) => reference.signature.geometryClass === "CYLINDRE",
        ),
      ).toBe(true)
  }
}

function bodyTargetParameters(named: boolean, featureId: string, outputRole: string) {
  return named ? { targetBody: { schemaVersion: 0, featureId, outputRole } } : {}
}

for (const namedBody of [false, true]) {
  test(`creates, repairs, reviews, commits and undoes a ${namedBody ? "body-targeted" : "legacy"} Hole through local MCP`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000)
    const local = await createMcpTestClient(43900 + testInfo.parallelIndex)
    const call = async (name: string, args: Record<string, unknown>) =>
      (await local.callTool({ name, arguments: args })).structuredContent?.result
    try {
      await page.goto(local.origin)
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
      const base = success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
        .revision
      const draft = success(
        localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
      )
      const sketchId = sketchIdSchema.parse(id(1))
      const boxId = featureIdSchema.parse(id(2))
      const holeId = featureIdSchema.parse(id(3))
      const sketch = createRectangleSketch({
        id: sketchId,
        label: "Hole sketch",
        plane: "xy",
        width: createLengthQuantity(4),
        height: createLengthQuantity(4),
        createEntityId: (() => {
          let next = 0
          return () => sketchEntityIdSchema.parse(id(10 + next++))
        })(),
        createConstraintId: (() => {
          let next = 0
          return () => sketchConstraintIdSchema.parse(id(30 + next++))
        })(),
      })
      const pointId = sketch.entities.find(
        (entity) => entity.type === "point" && entity.x === 4 && entity.y === 0,
      )?.id
      if (!pointId) throw new Error("Hole sketch fixture requires a point entity.")
      const variableId = variableIdSchema.parse(id(80))
      let revision = success(
        localToolOutputs.create_variable.parse(
          await call("create_variable", {
            draftId: draft.draftId,
            baseRevision: draft.revision,
            commandId: command(81),
            variable: {
              schemaVersion: 0,
              id: variableId,
              name: "holeDiameter",
              expression: "4 mm",
            },
          }),
        ),
      ).revision
      revision = success(
        localToolOutputs.create_box.parse(
          await call("create_box", {
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: command(4),
            featureId: boxId,
            widthMm: 20,
            depthMm: 20,
            heightMm: 20,
          }),
        ),
      ).revision
      revision = success(
        localToolOutputs.create_sketch.parse(
          await call("create_sketch", {
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: command(5),
            sketch,
          }),
        ),
      ).revision
      const invalidPointId = sketchEntityIdSchema.parse(id(99))
      revision = success(
        localToolOutputs.create_hole.parse(
          await call("create_hole", {
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: command(6),
            featureId: holeId,
            label: "MCP Hole",
            dependencies: [boxId],
            references: [],
            suppressed: false,
            parameters: {
              sketchId,
              pointIds: [namedBody ? pointId : invalidPointId],
              ...bodyTargetParameters(namedBody, boxId, "missing"),
              diameter: createLengthQuantity(99, "mm", "#holeDiameter"),
              direction: "forward",
              extent: "through-all",
            },
          }),
        ),
      ).revision
      const invalidPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(invalidPreview.geometry.status).toBe("invalid")
      revision = success(
        localToolOutputs.update_hole.parse(
          await call("update_hole", {
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: command(7),
            featureId: holeId,
            label: "MCP Hole",
            dependencies: [boxId],
            references: [],
            suppressed: false,
            parameters: {
              sketchId,
              pointIds: [pointId],
              ...bodyTargetParameters(namedBody, boxId, "result"),
              diameter: createLengthQuantity(99, "mm", "#holeDiameter"),
              direction: "reverse",
              extent: "through-all",
            },
          }),
        ),
      ).revision
      const preview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(preview.geometry.status).toBe("invalid")
      revision = success(
        localToolOutputs.update_hole.parse(
          await call("update_hole", {
            draftId: draft.draftId,
            baseRevision: revision,
            commandId: command(8),
            featureId: holeId,
            label: "MCP Hole",
            dependencies: [boxId],
            references: [],
            suppressed: false,
            parameters: {
              sketchId,
              pointIds: [pointId],
              ...bodyTargetParameters(namedBody, boxId, "result"),
              diameter: createLengthQuantity(99, "mm", "#holeDiameter"),
              direction: "forward",
              extent: "through-all",
            },
          }),
        ),
      ).revision
      const repairedPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: draft.draftId }),
        ),
      )
      expect(repairedPreview.geometry.status).toBe("valid")
      const committing = local.callTool({
        name: "commit_draft",
        arguments: { draftId: draft.draftId },
      })
      const commit = success(
        localToolOutputs.commit_draft.parse(await applyCommit(page, committing)),
      )
      const committedInfo = success(localToolOutputs.model_info.parse(await call("model_info", {})))
      expect(committedInfo.summary.revision).toBe(commit.revision)
      await expectHoleBodyTopology(local, commit.revision, holeId)
      const holeMeasurement = measurementOf(committedInfo.measurements?.data.features, holeId)
      expect(holeMeasurement.shape.volume).toBeCloseTo(8_000 - Math.PI * 4 * 20, 4)
      const inspected = success(
        localToolOutputs.model_entity.parse(
          await call("model_entity", {
            revision: commit.revision,
            entity: { kind: "feature", id: holeId },
          }),
        ),
      )
      if (inspected.data.entityKind !== "feature") throw new Error("Expected a Hole feature.")
      expect(inspected.data.record.type.schemaVersion).toBe(namedBody ? 2 : 1)
      expect(inspected.data.record.parameters).toMatchObject({
        ...bodyTargetParameters(namedBody, boxId, "result"),
        pointIds: [pointId],
        diameter: { source: { expression: "#holeDiameter" } },
      })
      await page.getByRole("treeitem", { name: "MCP Hole", exact: true }).click()
      const editHole = page.getByRole("form", { name: "Edit hole", exact: true })
      await expect(
        editHole.getByRole("combobox", { name: "Target body", exact: true }),
      ).toBeVisible()
      await editHole.getByRole("button", { name: "Cancel", exact: true }).click()
      const changed = success(
        localToolOutputs.create_draft.parse(
          await call("create_draft", { baseRevision: commit.revision }),
        ),
      )
      const updatedSketch = {
        ...sketch,
        constraints: sketch.constraints.map((constraint) =>
          constraint.type === "horizontal-distance"
            ? { ...constraint, value: createLengthQuantity(6) }
            : constraint,
        ),
      }
      const moved = success(
        localToolOutputs.update_sketch.parse(
          await call("update_sketch", {
            draftId: changed.draftId,
            baseRevision: changed.revision,
            commandId: command(82),
            sketch: updatedSketch,
          }),
        ),
      )
      const movedPreview = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: changed.draftId }),
        ),
      )
      expect(movedPreview.geometry.status).toBe("valid")
      const movedHole = measurementOf(movedPreview.geometry.measurements?.data.features, holeId)
      expect(movedHole.contentHash).not.toBe(holeMeasurement.contentHash)
      expect(movedHole.shape.volume).toBeCloseTo(holeMeasurement.shape.volume, 4)
      success(
        localToolOutputs.set_variable_expression.parse(
          await call("set_variable_expression", {
            draftId: changed.draftId,
            baseRevision: moved.revision,
            commandId: command(83),
            variableId,
            expression: "6 mm",
          }),
        ),
      )
      const resized = success(
        localToolOutputs.preview_draft.parse(
          await call("preview_draft", { draftId: changed.draftId }),
        ),
      )
      expect(resized.geometry.status).toBe("valid")
      const resizedHole = measurementOf(resized.geometry.measurements?.data.features, holeId)
      expect(resizedHole.shape.volume).toBeCloseTo(8_000 - Math.PI * 9 * 20, 4)
      const changing = local.callTool({
        name: "commit_draft",
        arguments: { draftId: changed.draftId },
      })
      const changedCommit = success(
        localToolOutputs.commit_draft.parse(await applyCommit(page, changing)),
      )
      await expectHoleExports(local, changedCommit.revision, resizedHole.shape.volume)
      const toolbar = page.getByRole("toolbar", { name: "Model commands" })
      await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
      await expect
        .poll(async () => {
          const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
          const restored = info.measurements?.data.features.find(
            ({ featureId }) => featureId === holeId,
          )
          return restored?.status === "succeeded" ? restored.contentHash : null
        })
        .toBe(holeMeasurement.contentHash)
      await page
        .getByRole("toolbar", { name: "Model commands" })
        .getByRole("button", { name: "Undo", exact: true })
        .click()
      await expect
        .poll(
          async () =>
            success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
              .revision,
        )
        .toBeGreaterThan(commit.revision)
      const tree = success(
        localToolOutputs.model_tree.parse(
          await call("model_tree", {
            revision: success(localToolOutputs.model_info.parse(await call("model_info", {})))
              .summary.revision,
            cursor: null,
            limit: 20,
          }),
        ),
      )
      expect(tree.data.items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: holeId })]),
      )
    } finally {
      await local.close()
    }
  })
}
