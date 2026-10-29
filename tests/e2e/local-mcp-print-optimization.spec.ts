import { expect, test } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"
import type { ModelBodyTopologyView } from "../../packages/automation-api/src/body-topology-queries"
import { localToolOutputs } from "../../packages/automation-api/src/local-tools"
import { numericalJobReceiptSchema } from "../../packages/automation-api/src/numerical-jobs"
import {
  printOptimizationAnalysisSchema,
  printOptimizationRequestSchema,
} from "../../packages/automation-api/src/print-optimization-tools"
import { enableLocalAi } from "./application-menu-support"
import { createEditorProject } from "./fixtures"

function success<Value>(
  result: { ok: true; value: Value } | { ok: false; diagnostic: { message: string } },
): Value {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`

function selectPrintFaces(faces: ModelBodyTopologyView) {
  const bed = faces.data.topology.find(
    ({ reference, resolution }) =>
      resolution === "resolved" &&
      reference.signature.centroid[2] ===
        Math.min(...faces.data.topology.map(({ reference: face }) => face.signature.centroid[2])),
  )?.reference
  const preserve = faces.data.topology.find(
    ({ reference, resolution }) =>
      resolution === "resolved" &&
      reference.signature.centroid[0] ===
        Math.min(...faces.data.topology.map(({ reference: face }) => face.signature.centroid[0])),
  )?.reference
  if (!bed || !preserve) throw new Error("The expected source faces did not resolve.")
  return { bed, preserve }
}

test("controls exact FDM analysis and reviewed CAD publication entirely through paired MCP tools", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const local = await createMcpTestClient(45970 + testInfo.parallelIndex)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await local.callTool({ name, arguments: args })).structuredContent?.result
  const job = async (jobId: string) =>
    success(localToolOutputs.get_numerical_job.parse(await call("get_numerical_job", { jobId })))
  try {
    await page.goto(local.origin)
    await createEditorProject(page)
    await enableLocalAi(page)
    const info = success(localToolOutputs.model_info.parse(await call("model_info", {})))
    const draft = success(
      localToolOutputs.create_draft.parse(
        await call("create_draft", { baseRevision: info.summary.revision }),
      ),
    )
    expect(
      await call("create_box", {
        draftId: draft.draftId,
        baseRevision: draft.revision,
        commandId: id(201),
        featureId: id(202),
        label: "FDM source",
        widthMm: 16,
        depthMm: 8,
        heightMm: 8,
      }),
    ).toMatchObject({ ok: true })
    const committing = call("commit_draft", { draftId: draft.draftId })
    const authorReview = page.getByRole("region", { name: "Review AI changes", exact: true })
    await expect(authorReview).toBeVisible({ timeout: 30_000 })
    await authorReview.getByRole("button", { name: "Apply", exact: true }).click()
    const committed = success(localToolOutputs.commit_draft.parse(await committing))
    const parts = success(
      localToolOutputs.model_parts.parse(
        await call("model_parts", { revision: committed.revision }),
      ),
    )
    const part = parts.parts[0]
    if (!part) throw new Error("The source Part is unavailable.")
    const faces = success(
      localToolOutputs.model_body_topology.parse(
        await call("model_body_topology", {
          revision: committed.revision,
          featureId: id(202),
          outputRole: "result",
          topologyKind: "face",
          limit: 100,
        }),
      ),
    )
    const { bed, preserve } = selectPrintFaces(faces)
    const args = {
      baseRevision: committed.revision,
      source: {
        partId: part.id,
        featureId: id(202),
        outputRole: "result",
        contentHash: faces.contentHash,
      },
      settings: {
        bedFace: bed,
        preserveFaces: [preserve],
        material: { kind: "preset", presetId: "pla" },
      },
    }
    const analysisJob = numericalJobReceiptSchema.parse(
      success(
        localToolOutputs.analyze_print_optimization.parse(
          await call("analyze_print_optimization", args),
        ),
      ),
    )
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(committed.revision)
    await expect
      .poll(async () => (await job(analysisJob.jobId)).status, { timeout: 180_000 })
      .toBe("completed")
    const analyzed = await job(analysisJob.jobId)
    if (analyzed.status !== "completed") throw new Error("The analysis did not complete.")
    const analysis = printOptimizationAnalysisSchema.parse(success<unknown>(analyzed.result))
    expect(analysis.summary.exact?.preservedFaceCount).toBe(1)
    expect(analysis.summary.exact?.sourceVolumeMm3).toBeCloseTo(1024, 6)
    expect(analysis.summary.exact?.volumeMm3).toBeLessThan(1024)
    expect(analysis.summary.exact?.verification.optimized.cases).toHaveLength(4)
    expect(analysis.summary.configuration).toMatchObject({
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
    })
    expect(
      success(localToolOutputs.model_info.parse(await call("model_info", {}))).summary.revision,
    ).toBe(committed.revision)
    await expect(page.getByRole("region", { name: "Review AI import", exact: true })).toHaveCount(0)

    const receipt = numericalJobReceiptSchema.parse(
      success(
        localToolOutputs.request_print_optimization.parse(
          await call("request_print_optimization", { ...args, label: "Exact FDM candidate" }),
        ),
      ),
    )
    const review = page.getByRole("region", { name: "Review AI import", exact: true })
    await expect(review).toBeVisible({ timeout: 180_000 })
    await expect(
      review.getByText("1 original CAD face retained unchanged.", { exact: true }),
    ).toBeVisible()
    await expect(review.getByText("Exact solid", { exact: true })).toBeVisible()
    await review.getByRole("button", { name: "Apply", exact: true }).click()
    await expect
      .poll(async () => (await job(receipt.jobId)).status, { timeout: 30_000 })
      .toBe("completed")
    const completed = await job(receipt.jobId)
    if (completed.status !== "completed") throw new Error("The print request did not complete.")
    const applied = printOptimizationRequestSchema.parse(success<unknown>(completed.result))
    expect(applied.snapshot?.revision).toBeGreaterThan(committed.revision)
    await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(2)
    await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
      "Saved",
    )
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(1)
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(page.getByRole("treeitem", { name: /^Part / })).toHaveCount(2)
  } finally {
    await local.close()
  }
})
