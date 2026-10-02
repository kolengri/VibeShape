import { writeFile } from "node:fs/promises"
import { z } from "zod"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { expect, test } from "./fixtures"
import {
  expectPlateGeometry,
  mountingPlateSketches,
  plateIds,
  printingCommand,
  printingSuccess,
  reviewPrintingCommit,
  savePrintingArtifacts,
} from "./printing-journey-helpers"

test("prints an editable MCP mounting plate while preserving a manual browser dimension", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000)
  const local = await createMcpTestClient(44000 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const modelInfo = async () =>
    printingSuccess(localToolOutputs.model_info.parse(await call("model_info", {})))
  const variablesAt = async (revision: number) =>
    printingSuccess(
      localToolOutputs.model_variables.parse(
        await call("model_variables", { revision, cursor: null, limit: 20 }),
      ),
    )
  const entityAt = async (revision: number, kind: "sketch" | "feature", id: string) =>
    printingSuccess(
      localToolOutputs.model_entity.parse(
        await call("model_entity", { revision, entity: { kind, id } }),
      ),
    )
  const mutate = async (
    name:
      | "create_variable"
      | "create_sketch"
      | "create_extrude"
      | "create_hole"
      | "set_variable_expression",
    args: Record<string, unknown>,
  ) => printingSuccess(localToolOutputs[name].parse(await call(name, args))).revision
  const expectCurrentPlate = async (width: number, diameter: number, afterRevision: number) => {
    await expect
      .poll(
        async () => {
          const info = await modelInfo()
          const plate = info.measurements?.data.features.find(
            ({ featureId }) => featureId === plateIds.holes,
          )
          return info.summary.revision > afterRevision && plate?.status === "succeeded"
            ? plate.shape.volume
            : null
        },
        { timeout: 30_000 },
      )
      .toBeCloseTo((width * 40 - 4 * Math.PI * (diameter / 2) ** 2) * 4, 6)
    const info = await modelInfo()
    expectPlateGeometry(info.measurements?.data.features, width, diameter)
    return info
  }
  try {
    const discovered = await local.client.listTools()
    expect(discovered.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "create_sketch",
        "create_extrude",
        "create_hole",
        "model_variables",
        "export_model",
      ]),
    )
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("textbox", { name: /chat|prompt|message/i })).toHaveCount(0)
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("button", { name: /Disable AI session/ })).toBeVisible()
    const base = (await modelInfo()).summary.revision
    const draft = printingSuccess(
      localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: base })),
    )
    let revision = draft.revision
    const definitions = [
      { id: plateIds.width, name: "plateWidth", expression: "80 mm" },
      { id: plateIds.depth, name: "plateDepth", expression: "40 mm" },
      { id: plateIds.thickness, name: "plateThickness", expression: "4 mm" },
      { id: plateIds.diameter, name: "screwDiameter", expression: "4.4 mm" },
      { id: plateIds.offset, name: "edgeOffset", expression: "8 mm" },
    ]
    for (const [index, variable] of definitions.entries()) {
      revision = await mutate("create_variable", {
        draftId: draft.draftId,
        baseRevision: revision,
        commandId: printingCommand(500 + index),
        variable: { schemaVersion: 0, ...variable },
      })
    }
    const sketches = mountingPlateSketches()
    revision = await mutate("create_sketch", {
      draftId: draft.draftId,
      baseRevision: revision,
      commandId: printingCommand(510),
      sketch: sketches.outline,
    })
    revision = await mutate("create_extrude", {
      draftId: draft.draftId,
      baseRevision: revision,
      commandId: printingCommand(511),
      featureId: plateIds.extrusion,
      label: "Mounting plate",
      dependencies: [],
      references: [],
      suppressed: false,
      parameters: {
        profile: sketches.profile,
        distance: createLengthQuantity(4, "mm", "#plateThickness"),
        symmetric: false,
        operation: "new",
      },
    })
    revision = await mutate("create_sketch", {
      draftId: draft.draftId,
      baseRevision: revision,
      commandId: printingCommand(512),
      sketch: sketches.centers,
    })
    await mutate("create_hole", {
      draftId: draft.draftId,
      baseRevision: revision,
      commandId: printingCommand(513),
      featureId: plateIds.holes,
      label: "Four screw clearance holes",
      dependencies: [plateIds.extrusion],
      references: [],
      suppressed: false,
      parameters: {
        sketchId: plateIds.centers,
        pointIds: sketches.pointIds,
        targetBody: { schemaVersion: 0, featureId: plateIds.extrusion, outputRole: "result" },
        diameter: createLengthQuantity(4.4, "mm", "#screwDiameter"),
        direction: "forward",
        extent: "through-all",
      },
    })
    const preview = printingSuccess(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    expect(preview.geometry.status).toBe("valid")
    expectPlateGeometry(preview.geometry.measurements?.data.features, 80, 4.4)
    const created = await reviewPrintingCommit(page, local, draft.draftId)
    expectPlateGeometry((await modelInfo()).measurements?.data.features, 80, 4.4)
    await expect(
      page.getByRole("treeitem", { name: "Four screw clearance holes", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "1",
    )

    await page.getByRole("treeitem", { name: "Variables", exact: true }).click()
    const table = page.getByRole("table", { name: "Document variables", exact: true })
    const widthRow = table
      .getByRole("row")
      .filter({ has: page.locator('input[value="plateWidth"]') })
    await widthRow.getByRole("combobox", { name: "Variable expression", exact: true }).fill("90 mm")
    await page.getByRole("button", { name: "Apply variables", exact: true }).click()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const manual = await expectCurrentPlate(90, 4.4, created.revision)

    // The external agent reads the current revision and authored intent after the human edit.
    const freshVariables = await variablesAt(manual.summary.revision)
    const width = freshVariables.data.variables.find(
      ({ definition }) => definition.id === plateIds.width,
    )
    const diameter = freshVariables.data.variables.find(
      ({ definition }) => definition.id === plateIds.diameter,
    )
    expect(width?.definition.expression).toBe("90 mm")
    expect(diameter?.definition.expression).toBe("4.4 mm")
    if (!diameter) throw new Error("The fresh MCP variable read omitted the screw diameter.")
    const outline = await entityAt(manual.summary.revision, "sketch", plateIds.outline)
    const centers = await entityAt(manual.summary.revision, "sketch", plateIds.centers)
    const extrusion = await entityAt(manual.summary.revision, "feature", plateIds.extrusion)
    const holes = await entityAt(manual.summary.revision, "feature", plateIds.holes)
    if (
      outline.data.entityKind !== "sketch" ||
      centers.data.entityKind !== "sketch" ||
      extrusion.data.entityKind !== "feature" ||
      holes.data.entityKind !== "feature"
    ) {
      throw new Error("Fresh MCP reads must expose the editable plate sketches and features.")
    }
    expect(outline.data.record.constraints).toEqual(sketches.outline.constraints)
    expect(centers.data.record.constraints).toEqual(sketches.centers.constraints)
    expect(extrusion.data.record.parameters).toMatchObject({
      distance: { source: { expression: "#plateThickness" } },
    })
    expect(holes.data.record.parameters).toMatchObject({
      pointIds: sketches.pointIds,
      diameter: { source: { expression: "#screwDiameter" } },
    })
    expect(await call("create_draft", { baseRevision: created.revision })).toMatchObject({
      ok: false,
    })
    const changedDraft = printingSuccess(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: manual.summary.revision }),
      ),
    )
    await mutate("set_variable_expression", {
      draftId: changedDraft.draftId,
      baseRevision: changedDraft.revision,
      commandId: printingCommand(520),
      variableId: diameter.definition.id,
      expression: "5.4 mm",
    })
    const changedPreview = printingSuccess(
      localToolOutputs.preview_draft.parse(
        await call("preview_draft", { draftId: changedDraft.draftId }),
      ),
    )
    expect(changedPreview.geometry.status).toBe("valid")
    expectPlateGeometry(changedPreview.geometry.measurements?.data.features, 90, 5.4)
    const changed = await reviewPrintingCommit(page, local, changedDraft.draftId)
    expectPlateGeometry((await modelInfo()).measurements?.data.features, 90, 5.4)
    const afterAgent = await variablesAt(changed.revision)
    expect(
      afterAgent.data.variables.find(({ definition }) => definition.id === plateIds.width)
        ?.definition.expression,
    ).toBe("90 mm")

    const toolbar = page.getByRole("toolbar", { name: "Model commands", exact: true })
    await toolbar.getByRole("button", { name: "Model", exact: true }).click()
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    const undone = await expectCurrentPlate(90, 4.4, changed.revision)
    expect(
      (await variablesAt(undone.summary.revision)).data.variables.find(
        ({ definition }) => definition.id === plateIds.width,
      )?.definition.expression,
    ).toBe("90 mm")
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    const redone = await expectCurrentPlate(90, 5.4, undone.summary.revision)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("button", { name: /Disable AI session/ })).toBeVisible()
    const restored = await modelInfo()
    expect(restored.summary.revision).toBe(redone.summary.revision)
    expectPlateGeometry(restored.measurements?.data.features, 90, 5.4)
    const restoredVariables = await variablesAt(restored.summary.revision)
    expect(restoredVariables.data.variables.map(({ definition }) => definition)).toEqual(
      definitions.map((definition) => ({
        schemaVersion: 0,
        ...definition,
        expression:
          definition.id === plateIds.width
            ? "90 mm"
            : definition.id === plateIds.diameter
              ? "5.4 mm"
              : definition.expression,
      })),
    )
    const restoredHoles = await entityAt(restored.summary.revision, "feature", plateIds.holes)
    expect(restoredHoles.data).toEqual(holes.data)
    const topology = printingSuccess(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: restored.summary.revision,
          featureId: plateIds.holes,
          outputRole: "result",
          topologyKind: "face",
          limit: 100,
        }),
      ),
    )
    const cylindricalFaces = topology.data.topology.filter(
      ({ reference }) => reference.signature.geometryClass === "CYLINDRE",
    )
    expect(cylindricalFaces).toHaveLength(4)
    for (const [x, y] of [
      [8, 8],
      [82, 8],
      [82, 32],
      [8, 32],
    ]) {
      const face = cylindricalFaces.find(
        ({ reference }) =>
          Math.abs(reference.signature.centroid[0] - (x ?? 0)) < 0.00001 &&
          Math.abs(reference.signature.centroid[1] - (y ?? 0)) < 0.00001,
      )
      expect(face, `The through-hole center must remain at (${x}, ${y}) mm.`).toBeDefined()
      if (!face) throw new Error("A screw hole lost its dimensioned center.")
      expect(face.reference.signature.centroid[2]).toBeCloseTo(2, 5)
      expect(
        face.reference.signature.bounds.max[0] - face.reference.signature.bounds.min[0],
      ).toBeCloseTo(5.4, 5)
    }
    await page.getByRole("treeitem", { name: "Mounting plate", exact: true }).click()
    const editPlate = page.getByRole("form", { name: "Edit extrusion", exact: true })
    await expect(editPlate.getByRole("combobox", { name: "Distance", exact: true })).toHaveValue(
      "#plateThickness",
    )
    await editPlate.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(editPlate).toHaveCount(0)
    await savePrintingArtifacts(page, local, testInfo, restored, {
      variables: restoredVariables.data,
      outline: outline.data,
      centers: centers.data,
      extrusion: extrusion.data,
      holes: restoredHoles.data,
      topology: topology.data,
    })
  } finally {
    await local.close()
  }
})

