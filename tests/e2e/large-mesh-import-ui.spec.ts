import { createHash } from "node:crypto"
import { readMeshImportFeatureParameters } from "../../packages/domain/src/part-design-mesh-import"
import { writeStlMeshes } from "../../packages/formats/src/stl-meshes"
import { denseBoxMesh } from "../../packages/structural-optimization/tests/dense-box-fixture"
import { openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { chooseImportSource, requireSourceSnapshot } from "./source-import-ui-support"

test("applies, undoes, reloads and backs up a mesh above the former local import threshold", async ({
  page,
}) => {
  test.setTimeout(180_000)
  const mesh = denseBoxMesh({ subdivisions: 96, min: [-10, -10, -10], max: [10, 10, 10] })
  expect(mesh.indices.length / 3).toBeGreaterThan(83_333)
  const source = Buffer.from(writeStlMeshes([{ vertices: mesh.vertices, triangles: mesh.indices }]))
  const digest = createHash("sha256").update(source).digest("hex")
  await page.goto("/")
  await saved(page)
  const before = await saveProject(page)
  const dialog = await chooseImportSource(page, source, "dense-box.stl", "Millimeter (mm)")
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  const apply = dialog.getByRole("button", { name: "Apply import", exact: true })
  await expect(apply).toBeEnabled({ timeout: 60_000 })
  await apply.dblclick()
  await expect(dialog).not.toBeVisible({ timeout: 60_000 })
  await saved(page)
  const imported = await saveProject(page)
  const snapshot = requireSourceSnapshot(imported.project.snapshot)
  expect(snapshot.assets).toHaveLength(1)
  expect(snapshot.assets[0]).toMatchObject({ digest, byteLength: source.byteLength })
  const feature = snapshot.features.find((entry) => readMeshImportFeatureParameters(entry))
  if (!feature) throw new Error("The large mesh must be captured as one imported feature.")
  const parts = snapshot.parts.filter(({ bodyHistory }) => bodyHistory[0]?.featureId === feature.id)
  expect(parts).toHaveLength(1)
  const available = () => page.locator(`[data-part-id="${parts[0]?.id}"]`)
  await expect(available()).toHaveAttribute("data-part-status", "available")
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(undone.project.snapshot.parts).toEqual(before.project.snapshot.parts)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await saved(page)
  await page.reload()
  await saved(page)
  await expect(available()).toHaveAttribute("data-part-status", "available", { timeout: 60_000 })
  const reloaded = await saveProject(page)
  expect(reloaded.project.snapshot.features).toEqual(snapshot.features)
  expect(requireSourceSnapshot(reloaded.project.snapshot).assets).toEqual(snapshot.assets)
  await openProject(page, reloaded, 60_000)
  await expect(available()).toHaveAttribute("data-part-status", "available", { timeout: 60_000 })
})
