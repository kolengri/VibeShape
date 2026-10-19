import type { Page } from "@playwright/test"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import { expect, test } from "./fixtures"

type BrowserController = {
  createActiveDocumentAutomationSession: () =>
    | { ok: true; documentId: string; revision: number; host: AutomationHost; dispose: () => void }
    | { ok: false; diagnostic: { message: string } }
}

function proposeLongReview(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/document/document-controller.ts"
    const app: BrowserController = await import(path)
    const session = app.createActiveDocumentAutomationSession()
    if (!session.ok) throw new Error(session.diagnostic.message)
    const { host, documentId, revision } = session
    const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
    const actor = { type: "mcp" as const, clientId: "org.example.long-review", sessionId: id(1) }
    try {
      const created = await host.createDraft(actor, {
        schemaVersion: 1,
        documentId,
        baseRevision: revision,
      })
      if (!created.ok) throw new Error(created.diagnostic.message)
      const operation = { schemaVersion: 1, draftId: created.value.draftId }
      for (let index = 0; index < 12; index++) {
        const result = await host.applyCommand(actor, {
          ...operation,
          command: {
            schemaVersion: 1,
            kind: "org.vibeshape.document.rename",
            commandId: id(10 + index),
            documentId,
            baseRevision: revision + index,
            issuedAt: "2026-10-03T00:00:00Z",
            actor,
            payload: { name: `Detailed review with long explanatory project name ${index + 1}` },
          },
        })
        if (!result.ok) throw new Error(result.diagnostic.message)
      }
      const destructive = await host.applyCommand(actor, {
        ...operation,
        command: {
          schemaVersion: 1,
          kind: "org.vibeshape.variable.replace-table",
          commandId: id(30),
          documentId,
          baseRevision: revision + 12,
          issuedAt: "2026-10-03T00:00:00Z",
          actor,
          payload: {
            variables: [{ schemaVersion: 0, id: id(31), name: "reviewWidth", expression: "10 mm" }],
          },
        },
      })
      if (!destructive.ok) throw new Error(destructive.diagnostic.message)
      return await host.commitDraft(actor, operation)
    } finally {
      session.dispose()
    }
  })
}

test("long AI reviews keep consent controls visible and details scrollable in short and narrow windows", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  const committing = proposeLongReview(page)
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Untitled project", { exact: true })).toBeVisible()
  for (const [width, height] of [
    [1366, 500],
    [1024, 600],
    [512, 384],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const name of ["Apply", "Discard"]) {
      const button = review.getByRole("button", { name, exact: true })
      await expect(button).toBeInViewport({ ratio: 1 })
      await expect(button).toBeEnabled()
      await button.click({ trial: true })
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    if (width === 1366)
      await page.screenshot({ path: test.info().outputPath("long-review-short-window.png") })
  }
  const details = review.getByRole("region", { name: "Proposed changes", exact: true })
  await details.focus()
  await page.keyboard.press("End")
  await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(
    review.getByText(
      "This review includes a destructive document change. Confirm it before applying.",
      { exact: true },
    ),
  ).toBeInViewport()
  await expect(review.getByRole("button", { name: "Apply", exact: true })).toBeInViewport({
    ratio: 1,
  })
  await page.screenshot({ path: test.info().outputPath("long-review-mobile.png") })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({
    ratio: 1,
  })
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(review).toBeVisible()
  await review.getByRole("button", { name: "Discard", exact: true }).click()
  expect(await committing).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-review-rejected" },
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await expect(
    page
      .getByRole("status", { name: "Project save status", exact: true })
      .filter({ hasText: /^Saved$/ }),
  ).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("Untitled project", { exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Review AI changes", exact: true })).toHaveCount(0)
})
