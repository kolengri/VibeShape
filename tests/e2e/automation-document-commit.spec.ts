import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Locator, Page } from "@playwright/test"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import type { CommandActor } from "../../packages/domain/src/commands"
import { readVersionedVShape } from "../../packages/formats/src/vshape"
import { expect, test } from "./fixtures"

type BrowserAutomationFactory = {
  renameActiveProject: (revision: number, name: string) => Promise<{ ok: boolean }>
  createActiveDocumentAutomationSession: () =>
    | { ok: true; documentId: string; revision: number; host: AutomationHost; dispose: () => void }
    | { ok: false; diagnostic: { message: string } }
}
const paths = {
  controller: "/src/document/document-controller.ts",
  domain: `/@fs${resolve("packages/domain/src/index.ts")}`,
  persistence: `/@fs${resolve("packages/persistence/src/index.ts")}`,
  application: `/@fs${resolve("packages/application/src/persistent-document-session.ts")}`,
}

async function disconnectDuringReview(page: Page, review: Locator) {
  await page.evaluate(() =>
    (
      globalThis as unknown as { __automationDisconnect?: { waitEntered: () => Promise<void> } }
    ).__automationDisconnect?.waitEntered(),
  )
  const apply = review.getByRole("button", { name: "Apply", exact: true })
  await expect(apply).toHaveAttribute("aria-busy", "true")
  await page.evaluate(() =>
    (
      globalThis as unknown as { __automationDisconnect?: { dispose: () => void } }
    ).__automationDisconnect?.dispose(),
  )
  await expect(page.getByText("cancelled", { exact: false })).toHaveCount(0)
  await page.evaluate(() =>
    (
      globalThis as unknown as { __automationDisconnect?: { release: () => void } }
    ).__automationDisconnect?.release(),
  )
}

const scenarios = {
  commit: "persists an automation draft as one undo transaction and reopens its native history",
  lease: "rejects an automation commit after another writer takes the lease",
  stale: "preserves a human edit made after an automation preview",
  failure: "releases the editor save lock after an unexpected automation persistence rejection",
  disconnect:
    "completes an automation commit when the automation session disconnects during persistence",
} as const

for (const mode of ["commit", "lease", "stale", "failure", "disconnect"] as const) {
  test(scenarios[mode], async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const committing = page.evaluate(
      async ({ paths, mode }) => {
        const app: BrowserAutomationFactory = await import(paths.controller)
        const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
        const connection = app.createActiveDocumentAutomationSession()
        if (!connection.ok) throw new Error(connection.diagnostic.message)
        const { host, documentId, revision } = connection
        const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
        const actor = domain.commandActorSchema.parse({
          type: "mcp",
          clientId: "org.vibeshape.persisted-test",
          sessionId: id(1),
        })
        try {
          const created = await host.createDraft(actor, {
            schemaVersion: 1,
            documentId,
            baseRevision: revision,
          })
          if (!created.ok) throw new Error(created.diagnostic.message)
          const operation = { schemaVersion: 1, draftId: created.value.draftId }
          const quantity = domain.createLengthQuantity
          const features = [
            {
              id: id(2),
              label: "AI box",
              type: domain.boxFeatureType.type,
              parameters: {
                width: quantity(10),
                depth: quantity(20),
                height: quantity(30),
                centered: false,
              },
            },
            {
              id: id(3),
              label: "AI cylinder",
              type: domain.cylinderFeatureType.type,
              parameters: { radius: quantity(5), height: quantity(10), centered: false },
            },
          ]
          for (const [index, feature] of features.entries()) {
            const applied = await host.applyCommand(actor, {
              ...operation,
              command: {
                schemaVersion: 1,
                kind: "org.vibeshape.feature.add",
                commandId: id(10 + index),
                documentId,
                baseRevision: revision + index,
                issuedAt: "2026-09-07T00:00:01Z",
                actor,
                payload: {
                  feature: {
                    schemaVersion: 0,
                    ...feature,
                    dependencies: [],
                    references: [],
                    suppressed: false,
                  },
                },
              },
            })
            if (!applied.ok) throw new Error(applied.diagnostic.message)
          }
          const preview = await host.previewDraft(actor, operation)
          if (!preview.ok) throw new Error(preview.diagnostic.message)
          async function introduceConcurrentChange() {
            if (mode === "lease") {
              const persistence: typeof import("../../packages/persistence/src/database") &
                typeof import("../../packages/persistence/src/lease") = await import(
                paths.persistence
              )
              const database = new persistence.VibeShapeDatabase("vibeshape-product-v0")
              try {
                const taken = await persistence.acquireDocumentLease(database, {
                  documentId,
                  ownerId: id(99),
                  nowMs: Date.now() + 120_000,
                  durationMs: 60_000,
                })
                if (!taken.ok) throw new Error(taken.diagnostic.message)
              } finally {
                database.close()
              }
            }
            if (mode === "stale") {
              const renamed = await app.renameActiveProject(revision, "Human edit retained")
              if (!renamed.ok) throw new Error("The human edit failed.")
            }
          }
          await introduceConcurrentChange()
          const application: typeof import("../../packages/application/src/persistent-document-session") =
            await import(paths.application)
          const originalCommit = application.PersistentDocumentSession.prototype.commitDraft
          if (mode === "failure")
            application.PersistentDocumentSession.prototype.commitDraft = async () => {
              throw new Error("Injected persistence rejection")
            }
          let releaseCommit: (() => void) | null = null
          if (mode === "disconnect") {
            let entered = false
            let resolveEntered = () => {}
            const enteredPromise = new Promise<void>((resolve) => {
              resolveEntered = resolve
            })
            const gate = new Promise<void>((resolve) => {
              releaseCommit = resolve
            })
            application.PersistentDocumentSession.prototype.commitDraft = async function (input) {
              entered = true
              resolveEntered()
              await gate
              return originalCommit.call(this, input)
            }
            ;(
              globalThis as unknown as {
                __automationDisconnect?: {
                  waitEntered: () => Promise<void>
                  isEntered: () => boolean
                  release: () => void
                  dispose: () => void
                }
              }
            ).__automationDisconnect = {
              waitEntered: () => enteredPromise,
              isEntered: () => entered,
              release: () => releaseCommit?.(),
              dispose: connection.dispose,
            }
          }
          const committed = await host.commitDraft(actor, operation).finally(() => {
            application.PersistentDocumentSession.prototype.commitDraft = originalCommit
            delete (globalThis as unknown as { __automationDisconnect?: unknown })
              .__automationDisconnect
          })
          return {
            preview: preview.value,
            committed,
            draftId: created.value.draftId,
            actor,
            revision,
          }
        } finally {
          ;(
            globalThis as unknown as { __automationDisconnect?: { release: () => void } }
          ).__automationDisconnect?.release()
          connection.dispose()
        }
      },
      { paths, mode },
    )
    if (mode !== "stale") {
      const review = page.getByRole("region", { name: "Review AI changes", exact: true })
      await expect(review).toBeVisible({ timeout: 30_000 })
      await review.getByRole("button", { name: "Apply", exact: true }).click()
      if (mode === "disconnect") {
        await disconnectDuringReview(page, review)
      }
    }
    const result = await committing
    expect(result.preview.geometry.status).toBe("valid")
    const box = page.getByRole("treeitem", { name: "AI box", exact: true })
    const cylinder = page.getByRole("treeitem", { name: "AI cylinder", exact: true })
    const viewport = page.getByRole("region", { name: "3D viewport" })
    const toolbar = page.getByRole("toolbar", { name: "Model commands" })
    if (mode !== "commit" && mode !== "disconnect") {
      await expectFailedAutomationCommit(page, mode, result.committed)
      return
    }
    expect(result.committed).toMatchObject({
      ok: true,
      value: { commandCount: 2, revision: result.revision + 2 },
    })
    await expect(box).toBeVisible()
    await expect(cylinder).toBeVisible()
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2")
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(box).toHaveCount(0)
    await expect(cylinder).toHaveCount(0)
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
    await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeDisabled()
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(box).toBeVisible()
    await expect(cylinder).toBeVisible()
    await page.reload()
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(viewport).toHaveAttribute("data-rendered-feature-count", "2", { timeout: 30_000 })
    await expect(box).toBeVisible()
    await expect(cylinder).toBeVisible()
    await expectNativeAutomationTransaction(page, result.draftId, result.actor)
  })
}

