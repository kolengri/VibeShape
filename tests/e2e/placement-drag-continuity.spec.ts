import type { Locator, Page, TestInfo } from "@playwright/test"
import { readPlacementFeatureParameters } from "../../packages/domain/src/part-design-placement"
import { saved, saveProject } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { invokeModelCommand } from "./model-command-support"

type PlacementDraft = { form: Locator; viewport: Locator; canvas: Locator; x: Locator }
type Translation = readonly [number, number, number]

async function createPlacementDraft(page: Page): Promise<PlacementDraft> {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await saved(page)
  await invokeModelCommand(page, "Primitives", "Box")
  const box = page.getByRole("form", { name: "Create box", exact: true })
  for (const [name, value] of [
    ["Width", 20],
    ["Depth", 16],
    ["Height", 12],
    ["Origin X", 10],
    ["Origin Y", 20],
    ["Origin Z", 30],
  ] as const)
    await box.getByRole("combobox", { name, exact: true }).fill(`${value} mm`)
  await box.getByRole("button", { name: "Create box", exact: true }).click()
  await expect(box).toHaveCount(0)
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await page.getByRole("button", { name: "Place / align faces", exact: true }).click()
  const form = page.getByRole("form", { name: "Place part", exact: true })
  for (const [axis, value] of [
    ["X", 7],
    ["Y", -3],
    ["Z", 5],
  ] as const)
    await form.getByRole("combobox", { name: `Translate ${axis}`, exact: true }).fill(`${value} mm`)
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await page.getByRole("button", { name: "Fit view", exact: true }).click()
  return {
    form,
    viewport,
    canvas: viewport.locator("canvas"),
    x: form.getByRole("combobox", { name: "Translate X", exact: true }),
  }
}

async function expectGizmoPose(draft: PlacementDraft, translation: Translation) {
  await expect
    .poll(async () => {
      const raw = await draft.viewport.getAttribute("data-translation-gizmo-position")
      const position = (raw ?? "").split(",").map(Number)
      if (position.length !== 3 || !position.every(Number.isFinite)) return Infinity
      const expected = [10 + translation[0], 20 + translation[1], 36 + translation[2]]
      return Math.max(...position.map((value, index) => Math.abs(value - (expected[index] ?? 0))))
    })
    .toBeLessThan(0.00001)
}

async function expectDraftPose(draft: PlacementDraft, x: number) {
  await expectGizmoPose(draft, [x, -3, 5])
  await expect(draft.form.getByRole("combobox", { name: "Translate Y", exact: true })).toHaveValue(
    "-3 mm",
  )
  await expect(draft.form.getByRole("combobox", { name: "Translate Z", exact: true })).toHaveValue(
    "5 mm",
  )
}

async function readTranslation(draft: PlacementDraft): Promise<Translation> {
  const values = await Promise.all(
    ["X", "Y", "Z"].map(async (axis) =>
      Number.parseFloat(
        await draft.form
          .getByRole("combobox", { name: `Translate ${axis}`, exact: true })
          .inputValue(),
      ),
    ),
  )
  const [x, y, z] = values
  if (x === undefined || y === undefined || z === undefined || !values.every(Number.isFinite))
    throw new Error("Placement must expose three finite translation values.")
  return [x, y, z]
}

async function projectedOrigin(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-translation-gizmo-origin", /.+/)
  const bounds = await canvas.boundingBox()
  const raw = await canvas.getAttribute("data-translation-gizmo-origin")
  const [x, y] = (raw ?? "").split(",").map(Number)
  if (!bounds || x === undefined || y === undefined || !Number.isFinite(x + y))
    throw new Error("The Placement translation handle must have a finite projected origin.")
  return { x: bounds.x + x, y: bounds.y + y }
}

async function translationHandle(canvas: Locator) {
  const origin = await projectedOrigin(canvas)
  return { x: origin.x + 82, y: origin.y + 40 }
}

async function expectProjectedOrigin(draft: PlacementDraft, expected: { x: number; y: number }) {
  const actual = await projectedOrigin(draft.canvas)
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(0.5)
}

