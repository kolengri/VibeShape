import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { Locator, Page, TestInfo } from "@playwright/test"
import { unzipSync } from "fflate"
import type { AssemblyMotionStudy } from "../../packages/domain/src/assembly-authority"
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
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await page.getByRole("menuitem", { name: "New study", exact: true }).click()
  await panel(page).getByRole("textbox", { name: "Study name", exact: true }).fill("Hinge sweep")
  await panel(page).getByText("Edit keys (2)", { exact: true }).click()
  const keyTime = panel(page).getByRole("spinbutton", { name: "Time (s)", exact: true }).nth(1)
  await keyTime.focus()
  await keyTime.press("Tab")
  const duration = panel(page).getByRole("spinbutton", { name: "Duration (s)", exact: true })
  for (const value of ["4", "2"]) {
    await duration.fill(value)
    await panel(page).getByRole("textbox", { name: "Study name", exact: true }).focus()
    await expect(keyTime).toHaveValue(value)
    expect(await keyTime.evaluate((input) => input.checkValidity())).toBe(true)
  }
  const values = panel(page).getByRole("spinbutton", { name: "Value (deg)", exact: true })
  await values.nth(0).fill("-30")
  await values.nth(1).fill("30")
  await panel(page).getByRole("button", { name: "Save study", exact: true }).click()
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Hinge sweep", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  const authored = await savedAssembly(page)
  expect(authored.revision).toBe(baseline.revision + 1)
  expect(authored.assembly.joints).toEqual(baseline.assembly.joints)
  expect(authored.assembly.motionStudies?.[0]).toMatchObject({ name: "Hinge sweep", duration: 2 })
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await page.getByRole("menuitem", { name: "Hinge sweep", exact: true }).click()
  const timeline = panel(page).getByRole("slider", { name: "Timeline (s)", exact: true })
  const seekStarted = Date.now()
  await timeline.fill("1")
  await expect(page.getByText("Unsaved motion preview", { exact: true })).toBeVisible({
    timeout: 60000,
  })
  const seekMilliseconds = Date.now() - seekStarted
  expect((await savedAssembly(page)).revision).toBe(authored.revision)
  await panel(page).getByText("Playback settings", { exact: true }).click()
  await panel(page).getByRole("spinbutton", { name: "Sample count", exact: true }).fill("3")
  await panel(page).getByRole("spinbutton", { name: "Playback speed", exact: true }).fill("10")
  await panel(page).getByRole("checkbox", { name: "Reverse", exact: true }).check()
  const samplesStarted = Date.now()
  await panel(page).getByRole("button", { name: "Play animation", exact: true }).click()
  await expect(panel(page).getByText("Solved samples: 3", { exact: true })).toBeVisible({
    timeout: 60000,
  })
  await expect(panel(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(0, {
    timeout: 60000,
  })
  const threeSampleMilliseconds = Date.now() - samplesStarted
  await panel(page).getByText("Export solved motion", { exact: true }).click()
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
  await mkdir("artifacts/native-assistant-workflows", { recursive: true })
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
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Hinge sweep", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  const applied = await savedAssembly(page)
  expect(applied.revision).toBe(authored.revision + 1)
  expect(applied.assembly.joints[0]).toMatchObject({ value: -Math.PI / 6 })
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  expect((await savedAssembly(page)).assembly).toEqual(authored.assembly)
  await page.reload()
  await saved(page)
  expect((await savedAssembly(page)).assembly.motionStudies).toEqual(
    authored.assembly.motionStudies,
  )
})

async function addCranks(page: Page) {
  const base = (await savedAssembly(page)).assembly.instances[0]
  if (!base) throw new Error("Expected grounded base.")
  for (let index = 2; index <= 7; index++) {
    await page.locator(`[data-assembly-instance-id="${base.id}"]`).click()
    await panel(page).getByRole("button", { name: "Add joint", exact: true }).click()
    await panel(page).getByRole("combobox", { name: "Joint type", exact: true }).click()
    await page.getByRole("option", { name: "Revolute", exact: true }).click()
    await panel(page).getByRole("textbox", { name: "Name", exact: true }).fill(`Crank ${index}`)
    await panel(page).getByRole("spinbutton", { name: "Minimum drive", exact: true }).fill("-90")
    await panel(page).getByRole("spinbutton", { name: "Maximum drive", exact: true }).fill("90")
    await apply(page)
  }
}

