import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const root = resolve(import.meta.dirname, "../..")

test("native backup worker reads a persisted revision without blocking the page or changing authority", async ({
  page,
}) => {
  await page.route("**/backup-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Backup evidence</title>",
    }),
  )
  await page.goto("/backup-evidence.html")
  const report = await page.evaluate(async (root) => {
    const persistence: typeof import("../../packages/persistence/src/database") &
      typeof import("../../packages/persistence/src/versioned-repository") = await import(
      `/@fs${root}/packages/persistence/src/index.ts`
    )
    const fixtureModule: typeof import("../../scripts/authority-persistence-fixture") =
      await import(`/@fs${root}/scripts/authority-persistence-fixture.ts`)
    const client: typeof import("../../apps/web/src/document/project-backup-client") = await import(
      `/@fs${root}/apps/web/src/document/project-backup-client.ts`
    )
    const formats: typeof import("../../packages/formats/src/vshape") = await import(
      `/@fs${root}/packages/formats/src/vshape.ts`
    )
    const database = new persistence.VibeShapeDatabase(`backup-worker-${crypto.randomUUID()}`)
    try {
      const { created, added, upgraded, renamed } = fixtureModule.authorityFixture()
      const portable = {
        snapshot: renamed.snapshot,
        seed: null,
        legacyEvents: [],
        versionedEvents: [created.event, added.event, upgraded.event, renamed.event],
        historyMode: "complete",
        promotionRevision: 0,
        upgradeRevision: upgraded.snapshot.revision,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }
      const repository = new persistence.VersionedLocalDocumentRepository(database)
      const stored = await repository.copyPortableProjectV3({
        ...portable,
        copiedAt: fixtureModule.authorityTimestamp,
      })
      if (!stored.ok) throw new Error(stored.diagnostic.message)
      const headBefore = await database.projectsV1.get(renamed.snapshot.id)
      let ticks = 0
      const timer = setInterval(() => ticks++, 0)
      let backup: Awaited<ReturnType<typeof client.exportProjectBackup>>
      try {
        backup = await client.exportProjectBackup({
          databaseName: database.name,
          documentId: renamed.snapshot.id,
          revision: renamed.snapshot.revision,
        })
      } finally {
        clearInterval(timer)
      }
      if (!backup.ok) throw new Error(backup.diagnostic.message)
      const decoded = await formats.readVShapeV3(backup.file)
      if (!decoded.ok) throw new Error(decoded.diagnostic.message)
      const stale = await client.exportProjectBackup({
        databaseName: database.name,
        documentId: renamed.snapshot.id,
        revision: renamed.snapshot.revision - 1,
      })
      return {
        ticks,
        snapshot: decoded.value.snapshot,
        expectedSnapshot: renamed.snapshot,
        events: decoded.value.versionedEvents,
        expectedEvents: portable.versionedEvents,
        historyMode: decoded.value.manifest.historyMode,
        stale,
        headUnchanged:
          JSON.stringify(await database.projectsV1.get(renamed.snapshot.id)) ===
          JSON.stringify(headBefore),
      }
    } finally {
      await database.delete()
    }
  }, root)
  expect(report.ticks).toBeGreaterThan(0)
  expect(report.snapshot).toEqual(report.expectedSnapshot)
  expect(report.events).toEqual(report.expectedEvents)
  expect(report.historyMode).toBe("complete")
  expect(report.stale).toMatchObject({
    ok: false,
    diagnostic: { code: "project-action-blocked" },
  })
  expect(report.headUnchanged).toBe(true)
})
