import { writeFile } from "node:fs/promises"
import {
  applyDocumentCommand,
  createLengthQuantity,
  documentCommandSchema,
  extrusionFeatureType,
  featureRecordSchema,
} from "../../packages/domain/src"
import { writeVShape } from "../../packages/formats/src/vshape"
import { createLoftV3Project, loftFixtureId as id } from "../support/loft-v3-fixture"
import { openApplicationMenuItem } from "./application-menu-support"
import { saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"
import { expandHistoryDetails } from "./model-command-support"

async function brokenProfileArchive() {
  const fixture = createLoftV3Project()
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(777),
    type: extrusionFeatureType.type,
    label: "Broken profile extrusion",
    parameters: {
      profile: { ...fixture.sections[0], outerBoundaryEntityIds: [id(7777)] },
      distance: createLengthQuantity(15),
      symmetric: false,
      operation: "new",
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const applied = applyDocumentCommand(
    fixture.snapshot,
    documentCommandSchema.parse({
      schemaVersion: 1,
      kind: "org.vibeshape.feature.add",
      commandId: id(9988),
      documentId: fixture.snapshot.id,
      baseRevision: fixture.snapshot.revision,
      issuedAt: "2026-10-04T00:00:00Z",
      actor: { type: "user", userId: null },
      payload: { feature },
    }),
  )
  if (!applied.ok) throw new Error(applied.diagnostic.message)
  const archive = await writeVShape({
    snapshot: applied.snapshot,
    events: [...fixture.events, applied.event],
    exportedAt: "2026-10-04T00:00:00Z",
    createdBy: { application: "VibeShape diagnostic fixture", version: "1", build: null },
    engine: null,
  })
  if (!archive.ok) throw new Error(archive.diagnostic.message)
  return archive.value
}

test("explains an actual missing Extrude profile, retains raw details and keeps a collapsed-panel fallback", async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const archive = await brokenProfileArchive()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await saved(page)
  await openApplicationMenuItem(page, "Files and projects…")
  await page
    .getByRole("dialog", { name: "Projects", exact: true })
    .getByLabel("Choose VibeShape project file")
    .setInputFiles({
      name: "missing-profile.vshape",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(archive),
    })
  await saved(page)
  await expandHistoryDetails(page)
  await page.getByRole("treeitem", { name: "Broken profile extrusion", exact: true }).click()
  const form = page.getByRole("form", { name: "Edit extrusion", exact: true })
  const error = page.getByRole("alert", { name: "Cannot evaluate this operation", exact: true })
  await expect(error).toContainText("The selected sketch profile no longer exists.")
  await expect(error).toContainText(
    "Restore a closed region in the sketch, or select another profile.",
  )
  await expect(error).toContainText("Lower section")
  await expect(page.getByRole("alert")).toHaveCount(1)
  await expect(form.getByRole("button", { name: "Update extrusion", exact: true })).toBeDisabled()
  await expect(form.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled()
  const summary = error.getByText("Technical details", { exact: true })
  await summary.focus()
  await page.keyboard.press("Enter")
  await expect(error.locator("details")).toHaveAttribute("open", "")
  await expect(error.locator("pre")).toContainText("org.vibeshape.feature.sketch-profile-missing")
  await expect(error).toBeInViewport()
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("extrusion-error-details.png"),
  })
  await page.setViewportSize({ width: 900, height: 900 })
  await page.getByRole("button", { name: "Collapse task panel", exact: true }).click()
  await expect(error).toBeHidden()
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Preview unavailable. Open the task panel for details." }),
  ).toBeVisible()
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("extrusion-error-collapsed.png"),
  })
  const layout = await page.evaluate(`(() => {
    const ancestry = (selector) => {
      const result = []
      let node = document.querySelector(selector)
      while (node instanceof HTMLElement) {
        const bounds = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        result.push({
          tag: node.tagName,
          class: node.className,
          x: bounds.x,
          width: bounds.width,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollLeft: node.scrollLeft,
          overflowX: style.overflowX,
          minWidth: style.minWidth,
          display: style.display,
          gridColumns: style.gridTemplateColumns,
        })
        node = node.parentElement
      }
      return result
    }
    return {
      scrollX: window.scrollX,
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewport: ancestry('[aria-label="3D viewport"] [role="status"]'),
      history: ancestry('[role="treeitem"][aria-selected="true"]'),
      error: ancestry('[role="alert"]'),
    }
  })()`)
  const layoutPath = info.outputPath("collapsed-error-layout.json")
  await writeFile(layoutPath, JSON.stringify(layout, null, 2))
  await info.attach("collapsed-error-layout", { contentType: "application/json", path: layoutPath })
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Preview unavailable. Open the task panel for details." }),
  ).toBeInViewport()

  await page.getByRole("button", { name: "Open task panel", exact: true }).click()
  await expect(error).toBeVisible()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(error).toHaveCount(0)
})
