import type { Locator, Page } from "@playwright/test"
import { readLoftFeatureParametersV3 } from "../../packages/domain/src/part-design-loft-v3"
import { writeVShape } from "../../packages/formats/src/vshape"
import { createCylindricalLoftProject } from "../support/loft-v3-cylinder-fixture"
import { createLoftV3Project, loftFixtureId as id } from "../support/loft-v3-fixture"
import { openApplicationMenuItem } from "./application-menu-support"
import { openProject, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

test("authors exact Loft v3 tracks, rail, C0 guide and independent G1/G2 faces, repairs a native failure, edits, undoes and reopens", async ({
  page,
}) => {
  test.setTimeout(600_000)
  const fixture = createLoftV3Project()
  const archive = await writeVShape({
    snapshot: fixture.snapshot,
    events: fixture.events,
    exportedAt: "2026-10-04T00:00:00Z",
    createdBy: { application: "VibeShape authoring fixture", version: "1", build: null },
    engine: null,
  })
  if (!archive.ok) throw new Error(archive.diagnostic.message)
  await page.goto("/")
  await nativeSaved(page)
  await openApplicationMenuItem(page, "Files and projects…")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByLabel("Choose VibeShape project file")
    .setInputFiles({
      name: "constrained-loft.vshape",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(archive.value),
    })
  await expect(page.getByRole("treeitem", { name: "Part Seed box", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await nativeSaved(page)
  await expect(page.getByText(/Needs repair: the support face/)).toHaveCount(0)
  await invokeModelCommand(page, "Create", "Loft")
  let form = page.getByRole("form", { name: "Loft profiles", exact: true })
  for (const label of ["Lower section · Profile 1", "Upper section · Profile 1"]) {
    await form
      .getByRole("combobox", { name: "Section profile", exact: true })
      .selectOption({ label })
    await form.getByRole("button", { name: "Add section", exact: true }).click()
  }
  await form.getByRole("checkbox", { name: "Curve constraints (Loft v3)", exact: true }).check()
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await authorTracks(form, fixture)
  await authorPaths(form, fixture)
  await authorEnds(form)
  const startFace = form
    .getByRole("group", { name: "Start continuity", exact: true })
    .getByRole("combobox", { name: "Support face", exact: true })
  const wall = await startFace.inputValue()
  await startFace.selectOption(
    (await startFace
      .getByRole("option", { name: /Seed box.*\(0, 0, 10\) mm$/ })
      .getAttribute("value")) ?? "",
  )
  await expect(form.getByRole("alert")).toHaveText(
    "A Loft end edge does not lie on its support face.",
    { timeout: 30_000 },
  )
  await expect(form.getByRole("alert")).toBeVisible({ timeout: 30_000 })
  await expect(form.getByRole("button", { name: "Apply feature", exact: true })).toBeDisabled()
  await startFace.selectOption(wall)
  await nativePreviewReady(form, "Apply feature")
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await nativeSaved(page)
  await expect(page.getByRole("treeitem", { name: "Part Loft 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const applied = await saveProject(page)
  const feature = applied.project.snapshot.features.find((candidate) =>
    readLoftFeatureParametersV3(candidate),
  )
  if (!feature) throw new Error("Saved constrained Loft must exist")
  const parameters = required(
    readLoftFeatureParametersV3(feature),
    "Saved Loft v3 parameters must exist",
  )
  expect(parameters.outerCorrespondence).toEqual(fixture.outerCorrespondence)
  expect(parameters.rails).toEqual([{ vertexTrack: 0, path: fixture.railPath }])
  expect(parameters.guides).toEqual([
    { name: "Wall guide", segmentTrack: 0, continuity: "C0", path: fixture.guidePath },
  ])
  expect(parameters.start).toHaveLength(1)
  expect(parameters.start).toMatchObject([{ continuity: "G1", support: { featureId: id(850) } }])
  expect(parameters.end).toEqual(
    parameters.start.map((constraint) => ({ ...constraint, continuity: "G2" })),
  )
  await page.getByRole("treeitem", { name: "Loft 1", exact: true }).click()
  form = page.getByRole("form", { name: "Edit loft", exact: true })
  await expect(
    form.getByRole("checkbox", { name: "Curve constraints (Loft v3)", exact: true }),
  ).toBeChecked()
  await form
    .getByRole("group", { name: "End continuity", exact: true })
    .getByRole("combobox", { name: "Continuity", exact: true })
    .selectOption("G1")
  await form
    .getByRole("group", { name: "Guide 1", exact: true })
    .getByRole("textbox", { name: "Guide name", exact: true })
    .fill("Edited wall guide")
  await nativePreviewReady(form, "Update feature")
  await form.getByRole("button", { name: "Update feature", exact: true }).click()
  await nativeSaved(page)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await nativeSaved(page)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    applied.project.snapshot.features,
  )
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await nativeSaved(page)
  await page.reload()
  await nativeSaved(page)
  const reloaded = await saveProject(page)
  const current = reloaded.project.snapshot.features.find(({ id }) => id === feature.id)
  if (!current) throw new Error("Loft identity must survive reload")
  const reloadedParameters = required(
    readLoftFeatureParametersV3(current),
    "Reloaded Loft v3 parameters must exist",
  )
  expect(reloadedParameters.end).toMatchObject([{ continuity: "G1" }])
  expect(reloadedParameters.guides).toMatchObject([{ name: "Edited wall guide" }])
  await openProject(page, reloaded, 120_000)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    reloaded.project.snapshot.features,
  )
})

test("applies a cylindrical Loft with nonzero G2 at both ends and healthy oriented Datum support", async ({
  page,
}) => {
  test.setTimeout(240_000)
  const fixture = createCylindricalLoftProject()
  const archive = await writeVShape({
    snapshot: fixture.snapshot,
    events: fixture.events,
    exportedAt: "2026-10-04T00:00:00Z",
    createdBy: { application: "VibeShape curved G2 fixture", version: "1", build: null },
    engine: null,
  })
  if (!archive.ok) throw new Error(archive.diagnostic.message)
  await page.goto("/")
  await nativeSaved(page)
  await openApplicationMenuItem(page, "Files and projects…")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByLabel("Choose VibeShape project file")
    .setInputFiles({
      name: "cylindrical-loft.vshape",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(archive.value),
    })
  await expect(page.getByRole("treeitem", { name: "Part Seed cylinder", exact: true })).toBeVisible(
    { timeout: 30_000 },
  )
  await nativeSaved(page)
  await expect(page.getByText(/Needs repair: the support face/)).toHaveCount(0)
  await invokeModelCommand(page, "Create", "Loft")
  const form = page.getByRole("form", { name: "Loft profiles", exact: true })
  for (const label of ["Lower section · Profile 1", "Upper section · Profile 1"]) {
    await form
      .getByRole("combobox", { name: "Section profile", exact: true })
      .selectOption({ label })
    await form.getByRole("button", { name: "Add section", exact: true }).click()
  }
  await form.getByRole("checkbox", { name: "Curve constraints (Loft v3)", exact: true }).check()
  await authorTracks(form, fixture)
  for (const title of ["Start continuity", "End continuity"]) {
    const group = form.getByRole("group", { name: title, exact: true })
    await group.getByRole("button", { name: "Add end constraint", exact: true }).click()
    await group.getByRole("combobox", { name: "Continuity", exact: true }).selectOption("G2")
    const face = group.getByRole("combobox", { name: "Support face", exact: true }),
      option = face.getByRole("option", { name: /Seed cylinder.*\(1\.273, 1\.273, 5\) mm$/ })
    await expect(option).toBeAttached({ timeout: 15_000 })
    await face.selectOption((await option.getAttribute("value")) ?? "")
  }
  await nativePreviewReady(form, "Apply feature")
  await form.getByRole("button", { name: "Apply feature", exact: true }).click()
  await nativeSaved(page)
  const retainedSupport = page.getByRole("treeitem", { name: "Part Seed cylinder", exact: true })
  await expect(retainedSupport).toHaveAccessibleDescription("Available part")
  const saved = await saveProject(page),
    loft = saved.project.snapshot.features.find(({ label }) => label === "Loft 1")
  if (!loft) throw new Error("The curved Loft must remain authored.")
  const parameters = required(
    readLoftFeatureParametersV3(loft),
    "Curved Loft parameters must exist",
  )
  expect(parameters.outerCorrespondence).toEqual(fixture.outerCorrespondence)
  for (const constraint of [...parameters.start, ...parameters.end])
    expect(constraint).toMatchObject({
      continuity: "G2",
      support: { featureId: id(860), signature: { geometryClass: "CYLINDRE" } },
    })
  await openProject(page, saved, 120_000)
  expect((await saveProject(page)).project.snapshot.features).toEqual(
    saved.project.snapshot.features,
  )
  await expect(page.getByText(/Needs repair: the support face/)).toHaveCount(0)
  await expect(retainedSupport).toHaveAccessibleDescription("Available part")
})

async function authorTracks(
  form: Locator,
  fixture: Pick<ReturnType<typeof createLoftV3Project>, "outerCorrespondence">,
) {
  for (let track = 0; track < fixture.outerCorrespondence.length; track++) {
    await form.getByRole("button", { name: "Add segment track", exact: true }).click()
    for (let section = 0; section < 2; section++)
      await form
        .getByRole("combobox", { name: `Track ${track + 1} · Section ${section + 1}`, exact: true })
        .selectOption(
          `${fixture.outerCorrespondence[track]?.sectionEntityIds[section]}:${fixture.outerCorrespondence[track]?.sectionStartPointIds[section]}`,
        )
  }
}
async function authorPaths(form: Locator, fixture: ReturnType<typeof createLoftV3Project>) {
  for (const [button, groupName, path] of [
    ["Add boundary rail", "Rail 1", fixture.railPath],
    ["Add C0 guide", "Guide 1", fixture.guidePath],
  ] as const) {
    await form.getByRole("button", { name: button, exact: true }).click()
    const group = form.getByRole("group", { name: groupName, exact: true })
    if (groupName === "Guide 1")
      await group.getByRole("textbox", { name: "Guide name", exact: true }).fill("Wall guide")
    await group
      .getByRole("combobox", { name: "Path sketch", exact: true })
      .selectOption(path.sketchId)
    await group.getByRole("checkbox").check()
    await group
      .getByRole("combobox", { name: "Path start point", exact: true })
      .selectOption(path.startPointId)
  }
}
async function authorEnds(form: Locator) {
  for (const [title, continuity] of [
    ["Start continuity", "G1"],
    ["End continuity", "G2"],
  ] as const) {
    const group = form.getByRole("group", { name: title, exact: true })
    await group.getByRole("button", { name: "Add end constraint", exact: true }).click()
    await group.getByRole("combobox", { name: "Continuity", exact: true }).selectOption(continuity)
    const face = group.getByRole("combobox", { name: "Support face", exact: true })
    const option = face.getByRole("option", { name: /Seed box.*\(0, -2, 5\) mm$/ })
    await expect(option).toBeAttached({ timeout: 15_000 })
    await face.selectOption((await option.getAttribute("value")) ?? "")
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

async function nativeSaved(page: Page) {
  await test.step("Exact native rebuild and durable save", () =>
    expect(
      page
        .getByRole("status", { name: "Project save status", exact: true })
        .filter({ hasText: /^Saved$/ }),
    ).toBeAttached({
      timeout: 120_000,
    }))
}
async function nativePreviewReady(form: Locator, action: string) {
  await test.step("Exact native constrained preview ready", () =>
    expect(form.getByRole("button", { name: action, exact: true })).toBeEnabled({
      timeout: 120_000,
    }))
}
