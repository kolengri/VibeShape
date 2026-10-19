import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Page, TestInfo } from "@playwright/test"
import { unzipSync } from "fflate"
import type { createMcpTestClient } from "../../apps/mcp-server/test/client"
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
import {
  createRectangleSketch,
  rectangleSketchProfileSelector,
} from "../../packages/domain/src/rectangle-sketch"
import { sketchRecordSchema } from "../../packages/domain/src/sketch"
import { createLengthQuantity } from "../../packages/domain/src/units"
import { readAuthoredVShape } from "../../packages/formats/src/vshape"
import { openApplicationMenuItem } from "./application-menu-support"
import { expect } from "./fixtures"

export type PrintingMcpClient = Awaited<ReturnType<typeof createMcpTestClient>>
type PrintingModelInfo = Extract<
  ReturnType<typeof localToolOutputs.model_info.parse>,
  { ok: true }
>["value"]
const id = (n: number) => `0195b5ac-c350-7a2c-8c33-${String(n).padStart(12, "0")}`
export const printingCommand = (n: number) => commandIdSchema.parse(id(n))
export const plateIds = {
  outline: sketchIdSchema.parse(id(1)),
  extrusion: featureIdSchema.parse(id(2)),
  centers: sketchIdSchema.parse(id(3)),
  holes: featureIdSchema.parse(id(4)),
  width: variableIdSchema.parse(id(10)),
  depth: variableIdSchema.parse(id(11)),
  thickness: variableIdSchema.parse(id(12)),
  diameter: variableIdSchema.parse(id(13)),
  offset: variableIdSchema.parse(id(14)),
}

export function printingSuccess<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message?: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message ?? "The printing MCP journey failed.")
  return result.value
}

export function mountingPlateSketches() {
  let entity = 100
  let constraint = 200
  const rectangle = createRectangleSketch({
    id: plateIds.outline,
    label: "Plate outline",
    plane: "xy",
    width: createLengthQuantity(80, "mm", "#plateWidth"),
    height: createLengthQuantity(40, "mm", "#plateDepth"),
    createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
  })
  const profile = rectangleSketchProfileSelector(rectangle)
  if (!profile) throw new Error("The plate outline must expose a rectangular profile.")
  // Projected dimensions use first minus second; preserve the authored positive XY placement.
  const outline = sketchRecordSchema.parse({
    ...rectangle,
    constraints: rectangle.constraints.map((constraint) =>
      constraint.type === "horizontal-distance" || constraint.type === "vertical-distance"
        ? {
            ...constraint,
            firstPointId: constraint.secondPointId,
            secondPointId: constraint.firstPointId,
          }
        : constraint,
    ),
  })
  const anchor = sketchEntityIdSchema.parse(id(300))
  const positions = [
    { x: 8, y: 8, xExpression: "#edgeOffset", yExpression: "#edgeOffset" },
    { x: 72, y: 8, xExpression: "#plateWidth - #edgeOffset", yExpression: "#edgeOffset" },
    {
      x: 72,
      y: 32,
      xExpression: "#plateWidth - #edgeOffset",
      yExpression: "#plateDepth - #edgeOffset",
    },
    { x: 8, y: 32, xExpression: "#edgeOffset", yExpression: "#plateDepth - #edgeOffset" },
  ]
  const pointIds = positions.map((_, index) => sketchEntityIdSchema.parse(id(301 + index)))
  const centers = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: plateIds.centers,
    label: "Mounting hole centers",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: anchor, type: "point", x: 0, y: 0, construction: true },
      ...positions.map(({ x, y }, index) => ({
        schemaVersion: 0,
        id: pointIds[index],
        type: "point",
        x,
        y,
        construction: true,
      })),
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: sketchConstraintIdSchema.parse(id(400)),
        type: "fixed",
        pointId: anchor,
      },
      ...positions.flatMap(({ x, y, xExpression, yExpression }, index) => [
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(401 + index * 2)),
          type: "horizontal-distance",
          firstPointId: pointIds[index],
          secondPointId: anchor,
          value: createLengthQuantity(x, "mm", xExpression),
        },
        {
          schemaVersion: 0,
          id: sketchConstraintIdSchema.parse(id(402 + index * 2)),
          type: "vertical-distance",
          firstPointId: pointIds[index],
          secondPointId: anchor,
          value: createLengthQuantity(y, "mm", yExpression),
        },
      ]),
    ],
  })
  return { outline, profile, centers, pointIds }
}

