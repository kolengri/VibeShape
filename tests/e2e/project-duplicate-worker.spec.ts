import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test("saved-project preparation recovers IndexedDB in a worker and publishes only through the repository", async ({
  page,
}) => {
  await page.route("**/duplicate-worker-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Project copy preparation</title>",
    }),
  )
  await page.goto("/duplicate-worker-evidence.html")
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const evidence = await page.evaluate(
    async (root) => {
      const fixtures: typeof import("../../scripts/authority-persistence-fixture") = await import(
        `/@fs${root}/scripts/authority-persistence-fixture.ts`
      )
      const persistence: typeof import("../../packages/persistence/src/database") &
        typeof import("../../packages/persistence/src/versioned-repository") = await import(
        `/@fs${root}/packages/persistence/src/index.ts`
      )
      const identifiers: typeof import("../../packages/domain/src/identifiers") = await import(
        `/@fs${root}/packages/domain/src/identifiers.ts`
      )
      const client: typeof import("../../apps/web/src/document/project-import-client") =
        await import(`/@fs${root}/apps/web/src/document/project-import-client.ts`)
      const { created, added, upgraded, renamed } = fixtures.authorityFixture()
      const database = new persistence.VibeShapeDatabase(`copy-preparation-${crypto.randomUUID()}`)
      const repository = new persistence.VersionedLocalDocumentRepository(database)
      try {
        const saved = await repository.copyPortableProjectV3({
          snapshot: renamed.snapshot,
          seed: null,
          legacyEvents: [],
          versionedEvents: [created.event, added.event, upgraded.event, renamed.event],
          historyMode: "complete",
          promotionRevision: 0,
          upgradeRevision: upgraded.snapshot.revision,
          migrationDiagnostic: null,
          unavailableRecords: [],
          copiedAt: fixtures.authorityTimestamp,
        })
        if (!saved.ok) throw new Error(saved.diagnostic.message)
        const documentId = identifiers.documentIdSchema.parse(
          "0195b5ac-b250-7a2c-8c33-000000000333",
        )
        const request = {
          databaseName: database.name,
          sourceDocumentId: renamed.snapshot.id,
          expectedHeadRevision: renamed.snapshot.revision,
          documentId,
          name: "Independent saved copy",
          issuedAt: fixtures.authorityTimestamp,
          signal: new AbortController().signal,
        }
        const stale = await client.prepareProjectDuplicate({
          ...request,
          expectedHeadRevision: 999,
        })
        const prepared = await client.prepareProjectDuplicate(request)
        if (!prepared.ok || prepared.value.version !== 3)
          throw new Error("Expected a prepared saved-project copy.")
        const beforePublication = await database.projectsV1.count()
        const stored = await repository.copyPortableProjectV3({
          ...prepared.value.project,
          copiedAt: fixtures.authorityTimestamp,
        })
        if (!stored.ok) throw new Error(stored.diagnostic.message)
        const duplicate = await repository.exportPortableProjectV3(documentId)
        const source = await repository.exportPortableProjectV3(renamed.snapshot.id)
        if (!duplicate.ok || !source.ok) throw new Error("Expected both saved projects.")
        const originals = new Set(source.value.versionedEvents.map((event) => event.commandId))
        return {
          beforePublication,
          staleCode: stale.ok ? null : stale.diagnostic.code,
          name: duplicate.value.snapshot.name,
          sourceSnapshot: source.value.snapshot,
          expectedSourceSnapshot: renamed.snapshot,
          featureIds: duplicate.value.snapshot.features.map(({ id }) => id),
          sourceFeatureIds: renamed.snapshot.features.map(({ id }) => id),
          independentHistory: duplicate.value.versionedEvents.every(
            (event) => event.documentId === documentId && !originals.has(event.commandId),
          ),
          copiedHistoryLength: duplicate.value.versionedEvents.length,
          sourceHistoryLength: source.value.versionedEvents.length,
        }
      } finally {
        await database.delete()
      }
    },
    resolve(import.meta.dirname, "../.."),
  )
  expect(evidence.beforePublication).toBe(1)
  expect(evidence.staleCode).toBe("stale-revision")
  expect(evidence.name).toBe("Independent saved copy")
  expect(evidence.sourceSnapshot).toEqual(evidence.expectedSourceSnapshot)
  expect(evidence.featureIds).toEqual(evidence.sourceFeatureIds)
  expect(evidence.independentHistory).toBe(true)
  expect(evidence.copiedHistoryLength).toBe(evidence.sourceHistoryLength + 1)
  expect(errors).toEqual([])
})
