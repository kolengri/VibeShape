import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import { describe, expect, it } from "vitest"
import {
  lightweightingId,
  lightweightingOperation,
  lightweightingSettings,
  lightweightingSnapshot,
  lightweightingSummary,
} from "./lightweighting.test-fixtures"
import {
  lightweightingAnalysisSchema,
  lightweightingRequestSchema,
  lightweightingResultContextMatches,
} from "./lightweighting-tools"
import {
  localOperationSchema,
  localToolInputs,
  localToolNameSchema,
  localToolOutputs,
} from "./local-tools"
import { remoteOperationSchema } from "./remote-session"
import { localToolAnnotations } from "./tool-metadata"

describe("bounded paired-browser lightweighting contracts", () => {
  it("advertises a strict read-only shared material catalog on both transports", () => {
    const operation = { tool: "list_lightweighting_materials", arguments: {} }
    expect(localOperationSchema.safeParse(operation).success).toBe(true)
    expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
    expect(localToolAnnotations("list_lightweighting_materials")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(
      localToolOutputs.list_lightweighting_materials.safeParse({
        ok: true,
        value: structuralMaterialCatalog,
      }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({ ...operation, arguments: { script: "ignored" } }).success,
    ).toBe(false)
  })
  it("publishes strict local and remote tools with manual mutation annotations", () => {
    for (const request of [false, true]) {
      const operation = lightweightingOperation(request)
      expect(localToolNameSchema.options).toContain(operation.tool)
      expect(localToolInputs[operation.tool]).toBeDefined()
      expect(localToolOutputs[operation.tool]).toBeDefined()
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      expect(localToolAnnotations(operation.tool)).toMatchObject({
        readOnlyHint: !request,
        destructiveHint: request,
        idempotentHint: !request,
        openWorldHint: false,
      })
      for (const extra of [
        { approved: true },
        { mesh: { vertices: [], indices: [] } },
        { actor: {} },
        { path: "/private/source.stl" },
      ])
        expect(
          localOperationSchema.safeParse({
            ...operation,
            arguments: { ...operation.arguments, ...extra },
          }).success,
        ).toBe(false)
    }
  })
  it("rejects infeasible, non-finite and unbounded settings before transport", () => {
    const operation = lightweightingOperation()
    for (const settings of [
      { ...lightweightingSettings, maxIterations: 41 },
      { ...lightweightingSettings, cellSizeMm: Number.NaN },
      { ...lightweightingSettings, safetyFactor: 0.99 },
      {
        ...lightweightingSettings,
        material: { ...lightweightingSettings.material, poissonRatio: 0.49 },
      },
    ])
      expect(
        localOperationSchema.safeParse({
          ...operation,
          arguments: { ...operation.arguments, settings },
        }).success,
      ).toBe(false)
  })
  it("accepts bounded summaries and rejects body/revision/constraint/snapshot mismatches", () => {
    const operation = lightweightingOperation()
    const value = {
      documentId: lightweightingId(3),
      baseRevision: 4,
      source: operation.arguments.source,
      summary: lightweightingSummary(),
    }
    expect(lightweightingAnalysisSchema.safeParse(value).success).toBe(true)
    expect(
      lightweightingResultContextMatches(operation, { ok: true, value }, lightweightingId(3)),
    ).toBe(true)
    for (const patch of [
      { baseRevision: 5 },
      { documentId: lightweightingId(4) },
      { source: { ...value.source, contentHash: "b".repeat(64) } },
      {
        summary: {
          ...value.summary,
          optimized: { ...value.summary.optimized, maxVonMisesMpa: 51 },
        },
      },
      {
        summary: {
          ...value.summary,
          optimized: { ...value.summary.optimized, maxDisplacementMm: 2 },
        },
      },
    ])
      expect(
        lightweightingResultContextMatches(
          operation,
          { ok: true, value: { ...value, ...patch } },
          lightweightingId(3),
        ),
      ).toBe(false)
    expect(
      lightweightingAnalysisSchema.safeParse({ ...value, mesh: { vertices: [], indices: [] } })
        .success,
    ).toBe(false)
    const request = lightweightingOperation(true)
    expect(
      lightweightingResultContextMatches(request, {
        ok: true,
        value: { ...value, snapshot: lightweightingSnapshot() },
      }),
    ).toBe(true)
    expect(
      lightweightingResultContextMatches(request, {
        ok: true,
        value: { ...value, snapshot: { ...lightweightingSnapshot(), revision: 4 } },
      }),
    ).toBe(false)
    expect(lightweightingRequestSchema.safeParse({ ...value, snapshot: null }).success).toBe(false)
    expect(
      lightweightingRequestSchema.safeParse({
        ...value,
        summary: lightweightingSummary(false),
        snapshot: null,
      }).success,
    ).toBe(true)
  })
})