async function dragPlacement(page: Page, draft: PlacementDraft, offsets: readonly number[]) {
  const before = await draft.x.inputValue()
  await expectDraftPose(draft, Number.parseFloat(before))
  const handle = await translationHandle(draft.canvas)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await expect(draft.canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
  await expect(draft.x).toHaveValue(before)
  for (const offset of offsets) await page.mouse.move(handle.x + offset, handle.y)
  await expect(draft.x).not.toHaveValue(before)
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const released = await draft.x.inputValue()
  await page.mouse.up()
  await expect(draft.canvas).not.toHaveAttribute("data-translation-gizmo-dragging")
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", {
    timeout: 30_000,
  })
  await expect(draft.x).toHaveValue(released)
  await expectDraftPose(draft, Number.parseFloat(released))
  return released
}

async function applyAndReopenPlacement(
  page: Page,
  draft: PlacementDraft,
  released: string,
  action: "Create placement" | "Update placement" = "Create placement",
) {
  const expected = await readTranslation(draft)
  expect(expected[0]).toBe(Number.parseFloat(released))
  await draft.form.getByRole("button", { name: action, exact: true }).click()
  await expect(draft.form).toHaveCount(0)
  await saved(page)
  const backup = await saveProject(page)
  const feature = backup.project.snapshot.features.find((item) =>
    readPlacementFeatureParameters(item),
  )
  if (!feature) throw new Error("The cumulative Placement transform must be authored.")
  expect(readPlacementFeatureParameters(feature)).toMatchObject({
    translation: {
      x: { value: Number.parseFloat(released) },
      y: { value: expected[1] },
      z: { value: expected[2] },
    },
  })
  await page.reload()
  await saved(page)
  await page.getByRole("treeitem", { name: "Placement 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit placement", exact: true })
  await expect(form.getByRole("combobox", { name: "Translate X", exact: true })).toHaveValue(
    released,
  )
  await expect(readTranslation({ ...draft, form })).resolves.toEqual(expected)
  await expectGizmoPose({ ...draft, form }, expected)
}

test("continues settled Placement drags from the last release and reopens the cumulative transform", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const draft = await createPlacementDraft(page)
  let previous = "7 mm"
  for (let gesture = 0; gesture < 3; gesture += 1) {
    const released = await dragPlacement(page, draft, [45])
    expect(Number.parseFloat(released)).toBeGreaterThan(Number.parseFloat(previous))
    previous = released
  }
  await expect(draft.viewport).toHaveAttribute("data-preview-feature-count", "1")
  await applyAndReopenPlacement(page, draft, previous)
})

async function cancelActivePlacementDrag(page: Page, draft: PlacementDraft, released: string) {
  const handle = await translationHandle(draft.canvas)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 60, handle.y)
  await expect(draft.canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
  await expect(draft.x).not.toHaveValue(released)
  await page.keyboard.press("Escape")
  await expect(draft.x).toHaveValue(released)
  await expect(draft.form).toBeVisible()
  await page.mouse.up()
  await expect(draft.canvas).not.toHaveAttribute("data-translation-gizmo-dragging")
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expectDraftPose(draft, Number.parseFloat(released))
}

async function dragPlacementRapidly(page: Page, draft: PlacementDraft, direction: number) {
  const handle = await translationHandle(draft.canvas)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + direction * 60, handle.y)
  await page.mouse.move(handle.x - direction * 30, handle.y)
  await page.mouse.move(handle.x + direction * 90, handle.y)
  await page.mouse.up()
  return draft.x.inputValue()
}

test("retains rapid reversing Placement releases and cancels only the active drag", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const draft = await createPlacementDraft(page)
  let released = "7 mm"
  for (let gesture = 0; gesture < 11; gesture += 1) {
    const direction = gesture % 2 === 0 ? 1 : -1
    const before = Number.parseFloat(released)
    released = await dragPlacementRapidly(page, draft, direction)
    expect(direction * (Number.parseFloat(released) - before)).toBeGreaterThan(0)
  }
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(draft.x).toHaveValue(released)
  await expectDraftPose(draft, Number.parseFloat(released))
  await cancelActivePlacementDrag(page, draft, released)
  await draft.form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(draft.form).toHaveCount(0)
  await saved(page)
  const backup = await saveProject(page)
  expect(
    backup.project.snapshot.features.some((feature) => readPlacementFeatureParameters(feature)),
  ).toBe(false)
})

