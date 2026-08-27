import { expect, test } from "./fixtures"
import { confirmSketchPlane, drawRectangle } from "./sketch-helpers"

test.describe("selector-backed extrusion", () => {
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
    await expect(page.getByRole("button", { name: "Extrude selected profile" })).toBeEnabled()
    await page.getByRole("button", { name: "Extrude selected profile" }).click()
    const createForm = page.getByRole("form", { name: "Extrude profile" })
    await expect(createForm.getByText("Sketch 1", { exact: true })).toBeVisible()
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
    await page.getByRole("button", { name: "Extrude selected profile" }).click()
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
    await page.getByRole("button", { name: "Extrude selected profile" }).click()
    await page
      .getByRole("form", { name: "Extrude profile" })
      .getByRole("button", { name: "Create extrusion" })
      .click()

    const viewport = page.getByRole("region", { name: "3D viewport" })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "1", {
      timeout: 120_000,
    })
    await startPanel.getByRole("button", { name: "Create sketch" }).click()
    await expect(viewport).toHaveAttribute("data-origin-plane-selection", /xy|xz|yz/)

    const canvas = viewport.locator("canvas")
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The geometry canvas has no measurable bounds.")
    await canvas.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.5 } })

    const support = page.getByRole("combobox", { name: "Support plane" })
    await expect(support).toHaveValue("feature-face")
    await expect(support).toBeDisabled()
    await expect(page.getByRole("img", { name: "Editable sketch geometry" })).toBeVisible()
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
