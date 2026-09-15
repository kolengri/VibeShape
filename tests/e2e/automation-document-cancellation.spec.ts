import { resolve } from "node:path"
import type { AutomationHost } from "../../packages/automation-host/src/host"
import { expect, test } from "./fixtures"

type BrowserAutomationFactory = {
  renameActiveProject: (revision: number, name: string) => Promise<{ ok: boolean }>
  createActiveDocumentAutomationSession: () =>
    | {
        ok: true
        documentId: string
        revision: number
        host: AutomationHost
        dispose: () => void
      }
    | { ok: false; diagnostic: { message: string } }
}

type WorkerSessionModule = typeof import("../../packages/document-worker/src/session-core")

const paths = {
  controller: "/src/document/document-controller.ts",
  domain: `/@fs${resolve("packages/domain/src/index.ts")}`,
  worker: `/@fs${resolve("packages/document-worker/src/session.ts")}`,
}

const cases = {
  dispose: "cancels a preview when the automation handle is disposed",
  human: "cancels a preview when a human revision supersedes it",
} as const

for (const mode of Object.keys(cases) as Array<keyof typeof cases>) {
  test(cases[mode], async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto("/")
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()

    const result = await page.evaluate(
      async ({ mode, paths }) => {
        const app: BrowserAutomationFactory = await import(paths.controller)
        const domain: typeof import("../../packages/domain/src/index") = await import(paths.domain)
        const worker: WorkerSessionModule = await import(paths.worker)
        function holdFirstRebuild(workerModule: WorkerSessionModule) {
          const originalRebuild = workerModule.DocumentWorkerSession.prototype.rebuild
          let first = true
          let enteredResolve: (() => void) | undefined
          const entered = new Promise<void>((resolve) => {
            enteredResolve = resolve
          })
          let releaseResolve: (() => void) | undefined
          const release = new Promise<void>((resolve) => {
            releaseResolve = resolve
          })
          let completedResolve: (() => void) | undefined
          const completed = new Promise<void>((resolve) => {
            completedResolve = resolve
          })
          workerModule.DocumentWorkerSession.prototype.rebuild = function (...args) {
            const response = originalRebuild.apply(this, args)
            if (!first) return response
            first = false
            return response.then(async (value) => {
              enteredResolve?.()
              await release
              completedResolve?.()
              return value
            })
          }
          return {
            entered,
            completed,
            release: () => releaseResolve?.(),
            restore: () => {
              workerModule.DocumentWorkerSession.prototype.rebuild = originalRebuild
            },
          }
        }
        async function seedDraft(
          host: AutomationHost,
          domainModule: typeof import("../../packages/domain/src/index"),
          actor: { type: string; clientId: string; sessionId: string },
          operation: { schemaVersion: number; draftId: string },
          documentId: string,
          revision: number,
          id: (n: number) => string,
        ) {
          const created = await host.createDraft(actor, {
            schemaVersion: 1,
            documentId,
            baseRevision: revision,
          })
          if (!created.ok || !created.value)
            throw new Error("The automation draft was not created.")
          operation.draftId = created.value.draftId
          const applied = await host.applyCommand(actor, {
            ...operation,
            command: {
              schemaVersion: 1,
              kind: "org.vibeshape.feature.add",
              commandId: id(3),
              documentId,
              baseRevision: revision,
              issuedAt: "2026-09-07T00:00:01Z",
              actor,
              payload: {
                feature: {
                  schemaVersion: 0,
                  id: id(4),
                  label: "AI box",
                  type: domainModule.boxFeatureType.type,
                  parameters: {
                    width: domainModule.createLengthQuantity(10),
                    depth: domainModule.createLengthQuantity(20),
                    height: domainModule.createLengthQuantity(30),
                    centered: false,
                  },
                  dependencies: [],
                  references: [],
                  suppressed: false,
                },
              },
            },
          })
          if (!applied.ok)
            throw new Error(applied.diagnostic?.message ?? "The draft command failed.")
        }
        const held = holdFirstRebuild(worker)

        const connection = app.createActiveDocumentAutomationSession()
        if (!connection.ok) {
          held.restore()
          throw new Error(connection.diagnostic.message)
        }
        const { host, documentId, revision } = connection
        const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
        const actor = { type: "mcp", clientId: "org.vibeshape.cancel-test", sessionId: id(1) }
        const operation = { schemaVersion: 1, draftId: id(2) }
        try {
          await seedDraft(host, domain, actor, operation, documentId, revision, id)

          const pendingPreview = host.previewDraft(actor, operation)
          await held.entered
          if (mode === "dispose") connection.dispose()
          else {
            const renamed = await app.renameActiveProject(revision, "Human update")
            if (!renamed.ok) throw new Error("The human edit failed.")
          }

          const settledBeforeRelease = await Promise.race([
            pendingPreview.then((value) => ({ settled: true, value })),
            new Promise<{ settled: false }>((resolve) =>
              setTimeout(() => resolve({ settled: false }), 2_000),
            ),
          ])
          if (!settledBeforeRelease.settled) throw new Error("The pending preview did not settle.")
          held.release()
          await held.completed
          const latePreview = await pendingPreview
          const committed = await host.commitDraft(actor, operation).catch((error: unknown) => ({
            ok: false as const,
            diagnostic: { code: "promise-rejected", message: String(error) },
          }))
          return { mode, settledBeforeRelease, latePreview, committed }
        } finally {
          held.release()
          held.restore()
          connection.dispose()
        }
      },
      { mode, paths },
    )

    expect(result.settledBeforeRelease.settled).toBe(true)
    expect(result.settledBeforeRelease.value).toMatchObject({
      ok: false,
      diagnostic: { code: "automation-operation-failed" },
    })
    expect(result.latePreview).toEqual(result.settledBeforeRelease.value)
    expect(result.committed.ok).toBe(false)
    await expect(page.getByRole("treeitem", { name: "AI box", exact: true })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
      "data-rendered-feature-count",
      "0",
    )
    if (mode === "dispose") {
      if (result.committed.ok)
        throw new Error("The disposed automation draft unexpectedly committed.")
      expect(result.committed.diagnostic.code).toBe("draft-review-cancelled")
      await expect(
        page
          .getByRole("toolbar", { name: "Model commands" })
          .getByRole("button", { name: "Undo", exact: true }),
      ).toBeDisabled()
    } else {
      expect(result.committed).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
      await expect(page.getByText("Human update", { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
      await expect(page.getByText("Human update", { exact: true })).toBeVisible()
      await expect(page.getByRole("treeitem", { name: "AI box", exact: true })).toHaveCount(0)
      await expect(page.getByRole("region", { name: "3D viewport" })).toHaveAttribute(
        "data-rendered-feature-count",
        "0",
      )
    }
  })
}