async function moveHeldPointer(page: Page, canvas: Locator, target: { x: number; y: number }) {
  await canvas.evaluate((element, point) => {
    if (element.onpointermove) throw new Error("Expected no existing pointer receipt handler.")
    element.removeAttribute("data-test-pointer-received")
    element.onpointermove = (event: {
      isPrimary: boolean
      buttons: number
      clientX: number
      clientY: number
    }) => {
      if (!event.isPrimary || (event.buttons & 1) === 0) return
      if (Math.hypot(event.clientX - point.x, event.clientY - point.y) <= 0.5)
        element.setAttribute("data-test-pointer-received", "true")
    }
  }, target)
  try {
    await page.mouse.move(target.x, target.y, { steps: 5 })
    await expect(canvas).toHaveAttribute("data-test-pointer-received", "true")
  } finally {
    await canvas.evaluate((element) => {
      element.onpointermove = null
    })
  }
}

async function continueThroughHeldPreview(page: Page, draft: PlacementDraft, testInfo: TestInfo) {
  const handle = await translationHandle(draft.canvas)
  const before = await draft.x.inputValue()
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await moveHeldPointer(page, draft.canvas, { x: handle.x + 45, y: handle.y })
  await expect(draft.x).not.toHaveValue(before)
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const intermediate = await draft.x.inputValue()
  const intermediateOrigin = await projectedOrigin(draft.canvas)
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(draft.canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
  await expect(draft.x).toHaveValue(intermediate)
  await expectDraftPose(draft, Number.parseFloat(intermediate))
  await expectProjectedOrigin(draft, intermediateOrigin)
  await page.screenshot({ path: testInfo.outputPath("held-exact-preview.png") })
  await moveHeldPointer(page, draft.canvas, { x: handle.x + 90, y: handle.y })
  await expect
    .poll(async () => Number.parseFloat(await draft.x.inputValue()))
    .toBeGreaterThan(Number.parseFloat(intermediate))
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const released = await draft.x.inputValue()
  const releasedOrigin = await projectedOrigin(draft.canvas)
  expect(releasedOrigin.x).toBeGreaterThan(intermediateOrigin.x)
  await page.mouse.up()
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(draft.x).toHaveValue(released)
  await expectProjectedOrigin(draft, releasedOrigin)
  await page.screenshot({ path: testInfo.outputPath("continued-release-preview.png") })
  return { released, releasedOrigin }
}

test("continues an edited Placement gesture after its exact preview completes while held", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const creating = await createPlacementDraft(page)
  await creating.form.getByRole("button", { name: "Create placement", exact: true }).click()
  await expect(creating.form).toHaveCount(0)
  await saved(page)
  await page.getByRole("treeitem", { name: "Placement 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit placement", exact: true })
  const draft = {
    ...creating,
    form,
    x: form.getByRole("combobox", { name: "Translate X", exact: true }),
  }
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expectDraftPose(draft, 7)
  const { released, releasedOrigin } = await continueThroughHeldPreview(page, draft, testInfo)
  const handle = await translationHandle(draft.canvas)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await expect(draft.x).toHaveValue(released)
  await expectProjectedOrigin(draft, releasedOrigin)
  await page.mouse.move(handle.x + 45, handle.y, { steps: 5 })
  await expect
    .poll(async () => Number.parseFloat(await draft.x.inputValue()))
    .toBeGreaterThan(Number.parseFloat(released))
  await page.mouse.up()
  const lastRelease = await draft.x.inputValue()
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(draft.x).toHaveValue(lastRelease)
  await expectDraftPose(draft, Number.parseFloat(lastRelease))
  await applyAndReopenPlacement(page, draft, lastRelease, "Update placement")
})

