import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle, selectSketchTool } from "./sketch-helpers"

function extrudeCommand(page: Page) {
  return page
    .getByRole("toolbar", { name: "Model commands" })
    .getByRole("button", { name: "Extrude", exact: true })
}

async function drawTwoSeparatedProfiles(page: Page) {
  const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
  const bounds = await drawing.boundingBox()
  if (!bounds) throw new Error("The editable sketch canvas is not visible.")
  const rectangles = [
    [0.18, 0.62, 0.4, 0.38],
    [0.6, 0.62, 0.82, 0.38],
  ] as const
  for (const [startX, startY, endX, endY] of rectangles) {
    await selectSketchTool(page, "Rectangle tools", "Rectangle G")
    await page.mouse.click(bounds.x + bounds.width * startX, bounds.y + bounds.height * startY)
    await page.mouse.click(bounds.x + bounds.width * endX, bounds.y + bounds.height * endY)
  }
  await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(8)
}

async function clickSavedProfileInViewport(page: Page, label: string) {
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const canvas = viewport.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The 3D viewport canvas is not visible.")
  const status = viewport.getByText(`Select profile: ${label}`, { exact: true })
  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const position = {
        x: bounds.x + (bounds.width * column) / 12,
        y: bounds.y + (bounds.height * row) / 12,
      }
      await page.mouse.move(position.x, position.y)
      await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
      if (!(await status.isVisible())) continue
      await page.mouse.click(position.x, position.y)
      return
    }
  }
  throw new Error(`${label} was not pickable in the 3D viewport.`)
}