function expectSevenTracks(study: AssemblyMotionStudy | undefined) {
  if (!study) throw new Error("Expected persisted seven-track study.")
  expect(study.duration).toBe(4)
  expect(study.tracks).toHaveLength(7)
  expect(new Set(study.tracks.map(({ jointId }) => jointId)).size).toBe(7)
  study.tracks.forEach((track, index) => {
    expect(track.keys.map(({ time }) => time)).toEqual([0, 2.04, 4])
    expect(track.keys[0]?.value).toBeCloseTo(((-30 + index * 5) * Math.PI) / 180)
    expect(track.keys[2]?.value).toBeCloseTo(((30 + index * 5) * Math.PI) / 180)
  })
}

async function fillStudyNumber(input: Locator, value: string) {
  // A blur can retime the next field; finish that render before replacing its text.
  await input.focus()
  await input.fill(value)
}

async function verifyRetimeBoundaries(page: Page) {
  const time = panel(page).getByRole("spinbutton", { name: "Time (s)", exact: true }).nth(1)
  const duration = panel(page).getByRole("spinbutton", { name: "Duration (s)", exact: true })
  const middle = panel(page)
    .getByRole("group", { name: "Track 1 key times", exact: true })
    .getByRole("slider")
    .nth(1)
  const lastTime = panel(page).getByRole("spinbutton", { name: "Time (s)", exact: true }).nth(2)
  const name = panel(page).getByRole("textbox", { name: "Study name", exact: true })
  await fillStudyNumber(duration, "5")
  await fillStudyNumber(time, "1.9")
  await fillStudyNumber(lastTime, "1.9000000000000001")
  await duration.focus()
  await expect(duration).not.toHaveAttribute("aria-invalid", "true")
  await fillStudyNumber(duration, "5")
  await name.focus()
  await expect(time).toHaveValue("1.9")
  await expect(lastTime).toHaveValue("1.9000000000000001")
  expect(await duration.evaluate((input) => input.form?.checkValidity())).toBe(true)
  await fillStudyNumber(lastTime, "5")
  await fillStudyNumber(duration, "2")
  await fillStudyNumber(time, "5e-324")
  await duration.focus()
  await expect(duration).not.toHaveAttribute("aria-invalid", "true")
  await fillStudyNumber(duration, "0.001")
  await panel(page).getByRole("textbox", { name: "Study name", exact: true }).focus()
  await expect(duration).toHaveAttribute("aria-invalid", "true")
  await expect(
    panel(page).getByText(
      "This duration would merge key times. Move the keys farther apart or use a longer duration.",
      { exact: true },
    ),
  ).toBeVisible()
  await fillStudyNumber(duration, "2")
  await fillStudyNumber(time, "1")
  await middle.focus()
  await middle.press("Home")
  await fillStudyNumber(duration, "0.001")
  await panel(page).getByRole("textbox", { name: "Study name", exact: true }).focus()
  expect(Number(await middle.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
  await expect(duration).not.toHaveAttribute("aria-invalid", "true")
  await fillStudyNumber(duration, "2")
  await fillStudyNumber(time, "1.02")
  await middle.focus()
}

async function captureStudyLayouts(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "chromium") return
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 1440, height: 900 })
  const form = page.getByRole("form", { name: "Motion studies", exact: true })
  for (const theme of ["light", "dark"] as const) {
    await page
      .locator("html")
      .evaluate((element, dark) => element.classList.toggle("dark", dark), theme === "dark")
    await form.getByRole("textbox", { name: "Study name", exact: true }).focus()
    expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`motion-ui-${theme}.png`) })
  }
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(form.getByRole("button", { name: "Save study", exact: true })).toBeInViewport()
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("motion-ui-1024.png") })
  // A 512×384 CSS viewport models 200% page zoom on a 1024×768 display.
  await page.setViewportSize({ width: 512, height: 384 })
  const content = form.locator("[data-slot='task-panel-content']")
  const footer = form.locator("[data-slot='task-panel-footer']")
  await expect(form.getByRole("button", { name: "Save study", exact: true })).toBeInViewport()
  expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  )
  const footerBounds = await footer.boundingBox()
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(await footer.boundingBox()).toEqual(footerBounds)
  await expect(form.getByRole("heading", { name: "Edit study", exact: true })).toBeInViewport()
  await expect(form.getByRole("button", { name: "Save study", exact: true })).toBeInViewport()
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("motion-ui-zoom200-equivalent.png") })
}