export function expectPlateGeometry(
  entries: readonly ModelMeasurementEntry[] | undefined,
  width: number,
  diameter: number,
) {
  const plate = entries?.find((entry) => entry.featureId === plateIds.holes)
  if (plate?.status !== "succeeded")
    throw new Error("Exact mounting plate geometry is unavailable.")
  expect(plate.shape.valid).toBe(true)
  expect(plate.shape.solidCount).toBe(1)
  expect(plate.shape.faceCount).toBe(10)
  const expectedVolume = (width * 40 - 4 * Math.PI * (diameter / 2) ** 2) * 4
  expect(plate.shape.volume).toBeCloseTo(expectedVolume, 6)
  for (const [index, maximum] of [width, 40, 4].entries()) {
    expect(plate.shape.bounds.min[index]).toBeCloseTo(0, 6)
    expect(plate.shape.bounds.max[index]).toBeCloseTo(maximum, 6)
  }
  return plate
}

export async function reviewPrintingCommit(page: Page, local: PrintingMcpClient, draftId: string) {
  const pending = local.callTool({ name: "commit_draft", arguments: { draftId } })
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  const committed = printingSuccess(
    localToolOutputs.commit_draft.parse((await pending).structuredContent?.result),
  )
  await expect(review).toHaveCount(0)
  return committed
}

function inspectStl(bytes: Buffer, expectedVolume: number) {
  const triangleCount = bytes.readUInt32LE(80)
  expect(triangleCount).toBeGreaterThan(12)
  expect(bytes.length).toBe(84 + triangleCount * 50)
  let volume = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < triangleCount; index++) {
    const offset = 84 + index * 50 + 12
    const vertices = Array.from({ length: 9 }, (_, axis) => bytes.readFloatLE(offset + axis * 4))
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = vertices as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    for (let axis = 0; axis < 3; axis++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        const value = vertices[vertex * 3 + axis]
        if (value === undefined) throw new Error("The STL triangle is incomplete.")
        min[axis] = Math.min(min[axis] ?? Infinity, value)
        max[axis] = Math.max(max[axis] ?? -Infinity, value)
      }
    }
  }
  expect(Math.abs(Math.abs(volume / 6) - expectedVolume)).toBeLessThan(expectedVolume * 0.002)
  for (const [axis, expected] of [0, 0, 0].entries()) {
    expect(min[axis]).toBeCloseTo(expected, 6)
    expect(max[axis]).toBeCloseTo([90, 40, 4][axis] ?? 0, 6)
  }
  return { triangleCount, volume: Math.abs(volume / 6), bounds: { min, max } }
}

async function saveMeshExport(
  local: PrintingMcpClient,
  directory: string,
  revision: number,
  format: "step" | "stl" | "3mf",
) {
  const response = await local.callTool({ name: "export_model", arguments: { revision, format } })
  const link = response.content.find((item) => item.type === "resource_link")
  if (link?.type !== "resource_link") throw new Error(`The ${format} export has no resource link.`)
  const resource = await local.client.readResource({ uri: link.uri })
  const blob = resource.contents[0]
  if (!blob || !("blob" in blob)) throw new Error(`The ${format} export is not readable.`)
  const bytes = Buffer.from(blob.blob, "base64")
  await writeFile(resolve(directory, `mounting-plate.${format}`), bytes)
  return bytes
}

