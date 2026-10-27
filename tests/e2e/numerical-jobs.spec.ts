import { expect, type Page, test } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { numericalJobReceiptSchema } from "../../packages/automation-api/src/numerical-jobs"
import { quickLightweightingRequestSchema } from "../../packages/automation-api/src/quick-lightweighting-tools"
import { enableLocalAi } from "./application-menu-support"
import { createEditorProject } from "./fixtures"

type LocalClient = Awaited<ReturnType<typeof createMcpTestClient>>
type GateMode = "request" | "complete"
type WorkerGate = {
  state: () => { pending: number; terminated: number; successfulResults: number }
  release: () => number
}
const shortDeadlineMs = 2_000
const featureId = "0195b5ac-b250-7a2c-8c33-000000000103"
const quickSettings = {
  mode: "preserve-exterior",
  removalPercent: 20,
  cellSizeMm: 1,
  skinThicknessMm: 2,
} as const
const structuralSettings = {
  material: {
    youngModulusMpa: 1000,
    poissonRatio: 0,
    yieldStrengthMpa: 100,
    densityKgM3: 1000,
  },
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 2,
  supports: [{ min: [0, 0, 0], max: [0, 10, 10] }],
  loadCases: [{ name: "Axial", region: { min: [10, 0, 0], max: [10, 10, 10] }, forceN: [1, 0, 0] }],
  preserveRegions: [],
  maxIterations: 1,
}

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
) {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

async function call(
  local: LocalClient,
  name: string,
  args: Record<string, unknown>,
  timeout?: number,
) {
  return (await local.callTool({ name, arguments: args }, timeout ? { timeout } : undefined))
    .structuredContent?.result
}

async function installWorkerGate(page: Page, mode: GateMode) {
  await page.addInitScript((mode) => {
    const NativeWorker = globalThis.Worker
    const pending: (() => void)[] = []
    let releasing = false
    let terminated = 0
    let successfulResults = 0
    class GatedWorker extends NativeWorker {
      private numerical = false
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener("message", (event: MessageEvent) => {
          if (
            !this.numerical ||
            releasing ||
            mode !== "complete" ||
            event.data?.type !== "complete"
          )
            return
          event.stopImmediatePropagation()
          if (event.data.response?.ok === true) successfulResults += 1
          // Retain the actual worker output, including delivery after terminate, to exercise races.
          pending.push(() => this.dispatchEvent(new MessageEvent("message", { data: event.data })))
        })
      }
      postMessage(message: unknown, transferOrOptions?: unknown) {
        this.numerical ||=
          typeof message === "object" &&
          message !== null &&
          "input" in message &&
          "runtimeBaseUrl" in message
        const send = () =>
          Reflect.apply(NativeWorker.prototype.postMessage, this, [message, transferOrOptions])
        if (this.numerical && mode === "request") pending.push(send)
        else send()
      }
      terminate() {
        if (this.numerical) terminated += 1
        super.terminate()
      }
    }
    globalThis.Worker = GatedWorker
    Object.assign(globalThis, {
      numericalJobWorkerGate: {
        state: () => ({ pending: pending.length, terminated, successfulResults }),
        release() {
          const deliveries = pending.splice(0)
          releasing = true
          try {
            for (const deliver of deliveries) deliver()
          } finally {
            releasing = false
          }
          return deliveries.length
        },
      },
    })
  }, mode)
}

function gateState(page: Page) {
  return page.evaluate(() => {
    const gate = Reflect.get(globalThis, "numericalJobWorkerGate") as WorkerGate
    return gate.state()
  })
}

function releaseWorker(page: Page) {
  return page.evaluate(() => {
    const gate = Reflect.get(globalThis, "numericalJobWorkerGate") as WorkerGate
    return gate.release()
  })
}

