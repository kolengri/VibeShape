import { createHash } from "node:crypto"
import type { Page } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { IMPORT_UPLOAD_CHUNK_MAX_BYTES } from "../../packages/automation-api/src/imports"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import type { PlanarUploadInspection } from "../../packages/automation-api/src/planar-imports"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { enableLocalAi } from "./application-menu-support"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { exportGeometry, requireSourceSnapshot } from "./source-import-ui-support"

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(2 3)"><path d="M 0 0 L 20 0 L 20 10 L 0 10 Z"/></g></svg>'
const dxf =
  "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n1\n20\n2\n40\n1\n0\nENDSEC\n0\nEOF\n"
const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>
async function uploadAndInspect(
  call: Call,
  details: { format: "svg" | "dxf"; bytes: Buffer; revision: number },
) {
  const { format, bytes, revision } = details
  const upload = success(
    localToolOutputs.begin_planar_import_upload.parse(
      await call("begin_planar_import_upload", {
        revision,
        filename: `outline.${format}`,
        byteLength: bytes.length,
        unit: format === "svg" ? "mm" : "declared",
        plane: format === "svg" ? "xz" : "yz",
        label: `Paired outline.${format}`,
      }),
    ),
  )
  for (let offset = 0; offset < bytes.length; offset += IMPORT_UPLOAD_CHUNK_MAX_BYTES)
    success(
      localToolOutputs.append_planar_import_chunk.parse(
        await call("append_planar_import_chunk", {
          uploadId: upload.uploadId,
          offset,
          base64: bytes.subarray(offset, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES).toString("base64"),
        }),
      ),
    )
  const inspection = success(
    localToolOutputs.inspect_planar_import_upload.parse(
      await call("inspect_planar_import_upload", { uploadId: upload.uploadId }),
    ),
  )
  return inspection
}

async function reviewCaptured(
  page: Page,
  call: Call,
  inspection: PlanarUploadInspection,
  format: "svg" | "dxf",
  before: Awaited<ReturnType<typeof saveProject>>,
) {
  const request = () =>
    call("commit_planar_import_upload", {
      uploadId: inspection.upload.uploadId,
      uploadVersion: inspection.upload.uploadVersion,
    })
  const rejected = request(),
    review = page.getByRole("region", { name: "Review AI sketch import", exact: true })
  await expect(review).toBeVisible({ timeout: 30000 })
  await expect(
    review.getByRole("img", { name: "Imported planar curve preview", exact: true }),
  ).toBeVisible()
  await expect(
    review.getByText(`Sketch plane: ${format === "svg" ? "XZ" : "YZ"}`, { exact: true }),
  ).toBeVisible()
  await review.getByRole("button", { name: "Discard", exact: true }).click()
  expect(await rejected).toMatchObject({
    ok: false,
    diagnostic: { code: "import-review-cancelled" },
  })
  expect((await saveProject(page)).project.snapshot.sketches).toEqual(
    before.project.snapshot.sketches,
  )
  const applying = request()
  await expect(review).toBeVisible({ timeout: 30000 })
  await review.getByRole("button", { name: "Apply", exact: true }).dblclick()
  const committed = success(localToolOutputs.commit_planar_import_upload.parse(await applying))
  await saved(page)
  return committed
}

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
async function extrudeSavedProfile(
  page: Page,
  call: Call,
  details: { revision: number; sketchId: string },
) {
  const { revision, sketchId } = details
  const profiles = success(
    localToolOutputs.model_sketch_solution.parse(
      await call("model_sketch_solution", { revision, sketchId }),
    ),
  )
  if (profiles.data.section !== "profiles" || !profiles.data.items[0])
    throw new Error("Missing exact solved imported profile.")
  expect(profiles.data.items[0].area).toBeCloseTo(200)
  const draft = success(
    localToolOutputs.create_draft.parse(await call("create_draft", { baseRevision: revision })),
  )
  success(
    localToolOutputs.create_extrude.parse(
      await call("create_extrude", {
        draftId: draft.draftId,
        baseRevision: draft.revision,
        commandId: id(1),
        featureId: id(2),
        label: "Imported profile extrusion",
        dependencies: [],
        references: [],
        suppressed: false,
        parameters: {
          profile: profiles.data.items[0].selector,
          distance: createLengthQuantity(3),
          symmetric: false,
          operation: "new",
        },
      }),
    ),
  )
  const preview = success(
    localToolOutputs.preview_draft.parse(await call("preview_draft", { draftId: draft.draftId })),
  )
  expect(preview.geometry.status).toBe("valid")
  const pending = call("commit_draft", { draftId: draft.draftId }),
    review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30000 })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  success(localToolOutputs.commit_draft.parse(await pending))
  await saved(page)
  expect((await exportGeometry(page, "STEP")).toString("utf8")).toContain("ISO-10303-21")
}

