import { readFile } from "node:fs/promises"
import { readImportedFeatureParameters } from "../../packages/domain/src/part-design-import"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { chooseImportSource } from "./source-import-ui-support"

const fixture = new URL(
  "../../packages/formats/tests/fixtures/f3d/synthetic-box.f3d",
  import.meta.url,
)

test("imports a local F3D archive through its worker, reports unsupported history, and atomically retains editable records and exact fallback", async ({
  page,
}) => {
  test.setTimeout(180_000)
  const bytes = await readFile(fixture)
  await page.goto("/")
  await saved(page)
  const before = await saveProject(page)
  let dialog = await chooseImportSource(page, bytes, "synthetic-box.f3d")
  await expect(dialog.getByRole("combobox", { name: "Source unit metadata" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
    timeout: 60_000,
  })
  const report = dialog.getByRole("region", { name: "F3D conversion report", exact: true })
  await expect(report).toContainText(
    "Recovered 1 exact bodies, 1 editable sketches and 1 numeric parameters.",
  )
  await report.getByText("Unsupported or adapted records: 2", { exact: true }).click()
  await expect(report).toContainText("Unsupported1")
  await expect(report).toContainText("feature history is unsupported")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  const cancelled = await saveProject(page)
  expect(cancelled.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(cancelled.project.snapshot.sketches).toEqual(before.project.snapshot.sketches)
  expect(cancelled.project.snapshot.variables).toEqual(before.project.snapshot.variables)

  dialog = await chooseImportSource(page, bytes, "synthetic-box.f3d")
  await dialog.getByRole("button", { name: "Inspect source", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Apply import", exact: true })).toBeEnabled({
    timeout: 60_000,
  })
  await dialog.getByRole("button", { name: "Apply import", exact: true }).click()
  await expect(dialog).not.toBeVisible({ timeout: 60_000 })
  await saved(page)
  const imported = await saveProject(page)
  const snapshot = imported.project.snapshot
  expect(
    snapshot.sketches.map((sketch) => ({
      label: sketch.label,
      types: sketch.entities.map((entity) => entity.type),
    })),
  ).toContainEqual({ label: "Sketch1", types: ["point", "circle"] })
  expect(
    snapshot.variables.some(
      (variable) => variable.name.startsWith("f3d_width_") && variable.expression === "15 mm",
    ),
  ).toBe(true)
  const feature = snapshot.features.find((feature) => readImportedFeatureParameters(feature))
  expect(feature).toBeDefined()
  if (!feature) throw new Error("F3D exact fallback was not saved.")
  const signature = readImportedFeatureParameters(feature)?.outputs[0]?.signature
  expect(signature?.volume).toBeCloseTo(1_000_000)
  for (const coordinate of signature?.bounds.min ?? []) expect(coordinate).toBeCloseTo(0, 6)
  for (const coordinate of signature?.bounds.max ?? []) expect(coordinate).toBeCloseTo(100, 6)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  const undone = await saveProject(page)
  expect(undone.project.snapshot.features).toEqual(before.project.snapshot.features)
  expect(undone.project.snapshot.sketches).toEqual(before.project.snapshot.sketches)
  expect(undone.project.snapshot.variables).toEqual(before.project.snapshot.variables)
})
