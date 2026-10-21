import { readExtrusionFeatureParameters } from "../../packages/domain/src/part-design"
import { readHoleFeatureParameters } from "../../packages/domain/src/part-design-hole"
import { readThreadFeatureParameters } from "../../packages/domain/src/part-design-thread"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test("selects an exact planar extrusion endpoint and saves its captured body revision", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const name of ["Width", "Depth"])
    await box.getByRole("combobox", { name, exact: true }).fill("200 mm")
  await box.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await commands.getByRole("button", { name: "Extrude", exact: true }).click()
  const form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form
    .getByRole("combobox", { name: "End condition", exact: true })
    .selectOption("up-to-face")
  await form.getByRole("combobox", { name: "End support body", exact: true }).click()
  await page.getByRole("combobox", { name: "Search options…", exact: true }).fill("Box 1 · result")
  await page.getByRole("option", { name: "Box 1 · result", exact: true }).click()
  await form.getByRole("combobox", { name: "End face", exact: true }).click()
  await page
    .getByRole("combobox", { name: "Search options…", exact: true })
    .fill("primitive.box.cap.end")
  await page
    .getByRole("option", { name: "Box 1 · result · primitive.box.cap.end", exact: true })
    .click()
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await saved(page)
  const backup = await saveProject(page)
  const feature = backup.project.snapshot.features.find(
    (item) => item.type.schemaVersion === 6 && readExtrusionFeatureParameters(item),
  )
  if (!feature) throw new Error("Expected an authored face-terminated Extrusion v6.")
  expect(readExtrusionFeatureParameters(feature)).toMatchObject({
    targetBody: null,
    endCondition: {
      kind: "up-to-face",
      sourceContentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      targetBody: { outputRole: "result" },
      face: { outputRole: "result", semanticRole: "primitive.box.cap.end" },
    },
  })
})

test("authors start offset and draft through the exact extrusion preview and reopens the stored values", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click()
  await confirmSketchPlane(page, "xy")
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  const viewport = page.getByRole("region", { name: "3D viewport" })
  await page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Extrude", exact: true })
    .click()
  let form = page.getByRole("form", { name: "Extrude profile", exact: true })
  await form.getByRole("combobox", { name: "Start offset", exact: true }).fill("3 mm")
  await form.getByRole("combobox", { name: "Draft angle", exact: true }).fill("2 deg")
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Create extrusion", exact: true }).click()
  await saved(page)
  const backup = await saveProject(page)
  const feature = backup.project.snapshot.features.find(
    (item) => item.type.schemaVersion === 6 && readExtrusionFeatureParameters(item),
  )
  if (!feature) throw new Error("Expected an authored Extrusion v6.")
  expect(readExtrusionFeatureParameters(feature)).toMatchObject({
    startOffset: { value: 3 },
    draftAngle: { value: (2 * Math.PI) / 180 },
    endCondition: { kind: "distance" },
  })
  await page.getByRole("treeitem", { name: "Extrusion 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit extrusion", exact: true })
  await expect(form.getByRole("combobox", { name: "Start offset", exact: true })).toHaveValue(
    "3 mm",
  )
  await expect(form.getByRole("combobox", { name: "Draft angle", exact: true })).toHaveValue(
    "2 deg",
  )
})

test("authors a counterbore from the ordinary hole task and retains its exact recess quantities", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const name of ["Width", "Depth"])
    await box.getByRole("combobox", { name, exact: true }).fill("200 mm")
  await box.getByRole("combobox", { name: "Height", exact: true }).fill("20 mm")
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await commands.getByRole("button", { name: "Create sketch", exact: true }).click()
  await confirmSketchPlane(page)
  await drawRectangle(page)
  await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  await invokeModelCommand(page, "Modify", "Hole")
  const form = page.getByRole("form", { name: "Hole", exact: true })
  await form.getByRole("checkbox", { name: "Point 1", exact: true }).check()
  await form.getByRole("combobox", { name: "Hole style", exact: true }).selectOption("counterbore")
  await form.getByRole("combobox", { name: "Recess diameter", exact: true }).fill("8 mm")
  await form.getByRole("combobox", { name: "Recess depth", exact: true }).fill("3 mm")
  await expect(form.getByRole("button", { name: "Create hole", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create hole", exact: true }).click()
  await saved(page)
  const backup = await saveProject(page)
  const feature = backup.project.snapshot.features.find((item) => readHoleFeatureParameters(item))
  if (!feature) throw new Error("Expected an authored Hole v3.")
  expect(feature.type.schemaVersion).toBe(3)
  expect(readHoleFeatureParameters(feature)).toMatchObject({
    treatment: { kind: "counterbore", diameter: { value: 8 }, depth: { value: 3 } },
  })
})

test("authors an explicit reference axis through the thread preview and persists v2 intent", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Model", exact: true }).click()
  await invokeModelCommand(page, "Primitives", "Cylinder")
  const cylinder = page.getByRole("form", { name: "Create cylinder", exact: true })
  await cylinder.getByRole("combobox", { name: "Radius", exact: true }).fill("5 mm")
  await cylinder.getByRole("combobox", { name: "Height", exact: true }).fill("8 mm")
  await cylinder.getByRole("button", { name: "Create cylinder", exact: true }).click()
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true }).click()
  await page.getByRole("button", { name: "Thread", exact: true }).click()
  const form = page.getByRole("form", { name: "Thread body", exact: true })
  await form.getByText("Axis, origin and thread options", { exact: true }).click()
  await form
    .getByRole("combobox", { name: "Reference source", exact: true })
    .selectOption("explicit")
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await saved(page)
  const backup = await saveProject(page)
  const feature = backup.project.snapshot.features.find((item) => readThreadFeatureParameters(item))
  if (!feature) throw new Error("Expected an authored Thread v2.")
  expect(feature.type.schemaVersion).toBe(2)
  expect(readThreadFeatureParameters(feature)).toMatchObject({
    axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 1] },
  })
})
