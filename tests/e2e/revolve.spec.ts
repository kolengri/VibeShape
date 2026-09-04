import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { clickSavedProfileInViewport, confirmSketchPlane, selectSketchTool } from "./sketch-helpers"

async function drawProfileAwayFromBothOriginAxes(page: Page) {
  await selectSketchTool(page, "Rectangle tools", "Rectangle G")
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")

  await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.42)
  await page.mouse.click(bounds.x + bounds.width * 0.74, bounds.y + bounds.height * 0.3)
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
}

async function drawTwoProfilesAwayFromOriginAxes(page: Page) {
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  const rectangles = [
    [0.18, 0.42, 0.4, 0.28],
    [0.6, 0.42, 0.82, 0.28],
  ] as const
  for (const [startX, startY, endX, endY] of rectangles) {
    await selectSketchTool(page, "Rectangle tools", "Rectangle G")
    await page.mouse.click(bounds.x + bounds.width * startX, bounds.y + bounds.height * startY)
    await page.mouse.click(bounds.x + bounds.width * endX, bounds.y + bounds.height * endY)
  }
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
}

async function drawOverlappingSweepProfilesForModifyingRevolve(page: Page) {
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  const rectangles = [
    [0.6, 0.42, 0.74, 0.3],
    [0.6, 0.68, 0.74, 0.8],
  ] as const
  for (const [startX, startY, endX, endY] of rectangles) {
    await selectSketchTool(page, "Rectangle tools", "Rectangle G")
    await page.mouse.click(bounds.x + bounds.width * startX, bounds.y + bounds.height * startY)
    await page.mouse.click(bounds.x + bounds.width * endX, bounds.y + bounds.height * endY)
  }
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
}