async function createSource(page: Page, local: LocalClient) {
  await page.goto(local.origin)
  await createEditorProject(page)
  await enableLocalAi(page)
  const info = success(localToolOutputs.model_info.parse(await call(local, "model_info", {})))
  const draft = success(
    localToolOutputs.create_draft.parse(
      await call(local, "create_draft", { baseRevision: info.summary.revision }),
    ),
  )
  expect(
    await call(local, "create_box", {
      draftId: draft.draftId,
      baseRevision: draft.revision,
      commandId: "0195b5ac-b250-7a2c-8c33-000000000102",
      featureId,
      label: "Numerical source",
      widthMm: 10,
      depthMm: 10,
      heightMm: 10,
    }),
  ).toMatchObject({ ok: true })
  const committing = call(local, "commit_draft", { draftId: draft.draftId })
  const review = page.getByRole("region", { name: "Review AI changes", exact: true })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await review.getByRole("button", { name: "Apply", exact: true }).click()
  const committed = success(localToolOutputs.commit_draft.parse(await committing))
  const parts = success(
    localToolOutputs.model_parts.parse(
      await call(local, "model_parts", { revision: committed.revision }),
    ),
  )
  expect(parts.parts).toHaveLength(1)
  const part = parts.parts[0]
  if (!part) throw new Error("Expected the numerical source Part.")
  const topology = success(
    localToolOutputs.model_body_topology.parse(
      await call(local, "model_body_topology", {
        revision: committed.revision,
        featureId,
        outputRole: "result",
        topologyKind: "face",
        limit: 1,
      }),
    ),
  )
  return {
    documentId: parts.documentId,
    baseRevision: committed.revision,
    source: { partId: part.id, featureId, outputRole: "result", contentHash: topology.contentHash },
  }
}

async function readJob(local: LocalClient, jobId: string) {
  return success(
    localToolOutputs.get_numerical_job.parse(await call(local, "get_numerical_job", { jobId })),
  )
}

test("returns all four numerical receipts and keeps MCP queries available while workers are held", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await installWorkerGate(page, "request")
  const local = await createMcpTestClient(45840 + testInfo.parallelIndex)
  try {
    const context = await createSource(page, local)
    for (const tool of [
      "analyze_lightweighting",
      "request_lightweighting",
      "analyze_quick_lightweighting",
      "request_quick_lightweighting",
    ] as const) {
      const startedAt = Date.now()
      const receipt = numericalJobReceiptSchema.parse(
        success<unknown>(
          localToolOutputs[tool].parse(
            await call(
              local,
              tool,
              {
                baseRevision: context.baseRevision,
                source: context.source,
                settings: tool.includes("quick") ? quickSettings : structuralSettings,
                ...(tool.startsWith("request") ? { label: "Held numerical snapshot" } : {}),
              },
              shortDeadlineMs,
            ),
          ),
        ),
      )
      expect(receipt).toMatchObject({
        tool,
        documentId: context.documentId,
        baseRevision: context.baseRevision,
        status: "running",
      })
      await expect.poll(async () => (await gateState(page)).pending).toBeGreaterThan(0)
      await expect.poll(() => Date.now() - startedAt).toBeGreaterThan(shortDeadlineMs)
      const running = await readJob(local, receipt.jobId)
      expect(running).toEqual({ ...receipt, result: null })
      const info = success(
        localToolOutputs.model_info.parse(await call(local, "model_info", {}, shortDeadlineMs)),
      )
      expect(info.summary.revision).toBe(context.baseRevision)
      const cancelling = success(
        localToolOutputs.cancel_numerical_job.parse(
          await call(local, "cancel_numerical_job", { jobId: receipt.jobId }, shortDeadlineMs),
        ),
      )
      expect(cancelling).toMatchObject({ ...receipt, status: "cancelling", result: null })
      await expect.poll(async () => (await readJob(local, receipt.jobId)).status).toBe("completed")
      expect(await readJob(local, receipt.jobId)).toMatchObject({
        ...receipt,
        status: "completed",
        result: { ok: false, diagnostic: { code: "request-cancelled" } },
      })
      expect(await releaseWorker(page)).toBe(1)
    }
    expect((await gateState(page)).terminated).toBe(4)
  } finally {
    await local.close()
  }
})