test("authors seven named drive tracks with degree offsets and graphical key times", async ({
  page,
}, testInfo) => {
  test.setTimeout(300000)
  page.setDefaultTimeout(15000)
  await prepare(page)
  await addCranks(page)
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await page.getByRole("menuitem", { name: "New study", exact: true }).click()
  await panel(page)
    .getByRole("textbox", { name: "Study name", exact: true })
    .fill("Seven coordinated cranks")
  await panel(page).getByText("Edit keys (2)", { exact: true }).click()
  const values = panel(page).getByRole("spinbutton", { name: "Value (deg)", exact: true })
  await values.nth(0).fill("")
  await panel(page).getByRole("button", { name: "Save study", exact: true }).click()
  await expect(values.nth(0)).toBeFocused()
  await expect(values.nth(0)).toHaveValue("")
  await values.nth(0).fill("-30")
  await values.nth(1).fill("30")
  await panel(page).getByRole("button", { name: "Add key", exact: true }).click()
  const lane = panel(page).getByRole("group", { name: "Track 1 key times", exact: true })
  const middle = lane.getByRole("slider").nth(1)
  await middle.hover()
  const box = await middle.boundingBox()
  if (!box) throw new Error("Expected a graphical key marker.")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2)
  await page.mouse.up()
  const draggedTime = Number(await middle.getAttribute("aria-valuenow"))
  expect(draggedTime).toBeGreaterThan(1)
  expect(draggedTime).toBeLessThan(2)
  await panel(page).getByRole("spinbutton", { name: "Time (s)", exact: true }).nth(1).fill("1")
  await middle.focus()
  await middle.press("ArrowRight")
  await expect(
    panel(page).getByRole("slider", { name: "Key 2 at 1.02 s", exact: true }),
  ).toBeVisible()
  await verifyRetimeBoundaries(page)
  await panel(page).getByText("Copy to another joint", { exact: true }).click()
  for (let index = 1; index <= 6; index++) {
    const source = panel(page).getByRole("group", { name: "Track 1", exact: true })
    const offset = source.getByRole("spinbutton", { name: "Angular offset (deg)", exact: true })
    const copy = source.getByRole("button", { name: "Copy track", exact: true })
    await offset.click()
    const before = await copy.boundingBox()
    await offset.fill(String(index * 5))
    const buffered = await copy.boundingBox()
    if (!before || !buffered) throw new Error("Expected a visible copy action.")
    expect(buffered.y).toBeCloseTo(before.y)
    await copy.click()
    await expect(
      panel(page).getByRole("combobox", { name: "Coordinate", exact: true }),
    ).toHaveCount(index + 1)
  }
  await expect(panel(page).getByRole("combobox", { name: "Coordinate", exact: true })).toHaveCount(
    7,
  )
  await expect(
    panel(page).getByRole("group", { name: "Track 7 key times", exact: true }),
  ).toBeVisible()
  await panel(page).getByRole("spinbutton", { name: "Duration (s)", exact: true }).fill("4")
  await panel(page).getByRole("textbox", { name: "Study name", exact: true }).focus()
  await expect(
    panel(page).getByRole("slider", { name: "Key 2 at 2.04 s", exact: true }),
  ).toHaveCount(7)
  await panel(page).getByRole("button", { name: "Save study", exact: true }).click()
  const archive = await saveProject(page)
  const snapshot = archive.project.snapshot
  if (snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5)
    throw new Error("Expected assembly snapshot.")
  const study = snapshot.assembly.motionStudies?.[0]
  expectSevenTracks(study)
  if (testInfo.project.name === "chromium")
    await writeFile(testInfo.outputPath("seven-drive-study.vshape"), archive.bytes)
  await page.reload()
  await saved(page)
  await page
    .getByRole("group", { name: "Geometry workspace" })
    .getByRole("button", { name: "Assembly", exact: true })
    .click()
  await panel(page).getByRole("button", { name: "Motion studies", exact: true }).click()
  await page.getByRole("menuitem", { name: "Seven coordinated cranks", exact: true }).click()
  await expect(panel(page).getByRole("combobox", { name: "Coordinate", exact: true })).toHaveCount(
    7,
  )
  await panel(page).getByText("Playback settings", { exact: true }).click()
  await panel(page).getByRole("spinbutton", { name: "Sample count", exact: true }).fill("3")
  await panel(page).getByRole("spinbutton", { name: "Playback speed", exact: true }).fill("10")
  await panel(page).getByRole("button", { name: "Play animation", exact: true }).click()
  await expect(panel(page).getByText("Solved samples: 3", { exact: true })).toBeVisible({
    timeout: 60000,
  })
  await expect(panel(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(0, {
    timeout: 60000,
  })
  await captureStudyLayouts(page, testInfo)
})
