import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import type { runSourceAssetsPersistenceEvidence } from "../../scripts/source-assets-persistence-evidence"

const path = `/@fs${resolve(import.meta.dirname, "../../scripts/source-assets-persistence-evidence.ts")}`
test("source publication, rollback, native backup and Redo survive IndexedDB restart", async ({
  page,
}) => {
  await page.route("**/source-assets-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Source asset persistence</title>",
    }),
  )
  await page.goto("/source-assets-evidence.html")
  const report = await page.evaluate(
    async ({ path, name }) => {
      const evidence: {
        runSourceAssetsPersistenceEvidence: typeof runSourceAssetsPersistenceEvidence
      } = await import(path)
      return evidence.runSourceAssetsPersistenceEvidence(name)
    },
    { path, name: `source-assets-${test.info().project.name}` },
  )
  expect(report).toEqual({
    authoredTransaction: true,
    publication: true,
    quotaRollback: true,
    staleRejected: true,
    restarted: true,
    nativeUndoRedo: true,
    corruptRejected: true,
    unsupportedRejected: true,
    migration: true,
    schemaVersion: 4,
  })
})