test("releases a real Quick worker result after its short MCP start request has completed", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await installWorkerGate(page, "complete")
  const local = await createMcpTestClient(45860 + testInfo.parallelIndex)
  try {
    const context = await createSource(page, local)
    const startedAt = Date.now()
    const receipt = numericalJobReceiptSchema.parse(
      success(
        localToolOutputs.analyze_quick_lightweighting.parse(
          await call(
            local,
            "analyze_quick_lightweighting",
            { baseRevision: context.baseRevision, source: context.source, settings: quickSettings },
            shortDeadlineMs,
          ),
        ),
      ),
    )
    await expect.poll(async () => (await gateState(page)).pending, { timeout: 120_000 }).toBe(1)
    expect((await gateState(page)).successfulResults).toBe(1)
    await expect.poll(() => Date.now() - startedAt).toBeGreaterThan(shortDeadlineMs)
    expect(await readJob(local, receipt.jobId)).toEqual({ ...receipt, result: null })
    expect(
      success(
        localToolOutputs.model_info.parse(await call(local, "model_info", {}, shortDeadlineMs)),
      ).summary.revision,
    ).toBe(context.baseRevision)
    expect(await releaseWorker(page)).toBe(1)
    await expect.poll(async () => (await readJob(local, receipt.jobId)).status).toBe("completed")
    const completed = await readJob(local, receipt.jobId)
    expect(completed).toMatchObject({ ...receipt, status: "completed", result: { ok: true } })
    if (completed.status !== "completed" || !completed.result.ok)
      throw new Error("Expected the actual Quick analysis result.")
    const value = completed.result.value
    expect(value).toMatchObject({
      documentId: context.documentId,
      baseRevision: context.baseRevision,
      source: context.source,
      summary: { mode: "preserve-exterior", requestedRemovalPercent: 20 },
    })
    expect(value.summary).toMatchObject({ sourceVolumeMm3: 1000 })
    if (!("removedPercent" in value.summary)) throw new Error("Expected Quick volume evidence.")
    expect(value.summary.removedPercent).toBeGreaterThan(0)
    expect(value.summary.resultVolumeMm3).toBeLessThan(1000)
  } finally {
    await local.close()
  }
})

test("applies a real numerical snapshot and removes the entire saved result with one Undo", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await installWorkerGate(page, "complete")
  const local = await createMcpTestClient(45900 + testInfo.parallelIndex)
  try {
    const context = await createSource(page, local)
    const label = "Applied numerical snapshot"
    const receipt = numericalJobReceiptSchema.parse(
      success(
        localToolOutputs.request_quick_lightweighting.parse(
          await call(
            local,
            "request_quick_lightweighting",
            {
              baseRevision: context.baseRevision,
              source: context.source,
              settings: quickSettings,
              label,
            },
            shortDeadlineMs,
          ),
        ),
      ),
    )
    await expect.poll(async () => (await gateState(page)).pending, { timeout: 120_000 }).toBe(1)
    expect((await gateState(page)).successfulResults).toBe(1)
    expect(await releaseWorker(page)).toBe(1)
    const review = page.getByRole("region", { name: "Review AI import", exact: true })
    await expect(review).toBeVisible({ timeout: 30_000 })
    expect(await readJob(local, receipt.jobId)).toEqual({ ...receipt, result: null })
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    await expect.poll(async () => (await readJob(local, receipt.jobId)).status).toBe("completed")
    const completed = await readJob(local, receipt.jobId)
    expect(completed).toMatchObject({ ...receipt, status: "completed", result: { ok: true } })
    if (completed.status !== "completed") throw new Error("Expected the completed snapshot job.")
    const request = quickLightweightingRequestSchema.parse(success<unknown>(completed.result))
    expect(request.snapshot).toMatchObject({
      documentId: context.documentId,
      baseRevision: context.baseRevision,
    })
    expect(request.snapshot.revision).toBeGreaterThan(context.baseRevision)
    const appliedInfo = success(
      localToolOutputs.model_info.parse(await call(local, "model_info", {})),
    )
    expect(appliedInfo.summary.revision).toBe(request.snapshot.revision)
    const appliedParts = success(
      localToolOutputs.model_parts.parse(
        await call(local, "model_parts", { revision: appliedInfo.summary.revision }),
      ),
    )
    expect(appliedParts.parts).toHaveLength(2)
    expect(appliedParts.parts.find((part) => part.name === label)?.body.featureId).toBe(
      request.snapshot.featureId,
    )
    await expect(page.getByRole("treeitem", { name: label, exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: label, exact: true })).toHaveCount(0)
    const undoneInfo = success(
      localToolOutputs.model_info.parse(await call(local, "model_info", {})),
    )
    const undoneParts = success(
      localToolOutputs.model_parts.parse(
        await call(local, "model_parts", { revision: undoneInfo.summary.revision }),
      ),
    )
    expect(undoneParts.parts).toHaveLength(1)
    expect(undoneParts.parts[0]?.id).toBe(context.source.partId)
    expect(undoneParts.parts[0]?.body.featureId).toBe(featureId)
  } finally {
    await local.close()
  }
})

