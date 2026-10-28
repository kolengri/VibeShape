import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseGeometryImport } from "../../packages/formats/src/import"
import type {
  StructuralOptimizationInput,
  StructuralOptimizationResult,
} from "../../packages/structural-optimization/src/contract"
import { encodeStructuralSnapshot } from "../../packages/structural-optimization/src/mesh"
import { denseBoxMesh } from "../../packages/structural-optimization/tests/dense-box-fixture"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import {
  chooseImportSource,
  exportGeometry,
  requireSourceSnapshot,
} from "./source-import-ui-support"

function analyzedGeometry(mesh: StructuralOptimizationResult["mesh"]) {
  return {
    triangleCount: mesh.indices.length / 3,
    points: [
      ...new Set(
        mesh.indices.map((index) => JSON.stringify(mesh.vertices.slice(index * 3, index * 3 + 3))),
      ),
    ].sort(),
  }
}

async function exportedGeometry(bytes: Uint8Array) {
  const parsed = await parseGeometryImport({ format: "3mf", bytes })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostic))
  if (parsed.geometry.kind !== "triangle-mesh")
    throw new Error("Expected exported triangle mesh geometry.")
  const geometry = parsed.geometry
  const points = new Set<string>()
  let triangleCount = 0
  for (const node of geometry.nodes) {
    const mesh = geometry.meshes.find(({ id }) => id === node.meshId)
    if (!mesh) throw new Error("An exported occurrence must reference its mesh.")
    triangleCount += mesh.triangles.length
    for (const index of mesh.triangles.flat()) {
      const point = mesh.vertices[index]
      if (!point) throw new Error("An exported triangle must reference its vertex.")
      const matrix = node.transform
      const world = [0, 1, 2].map(
        (axis) =>
          (matrix[axis] ?? 0) * point[0] +
          (matrix[axis + 4] ?? 0) * point[1] +
          (matrix[axis + 8] ?? 0) * point[2] +
          (matrix[axis + 12] ?? 0),
      )
      points.add(JSON.stringify(world))
    }
  }
  return { triangleCount, points: [...points].sort() }
}

const input: StructuralOptimizationInput = {
  schemaVersion: 1,
  mesh: denseBoxMesh({ min: [132.8, 0, 0], max: [140.8, 1.6, 1.6] }),
  material: { youngModulusMpa: 1000, poissonRatio: 0, yieldStrengthMpa: 100, densityKgM3: 1000 },
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 0.8,
  supports: [{ min: [132.8, 0, 0], max: [132.8, 1.6, 1.6] }],
  loadCases: [
    { name: "Axial", region: { min: [140.8, 0, 0], max: [140.8, 1.6, 1.6] }, forceN: [1, 0, 0] },
  ],
  preserveRegions: [],
  maxIterations: 2,
  algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.2, penalty: 3 },
}

test("preserves analyzed structural coordinates through 3MF Apply, Undo, reload, native reopen and export", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto("/")
  await saved(page)
  const before = await saveProject(page)
  const result = await page.evaluate(
    async ({ input, moduleUrl, runtimeBaseUrl }) => {
      const {
        optimizeStructuralModel,
      }: {
        optimizeStructuralModel: (
          input: StructuralOptimizationInput,
          options: { runtimeBaseUrl: string },
        ) => Promise<StructuralOptimizationResult>
      } = await import(moduleUrl)
      return optimizeStructuralModel(input, { runtimeBaseUrl })
    },
    {
      input,
      moduleUrl: `/@fs${resolve("packages/structural-optimization/src/client.ts")}`,
      runtimeBaseUrl: new URL("/structural-runtime/", page.url()).href,
    },
  )
  expect(result.optimized.maxVonMisesMpa).toBeGreaterThan(0)
  expect(result.optimized.maxVonMisesMpa).toBeLessThanOrEqual(50)
  expect(result.optimized.maxDisplacementMm).toBeGreaterThan(0)
  expect(result.optimized.maxDisplacementMm).toBeLessThanOrEqual(1)
  const expected = analyzedGeometry(result.mesh)
  expect(expected.triangleCount).toBeGreaterThan(0)
  const snapshot = encodeStructuralSnapshot(result.mesh, result.cellSizeMm)
  expect(snapshot.format).toBe("3mf")
  expect(snapshot.mediaType).toBe("model/3mf")
  expect(await exportedGeometry(snapshot.bytes)).toEqual(expected)
  await writeFile(test.info().outputPath("numerical-result.json"), JSON.stringify(result, null, 2))
  await writeFile(test.info().outputPath("analyzed-snapshot.3mf"), snapshot.bytes)

  const dialog = await chooseImportSource(
    page,
    Buffer.from(snapshot.bytes),
    "structural-precision.3mf",
  )
  await expect(
    dialog.getByRole("combobox", { name: "Source unit metadata", exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog.getByText("Source units: declared by the 3MF file", { exact: true }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await dialog.getByRole("button", { name: "Apply import", exact: true }).click()
  await expect(dialog).not.toBeVisible({ timeout: 30_000 })
  await saved(page)
  const imported = await saveProject(page)
  const captured = requireSourceSnapshot(imported.project.snapshot)
  expect(captured.assets).toHaveLength(1)
  const digest = createHash("sha256").update(snapshot.bytes).digest("hex")
  expect(captured.assets[0]).toMatchObject({
    digest,
    byteLength: snapshot.bytes.byteLength,
    filename: "structural-precision.3mf",
    format: "3mf",
    representation: "triangle-mesh",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
  })
  if (!("assetBlobs" in imported.project))
    throw new Error("The native backup must retain immutable source bytes.")
  expect(imported.project.assetBlobs).toEqual([{ digest, bytes: snapshot.bytes }])
  expect(captured.parts).toHaveLength(1)
  const part = captured.parts[0]
  if (!part) throw new Error("The structural snapshot must publish an owned Part.")
  const row = page.locator(`[data-part-id="${part.id}"]`)
  await expect(row).toHaveAttribute("data-part-status", "available")
  const importedExport = await exportGeometry(page, "3MF", part.name)
  expect(await exportedGeometry(importedExport)).toEqual(expected)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(undone.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  expect(requireSourceSnapshot(undone.project.snapshot).assets).toEqual([])
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await expect(row).toHaveAttribute("data-part-status", "available")
  await page.reload()
  await saved(page)
  await expect(row).toHaveAttribute("data-part-status", "available")
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(captured.features)
  expect(reloaded.project.snapshot.parts).toEqual(captured.parts)
  expect(requireSourceSnapshot(reloaded.project.snapshot).assets).toEqual(captured.assets)
  expect(await exportedGeometry(await exportGeometry(page, "3MF", part.name))).toEqual(expected)

  await openProject(page, reloaded)
  await expect(row).toHaveAttribute("data-part-status", "available")
  const reopenedExport = await exportGeometry(page, "3MF", part.name)
  expect(await exportedGeometry(reopenedExport)).toEqual(expected)
  await writeFile(test.info().outputPath("reopened-export.3mf"), reopenedExport)
  await test.info().attach("precision-round-trip", {
    body: JSON.stringify({
      format: snapshot.format,
      digest,
      status: result.status,
      triangleCount: expected.triangleCount,
      uniquePointCount: expected.points.length,
    }),
    contentType: "application/json",
  })
})
