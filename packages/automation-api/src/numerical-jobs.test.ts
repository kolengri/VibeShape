import { describe, expect, it } from "bun:test"
import {
  lightweightingId,
  lightweightingIdentity,
  lightweightingOperation,
  lightweightingSnapshot,
  lightweightingSummary,
} from "./lightweighting.test-fixtures"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  numericalCompletedResultContextMatches,
  numericalJobReceiptSchema,
  numericalJobResultContextMatches,
  numericalJobStatusSchema,
  numericalToolResultSchema,
} from "./numerical-jobs"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "./quick-lightweighting.test-fixtures"
import { remoteOperationSchema } from "./remote-session"
import { localToolAnnotations } from "./tool-metadata"

const jobId = lightweightingId(30)
const documentId = lightweightingId(3)
function receipt(
  tool:
    | "analyze_lightweighting"
    | "request_lightweighting"
    | "analyze_quick_lightweighting"
    | "request_quick_lightweighting",
) {
  return { jobId, tool, documentId, baseRevision: 4, status: "running" }
}
const examples = [
  {
    operation: lightweightingOperation(),
    value: {
      documentId,
      baseRevision: 4,
      source: lightweightingIdentity,
      summary: lightweightingSummary(),
    },
  },
  {
    operation: lightweightingOperation(true),
    value: {
      documentId,
      baseRevision: 4,
      source: lightweightingIdentity,
      summary: lightweightingSummary(),
      snapshot: lightweightingSnapshot(),
    },
  },
  { operation: quickLightweightingOperation(), value: quickLightweightingValue() },
  { operation: quickLightweightingOperation(true), value: quickLightweightingValue(true) },
]

describe("browser-owned numerical job contracts", () => {
  it.each(examples)(
    "accepts receipts and legacy $operation.tool results but rejects receipt completion",
    ({ operation, value }) => {
      const pending = receipt(operation.tool)
      expect(localToolOutputs[operation.tool].safeParse({ ok: true, value: pending }).success).toBe(
        true,
      )
      expect(localToolOutputs[operation.tool].safeParse({ ok: true, value }).success).toBe(true)
      expect(
        numericalToolResultSchema(operation.tool).safeParse({ ok: true, value: pending }).success,
      ).toBe(false)
      expect(
        numericalCompletedResultContextMatches(operation, { ok: true, value }, documentId),
      ).toBe(true)
      expect(
        numericalCompletedResultContextMatches(operation, { ok: true, value: pending }, documentId),
      ).toBe(false)
      expect(
        numericalJobResultContextMatches(operation, { ok: true, value: pending }, documentId),
      ).toBe(true)
      for (const patch of [
        {
          tool:
            operation.tool === "analyze_lightweighting"
              ? "request_lightweighting"
              : "analyze_lightweighting",
        },
        { documentId: lightweightingId(99) },
        { baseRevision: 5 },
      ]) {
        expect(
          numericalJobResultContextMatches(
            operation,
            { ok: true, value: { ...pending, ...patch } },
            documentId,
          ),
        ).toBe(false)
      }
    },
  )

  it("retains source/settings validation for original numerical completions", () => {
    const operation = quickLightweightingOperation()
    const value = quickLightweightingValue()
    for (const patch of [
      { source: { ...value.source, contentHash: "b".repeat(64) } },
      { summary: { ...value.summary, requestedRemovalPercent: 40 } },
    ])
      expect(
        numericalCompletedResultContextMatches(
          operation,
          { ok: true, value: { ...value, ...patch } },
          documentId,
        ),
      ).toBe(false)
  })

  it.each(["get_numerical_job", "cancel_numerical_job"] as const)(
    "routes strict %s controls and binds job/document identity",
    (tool) => {
      const operation = { tool, arguments: { jobId } }
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      expect(
        localOperationSchema.safeParse({ ...operation, arguments: { jobId, operation: {} } })
          .success,
      ).toBe(false)
      const value = { ...receipt("analyze_quick_lightweighting"), result: null }
      expect(numericalJobResultContextMatches(operation, { ok: true, value }, documentId)).toBe(
        true,
      )
      for (const patch of [{ jobId: lightweightingId(99) }, { documentId: lightweightingId(99) }])
        expect(
          numericalJobResultContextMatches(
            operation,
            { ok: true, value: { ...value, ...patch } },
            documentId,
          ),
        ).toBe(false)
      expect(localToolAnnotations(tool)).toMatchObject({
        readOnlyHint: tool === "get_numerical_job",
        destructiveHint: false,
        idempotentHint: true,
      })
    },
  )

  it.each(examples)(
    "validates completed $operation.tool nested result identity and tool",
    ({ operation, value }) => {
      const completed = {
        ...receipt(operation.tool),
        status: "completed",
        result: { ok: true, value },
      }
      expect(numericalJobStatusSchema.safeParse(completed).success).toBe(true)
      for (const patch of [{ documentId: lightweightingId(99) }, { baseRevision: 5 }])
        expect(
          numericalJobStatusSchema.safeParse({
            ...completed,
            result: { ok: true, value: { ...value, ...patch } },
          }).success,
        ).toBe(false)
      expect(
        numericalJobStatusSchema.safeParse({
          ...completed,
          tool: operation.tool.includes("quick")
            ? "analyze_lightweighting"
            : "analyze_quick_lightweighting",
        }).success,
      ).toBe(false)
      if ("snapshot" in value) {
        for (const patch of [
          { documentId: lightweightingId(99) },
          { baseRevision: 3 },
          { revision: 4 },
        ])
          expect(
            numericalJobStatusSchema.safeParse({
              ...completed,
              result: { ok: true, value: { ...value, snapshot: { ...value.snapshot, ...patch } } },
            }).success,
          ).toBe(false)
      }
    },
  )

  it("requires exactly one terminal result and a UUIDv7 receipt", () => {
    const value = receipt("analyze_quick_lightweighting")
    const failure = {
      ok: false,
      diagnostic: { code: "cancelled", message: "Cancelled.", retryable: false },
    }
    for (const status of ["running", "cancelling"])
      expect(
        numericalJobStatusSchema.safeParse({ ...value, status, result: failure }).success,
      ).toBe(false)
    expect(
      numericalJobStatusSchema.safeParse({ ...value, status: "completed", result: null }).success,
    ).toBe(false)
    expect(
      numericalJobStatusSchema.safeParse({ ...value, status: "completed", result: failure })
        .success,
    ).toBe(true)
    expect(
      numericalJobReceiptSchema.safeParse({
        ...value,
        jobId: "0195b5ac-b280-4a2c-8c33-000000000030",
      }).success,
    ).toBe(false)
    expect(
      numericalJobStatusSchema.safeParse({ ...value, result: null, progress: {} }).success,
    ).toBe(false)
  })
})