test.describe("selector-backed extrusion", () => {
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
    await drawTwoSeparatedProfiles(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "2", {
      timeout: 120_000,
    })
    const profilePicker = viewport.getByRole("combobox", { name: "Select saved profile" })
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await extrudeCommand(page).click()
    let form = page.getByRole("form", { name: "Extrude profile" })
    await expect(form.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()

    await clickSavedProfileInViewport(page, "Sketch 1 · Profile 2")
    await expect(form).toBeVisible()
    await expect(form.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Cancel" }).click()
    await expect(profilePicker).toHaveValue("")

    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await extrudeCommand(page).click()
    form = page.getByRole("form", { name: "Extrude profile" })
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 2" })
    await expect(form.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 120_000 })
    await form.getByRole("button", { name: "Create extrusion" }).click()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()

    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(editForm.getByText("Sketch 1 · Profile 2", { exact: true })).toBeVisible()
    await profilePicker.selectOption({ label: "Sketch 1 · Profile 1" })
    await expect(editForm).toBeVisible()
    await expect(editForm.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    await editForm.getByRole("button", { name: "Update extrusion" }).click()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    await expect(
      page
        .getByRole("form", { name: "Edit extrusion" })
        .getByText("Sketch 1 · Profile 1", { exact: true }),
    ).toBeVisible()
  })

  test("selects a saved profile through the compact picker after reload", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
      timeout: 120_000,
    })
    const profile = page.getByRole("combobox", { name: "Select saved profile" })
    await profile.focus()
    await expect(profile).toBeFocused()
    await profile.selectOption({ label: "Sketch 1 · Profile 1" })

    await expect(profile).toHaveValue(/.+/)
    await expect(viewport).toHaveAttribute("data-selected-sketch-profile", /.+/)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toHaveCount(0)
    await expect(
      page
        .getByRole("toolbar", { name: "Model commands" })
        .getByRole("button", { name: "Extrude", exact: true }),
    ).toBeEnabled()
  })

  test("selects a saved profile directly in the 3D viewport after reload", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.reload()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-profile-count", "1", {
      timeout: 120_000,
    })
    const extrudeCommand = page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Extrude", exact: true })
    await expect(extrudeCommand).toBeDisabled()
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    const samples = [
      { x: bounds.width * 0.5, y: bounds.height * 0.5 },
      { x: bounds.width * 0.45, y: bounds.height * 0.5 },
      { x: bounds.width * 0.55, y: bounds.height * 0.5 },
      { x: bounds.width * 0.5, y: bounds.height * 0.45 },
      { x: bounds.width * 0.5, y: bounds.height * 0.55 },
    ]
    let activeSample = samples[0]
    let sampleIndex = 0
    await expect
      .poll(async () => {
        activeSample = samples[sampleIndex % samples.length]
        sampleIndex += 1
        if (activeSample) await canvas.hover({ position: activeSample })
        return viewport.getAttribute("data-preselected-sketch-profile")
      })
      .not.toBeNull()
    if (!activeSample) throw new Error("The saved profile has no hover sample.")
    await expect(viewport.getByText("Select profile: Sketch 1 · Profile 1")).toBeVisible()
    await canvas.click({ position: activeSample })

    await expect(viewport).toHaveAttribute("data-selected-sketch-profile", /.+/)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Extrude selected profile" })).toHaveCount(0)
    await expect(extrudeCommand).toBeEnabled()
    await extrudeCommand.click()
    await expect(page.getByRole("form", { name: "Extrude profile" })).toBeVisible()
  })

  test("creates, rebuilds, edits, and reopens a variable-driven solid", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })
    await expect(startPanel.getByRole("heading", { name: "Start with a sketch" })).toBeVisible()

    await page.getByRole("treeitem", { name: "Variables" }).click()
    await page.getByRole("button", { name: "Add variable" }).click()
    await page.getByRole("textbox", { name: "Variable name" }).fill("depth")
    await page.getByRole("combobox", { name: "Variable expression" }).fill("18 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()

    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xz")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Sketch 1" })).toBeVisible()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1", {
      timeout: 120_000,
    })
    await expect(viewport.locator('[data-plane-symbol="XY"]')).toBeVisible()
    await expect(viewport.locator('[data-plane-symbol="XZ"]')).toBeVisible()
    await expect(viewport.locator('[data-plane-symbol="YZ"]')).toBeVisible()
    await page.getByRole("button", { name: "Hide Sketch 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "0")
    await page.getByRole("button", { name: "Show Sketch 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-sketch-count", "1")
    await page
      .getByRole("combobox", { name: "Select saved profile" })
      .selectOption({ label: "Sketch 1 · Profile 1" })
    await expect(page.getByRole("button", { name: "Extrude selected profile" })).toHaveCount(0)
    await expect(extrudeCommand(page)).toBeEnabled()
    await extrudeCommand(page).click()
    const createForm = page.getByRole("form", { name: "Extrude profile" })
    await expect(createForm.getByText("Sketch 1 · Profile 1", { exact: true })).toBeVisible()
    await createForm.getByRole("combobox", { name: "Distance" }).fill("#depth")
    await createForm.getByRole("checkbox", { name: "Extrude symmetrically" }).check()
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await expect(page.getByText("Unsaved extrusion preview", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).not.toBeVisible()
    await createForm.getByRole("button", { name: "Create extrusion" }).dblclick()

    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    const normalSketchViewport = page.locator("section[data-sketch-context-mode='normal']")
    await expect(normalSketchViewport).toHaveAttribute("data-rendered-feature-count", "0")
    await expect(normalSketchViewport).toHaveAttribute("data-rendered-sketch-count", "0")
    const rollbackGuidance = page.getByTestId("sketch-rollback-guidance")
    await expect(rollbackGuidance).toContainText(
      "No earlier solid exists at this point in History.",
    )
    const showFinalResult = rollbackGuidance.getByRole("button", { name: "Show final result" })
    await showFinalResult.focus()
    await page.keyboard.press("Enter")
    await expect(rollbackGuidance).toHaveCount(0)
    await expect(
      page.getByTestId("sketch-final-context-status").getByRole("button", {
        name: "Hide final result",
      }),
    ).toBeFocused()
    await expect(page.getByTestId("sketch-final-context-status")).toContainText(
      "Final result · display only",
    )
    await expect(normalSketchViewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(normalSketchViewport).toHaveAttribute("data-sketch-reference-candidate-count", "0")
    await expect(
      page.getByRole("button", { name: "Use external geometry", exact: true }),
    ).toHaveCount(0)
    await page.getByRole("button", { name: "Replace support" }).click()
    await expect(page.getByRole("heading", { name: "Replace sketch support" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByTestId("sketch-final-context-status")).toContainText(
      "Final result · display only",
    )
    await expect(normalSketchViewport).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    const orbitSketchViewport = page.locator("section[data-sketch-context-mode='orbit']")
    await expect(orbitSketchViewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(orbitSketchViewport).toHaveAttribute("data-rendered-sketch-count", "1")
    await page.getByRole("button", { name: "Show final result", exact: true }).click()
    await expect(page.getByTestId("sketch-final-context-status")).toHaveCount(0)
    await expect(orbitSketchViewport).toHaveAttribute("data-rendered-feature-count", "0")
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()

    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(editForm.getByRole("combobox", { name: "Distance" })).toHaveValue("#depth")
    await expect(editForm.getByRole("checkbox", { name: "Extrude symmetrically" })).toBeChecked()
    await editForm.getByRole("combobox", { name: "Distance" }).fill("21 mm")
    await expect(viewport).toHaveAttribute("data-preview-status", "ready", {
      timeout: 120_000,
    })
    await expect(viewport).toHaveAttribute("data-preview-feature-count", "1")
    await editForm.getByRole("button", { name: "Cancel" }).click()
    await expect(viewport).toHaveAttribute("data-preview-status", "idle")

    await page.getByRole("treeitem", { name: "Variables" }).click()
    const expression = page.getByRole("combobox", { name: "Variable expression" })
    await expression.fill("24 mm")
    await page.getByRole("button", { name: "Apply variables" }).dblclick()
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Model", exact: true })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })

    await page.reload()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Variables" }).click()
    await expect(page.getByRole("combobox", { name: "Variable expression" })).toHaveValue("24 mm")
    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const reopenedForm = page.getByRole("form", { name: "Edit extrusion" })
    await expect(reopenedForm.getByRole("combobox", { name: "Distance" })).toHaveValue("#depth")
    await expect(
      reopenedForm.getByRole("checkbox", { name: "Extrude symmetrically" }),
    ).toBeChecked()
  })

  test("creates a separate colored body from a selected planar model face", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    const boxForm = page.getByRole("form", { name: "Create box" })
    await boxForm.getByRole("button", { name: "Create box" }).click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    const statusBar = page.locator("footer[role='status']")
    const faceSamples = [
      { x: bounds.width * 0.4, y: bounds.height * 0.55 },
      { x: bounds.width * 0.6, y: bounds.height * 0.55 },
      { x: bounds.width * 0.5, y: bounds.height * 0.3 },
    ]
    let sampleIndex = 0
    await expect
      .poll(async () => {
        await canvas.click({
          position: faceSamples[sampleIndex % faceSamples.length] as (typeof faceSamples)[number],
        })
        sampleIndex += 1
        return statusBar.textContent()
      })
      .toMatch(/Selection: Box 1 · Face \d+/)

    await page
      .getByRole("complementary", { name: "Task panel" })
      .getByRole("button", { name: "Create sketch" })
      .click()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Support plane" })).toHaveValue("feature-face")
    await expect(page.getByRole("combobox", { name: "Support plane" })).toBeDisabled()

    await drawRectangle(page)
    await page
      .getByRole("toolbar", { name: "Model commands" })
      .getByRole("button", { name: "Extrude", exact: true })
      .click()
    const extrusionForm = page.getByRole("form", { name: "Extrude profile" })
    await expect(extrusionForm).toBeVisible()
    await extrusionForm.getByRole("button", { name: "Create extrusion" }).click()

    await expect(page.getByRole("treeitem", { name: "Box 1" })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Extrusion 1" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })

    await page.getByRole("button", { name: "Hide Box 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("button", { name: "Show Box 1" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")

    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    const sketchContext = page.locator("section[data-sketch-context-mode='normal']")
    await expect(sketchContext).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(page.getByTestId("sketch-rollback-guidance")).toHaveCount(0)
    await page.getByRole("button", { name: "Hide Box 1" }).click()
    await expect(sketchContext).toHaveAttribute("data-rendered-feature-count", "0")
    await page.getByRole("button", { name: "Show Box 1" }).click()
    await expect(sketchContext).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("button", { name: "Use external geometry", exact: true }).click()
    const normalCandidateCount = await sketchContext.getAttribute(
      "data-sketch-reference-candidate-count",
    )
    expect(Number(normalCandidateCount)).toBeGreaterThan(0)
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    const orbitContext = page.locator("section[data-sketch-context-mode='orbit']")
    await expect(orbitContext).toHaveAttribute("data-rendered-feature-count", "1")
    const referenceSelect = page.getByRole("combobox", {
      name: "Select a reference with the keyboard",
    })
    const rollbackCandidateLabels = await referenceSelect.locator("option").allTextContents()
    await page.getByRole("button", { name: "Show final result", exact: true }).click()
    await expect(orbitContext).toHaveAttribute("data-rendered-feature-count", "2")
    await expect(orbitContext).toHaveAttribute(
      "data-sketch-reference-candidate-count",
      normalCandidateCount ?? "0",
    )
    await expect(referenceSelect.locator("option")).toHaveText(rollbackCandidateLabels)
    await page.getByRole("button", { name: "Show final result", exact: true }).click()
    await expect(orbitContext).toHaveAttribute("data-rendered-feature-count", "1")
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await page.getByRole("button", { name: "Finish sketch", exact: true }).click()
  })

  test("starts a sketch from an extrusion cap during support selection", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })

    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await extrudeCommand(page).click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    await canvas.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.5 } })
    const statusBar = page.locator("footer[role='status']")
    await expect(statusBar).toContainText(/Selection: Extrusion 1 · Face \d+/)
    const selectedFaceLabel = (await statusBar.textContent())?.match(/Extrusion 1 · Face \d+/)?.[0]
    if (!selectedFaceLabel) throw new Error("The selected extrusion face has no readable label.")

    await startPanel.getByRole("button", { name: "Create sketch" }).click()

    const support = page.getByRole("combobox", { name: "Support plane" })
    await expect(support).toHaveValue("feature-face")
    await expect(support).toBeDisabled()
    await expect(support).toContainText(selectedFaceLabel)
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
    const supportLabel = await support.locator("option:checked").textContent()
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 2" }).click()
    await expect(
      page.getByRole("combobox", { name: "Support plane" }).locator("option:checked"),
    ).toHaveText(supportLabel ?? "")
  })

  test("creates and rebuilds a sketch on a planar extrusion side", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const startPanel = page.getByRole("complementary", { name: "Task panel" })

    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await extrudeCommand(page).click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    await canvas.click({ position: { x: bounds.width * 0.72, y: bounds.height * 0.45 } })

    const support = page.getByRole("combobox", { name: "Support plane" })
    await expect(support).toHaveValue("feature-face")
    const sideLabel = await support.locator("option:checked").textContent()
    if (!sideLabel) throw new Error("The planar extrusion side has no readable label.")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 2" }).click()
    await expect(support.locator("option:checked")).toHaveText(sideLabel)
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    await expect(page.locator("section[data-sketch-context-mode='orbit']")).toHaveAttribute(
      "data-rendered-sketch-count",
      "2",
    )
    await page.getByRole("button", { name: "Normal to sketch", exact: true }).click()
    await page.getByRole("button", { name: "Finish sketch" }).click()

    await extrudeCommand(page).click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })

    await page.getByRole("treeitem", { name: "Extrusion 1" }).click()
    const editForm = page.getByRole("form", { name: "Edit extrusion" })
    await editForm.getByRole("combobox", { name: "Distance" }).fill("20 mm")
    await editForm.getByRole("button", { name: "Update extrusion" }).click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
    await page.getByRole("treeitem", { name: "Sketch 2" }).click()
    await page.getByRole("button", { name: "Edit sketch", exact: true }).click()
    await expect(support.locator("option:checked")).toHaveText(sideLabel)
    await page.getByRole("button", { name: "Orbit 3D view", exact: true }).click()
    await expect(page.locator("section[data-sketch-context-mode='orbit']")).toHaveAttribute(
      "data-rendered-sketch-count",
      "2",
    )
  })

  test("chooses an exact sketch support when model faces overlap", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    const startPanel = page.getByRole("complementary", { name: "Task panel" })
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box" })
      .click()
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await extrudeCommand(page).click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", {
      timeout: 120_000,
    })
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    const chooser = page.getByRole("listbox", { name: "Select sketch support" })
    let foundOverlap = false
    for (let row = 3; row < 15 && !foundOverlap; row += 1) {
      for (let column = 4; column < 20 && !foundOverlap; column += 1) {
        await page.mouse.move(
          bounds.x + (bounds.width * column) / 24,
          bounds.y + (bounds.height * row) / 18,
        )
        await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve()))")
        await page.keyboard.press("Backquote")
        foundOverlap = await chooser.isVisible()
      }
    }
    expect(foundOverlap).toBe(true)

    const extrusionFace = chooser.getByRole("option", { name: /Extrusion 1 · Face \d+/ }).first()
    await expect(extrusionFace).toBeVisible()
    await extrusionFace.hover()
    await expect(page.getByText(/Click to sketch on Extrusion 1 · Face \d+/)).toBeVisible()
    await extrusionFace.click()

    const support = page.getByRole("combobox", { name: "Support plane" })
    await expect(support.locator("option:checked")).toHaveText(/Extrusion 1 · Face \d+/)
    await drawRectangle(page)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 2" }).click()
    await expect(support.locator("option:checked")).toHaveText(/Extrusion 1 · Face \d+/)
  })

  test("replaces an existing sketch support graphically without recreating its geometry", async ({
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
    const taskPanel = page.getByRole("complementary", { name: "Task panel" })
    await taskPanel.getByRole("button", { name: "Create sketch" }).click()
    await confirmSketchPlane(page, "xy")
    await drawRectangle(page)
    const drawing = page.getByRole("img", { name: "Editable sketch geometry" })
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await toolbar.getByRole("button", { name: "Cylinder", exact: true }).click()
    await page
      .getByRole("form", { name: "Create cylinder" })
      .getByRole("button", { name: "Create cylinder" })
      .click()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()

    const support = page.getByRole("combobox", { name: "Support plane" })
    await expect(support).toHaveValue("xy")
    await page.getByRole("button", { name: "Replace support" }).click()
    await expect(page.getByRole("heading", { name: "Replace sketch support" })).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1")
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toHaveCount(0)

    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(support).toHaveValue("xy")
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)

    await page.getByRole("button", { name: "Replace support" }).click()
    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    const samples = [
      { x: bounds.width * 0.5, y: bounds.height * 0.5 },
      { x: bounds.width * 0.45, y: bounds.height * 0.55 },
      { x: bounds.width * 0.55, y: bounds.height * 0.55 },
    ]
    let sampleIndex = 0
    await expect
      .poll(async () => {
        const sample = samples[sampleIndex % samples.length]
        if (!sample) throw new Error("A support-selection sample must be available.")
        await canvas.click({ position: sample })
        sampleIndex += 1
        return support.count()
      })
      .toBe(1)

    await expect(support).toHaveValue("feature-face")
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
    await page.getByRole("button", { name: "Finish sketch" }).click()
    await page.getByRole("treeitem", { name: "Sketch 1" }).click()
    await expect(support).toHaveValue("feature-face")
    await expect(drawing.locator('[data-sketch-entity-type="line"]')).toHaveCount(4)
  })
})
