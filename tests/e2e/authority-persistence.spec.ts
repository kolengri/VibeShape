import { resolve } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import type {
  prepareAuthorityTab,
  runAuthorityPersistenceEvidence,
  takeOverAuthorityTab,
  verifyStaleAuthorityTab,
} from "../../scripts/authority-persistence-evidence"

type AuthorityEvidence = {
  runAuthorityPersistenceEvidence: typeof runAuthorityPersistenceEvidence
  prepareAuthorityTab: typeof prepareAuthorityTab
  takeOverAuthorityTab: typeof takeOverAuthorityTab
  verifyStaleAuthorityTab: typeof verifyStaleAuthorityTab
}

const modulePath = `/@fs${resolve(import.meta.dirname, "../../scripts/authority-persistence-evidence.ts")}`

async function openEvidencePage(page: Page) {
  await page.route("**/authority-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Authority persistence evidence</title>",
    }),
  )
  await page.goto("/authority-evidence.html")
}

test("authored authority preserves journals, rolls back failures, and reopens portable history", async ({
  page,
}) => {
  await openEvidencePage(page)
  const report = await page.evaluate(
    async ({ path, name }) => {
      const evidence: AuthorityEvidence = await import(path)
      return evidence.runAuthorityPersistenceEvidence(name)
    },
    { path: modulePath, name: `authority-evidence-${test.info().project.name}` },
  )
  expect(report).toEqual({
    rollback: true,
    oldWriterBarrier: true,
    recovery: true,
    unsupported: true,
    portable: true,
    checkpoint: true,
    draftRace: true,
    legacyBridge: true,
    schemaVersion: 3,
  })
})

test("a separate tab can take over an expired V2 lease without permitting stale writes", async ({
  page,
  context,
}) => {
  await openEvidencePage(page)
  const name = `authority-tabs-${test.info().project.name}`
  expect(
    await page.evaluate(
      async ({ path, name }) => {
        const evidence: AuthorityEvidence = await import(path)
        return evidence.prepareAuthorityTab(name)
      },
      { path: modulePath, name },
    ),
  ).toBe(true)
  const second = await context.newPage()
  await openEvidencePage(second)
  expect(
    await second.evaluate(
      async ({ path, name }) => {
        const evidence: AuthorityEvidence = await import(path)
        return evidence.takeOverAuthorityTab(name)
      },
      { path: modulePath, name },
    ),
  ).toBe(2)
  expect(
    await page.evaluate(
      async ({ path, name }) => {
        const evidence: AuthorityEvidence = await import(path)
        return evidence.verifyStaleAuthorityTab(name)
      },
      { path: modulePath, name },
    ),
  ).toBe(true)
})