function inspectThreeMf(bytes: Buffer) {
  const modelBytes = unzipSync(bytes)["3D/3dmodel.model"]
  if (!modelBytes) throw new Error("The 3MF archive has no core model.")
  const model = new TextDecoder().decode(modelBytes)
  expect(model).toContain('<model unit="millimeter"')
  expect(model.match(/<object /g)).toHaveLength(1)
  expect(model.match(/<triangle /g)?.length).toBeGreaterThan(12)
}

async function saveNativeBackup(page: Page, directory: string, revision: number) {
  const downloading = page.waitForEvent("download")
  await openApplicationMenuItem(page, "Save project (.vshape)")
  const backupPath = resolve(directory, "mounting-plate.vshape")
  await (await downloading).saveAs(backupPath)
  const backup = printingSuccess(
    await readAuthoredVShape(new Uint8Array(await readFile(backupPath))),
  )
  if (backup.version !== 3) throw new Error("Expected replay-validated authored V3 plate history.")
  expect(backup.project.snapshot.revision).toBe(revision)
  expect(backup.project.snapshot.variables).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "plateWidth", expression: "90 mm" }),
      expect.objectContaining({ name: "screwDiameter", expression: "5.4 mm" }),
    ]),
  )
  expect(
    backup.project.snapshot.features.find(({ id }) => id === plateIds.holes)?.parameters,
  ).toMatchObject({
    diameter: { source: { expression: "#screwDiameter" } },
    extent: "through-all",
  })
  return backup
}

async function savePlateScreenshot(page: Page, directory: string) {
  await page.setViewportSize({ width: 1440, height: 960 })
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  for (const sketch of ["Plate outline", "Mounting hole centers"]) {
    const hide = page.getByRole("button", { name: `Hide ${sketch}`, exact: true })
    if (await hide.isVisible()) await hide.click()
  }
  const clear = viewport.getByRole("button", { name: "Clear selection", exact: true })
  if (await clear.isVisible()) await clear.click()
  await viewport.getByRole("button", { name: "Fit view", exact: true }).click()
  // Fit view animates the camera; capture after it settles so the sample remains useful.
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(directory, "mounting-plate.png"), animations: "disabled" })
}

export async function savePrintingArtifacts(
  page: Page,
  local: PrintingMcpClient,
  testInfo: TestInfo,
  info: PrintingModelInfo,
  intent: unknown,
) {
  const directory = resolve(".artifacts/printing-journey", testInfo.project.name)
  await mkdir(directory, { recursive: true })
  const measurement = expectPlateGeometry(info.measurements?.data.features, 90, 5.4)
  const revision = info.summary.revision
  const step = await saveMeshExport(local, directory, revision, "step")
  expect(step.toString("utf8")).toContain("ISO-10303-21;")
  expect(step.toString("utf8").match(/CYLINDRICAL_SURFACE/g)).toHaveLength(4)
  const meshEvidence = inspectStl(
    await saveMeshExport(local, directory, revision, "stl"),
    measurement.shape.volume,
  )
  inspectThreeMf(await saveMeshExport(local, directory, revision, "3mf"))
  await savePlateScreenshot(page, directory)
  const backup = await saveNativeBackup(page, directory, revision)
  await writeFile(
    resolve(directory, "evidence.json"),
    `${JSON.stringify(
      {
        browser: testInfo.project.name,
        dimensionsMm: [90, 40, 4],
        screwDiameterMm: 5.4,
        sketchDimensionOffsetsMm: [
          [8, 8],
          [82, 8],
          [82, 32],
          [8, 32],
        ],
        holeCentersWorldMm: [
          [8, 8, 2],
          [82, 8, 2],
          [82, 32, 2],
          [8, 32, 2],
        ],
        expectedVolumeMm3: (90 * 40 - 4 * Math.PI * 2.7 ** 2) * 4,
        model: info,
        intent,
        stl: meshEvidence,
        nativeFormatVersion: backup.version,
        engine: backup.project.manifest.engine,
      },
      null,
      2,
    )}\n`,
  )
}