async function editedPlacementDraft(page: Page): Promise<PlacementDraft> {
  const creating = await createPlacementDraft(page)
  await creating.form.getByRole("button", { name: "Create placement", exact: true }).click()
  await expect(creating.form).toHaveCount(0)
  await saved(page)
  await page.getByRole("treeitem", { name: "Placement 1", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit placement", exact: true })
  await expect(creating.viewport).toHaveAttribute("data-preview-status", "ready", {
    timeout: 30_000,
  })
  return { ...creating, form, x: form.getByRole("combobox", { name: "Translate X", exact: true }) }
}

async function expectXYMovement(draft: PlacementDraft, before: Translation) {
  await expect.poll(async () => (await readTranslation(draft))[0]).toBeGreaterThan(before[0])
  await expect.poll(async () => (await readTranslation(draft))[1]).toBeGreaterThan(before[1])
  const translation = await readTranslation(draft)
  expect(translation[2]).toBe(5)
  return translation
}

async function observePendingPreview(viewport: Locator) {
  return viewport.evaluateHandle((element) => {
    const finished = new Promise<{
      status: string
      previewCount: string | null
      gizmo: string | null
    }>((resolve) => {
      const view = element.ownerDocument.defaultView
      if (!view) throw new Error("The preview viewport must belong to a browser window.")
      const observer = new view.MutationObserver(() => {
        const status = element.getAttribute("data-preview-status")
        if (status !== "idle" && status !== "loading") return
        observer.disconnect()
        resolve({
          status,
          previewCount: element.getAttribute("data-preview-feature-count"),
          gizmo: element.getAttribute("data-translation-gizmo-position"),
        })
      })
      observer.observe(element, { attributes: true, attributeFilter: ["data-preview-status"] })
    })
    return { finished }
  })
}

async function dragXYPlacement(
  page: Page,
  draft: PlacementDraft,
  testInfo: TestInfo,
  gesture: number,
) {
  const before = await readTranslation(draft)
  const origin = await projectedOrigin(draft.canvas)
  // The fitted isometric view projects the blue XY square between the positive X/Y arrows.
  const square = { x: origin.x + 42, y: origin.y }
  await page.mouse.move(square.x, square.y)
  await page.mouse.down()
  await expect(draft.canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
  expect(await readTranslation(draft)).toEqual(before)
  await expectProjectedOrigin(draft, origin)
  const pending = gesture === 1 ? await observePendingPreview(draft.viewport) : undefined
  const capturedPending = pending
    ?.evaluate(async (state) => state.finished)
    .then(async (observed) => {
      const screenshotStartStatus = await draft.viewport.getAttribute("data-preview-status")
      await page.screenshot({ path: testInfo.outputPath("xy-square-pending-preview.png") })
      const screenshotEndStatus = await draft.viewport.getAttribute("data-preview-status")
      await testInfo.attach("pending-preview-state.json", {
        contentType: "application/json",
        body: JSON.stringify({
          previousTranslation: before,
          observed,
          screenshotStartStatus,
          screenshotEndStatus,
        }),
      })
      return observed
    })
  await page.mouse.move(square.x + 35, square.y + 8, { steps: 5 })
  if (pending && capturedPending) {
    const observed = await capturedPending
    await pending.dispose()
    expect(
      observed.previewCount,
      "A valid pending Placement must retain its last preview body",
    ).toBe("1")
  }
  const intermediate = await expectXYMovement(draft, before)
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const intermediateOrigin = await projectedOrigin(draft.canvas)
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await expect(draft.canvas).toHaveAttribute("data-translation-gizmo-dragging", "true")
  expect(await readTranslation(draft)).toEqual(intermediate)
  await expectGizmoPose(draft, intermediate)
  await expectProjectedOrigin(draft, intermediateOrigin)
  if (gesture === 0)
    await page.screenshot({ path: testInfo.outputPath("xy-square-held-preview.png") })
  await page.mouse.move(square.x + 70, square.y + 16, { steps: 5 })
  await expectXYMovement(draft, intermediate)
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  )
  const released = await readTranslation(draft)
  const releasedOrigin = await projectedOrigin(draft.canvas)
  await page.mouse.up()
  await expect(draft.viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  expect(await readTranslation(draft)).toEqual(released)
  await expectGizmoPose(draft, released)
  await expectProjectedOrigin(draft, releasedOrigin)
  if (gesture === 0)
    await page.screenshot({ path: testInfo.outputPath("xy-square-released-preview.png") })
}

test("continues repeated Placement XY-square drags through exact previews and successive releases", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const draft = await editedPlacementDraft(page)
  await expectGizmoPose(draft, [7, -3, 5])
  for (let gesture = 0; gesture < 3; gesture += 1) {
    await dragXYPlacement(page, draft, testInfo, gesture)
  }
  const released = await draft.x.inputValue()
  await applyAndReopenPlacement(page, draft, released, "Update placement")
})
