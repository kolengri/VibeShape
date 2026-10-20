import { writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { probeNativeBackgroundSession } from "./background-session-fixture"

test("keeps the editor's authenticated heartbeat and fake ACP reads alive while minimized", async () => {
  test.skip(Boolean(process.env.VIBESHAPE_PACKAGED_APP), "Requires an isolated dynamic test port.")
  const receipt = await probeNativeBackgroundSession()
  await writeFile(
    test.info().outputPath("background-session.json"),
    JSON.stringify(receipt, null, 2),
  )
  expect(receipt.backgroundThrottling).toBe(false)
  expect(receipt.initiallyVisible).toBe(false)
  expect(receipt.licensePolicy).toEqual({ backgroundThrottling: true, visible: false })
  expect(receipt.isolatedProfile).toBe(true)
  expect(receipt.packaged).toBe(false)
  expect(new URL(receipt.origin).port).not.toBe("43115")
  expect(receipt.minimized).toBe(true)
  expect(receipt.observedMs).toBeGreaterThan(20_000)
  expect(receipt.freshSuccessfulPolls).toBeGreaterThan(5)
  expect(receipt.pollStatuses).toEqual([200])
  expect(receipt.sequenceRestarts).toBe(0)
  expect(receipt.maxGapMs).toBeLessThan(15_000)
  expect(receipt.fakeAcpReadAfterMinimize).toBe(true)
  expect(receipt.sameAcpSession).toBe(true)
  expect(receipt.fakeAcpReadCount).toBe(2)
})