test("imports SVG/DXF through paired bytes and manual analytical review, retains editable provenance and extrudes a discovered profile", async ({
  page,
}, testInfo) => {
  test.setTimeout(240000)
  const local = await createMcpTestClient(45750 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(local.origin)
    await saved(page)
    await enableLocalAi(page)
    let revision = (await saveProject(page)).project.snapshot.revision
    let svgId = ""
    for (const format of ["svg", "dxf"] as const) {
      const before = await saveProject(page),
        bytes = Buffer.from(format === "svg" ? svg : dxf)
      const inspection = await uploadAndInspect(call, { format, bytes, revision })
      expect(inspection.upload.sha256).toBe(createHash("sha256").update(bytes).digest("hex"))
      expect(inspection.normalization.scaleToMillimeters).toBe(format === "svg" ? 1 : 25.4)
      expect(inspection.closedPaths).toBe(1)
      expect((await saveProject(page)).project.snapshot.sketches).toEqual(
        before.project.snapshot.sketches,
      )
      const committed = await reviewCaptured(page, call, inspection, format, before)
      revision = committed.revision
      const project = await saveProject(page),
        snapshot = requireSourceSnapshot(project.project.snapshot),
        sketch = snapshot.sketches.find((sketch) => sketch.id === committed.sketchId)
      if (!sketch?.sourceImport) throw new Error("Missing ordinary captured source sketch.")
      expect(sketch.plane).toBe(format === "svg" ? "xz" : "yz")
      expect(sketch.sourceImport.paths.map((path) => path.outputId)).toEqual(committed.pathOutputs)
      expect(snapshot.parts).toEqual(before.project.snapshot.parts)
      expect(snapshot.features).toEqual(before.project.snapshot.features)
      expect(project.project.versionedEvents.some((event) => event.actor.type === "mcp")).toBe(true)
      if (!("assetBlobs" in project.project)) throw new Error("Missing portable source bytes.")
      expect(project.project.assetBlobs).toContainEqual({
        digest: inspection.upload.sha256,
        bytes: new Uint8Array(bytes),
      })
      if (format === "svg") svgId = sketch.id
      await page.getByRole("button", { name: "Undo", exact: true }).click()
      await saved(page)
      expect((await saveProject(page)).project.snapshot.sketches).toEqual(
        before.project.snapshot.sketches,
      )
      await page.getByRole("button", { name: "Redo", exact: true }).click()
      await saved(page)
      await page.reload()
      await saved(page)
      const restored = await saveProject(page)
      expect(restored.project.snapshot.sketches).toEqual(snapshot.sketches)
      revision = restored.project.snapshot.revision
      await expect(page.getByRole("button", { name: "Stop AI", exact: true })).toBeVisible()
    }
    await extrudeSavedProfile(page, call, { revision, sketchId: svgId })
    const portable = await saveProject(page)
    await openProject(page, portable)
    await page.reload()
    await saved(page)
    const restored = await saveProject(page)
    expect(restored.project.snapshot.sketches).toEqual(portable.project.snapshot.sketches)
    expect(restored.project.snapshot.features).toEqual(portable.project.snapshot.features)
    await page.getByRole("treeitem", { name: "Paired outline.svg", exact: true }).click()
    await expect(
      page.getByRole("img", { name: "Editable sketch geometry", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    await saved(page)
  } finally {
    await local.close()
  }
})
