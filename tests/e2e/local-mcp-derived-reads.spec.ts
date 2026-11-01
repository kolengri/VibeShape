import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type { BinaryExportChunk } from "../../packages/automation-api/src/binary-exports"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { enableLocalAi } from "./application-menu-support"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
async function applyAssembly(page: Page) {
  const task = page.getByRole("region", { name: "Assembly task", exact: true })
  await task.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(task.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
  await saved(page)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60_000 },
  )
}
async function createClearanceJoint(page: Page) {
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  const toolbar = page.getByRole("toolbar", { name: "Assembly actions", exact: true })
  const task = page.getByRole("region", { name: "Assembly task", exact: true })
  await toolbar.getByRole("button", { name: "Create definition", exact: true }).click()
  await task.getByRole("textbox", { name: "Name", exact: true }).fill("MCP clearance bracket")
  await applyAssembly(page)
  const source = (await saveProject(page)).project.snapshot
  if (source.schemaVersion < 4 || !("assembly" in source)) throw new Error("Expected assembly.")
  const parent = source.assembly.instances[0]
  if (!parent) throw new Error("Expected a grounded occurrence.")
  await page.locator(`[data-assembly-instance-id="${parent.id}"]`).click()
  await toolbar.getByRole("button", { name: "Add joint", exact: true }).click()
  await task.getByRole("combobox", { name: "Joint type", exact: true }).click()
  await page.getByRole("option", { name: "Revolute", exact: true }).click()
  await task.getByRole("textbox", { name: "Name", exact: true }).fill("MCP clearance arm")
  await task.getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-45")
  await task.getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("45")
  await applyAssembly(page)
  const snapshot = (await saveProject(page)).project.snapshot
  if (snapshot.schemaVersion < 4 || !("assembly" in snapshot)) throw new Error("Expected assembly.")
  return snapshot
}

test("prepares a real PNG artifact and inspects sampled clearance through paired stdio MCP without changing the design", async ({
  page,
}, info) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(43540 + info.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    const tools = (await local.client.listTools()).tools
    for (const name of ["prepare_picture_render", "inspect_motion_clearance"])
      expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      })
    await page.goto(local.origin)
    await saved(page)
    await createSolids(page)
    await enableLocalAi(page)
    const before = (await saveProject(page)).project.snapshot
    const picture = success(
      localToolOutputs.prepare_picture_render.parse(
        await call("prepare_picture_render", {
          revision: before.revision,
          settings: { scene: "studio", quality: "draft", width: 320, height: 240 },
        }),
      ),
    )
    expect(picture.file).toMatchObject({
      documentId: before.id,
      revision: before.revision,
      format: "png",
      mimeType: "image/png",
    })
    const parts: Buffer[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const chunk: BinaryExportChunk = success(
        localToolOutputs.read_export_chunk.parse(
          await call("read_export_chunk", { exportId: picture.file.exportId, offset }),
        ),
      )
      expect(chunk.offset).toBe(offset)
      parts.push(Buffer.from(chunk.base64, "base64"))
      offset = chunk.nextOffset
    }
    const bytes = Buffer.concat(parts)
    expect(bytes.byteLength).toBe(picture.file.byteLength)
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(picture.file.sha256)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBe(320)
    expect(bytes.readUInt32BE(20)).toBe(240)
    await writeFile(info.outputPath("mcp-picture.png"), bytes)
    expect((await saveProject(page)).project.snapshot).toEqual(before)
    expect(await call("discard_export", { exportId: picture.file.exportId })).toMatchObject({
      ok: true,
    })
    const assembly = await createClearanceJoint(page)
    expect(await call("prepare_picture_render", { revision: assembly.revision })).toMatchObject({
      ok: false,
      diagnostic: { code: "picture-representation-unsupported" },
    })
    const joint = assembly.assembly.joints[0]
    if (!joint) throw new Error("Expected a driven joint.")
    const report = success(
      localToolOutputs.inspect_motion_clearance.parse(
        await call("inspect_motion_clearance", {
          revision: assembly.revision,
          jointId: joint.id,
          coordinate: "angle",
          start: -Math.PI / 18,
          end: Math.PI / 9,
          sampleCount: 3,
          minimumGap: 0.2,
        }),
      ),
    )
    expect(report.status).toBe("complete")
    expect(report.scope).toMatchObject({ documentId: assembly.id, revision: assembly.revision })
    expect(report.samples).toHaveLength(3)
    expect(report.samples[0]?.value).toBe(-Math.PI / 18)
    expect(report.samples[1]?.value).toBeCloseTo(Math.PI / 36, 12)
    expect(report.samples[2]?.value).toBe(Math.PI / 9)
    expect(report.smallest?.distance).toBe(0)
    expect(report.samples.some((sample) => sample.collisionCount > 0)).toBe(true)
    expect((await saveProject(page)).project.snapshot).toEqual(assembly)
    await page.getByRole("button", { name: "Stop AI", exact: true }).click()
    expect(
      await call("inspect_motion_clearance", {
        revision: assembly.revision,
        jointId: joint.id,
        coordinate: "angle",
        start: 0,
        end: 0.1,
        sampleCount: 2,
      }),
    ).toMatchObject({ ok: false })
  } finally {
    await local.close()
  }
})
