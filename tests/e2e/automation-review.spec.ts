import { resolve } from "node:path"
import type { Page } from "@playwright/test"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import { expect, test } from "./fixtures"

type BrowserController = {
  renameActiveProject: (revision: number, name: string) => Promise<{ ok: boolean }>
  createActiveDocumentAutomationSession: () =>
    | { ok: true; documentId: string; revision: number; host: AutomationHost; dispose: () => void }
    | { ok: false; diagnostic: { message: string } }
}

const paths = {
  controller: "/src/document/document-controller.ts",
  reviews: "/src/automation/automation-review-controller.ts",
  domain: `/@fs${resolve("packages/domain/src/index.ts")}`,
}

async function inspectCompactReview(page: Page) {
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.locator("html").evaluate((element) => element.classList.add("dark"))
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("automation-review-dark.png"),
  })
  await page.locator("html").evaluate((element) => element.classList.remove("dark"))
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("automation-review-light.png"),
  })
  // This CSS viewport represents a 1024-pixel window at 200% browser zoom.
  await page.setViewportSize({ width: 512, height: 384 })
  await review.getByRole("button", { name: "Discard", exact: true }).scrollIntoViewIfNeeded()
  await expect(review.getByRole("button", { name: "Discard", exact: true })).toBeInViewport()
  await expect(review.getByRole("button", { name: "Apply", exact: true })).toBeInViewport()
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("automation-review-zoom.png"),
  })
}

for (const mode of ["discard", "human", "close", "approved-close"] as const) {
  test(`keeps the project unchanged when an automation review ends with ${mode}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    const committing = page.evaluate(
      async ({ paths, mode }) => {
        const app: BrowserController = await import(paths.controller)
        const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
        const reviews: typeof import("../../apps/web/src/automation/automation-review-controller") =
          await import(paths.reviews)
        const originalRequest = reviews.automationReviews.request
        let markApproved = () => {}
        const approved = new Promise<void>((resolve) => {
          markApproved = resolve
        })
        let release = () => {}
        const released = new Promise<void>((resolve) => {
          release = resolve
        })
        if (mode === "approved-close")
          reviews.automationReviews.request = async (owner, input) => {
            const decision = await originalRequest(owner, input)
            if (decision === "approved") {
              markApproved()
              await released
            }
            return decision
          }
        const connection = app.createActiveDocumentAutomationSession()
        if (!connection.ok) throw new Error(connection.diagnostic.message)
        const { host, documentId, revision } = connection
        Reflect.set(globalThis, "__automationReviewControl", {
          close: connection.dispose,
          revision,
          approved,
          release,
        })
        const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
        const actor = {
          type: "mcp",
          clientId: "org.example.review-client-for-a-detailed-local-cad-session",
          sessionId: id(1),
        }
        try {
          const created = await host.createDraft(actor, {
            schemaVersion: 1,
            documentId,
            baseRevision: revision,
          })
          if (!created.ok) throw new Error(created.diagnostic.message)
          const operation = { schemaVersion: 1, draftId: created.value.draftId }
          const applied = await host.applyCommand(actor, {
            ...operation,
            command: {
              schemaVersion: 1,
              kind: "org.vibeshape.feature.add",
              commandId: id(2),
              documentId,
              baseRevision: revision,
              issuedAt: "2026-09-07T00:00:01Z",
              actor,
              payload: {
                feature: {
                  schemaVersion: 0,
                  id: id(3),
                  label: "Review box",
                  type: domain.boxFeatureType.type,
                  parameters: {
                    width: domain.createLengthQuantity(10),
                    depth: domain.createLengthQuantity(20),
                    height: domain.createLengthQuantity(30),
                    centered: false,
                  },
                  dependencies: [],
                  references: [],
                  suppressed: false,
                },
              },
            },
          })
          if (!applied.ok) throw new Error(applied.diagnostic.message)
          const commit = await host.commitDraft(actor, operation)
          const retained = await host.previewDraft(actor, operation)
          return { commit, retained }
        } finally {
          release()
          reviews.automationReviews.request = originalRequest
          connection.dispose()
          Reflect.deleteProperty(globalThis, "__automationReviewControl")
        }
      },
      { paths, mode },
    )
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review).toBeVisible()
    await expect(review.getByText(/org.example.review-client/)).toBeVisible()
    await expect(review.getByText("6,000 mm³", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Review box", exact: true })).toHaveCount(0)
    if (mode === "discard") {
      await inspectCompactReview(page)
      await review.getByRole("button", { name: "Discard", exact: true }).click()
    } else {
      if (mode === "approved-close")
        await review.getByRole("button", { name: "Apply", exact: true }).click()
      await page.evaluate(
        async ({ mode, paths }) => {
          const control: {
            close: () => void
            revision: number
            approved: Promise<void>
            release: () => void
          } = Reflect.get(globalThis, "__automationReviewControl")
          if (mode === "approved-close") {
            await control.approved
            control.close()
            control.release()
          } else if (mode === "close") control.close()
          else {
            const app: BrowserController = await import(paths.controller)
            const result = await app.renameActiveProject(control.revision, "Human review edit")
            if (!result.ok) throw new Error("The human edit failed.")
          }
        },
        { mode, paths },
      )
    }
    const result = await committing
    expect(result.commit).toMatchObject({
      ok: false,
      diagnostic: { code: mode === "discard" ? "draft-review-rejected" : "draft-review-cancelled" },
    })
    if (mode === "discard") {
      expect(result.retained).toMatchObject({ ok: false, diagnostic: { code: "draft-not-found" } })
      await expect(review).toHaveCount(0)
    } else {
      await expect(review.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0)
      await review.getByRole("button", { name: "Close", exact: true }).click()
    }
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: "Review box", exact: true })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "0",
    )
    if (mode === "human")
      await expect(page.getByText("Human review edit", { exact: true })).toBeVisible()
  })
}