test.describe("selector-backed revolve", () => {
  test("keeps the curved angle handle synchronized with the exact field", async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const dimension of ["Width", "Depth", "Height"] as const) {
      await boxForm.getByRole("combobox", { name: dimension }).fill("500 mm")
    }
    await boxForm.getByRole("button", { name: "Create box" }).click()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawProfileAwayFromBothOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
      timeout: 120_000,
    })
    await viewport
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()

    const form = page.getByRole("form", { name: "Revolve profile" })
    const angle = form.getByRole("combobox", { name: "Angle" })
    const canvas = viewport.locator("canvas")
    await angle.fill("270 deg")
    await expect(viewport).toHaveAttribute("data-angular-gizmo-angle", (Math.PI * 1.5).toString(), {
      timeout: 120_000,
    })
    await expect(canvas).toHaveAttribute("data-angular-gizmo-handle", /.+/)
    const bounds = await canvas.boundingBox()
    const handleAttribute = await canvas.getAttribute("data-angular-gizmo-handle")
    if (!bounds || !handleAttribute) throw new Error("The angular handle is not measurable.")
    const [localX = Number.NaN, localY = Number.NaN] = handleAttribute.split(",").map(Number)
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
      throw new Error("The angular handle position is invalid.")
    }
    const handle = { x: bounds.x + localX, y: bounds.y + localY }
    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x - 70, handle.y + 70, { steps: 10 })
    await page.mouse.up()

    await expect(angle).not.toHaveValue("270 deg")
    await expect(angle).toHaveValue(/^\d+(?:\.\d+)? deg$/)
    await form.getByRole("button", { name: "Cancel" }).click()
    await expect(viewport).not.toHaveAttribute("data-angular-gizmo-feature")
  })

  test("creates and reopens a new result from two profiles", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawTwoProfilesAwayFromOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "2", {
      timeout: 120_000,
    })
    await viewport
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
    const form = page.getByRole("form", { name: "Revolve profile" })
    await form
      .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 1" })
      .click()
    await clickSavedProfileInViewport(page, "Sketch 1 · Profile 2", true)

    await expect(form.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    await expect(form.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-selected-sketch-profile-count", "2")
    await expect(form.getByRole("combobox", { name: "Result operation" })).toBeEnabled()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Create revolve" }).click()

    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(editForm.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    await expect(editForm.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-selected-sketch-profile-count", "2")
  })

  for (const operation of ["add", "remove", "intersect"] as const) {
    test(`applies multi-profile revolve ${operation} to one explicit target and reopens the intent`, async ({
      page,
    }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto("/")
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
        timeout: 120_000,
      })
      const toolbar = page.getByRole("toolbar", { name: "Model commands" })
      await toolbar.getByRole("button", { name: "Box", exact: true }).click()
      const boxForm = page.getByRole("form", { name: "Create box" })
      for (const dimension of ["Width", "Depth", "Height"] as const) {
        await boxForm.getByRole("combobox", { name: dimension }).fill("500 mm")
      }
      await boxForm.getByRole("button", { name: "Create box", exact: true }).click()

      await page
        .getByRole("complementary", { name: "Task panel" })
        .getByRole("button", { name: "Create sketch" })
        .click()
      await confirmSketchPlane(page, "xy")
      await drawOverlappingSweepProfilesForModifyingRevolve(page)
      await page.getByRole("button", { name: "Finish sketch" }).click()

      const viewport = page.getByRole("region", { name: "3D viewport" })
      await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "2", {
        timeout: 120_000,
      })
      await viewport
        .getByRole("combobox", { name: "Select saved profile" })
        .selectOption({ label: "Sketch 1 · Profile 1" })
      await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
      const form = page.getByRole("form", { name: "Revolve profile" })
      await form
        .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 1" })
        .click()
      await page.getByRole("button", { name: "Hide Box 1" }).click()
      await clickSavedProfileInViewport(page, "Sketch 1 · Profile 2", true)
      await page.getByRole("button", { name: "Show Box 1" }).click()
      await form.getByRole("combobox", { name: "Result operation" }).selectOption(operation)
      await expect(
        form.getByRole("combobox", { name: "Target body" }).locator("option:checked"),
      ).toHaveText("Box 1")
      await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
      await form.getByRole("button", { name: "Create revolve" }).click()

      await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
      await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
        timeout: 120_000,
      })
      await page.getByRole("treeitem", { name: "Revolve 1" }).click()
      const editForm = page.getByRole("form", { name: "Edit revolve" })
      await expect(editForm.getByRole("combobox", { name: "Result operation" })).toHaveValue(
        operation,
      )
      await expect(editForm.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
      await expect(editForm.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
      await expect(
        editForm.getByRole("combobox", { name: "Target body" }).locator("option:checked"),
      ).toHaveText("Box 1")

      await editForm.getByRole("button", { name: "Cancel" }).click()
      await viewport
        .getByRole("combobox", { name: "Select saved profile" })
        .selectOption({ label: "Sketch 1 · Profile 1" })
      await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
      const downstreamForm = page.getByRole("form", { name: "Revolve profile" })
      await downstreamForm
        .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 1" })
        .click()
      await page.getByRole("button", { name: "Hide Box 1" }).click()
      await clickSavedProfileInViewport(page, "Sketch 1 · Profile 2", true)
      await page.getByRole("button", { name: "Show Box 1" }).click()
      await downstreamForm
        .getByRole("combobox", { name: "Result operation" })
        .selectOption(operation)
      await expect(
        downstreamForm.getByRole("combobox", { name: "Target body" }).locator("option:checked"),
      ).toHaveText("Revolve 1")
      await downstreamForm.getByRole("button", { name: "Cancel" }).click()
    })
  }

  test("blocks saving while the exact multi-profile preview has failed", async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const dimension of ["Width", "Depth", "Height"] as const) {
      await boxForm.getByRole("combobox", { name: dimension }).fill("1 mm")
    }
    await expect(boxForm.getByRole("button", { name: "Create box", exact: true })).toBeEnabled({
      timeout: 120_000,
    })
    await boxForm.getByRole("button", { name: "Create box", exact: true }).click()

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawTwoProfilesAwayFromOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "2", {
      timeout: 120_000,
    })
    await viewport
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
    const form = page.getByRole("form", { name: "Revolve profile" })
    await form
      .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 1" })
      .click()
    await clickSavedProfileInViewport(page, "Sketch 1 · Profile 2", true)
    await form.getByRole("combobox", { name: "Result operation" }).selectOption("intersect")

    await expect(viewport).toHaveAttribute("data-preview-status", "error", {
      timeout: 120_000,
    })
    const submit = form.getByRole("button", { name: "Create revolve" })
    await expect(submit).toBeDisabled()
    await submit.click({ force: true })
    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toHaveCount(0)
  })

  test("reselects a profile without closing create or edit", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawTwoProfilesAwayFromOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "2", {
      timeout: 120_000,
    })
    const profilePicker = viewport.getByRole("combobox", { name: "Select saved profile" })
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
    let form = page.getByRole("form", { name: "Revolve profile" })
    await form
      .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 1" })
      .click()
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 2" })
    await expect(form).toBeVisible()
    await expect(form.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Create revolve" }).click()

    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(editForm.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await editForm
      .getByRole("button", { name: "Select a profile in the 3D viewport: Sketch 1 · Profile 2" })
      .click()
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await expect(editForm).toBeVisible()
    await expect(editForm.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    await editForm.getByRole("button", { name: "Update revolve" }).click()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    form = page.getByRole("form", { name: "Edit revolve" })
    await expect(form.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
  })

  test("creates, previews, edits, and reopens a graphical sketch-line-axis solid", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    for (const dimension of ["Width", "Depth", "Height"] as const) {
      await boxForm.getByRole("combobox", { name: dimension }).fill("500 mm")
    }
    await boxForm.getByRole("button", { name: "Create box" }).click()

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawProfileAwayFromBothOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    const profilePicker = viewport.getByRole("combobox", { name: "Select saved profile" })
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })

    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
    const form = page.getByRole("form", { name: "Revolve profile" })
    await expect(form.getByRole("combobox", { name: "Angle" })).toHaveValue("360 deg")
    await expect(viewport).toHaveAttribute("data-sketch-reference-candidate-count", "8")
    await viewport
      .getByRole("combobox", { name: "Select a Revolve axis with the keyboard" })
      .selectOption({ label: "Sketch 1 · Line 1" })
    await expect(form.getByText("Sketch 1 · Line 1")).toBeVisible()

    await form.getByRole("button", { name: "Cancel" }).click()
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()
    const reopenedCreateForm = page.getByRole("form", { name: "Revolve profile" })
    await expect(
      reopenedCreateForm.getByText(
        "Click a highlighted sketch line or straight model edge in the 3D viewport, or use X/Y above.",
      ),
    ).toBeVisible()
    await expect(
      reopenedCreateForm.getByRole("button", { name: "Horizontal sketch axis (X)" }),
    ).toHaveAttribute("aria-pressed", "true")
    await viewport
      .getByRole("combobox", { name: "Select a Revolve axis with the keyboard" })
      .selectOption({ label: "Sketch 1 · Line 1" })
    await expect(reopenedCreateForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await reopenedCreateForm.getByRole("combobox", { name: "Angle" }).fill("180 deg")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await reopenedCreateForm.getByRole("button", { name: "Create revolve" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(editForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await expect(editForm.getByRole("combobox", { name: "Angle" })).toHaveValue("180 deg")
    await editForm.getByRole("combobox", { name: "Angle" }).fill("270 deg")
    await editForm.getByRole("combobox", { name: "Result operation" }).selectOption("remove")
    await editForm.getByRole("combobox", { name: "Target body" }).selectOption({ label: "Box 1" })
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await editForm.getByRole("button", { name: "Update revolve" }).click()
    await expect(editForm).toHaveCount(0)
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit revolve" })
    await expect(reopenedForm.getByRole("combobox", { name: "Angle" })).toHaveValue("270 deg")
    await expect(reopenedForm.getByText("Sketch 1 · Line 1")).toBeVisible()
    await expect(reopenedForm.getByRole("combobox", { name: "Result operation" })).toHaveValue(
      "remove",
    )
    await expect(
      reopenedForm.getByRole("combobox", { name: "Target body" }).locator("option:checked"),
    ).toHaveText("Box 1")
  })

  test("persists a stable straight model-edge axis selected from the viewport", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawProfileAwayFromBothOriginAxes(page)
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await viewport
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await toolbar.getByRole("button", { name: "Revolve", exact: true }).click()

    const form = page.getByRole("form", { name: "Revolve profile" })
    const picker = viewport.getByRole("combobox", {
      name: "Select a Revolve axis with the keyboard",
    })
    const modelEdgeOption = picker
      .locator("option")
      .filter({ hasText: /^Box 1 · Edge \d+$/ })
      .first()
    await expect(modelEdgeOption).toBeAttached()
    const optionValue = await modelEdgeOption.getAttribute("value")
    if (!optionValue) throw new Error("The model-edge axis option has no value.")
    const selectedLabel = await modelEdgeOption.textContent()
    if (!selectedLabel) throw new Error("The model-edge axis option has no readable label.")
    await picker.selectOption(optionValue)
    await expect(form.getByText(selectedLabel, { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Create revolve" }).click()

    await expect(page.getByRole("treeitem", { name: "Revolve 1" })).toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole("treeitem", { name: "Revolve 1" }).click()
    await expect(
      page.getByRole("form", { name: "Edit revolve" }).getByText(selectedLabel, { exact: true }),
    ).toBeVisible()
  })
})
