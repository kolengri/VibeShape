import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { threeMfExportReportSchema } from "../../packages/formats/src/three-mf"
import { threeMfInteroperabilityInvariants } from "../../packages/test-models/src"

interface ThreeMfSpikeState {
  state: "running" | "passed" | "failed"
  bytes: number[] | null
  report: unknown
  error: string | null
}

test("exports the deterministic 3MF fixture in a real browser", async ({ browser, page }) => {
  await page.goto("/spikes/three-mf.html")
  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running")
  const spike = await page.evaluate<ThreeMfSpikeState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_THREE_MF_SPIKE__"),
  )

  expect(spike.state, spike.error ?? "Unknown browser 3MF failure.").toBe("passed")
  await expect(status).toHaveAttribute("data-state", "passed")
  const report = threeMfExportReportSchema.parse(spike.report)
  expect(report).toMatchObject({
    objectCount: 3,
    meshObjectCount: 2,
    componentObjectCount: 1,
    buildItemCount: 1,
    vertexCount: 16,
    triangleCount: threeMfInteroperabilityInvariants.facetCount,
    hasThumbnail: true,
  })
  expect(spike.bytes).not.toBeNull()

  const artifactDirectory = ".artifacts/3mf-spike"
  mkdirSync(artifactDirectory, { recursive: true })
  writeFileSync(
    `${artifactDirectory}/vibeshape-interoperability.3mf`,
    Uint8Array.from(spike.bytes as number[]),
  )
  writeFileSync(
    `${artifactDirectory}/browser-report.json`,
    `${JSON.stringify({ schemaVersion: 1, browser: `Chromium ${browser.version()}`, report }, null, 2)}\n`,
  )
})