test("executes the MCP authoring guide plate example against the real browser kernel", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const local = await createMcpTestClient(44100 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    const resource = await local.client.readResource({ uri: "vibeshape://authoring-guide" })
    const content = resource.contents[0]
    if (!content || !("text" in content)) throw new Error("The MCP authoring guide is unavailable.")
    const json = content.text.match(/```json\n([\s\S]*?)\n```/)?.[1]
    if (!json) throw new Error("The MCP guide must contain its executable JSON example.")
    const example = z
      .array(
        z.object({
          tool: z.enum(["create_variable", "create_sketch", "create_extrude", "create_hole"]),
          arguments: z.record(z.string(), z.unknown()),
        }),
      )
      .length(5)
      .parse(JSON.parse(json.replaceAll("0195b5ac-b250", "0195b5ac-d450")))
    await page.goto(local.origin)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enable AI session", exact: true }).click()
    await expect(page.getByRole("button", { name: /Disable AI session/ })).toBeVisible()
    const info = printingSuccess(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = printingSuccess(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: info.summary.revision }),
      ),
    )
    let revision = draft.revision
    for (const entry of example) {
      revision = printingSuccess(
        localToolOutputs[entry.tool].parse(
          await call(entry.tool, {
            ...entry.arguments,
            draftId: draft.draftId,
            baseRevision: revision,
          }),
        ),
      ).revision
    }
    const preview = printingSuccess(
      localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
    )
    const previewEvidence = JSON.stringify(preview.geometry, null, 2)
    const previewPath = testInfo.outputPath("authoring-guide-preview.json")
    await writeFile(previewPath, `${previewEvidence}\n`)
    await testInfo.attach("Authoring guide exact preview", {
      path: previewPath,
      contentType: "application/json",
    })
    expect(preview.geometry.status, previewEvidence).toBe("valid")
    const holeId = example.find(({ tool }) => tool === "create_hole")?.arguments.featureId
    const plate = preview.geometry.measurements?.data.features.find(
      ({ featureId }) => featureId === holeId,
    )
    if (plate?.status !== "succeeded")
      throw new Error("The documented plate must produce exact geometry.")
    expect(plate.shape.solidCount).toBe(1)
    expect(plate.shape.volume).toBeCloseTo(3840 - 32 * Math.PI, 6)
    for (const [index, maximum] of [40, 24, 4].entries()) {
      expect(plate.shape.bounds.min[index]).toBeCloseTo(0, 6)
      expect(plate.shape.bounds.max[index]).toBeCloseTo(maximum, 6)
    }
    expect(await call("discard_draft", { draftId: draft.draftId })).toMatchObject({ ok: true })
    expect(
      printingSuccess(localToolOutputs.model_info.parse(await call("model_info", {}))).summary
        .revision,
    ).toBe(info.summary.revision)
  } finally {
    await local.close()
  }
})
