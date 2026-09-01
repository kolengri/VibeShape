import { mkdirSync, writeFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import { z } from "zod"

const reportSchema = z
  .object({
    schemaVersion: z.literal(0),
    committedRevisions: z.literal(2),
    staleDiagnostic: z.literal("stale-revision"),
    quotaFailure: z
      .object({ diagnostic: z.literal("quota-exceeded"), rolledBack: z.literal(true) })
      .strict(),
    transactionRecordCounts: z
      .object({ events: z.literal(2), snapshots: z.literal(2), projects: z.literal(1) })
      .strict(),
    recovery: z
      .object({
        replayedRevision: z.literal(2),
        corruptSnapshotRecords: z.array(z.string()).min(1),
        boundedLossRevision: z.literal(1),
        lostRevisionCount: z.literal(1),
        cleanStatus: z.literal("clean"),
        migration: z
          .object({
            journalProvenance: z.literal("journal-derived"),
            degradedProvenance: z.literal("snapshot-derived"),
            boundedRevision: z.literal(1),
            boundedProvenance: z.literal("journal-derived"),
            unavailableRecords: z
              .array(z.string())
              .refine((records) => records.includes("event:1")),
            storedSnapshotSchema: z.literal(0),
          })
          .strict(),
      })
      .strict(),
    leases: z
      .object({
        acquired: z.literal("acquired"),
        blocked: z.literal("lease-held"),
        takeover: z.literal("taken-over"),
        epoch: z.literal(2),
        oldWriterCommit: z.literal("lease-lost"),
      })
      .strict(),
    versioned: z
      .object({
        stalePromotionBarrier: z.literal("stale-revision"),
        lossyPromotionBarrier: z.literal("corrupt-history"),
        promotionProvenance: z.literal("journal-derived"),
        committedRevision: z.literal(3),
        recoveredRevision: z.literal(3),
        boundedLossRevision: z.literal(2),
        lostRevisionCount: z.literal(1),
        corruptRecords: z.array(z.string()).refine((records) => records.includes("snapshot-v1:3")),
        legacyWriteBarrier: z.literal("stale-revision"),
        corruptHeadBarrier: z.literal("corrupt-history"),
        transactionRolledBack: z.literal(true),
        cleanStatus: z.literal("clean"),
        lifecycle: z
          .object({
            authoritativeRevision: z.literal(3),
            authoritativeName: z.literal("Bracket History v1"),
            thumbnailRevision: z.literal(3),
            lastExternalBackupAt: z.literal("2026-08-08T00:00:03Z"),
            legacyThumbnailWriteBarrier: z.literal("stale-revision"),
            copiedPreviewRevision: z.literal(1),
            deletedCopyRecords: z
              .object({ events: z.literal(1), snapshots: z.literal(1), thumbnails: z.literal(1) })
              .strict(),
          })
          .strict(),
        records: z
          .object({ projects: z.literal(1), snapshots: z.literal(2), events: z.literal(1) })
          .strict(),
      })
      .strict(),
    rejectedCleanClose: z.literal("lease-lost"),
    cache: z
      .object({
        status: z.enum(["verified", "unavailable"]),
        byteLength: z.literal(5).nullable(),
        orphanFilesRemoved: z.array(z.string()).max(2),
      })
      .strict(),
    capabilities: z
      .object({
        schemaVersion: z.literal(0),
        indexedDb: z.literal(true),
        opfs: z.boolean(),
        persistentStorage: z.boolean(),
        fileSystemAccess: z.boolean(),
        usageBytes: z.number().int().nonnegative().nullable(),
        quotaBytes: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    updateWithDirtyDocument: z.literal("defer"),
    persistentStoragePrompt: z
      .object({ afterSavedUserGesture: z.literal(true), background: z.literal(false) })
      .strict(),
    fallbackSaveMethod: z.literal("download"),
  })
  .strict()

interface PersistenceSpikeState {
  state: "running" | "passed" | "failed"
  stage: string
  report: unknown
  error: string | null
}

const reopenReportSchema = z
  .object({
    schemaVersion: z.literal(0),
    mode: z.enum(["recover-dirty", "offline-reopen"]),
    status: z.enum(["clean", "recovered", "recovered-with-loss"]),
    recoveredRevision: z.literal(2),
    lostRevisionCount: z.literal(0),
  })
  .strict()

async function readPassedSpike(page: Page) {
  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 30_000 })
  const spike = await page.evaluate<PersistenceSpikeState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_PERSISTENCE_SPIKE__"),
  )
  expect(spike.state, spike.error ?? `Persistence failed during ${spike.stage}.`).toBe("passed")
  await expect(status).toHaveAttribute("data-state", "passed")
  return spike.report
}

async function setSpikeNetworkOutage(page: Page, offline: boolean) {
  await page.evaluate((requestedOffline) => {
    const controller = navigator.serviceWorker.controller
    if (!controller) throw new Error("The persistence service worker is not controlling the page.")
    return new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel()
      const timeout = window.setTimeout(
        () =>
          reject(new Error("The persistence service worker did not acknowledge network state.")),
        5_000,
      )
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout)
        resolve()
      }
      controller.postMessage({ type: "vibeshape.persistence.network", offline: requestedOffline }, [
        channel.port2,
      ])
    })
  }, offline)
}

test("records local-first recovery evidence in a real browser", async ({
  browser,
  context,
  page,
}, testInfo) => {
  await page.goto("/spikes/persistence.html?mode=seed-dirty")
  expect(await readPassedSpike(page)).toMatchObject({
    schemaVersion: 0,
    mode: "seed-dirty",
    revision: 2,
  })
  await page.close()

  const recoveryPage = await context.newPage()
  await recoveryPage.goto("/spikes/persistence.html?mode=recover-dirty")
  const crashRecovery = reopenReportSchema.parse(await readPassedSpike(recoveryPage))
  expect(crashRecovery).toMatchObject({ mode: "recover-dirty", status: "recovered" })

  await recoveryPage.goto("/spikes/persistence.html")
  const report = reportSchema.parse(await readPassedSpike(recoveryPage))
  expect(report.cache.status === "verified").toBe(report.capabilities.opfs)
  expect(report.cache.byteLength).toBe(report.capabilities.opfs ? 5 : null)
  expect(report.cache.orphanFilesRemoved).toHaveLength(report.capabilities.opfs ? 2 : 0)

  await setSpikeNetworkOutage(recoveryPage, true)
  await recoveryPage.goto("/spikes/persistence.html?mode=offline-reopen")
  const offlineReopen = reopenReportSchema.parse(await readPassedSpike(recoveryPage))
  await setSpikeNetworkOutage(recoveryPage, false)
  expect(offlineReopen).toMatchObject({ mode: "offline-reopen", status: "clean" })

  const evidence = {
    schemaVersion: 0,
    browser: `${testInfo.project.name} ${browser.version()}`,
    forcedTerminationRecovery: crashRecovery,
    report,
    offlineReopen,
  }
  mkdirSync(".artifacts/persistence-spike", { recursive: true })
  const outputPath = `.artifacts/persistence-spike/${testInfo.project.name}.json`
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  await testInfo.attach("persistence-evidence", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  })
})
