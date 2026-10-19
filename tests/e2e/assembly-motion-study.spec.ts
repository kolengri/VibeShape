import { readFile, writeFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { unzipSync } from "fflate"
import { createSolids, saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

const panel = (page: Page) => page.getByRole("region", { name: "Assembly task", exact: true })
async function savedAssembly(page: Page) {
  const snapshot = (await saveProject(page)).project.snapshot
  if (snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5)
    throw new Error("Expected assembly authority.")
  return snapshot
}
async function apply(page: Page) {
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await saved(page)
  await expect(panel(page).getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
  await expect(page.getByText("Inspecting frozen assembly geometry…", { exact: true })).toHaveCount(
    0,
    { timeout: 60000 },
  )
}
async function prepare(page: Page) {
  await page.goto("/")
  await saved(page)
  await createSolids(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await panel(page).getByRole("button", { name: "Create definition", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Study bracket")
  await apply(page)
  const parent = (await savedAssembly(page)).assembly.instances[0]
  if (!parent) throw new Error("Expected grounded occurrence.")
  await page.locator(`[data-assembly-instance-id="${parent.id}"]`).click()
  await panel(page).getByRole("button", { name: "Add joint", exact: true }).click()
  await panel(page).getByRole("combobox", { name: "Joint type", exact: true }).click()
  await page.getByRole("option", { name: "Revolute", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill("Study arm")
  await panel(page).getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-90")
  await panel(page).getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("90")
  await apply(page)
}
test("saves keyed motion separately, seeks and samples real poses, exports PNG/JSON/CSV, and restores through Undo and reload", async ({
  page,
}) => {
  test.setTimeout(240000)
  await prepare(page)
  const baseline = await savedAssembly(page)
  await panel(page).getByRole("button", { name: "More assembly actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "New study", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Study name", exact: true }).fill("Hinge sweep")
  const values = panel(page).getByRole("spinbutton", { name: "Value (rad)", exact: true })
  await values.nth(0).fill("-0.5")
  await values.nth(1).fill("0.5")
  await panel(page).getByRole("button", { name: "Save study", exact: true }).click()
  await panel(page).getByRole("button", { name: "More assembly actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Hinge sweep", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  const authored = await savedAssembly(page)
  expect(authored.revision).toBe(baseline.revision + 1)
  expect(authored.assembly.joints).toEqual(baseline.assembly.joints)
  expect(authored.assembly.motionStudies?.[0]).toMatchObject({ name: "Hinge sweep", duration: 2 })
  await panel(page).getByRole("button", { name: "More assembly actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Hinge sweep", exact: true }).click()
  const timeline = panel(page).getByRole("slider", { name: "Timeline (s)", exact: true })
  const seekStarted = Date.now()
  await timeline.fill("1")
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible({
    timeout: 60000,
  })
  const seekMilliseconds = Date.now() - seekStarted
  expect((await savedAssembly(page)).revision).toBe(authored.revision)
  await panel(page).getByRole("spinbutton", { name: "Sample count", exact: true }).fill("3")
  await panel(page).getByRole("spinbutton", { name: "Playback speed", exact: true }).fill("10")
  await panel(page).getByRole("checkbox", { name: "Reverse", exact: true }).check()
  const samplesStarted = Date.now()
  await panel(page).getByRole("button", { name: "Play one sweep", exact: true }).click()
  await expect(panel(page).getByText("Solved samples: 3", { exact: true })).toBeVisible({
    timeout: 60000,
  })
  await expect(panel(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(0, {
    timeout: 60000,
  })
  const threeSampleMilliseconds = Date.now() - samplesStarted
  const jsonDownload = page.waitForEvent("download")
  await panel(page).getByRole("button", { name: "Export solved JSON", exact: true }).click()
  const json = await jsonDownload,
    jsonPath = await json.path()
  if (!jsonPath) throw new Error("Expected JSON file.")
  const data = JSON.parse(await readFile(jsonPath, "utf8"))
  expect(data.samples.map((sample: { timeSeconds: number }) => sample.timeSeconds)).toEqual([
    2, 1, 0,
  ])
  expect(data.samples[0].occurrences.length).toBe(2)
  const csvDownload = page.waitForEvent("download")
  await panel(page).getByRole("button", { name: "Export solved CSV", exact: true }).click()
  const csvPath = await (await csvDownload).path()
  if (!csvPath) throw new Error("Expected CSV file.")
  const csvRows = (await readFile(csvPath, "utf8")).split("\n")
  expect(csvRows).toHaveLength(8)
  expect(csvRows[0]).toContain("study_id,revision,time_s,")
  for (const row of csvRows.slice(1, -1))
    expect(row.split(",").slice(0, 2)).toEqual([data.studyId, String(authored.revision)])
  const pngDownload = page.waitForEvent("download")
  const pngStarted = Date.now()
  await panel(page).getByRole("button", { name: "Export PNG sequence", exact: true }).click()
  const pngPath = await (await pngDownload).path()
  const threeFramePngMilliseconds = Date.now() - pngStarted
  if (!pngPath) throw new Error("Expected PNG archive.")
  const files = unzipSync(await readFile(pngPath))
  expect(Object.keys(files)).toEqual([
    "motion.json",
    "frame-0001.png",
    "frame-0002.png",
    "frame-0003.png",
  ])
  expect([...(files["frame-0001.png"]?.slice(0, 8) ?? [])]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ])
  await writeFile(
    "artifacts/native-assistant-workflows/motion-browser-timing.json",
    JSON.stringify(
      {
        fixture: "two exact box occurrences, one revolute joint",
        samples: 3,
        relativeSpeed: 10,
        seekMilliseconds,
        threeSampleMilliseconds,
        threeFramePngMilliseconds,
      },
      null,
      2,
    ),
  )
  await panel(page).getByRole("button", { name: "Apply", exact: true }).click()
  await panel(page).getByRole("button", { name: "More assembly actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Hinge sweep", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  const applied = await savedAssembly(page)
  expect(applied.revision).toBe(authored.revision + 1)
  expect(applied.assembly.joints[0]).toMatchObject({ value: -0.5 })
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await savedAssembly(page)).assembly).toEqual(authored.assembly)
  await page.reload()
  await saved(page)
  expect((await savedAssembly(page)).assembly.motionStudies).toEqual(
    authored.assembly.motionStudies,
  )
})
