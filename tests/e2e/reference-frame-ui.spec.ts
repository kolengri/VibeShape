import { readMirrorFeatureParametersV3 } from "../../packages/domain/src/part-design-mirror"
import { readPatternFeatureParametersV2 } from "../../packages/domain/src/part-design-pattern"
import { readSplitFeatureParametersV2 } from "../../packages/domain/src/part-design-split"
import { createSolids, openProject, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("authors oblique body reference frames and reopens their exact persisted intent", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Mirror", exact: true }).click()
  let form = page.getByRole("form", { name: "Mirror part", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption("explicit")
  await form.getByRole("spinbutton", { name: "Direction Z", exact: true }).fill("0")
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeDisabled()
  await form.getByRole("spinbutton", { name: "Direction X", exact: true }).fill("3")
  await form.getByRole("spinbutton", { name: "Direction Y", exact: true }).fill("4")
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create mirror", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Pattern", exact: true }).click()
  form = page.getByRole("form", { name: "Pattern body", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption("explicit")
  await form.getByRole("spinbutton", { name: "Direction X", exact: true }).fill("3")
  await form.getByRole("spinbutton", { name: "Direction Y", exact: true }).fill("4")
  await form.getByRole("spinbutton", { name: "Direction Z", exact: true }).fill("0")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Split", exact: true }).click()
  form = page.getByRole("form", { name: "Split part", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption("explicit")
  await form.getByRole("spinbutton", { name: "Direction X", exact: true }).fill("3")
  await form.getByRole("spinbutton", { name: "Direction Y", exact: true }).fill("4")
  await form.getByRole("spinbutton", { name: "Direction Z", exact: true }).fill("0")
  await form.getByRole("combobox", { name: "Plane offset", exact: true }).fill("0 mm")
  await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply split", exact: true }).click()
  await saved(page)
  const authored = await saveProject(page)
  const features = authored.project.snapshot.features
  const mirror = features.flatMap((feature) => readMirrorFeatureParametersV3(feature) ?? [])
  const pattern = features.flatMap((feature) => readPatternFeatureParametersV2(feature) ?? [])
  const split = features.flatMap((feature) => readSplitFeatureParametersV2(feature) ?? [])
  expect(mirror).toHaveLength(1)
  expect(pattern).toHaveLength(1)
  expect(split).toHaveLength(1)
  expect(mirror[0]?.plane).toEqual({
    kind: "explicit-plane",
    origin: [0, 0, 0],
    normal: [0.6, 0.8, 0],
  })
  expect(pattern[0]?.axis).toEqual({
    kind: "explicit-axis",
    origin: [0, 0, 0],
    direction: [0.6, 0.8, 0],
  })
  expect(split[0]?.plane).toEqual(mirror[0]?.plane)
  await page.reload()
  await saved(page)
  const reopened = await saveProject(page)
  expect(reopened.project.snapshot.features).toEqual(features)
  expect(reopened.project.snapshot.parts).toEqual(authored.project.snapshot.parts)
})

test("binds current Datum frames and a viewport planar face without consuming support", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await invokeModelCommand(page, "Primitives", "Box")
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await invokeModelCommand(page, "Create", "Datum plane")
  const datum = page.getByRole("form", { name: "Create datum plane", exact: true })
  await datum.getByRole("combobox", { name: "Offset", exact: true }).fill("5 mm")
  await datum.getByRole("button", { name: "Create datum plane", exact: true }).click()
  await saved(page)
  await page
    .getByRole("complementary", { name: "Model tree" })
    .getByRole("button", { name: "Hide Datum plane 1", exact: true })
    .click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The geometry canvas must have measurable bounds.")
  const samples = [
    [0.47, 0.5],
    [0.53, 0.5],
    [0.5, 0.35],
  ]
  let sampleIndex = 0
  await expect
    .poll(async () => {
      const sample = samples[sampleIndex++ % samples.length] ?? [0.5, 0.5]
      await canvas.click({
        position: { x: bounds.width * (sample[0] ?? 0.5), y: bounds.height * (sample[1] ?? 0.5) },
      })
      return page
        .locator("footer")
        .getByRole("status")
        .filter({ hasText: /^Selection:/ })
        .textContent()
    })
    .toMatch(/Selection: Box 1 · Face \d+/)
  await commands.getByRole("button", { name: "Mirror", exact: true }).click()
  let form = page.getByRole("form", { name: "Mirror part", exact: true })
  const useFace = form.getByRole("button", { name: "Use selected planar face", exact: true })
  await expect(useFace).toBeEnabled()
  await useFace.click()
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create mirror", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await commands.getByRole("button", { name: "Pattern", exact: true }).click()
  form = page.getByRole("form", { name: "Pattern body", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption({ label: "Datum plane 1 · x" })
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await commands.getByRole("button", { name: "Split", exact: true }).click()
  form = page.getByRole("form", { name: "Split part", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption({ label: "Datum plane 1" })
  await form.getByRole("combobox", { name: "Plane offset", exact: true }).fill("0 mm")
  await expect(form.getByRole("button", { name: "Apply split", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply split", exact: true }).click()
  await saved(page)
  const snapshot = (await saveProject(page)).project.snapshot
  const mirror = snapshot.features.find((feature) => readMirrorFeatureParametersV3(feature))
  const pattern = snapshot.features.find((feature) => readPatternFeatureParametersV2(feature))
  const split = snapshot.features.find((feature) => readSplitFeatureParametersV2(feature))
  expect(mirror && readMirrorFeatureParametersV3(mirror)?.plane.kind).toBe("planar-face")
  expect(mirror?.dependencies).toHaveLength(1)
  expect(pattern && readPatternFeatureParametersV2(pattern)?.axis.kind).toBe("datum-axis")
  expect(pattern?.dependencies).toHaveLength(2)
  expect(split && readSplitFeatureParametersV2(split)?.plane.kind).toBe("datum-plane")
  expect(split?.dependencies).toHaveLength(2)
  expect(snapshot.features.some(({ label }) => label === "Datum plane 1")).toBe(true)
  await page.reload()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(snapshot.features)
})

test("patterns an exact named body using a current stable straight edge", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Pattern", exact: true }).click()
  const form = page.getByRole("form", { name: "Pattern body", exact: true })
  const source = form.getByRole("combobox", { name: "Reference source", exact: true })
  const edge = source
    .locator("option")
    .filter({ hasText: /^Box 1 · result · / })
    .first()
  await expect(edge).toBeAttached()
  const value = await edge.getAttribute("value")
  if (!value) throw new Error("The exact current edge option must be selectable.")
  await source.selectOption(value)
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  const snapshot = (await saveProject(page)).project.snapshot
  const pattern = snapshot.features.find((feature) => readPatternFeatureParametersV2(feature))
  const parameters = pattern && readPatternFeatureParametersV2(pattern)
  expect(parameters?.axis.kind).toBe("linear-edge")
  if (parameters?.axis.kind === "linear-edge") {
    expect(parameters.axis.reference.outputRole).toBe("result")
    expect(parameters.axis.reference.signature.geometryClass).toBe("LINE")
    expect(pattern?.dependencies).toEqual([parameters.axis.reference.featureId])
    expect(pattern?.references).toEqual([])
  }
  await page.reload()
  await saved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(snapshot.features)
})

test("retains a source-preserving arbitrary-plane Mirror v3 through edits and native reopen", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  const before = await saveProject(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Mirror", exact: true }).click()
  let form = page.getByRole("form", { name: "Mirror part", exact: true })
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption("explicit")
  await form.getByRole("spinbutton", { name: "Direction X", exact: true }).fill("3")
  await form.getByRole("spinbutton", { name: "Direction Y", exact: true }).fill("4")
  await form.getByRole("spinbutton", { name: "Direction Z", exact: true }).fill("0")
  await form.getByRole("combobox", { name: "Plane offset", exact: true }).fill("-1 in")
  await form.getByRole("checkbox", { name: "Preserve source part", exact: true }).check()
  await expect(form.getByRole("button", { name: "Create mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create mirror", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Mirror 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const applied = await saveProject(page)
  const mirror = applied.project.snapshot.features.find((feature) =>
    readMirrorFeatureParametersV3(feature),
  )
  if (!mirror) throw new Error("An arbitrary reflection must retain its authored v3 feature.")
  expect(readMirrorFeatureParametersV3(mirror)).toMatchObject({
    plane: { kind: "explicit-plane", origin: [0, 0, 0], normal: [0.6, 0.8, 0] },
    offset: { value: -25.4, source: { expression: "-1 in" } },
    preserveSource: true,
  })
  expect(applied.project.snapshot.parts).toHaveLength(before.project.snapshot.parts.length + 1)
  for (const part of before.project.snapshot.parts)
    expect(applied.project.snapshot.parts.find(({ id }) => id === part.id)).toEqual(part)
  await page.getByRole("treeitem", { name: "Mirror 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit mirror", exact: true })
  await expect(form.getByRole("combobox", { name: "Plane offset", exact: true })).toHaveValue(
    "-1 in",
  )
  await expect(
    form.getByRole("checkbox", { name: "Preserve source part", exact: true }),
  ).toBeChecked()
  await form.getByRole("spinbutton", { name: "Origin Z (mm)", exact: true }).fill("5")
  await expect(form.getByRole("button", { name: "Update mirror", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Update mirror", exact: true }).click()
  await saved(page)
  const edited = await saveProject(page)
  expect(edited.project.snapshot.parts).toEqual(applied.project.snapshot.parts)
  expect(edited.project.snapshot.features.find(({ id }) => id === mirror.id)).toMatchObject({
    type: { schemaVersion: 3 },
    parameters: { preserveSource: true, offset: { value: -25.4 } },
  })
  await openProject(page, edited)
  const imported = await saveProject(page)
  expect(imported.project.snapshot.features).toEqual(edited.project.snapshot.features)
  expect(imported.project.snapshot.parts).toEqual(edited.project.snapshot.parts)
})
