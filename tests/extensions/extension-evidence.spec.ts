import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { z } from "zod"

const sandboxTaskSchema = z
  .object({
    status: z.enum(["completed", "timeout", "resource-limit", "invalid-module", "failed"]),
    durationMs: z.number().nonnegative(),
    messages: z.number().int().nonnegative(),
    value: z.number().int().nullable(),
    authority: z.record(z.string(), z.boolean()).nullable(),
    diagnostic: z.string().nullable(),
  })
  .strict()

const reportSchema = z
  .object({
    schemaVersion: z.literal(0),
    decision: z.literal("proceed-with-reduced-scope"),
    package: z
      .object({
        versionOneIntegrity: z.string().regex(/^[a-f0-9]{64}$/),
        versionTwoIntegrity: z.string().regex(/^[a-f0-9]{64}$/),
        signedTrust: z
          .object({ identity: z.literal("verified-publisher"), sandboxRequired: z.literal(true) })
          .strict(),
        unsignedTrust: z
          .object({ identity: z.literal("unknown-publisher"), sandboxRequired: z.literal(true) })
          .strict(),
      })
      .strict(),
    runtimes: z
      .object({
        firstSession: sandboxTaskSchema,
        secondSession: sandboxTaskSchema,
        versionTwo: sandboxTaskSchema,
        javascript: sandboxTaskSchema,
        undeclaredImport: sandboxTaskSchema,
      })
      .strict(),
    termination: z
      .object({
        wasmLoop: sandboxTaskSchema,
        javascriptLoop: sandboxTaskSchema,
        flood: sandboxTaskSchema,
        memoryGrowth: sandboxTaskSchema,
        oversizedOutput: sandboxTaskSchema,
        mainThreadTicks: z.number().int().positive(),
      })
      .strict(),
    policy: z
      .object({
        exactVersionCoexistence: z.literal(true),
        deniedBeforeGrant: z.literal(false),
        grantedBeforeRevoke: z.literal(true),
        terminatedOnRevoke: z.literal(1),
        terminatedHosts: z.literal(1),
        authorizedAfterRevoke: z.literal(false),
        compatibility: z
          .object({ host10: z.literal(true), host11: z.literal(true), host20: z.literal(false) })
          .strict(),
        update: z
          .object({
            capabilities: z
              .object({
                added: z.array(z.string()),
                requiresApproval: z.literal(true),
                enabledAfterUpdate: z.literal(false),
              })
              .strict(),
            invariants: z
              .object({
                matches: z.literal(false),
                current: z.literal(42),
                candidate: z.literal(63),
              })
              .strict(),
            rollbackIntegrity: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .strict(),
    restrictedMode: z
      .object({
        states: z.tuple([
          z.literal("extension-missing"),
          z.literal("extension-disabled"),
          z.literal("extension-incompatible"),
          z.literal("extension-timeout"),
          z.literal("extension-resource-limit"),
          z.literal("extension-failed"),
        ]),
        payloadPreserved: z.literal(true),
      })
      .strict(),
    panel: z
      .object({
        ready: z.literal("ready"),
        command: z.literal("org.example.threaded-insert.create"),
        opaqueOrigin: z.literal(true),
        sandbox: z.literal("allow-scripts"),
        cspHash: z.literal(true),
      })
      .strict(),
  })
  .strict()

interface ExtensionSpikeState {
  state: "running" | "passed" | "failed"
  stage: string
  report: unknown
  error: string | null
}

test("records extension isolation and package evidence", async ({ browser, page }, testInfo) => {
  await page.goto("/spikes/extension-sandbox.html")
  const panel = page.frameLocator("#extension-panel")
  await expect(panel.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
  await panel.getByRole("button", { name: "Create threaded insert" }).click()
  const status = page.getByRole("status")
  await expect(status).toHaveAttribute("data-state", "passed", { timeout: 30_000 })
  const spike = await page.evaluate<ExtensionSpikeState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_EXTENSION_SPIKE__"),
  )
  expect(spike.state, spike.error ?? `Extension spike failed during ${spike.stage}.`).toBe("passed")
  const report = reportSchema.parse(spike.report)

  expect(report.package.versionOneIntegrity).not.toBe(report.package.versionTwoIntegrity)
  expect(report.runtimes.firstSession).toMatchObject({ status: "completed", value: 42 })
  expect(report.runtimes.secondSession).toMatchObject({ status: "completed", value: 42 })
  expect(report.runtimes.versionTwo).toMatchObject({ status: "completed", value: 63 })
  expect(report.runtimes.javascript.status).toBe("completed")
  expect(report.runtimes.javascript.authority).toMatchObject({
    network: true,
    clock: true,
    randomness: true,
    indexedDb: true,
    dom: false,
    rawKernel: false,
  })
  expect(report.runtimes.undeclaredImport).toMatchObject({
    status: "invalid-module",
    diagnostic: "undeclared-import",
  })
  expect(report.termination.wasmLoop.status).toBe("timeout")
  expect(report.termination.javascriptLoop.status).toBe("timeout")
  expect(report.termination.flood.status).toBe("resource-limit")
  expect(report.termination.memoryGrowth.status).toBe("resource-limit")
  expect(report.termination.oversizedOutput.status).toBe("resource-limit")
  expect(report.termination.mainThreadTicks).toBeGreaterThanOrEqual(5)

  const evidence = {
    schemaVersion: 0,
    browser: `${testInfo.project.name} ${browser.version()}`,
    report,
  }
  mkdirSync(".artifacts/extension-spike", { recursive: true })
  const outputPath = `.artifacts/extension-spike/${testInfo.project.name}.json`
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  await testInfo.attach("extension-evidence", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  })
})