async function expectFailedAutomationCommit(
  page: Page,
  mode: "lease" | "stale" | "failure",
  committed: unknown,
) {
  const box = page.getByRole("treeitem", { name: "AI box", exact: true })
  const cylinder = page.getByRole("treeitem", { name: "AI cylinder", exact: true })
  const viewport = page.getByRole("region", { name: "3D viewport" })
  const toolbar = page.getByRole("toolbar", { name: "Model commands" })
  expect(committed).toMatchObject({
    ok: false,
    diagnostic: {
      code: {
        lease: "document-write-unavailable",
        stale: "stale-revision",
        failure: "document-commit-failed",
      }[mode],
    },
  })
  await expect(box).toHaveCount(0)
  await expect(cylinder).toHaveCount(0)
  await expect(viewport).toHaveAttribute("data-rendered-feature-count", "0")
  if (mode === "lease")
    await expect(toolbar.getByRole("button", { name: "Box", exact: true })).toBeDisabled()
  if (mode !== "stale")
    await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeDisabled()
  if (mode === "failure") {
    const review = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(review.getByRole("status")).toContainText("save could not be confirmed")
    await review.getByRole("button", { name: "Close", exact: true }).click()
    await toolbar.getByRole("button", { name: "Box", exact: true }).click()
    await page
      .getByRole("form", { name: "Create box" })
      .getByRole("button", { name: "Create box", exact: true })
      .click()
    await expect(page.getByRole("treeitem", { name: "Box 1", exact: true })).toBeVisible()
  }
  await page.reload()
  await expect(box).toHaveCount(0)
  await expect(cylinder).toHaveCount(0)
  if (mode === "stale")
    await expect(page.getByText("Human edit retained", { exact: true })).toBeVisible()
}

async function expectNativeAutomationTransaction(page: Page, draftId: string, actor: CommandActor) {
  await page.getByRole("button", { name: "Project…" }).click()
  const projects = page.getByRole("dialog", { name: "Projects" })
  const downloading = page.waitForEvent("download")
  await projects.getByRole("button", { name: "Download .vshape" }).click()
  const file = await (await downloading).path()
  if (!file) throw new Error("The native project backup was not retained.")
  const archive = await readVersionedVShape(new Uint8Array(await readFile(file)))
  if (!archive.ok || archive.value.version !== 2)
    throw new Error("Expected a replay-validated versioned backup.")
  const events = archive.value.project.versionedEvents.filter(
    (event) => event.transactionId === draftId,
  )
  expect(events).toHaveLength(2)
  expect(events.map((event) => event.actor)).toEqual([actor, actor])
  expect(events.map((event) => event.commandId)).toEqual([
    "0195b5ac-b250-7a2c-8c33-000000000010",
    "0195b5ac-b250-7a2c-8c33-000000000011",
  ])
  expect(
    archive.value.project.versionedEvents.filter(
      (event) => event.type === "org.vibeshape.document.restored",
    ),
  ).toHaveLength(2)
}