for (const cancellation of ["cancel_numerical_job", "Stop AI"] as const) {
  test(`${cancellation} prevents a held real Quick result from persisting after cancellation`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await installWorkerGate(page, "complete")
    const local = await createMcpTestClient(45880 + testInfo.parallelIndex)
    try {
      const context = await createSource(page, local)
      const label = "Cancelled numerical snapshot"
      const receipt = numericalJobReceiptSchema.parse(
        success(
          localToolOutputs.request_quick_lightweighting.parse(
            await call(
              local,
              "request_quick_lightweighting",
              {
                baseRevision: context.baseRevision,
                source: context.source,
                settings: quickSettings,
                label,
              },
              shortDeadlineMs,
            ),
          ),
        ),
      )
      await expect.poll(async () => (await gateState(page)).pending, { timeout: 120_000 }).toBe(1)
      expect((await gateState(page)).successfulResults).toBe(1)
      if (cancellation === "cancel_numerical_job") {
        expect(
          await call(local, "cancel_numerical_job", { jobId: receipt.jobId }, shortDeadlineMs),
        ).toMatchObject({ ok: true, value: { ...receipt, status: "cancelling", result: null } })
        await expect
          .poll(async () => (await readJob(local, receipt.jobId)).status)
          .toBe("completed")
        expect(await readJob(local, receipt.jobId)).toMatchObject({
          status: "completed",
          result: { ok: false, diagnostic: { code: "request-cancelled" } },
        })
      } else {
        await page.getByRole("button", { name: "Stop AI", exact: true }).click()
        await expect(
          page.getByRole("button", { name: "Enable AI session", exact: true }),
        ).toBeVisible()
      }
      await expect.poll(async () => (await gateState(page)).terminated).toBe(1)
      expect(await releaseWorker(page)).toBe(1)
      await expect(page.getByRole("region", { name: "Review AI import", exact: true })).toHaveCount(
        0,
      )
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toHaveCount(0)
      await page.reload()
      await expect(
        page.getByRole("status", { name: "Project save status", exact: true }),
      ).toHaveText("Saved")
      await expect(page.getByRole("treeitem", { name: label, exact: true })).toHaveCount(0)
      if (cancellation === "Stop AI") await enableLocalAi(page)
      await expect(
        page.getByText("AI access on · Approve each change", { exact: true }),
      ).toBeVisible()
      const restored = success(
        localToolOutputs.model_info.parse(await call(local, "model_info", {})),
      )
      expect(restored.summary.revision).toBe(context.baseRevision)
    } finally {
      await local.close()
    }
  })
}
