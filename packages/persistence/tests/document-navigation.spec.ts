import { expect, test } from "@playwright/test"
import type {
  durableNavigationEvidence,
  verifyDurableNavigationRestart,
} from "../src/document-navigation.browser-evidence"

test("durable navigation survives reopen and rolls back quota, lease, and corrupt-target failures", async ({
  page,
}) => {
  await page.route("**/history-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>History evidence</title>",
    }),
  )
  await page.goto("/history-evidence.html")
  const report = await page.evaluate(
    async ({ name, path }) => {
      const evidence: { durableNavigationEvidence: typeof durableNavigationEvidence } =
        await import(path)
      return evidence.durableNavigationEvidence(name)
    },
    {
      name: `durable-history-${test.info().project.name}`,
      path: `/@fs${new URL("../src/document-navigation.browser-evidence.ts", import.meta.url).pathname}`,
    },
  )
  expect(report).toEqual({
    reopenedSteps: 125,
    quotaRollback: true,
    staleLease: true,
    multiStepRestart: true,
    replayFallback: true,
    corruptHistory: true,
    legacyBaseline: true,
    importedBaseline: true,
  })
})

test("retains navigation across a browser process restart and can apply the saved redo range", async ({
  playwright,
  browserName,
  baseURL,
}, testInfo) => {
  if (!baseURL) throw new Error("The durable history browser tests require a Vite baseURL")
  const profile = testInfo.outputPath("persistent-profile")
  const path = `/@fs${new URL("../src/document-navigation.browser-evidence.ts", import.meta.url).pathname}`
  const name = `history-process-restart-${browserName}`
  let context = await playwright[browserName].launchPersistentContext(profile, { headless: true })
  try {
    let page = await context.newPage()
    await page.route("**/history-evidence.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>History restart</title>",
      }),
    )
    await page.goto(`${baseURL}/history-evidence.html`)
    expect(
      await page.evaluate(
        async ({ path, name }) => {
          const evidence: { durableNavigationEvidence: typeof durableNavigationEvidence } =
            await import(path)
          return evidence.durableNavigationEvidence(name, true)
        },
        { path, name },
      ),
    ).toEqual({ preparedForRestart: true, redoSteps: 125 })
    await context.close()
    context = await playwright[browserName].launchPersistentContext(profile, { headless: true })
    page = await context.newPage()
    await page.route("**/history-evidence.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>History restart</title>",
      }),
    )
    await page.goto(`${baseURL}/history-evidence.html`)
    expect(
      await page.evaluate(
        async ({ path, name }) => {
          const evidence: {
            verifyDurableNavigationRestart: typeof verifyDurableNavigationRestart
          } = await import(path)
          return evidence.verifyDurableNavigationRestart(name)
        },
        { path, name },
      ),
    ).toEqual({ browserRestart: true, redoSteps: 125 })
  } finally {
    await context.close()
  }
})

test("replays migrated historical targets on demand and verifies their immutable source bytes", async ({
  page,
}) => {
  await page.route("**/history-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Historical source authority</title>",
    }),
  )
  await page.goto("/history-evidence.html")
  const report = await page.evaluate(
    async ({ path, fixturePath }) => {
      const evidence: {
        historicalSourceNavigationEvidence: typeof import("../src/document-navigation.browser-evidence").historicalSourceNavigationEvidence
      } = await import(path)
      const fixtures: {
        sourceAssetsFixture: typeof import("../../../scripts/source-assets-fixture").sourceAssetsFixture
      } = await import(fixturePath)
      const f = await fixtures.sourceAssetsFixture()
      const states = [
        f.authored.created,
        f.authored.added,
        f.authored.upgraded,
        f.textureUpgraded,
        f.upgraded,
        f.added,
      ]
      return evidence.historicalSourceNavigationEvidence(
        `history-source-${crypto.randomUUID()}`,
        states.map(({ snapshot }) => snapshot),
        states.map(({ event }) => event),
        f.blob,
      )
    },
    {
      path: `/@fs${new URL("../src/document-navigation.browser-evidence.ts", import.meta.url).pathname}`,
      fixturePath: `/@fs${new URL("../../../scripts/source-assets-fixture.ts", import.meta.url).pathname}`,
    },
  )
  expect(report).toEqual({ migratedTargets: 6, sourceChecksum: true })
})
