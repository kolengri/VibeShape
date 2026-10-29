import { describe, expect, it } from "bun:test"
import { lightweightingId } from "./lightweighting.test-fixtures"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  numericalCompletedResultContextMatches,
  numericalJobStatusSchema,
  numericalOperationSchema,
} from "./numerical-jobs"
import {
  printOptimizationFace,
  printOptimizationOperation,
  printOptimizationValue,
} from "./print-optimization.test-fixtures"
import {
  printOptimizationResultContextMatches,
  resolvePrintOptimizationMaterial,
} from "./print-optimization-tools"
import { remoteOperationSchema } from "./remote-session"
import { localToolAnnotations } from "./tool-metadata"

describe("exact automatic print optimization contracts", () => {
  it.each([false, true])(
    "registers both transports and original/background result contracts (request=%s)",
    (request) => {
      const operation = printOptimizationOperation(request)
      const value = printOptimizationValue(request)
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      expect(numericalOperationSchema.safeParse(operation).success).toBe(true)
      expect(localToolAnnotations(operation.tool)).toMatchObject({
        readOnlyHint: !request,
        destructiveHint: request,
        openWorldHint: false,
      })
      expect(localToolOutputs[operation.tool].safeParse({ ok: true, value }).success).toBe(true)
      expect(
        printOptimizationResultContextMatches(operation, { ok: true, value }, lightweightingId(3)),
      ).toBe(true)
      expect(
        numericalCompletedResultContextMatches(operation, { ok: true, value }, lightweightingId(3)),
      ).toBe(true)
      const receipt = {
        jobId: lightweightingId(30),
        tool: operation.tool,
        documentId: lightweightingId(3),
        baseRevision: 4,
        status: "running",
      }
      expect(localToolOutputs[operation.tool].safeParse({ ok: true, value: receipt }).success).toBe(
        true,
      )
      expect(
        numericalJobStatusSchema.safeParse({
          ...receipt,
          status: "completed",
          result: { ok: true, value },
        }).success,
      ).toBe(true)
      expect(
        numericalJobStatusSchema.safeParse({
          ...receipt,
          status: "completed",
          result: { ok: true, value: { ...value, baseRevision: 5 } },
        }).success,
      ).toBe(false)
      expect(
        numericalJobStatusSchema.safeParse({
          ...receipt,
          tool: "analyze_quick_lightweighting",
          status: "completed",
          result: { ok: true, value },
        }).success,
      ).toBe(false)
    },
  )

  it("rejects native indices, mismatched body outputs, duplicate faces and untrusted worker options", () => {
    const operation = printOptimizationOperation()
    for (const patch of [
      { bedFace: 7 },
      { bedFace: { ...printOptimizationFace(), meshFaceId: 7 } },
      { bedFace: { ...printOptimizationFace(), featureId: lightweightingId(99) } },
      { preserveFaces: [{ ...printOptimizationFace(), outputRole: "other" }] },
      { preserveFaces: [printOptimizationFace(1), printOptimizationFace(1)] },
      { preserveTriangleIndices: [0] },
      { includeVoxelGrid: true },
      { mesh: {} },
      { material: { kind: "preset", presetId: "steel-304" } },
      { material: { kind: "custom", properties: { youngModulusMpa: 1 } } },
      { cellSizeMm: Number.NaN },
      { cellSizeMm: 0 },
      { cellSizeMm: Number.POSITIVE_INFINITY },
      { layerHeightMm: 2 },
      { maxIterations: -1 },
      { maxIterations: 0.5 },
      { minStiffnessFraction: 0 },
      { minStrengthFraction: 1.01 },
      { supportMode: "automatic" },
    ])
      expect(
        localOperationSchema.safeParse({
          ...operation,
          arguments: {
            ...operation.arguments,
            settings: { ...operation.arguments.settings, ...patch },
          },
        }).success,
      ).toBe(false)
    // Orientation and exact face preservation are independent roles.
    expect(
      localOperationSchema.safeParse({
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...operation.arguments.settings, preserveFaces: [printOptimizationFace()] },
        },
      }).success,
    ).toBe(true)
  })

  it("resolves all six plastic presets and accepts schema-validated custom properties", () => {
    for (const presetId of ["pla", "petg", "abs", "asa", "pc-blend", "nylon"] as const)
      expect(
        resolvePrintOptimizationMaterial({ kind: "preset", presetId }).youngModulusMpa,
      ).toBeGreaterThan(0)
    const properties = {
      youngModulusMpa: 1800,
      poissonRatio: 0.3,
      yieldStrengthMpa: 40,
      densityKgM3: 1200,
    }
    expect(resolvePrintOptimizationMaterial({ kind: "custom", properties })).toEqual(properties)
    const operation = printOptimizationOperation()
    const value = printOptimizationValue()
    expect(
      printOptimizationResultContextMatches(
        {
          ...operation,
          arguments: {
            ...operation.arguments,
            settings: { ...operation.arguments.settings, material: { kind: "custom", properties } },
          },
        },
        {
          ok: true,
          value: {
            ...value,
            summary: {
              ...value.summary,
              configuration: { ...value.summary.configuration, material: properties },
            },
          },
        },
      ),
    ).toBe(true)
  })

  it.each([false, true])(
    "rejects forged source, resolved settings and proposal evidence (request=%s)",
    (request) => {
      const operation = printOptimizationOperation(request)
      const value = printOptimizationValue(request)
      const summary = value.summary
      for (const patch of [
        { documentId: lightweightingId(99) },
        { baseRevision: 5 },
        { source: { ...value.source, contentHash: "b".repeat(64) } },
        {
          summary: {
            ...summary,
            configuration: {
              ...summary.configuration,
              material: { ...summary.configuration.material, youngModulusMpa: 2301 },
            },
          },
        },
        { summary: { ...summary, configuration: { ...summary.configuration, cellSizeMm: 2 } } },
        {
          summary: { ...summary, configuration: { ...summary.configuration, minFeatureSizeMm: 2 } },
        },
        {
          summary: { ...summary, configuration: { ...summary.configuration, layerHeightMm: 0.1 } },
        },
        { summary: { ...summary, configuration: { ...summary.configuration, maxIterations: 25 } } },
        {
          summary: {
            ...summary,
            configuration: { ...summary.configuration, minStiffnessFraction: 0.8 },
          },
        },
        { summary: { ...summary, proposal: { ...summary.proposal, algorithm: undefined } } },
        { summary: { ...summary, proposal: { ...summary.proposal, fdm: undefined } } },
        {
          summary: {
            ...summary,
            proposal: { ...summary.proposal, relativePerformance: undefined },
          },
        },
        { summary: { ...summary, proposal: { ...summary.proposal, iterations: 25 } } },
        { summary: { ...summary, exact: null } },
        { mesh: {} },
        ...(request ? [{ snapshot: null }, { snapshot: { ...value.snapshot, revision: 4 } }] : []),
      ])
        expect(
          printOptimizationResultContextMatches(
            operation,
            { ok: true, value: { ...value, ...patch } },
            lightweightingId(3),
          ),
        ).toBe(false)
    },
  )

  it("checks the fixed exact solid against the original proposal baseline", () => {
    const operation = printOptimizationOperation()
    const value = printOptimizationValue()
    const exact = value.summary.exact
    if (!exact) throw new Error("Expected improved exact fixture.")
    for (const patch of [
      { preservedFaceCount: 0 },
      { volumeMm3: exact.sourceVolumeMm3 },
      { verification: { ...exact.verification, status: "improved" } },
      { verification: { ...exact.verification, iterations: 1 } },
      { verification: { ...exact.verification, algorithm: value.summary.proposal.algorithm } },
      { verification: { ...exact.verification, fdm: undefined } },
    ])
      expect(
        printOptimizationResultContextMatches(operation, {
          ok: true,
          value: { ...value, summary: { ...value.summary, exact: { ...exact, ...patch } } },
        }),
      ).toBe(false)
    const metrics = {
      ...exact.verification.optimized,
      cases: exact.verification.optimized.cases.map((item) => ({ ...item, complianceNmm: 1 })),
    }
    const forged = {
      ...value,
      summary: {
        ...value.summary,
        exact: {
          ...exact,
          verification: { ...exact.verification, baseline: metrics, optimized: metrics },
        },
      },
    }
    // The fixed body passes its own baseline but fails the original source's 0.1 / 0.9 budget.
    expect(printOptimizationResultContextMatches(operation, { ok: true, value: forged })).toBe(
      false,
    )
  })

  it("allows omitted geometry-derived cell size while binding dependent defaults and no-improvement nulls", () => {
    const operation = printOptimizationOperation(true)
    const { cellSizeMm: _cell, ...settings } = operation.arguments.settings
    const input = { ...operation, arguments: { ...operation.arguments, settings } }
    const value = printOptimizationValue(true, false)
    expect(printOptimizationResultContextMatches(input, { ok: true, value })).toBe(true)
    expect(
      localToolOutputs.request_print_optimization.safeParse({
        ok: true,
        value: { ...value, snapshot: printOptimizationValue(true).snapshot },
      }).success,
    ).toBe(false)
    expect(
      printOptimizationResultContextMatches(
        {
          ...operation,
          arguments: { ...operation.arguments, settings: { ...settings, maxIterations: 3 } },
        },
        { ok: true, value },
      ),
    ).toBe(false)
  })
})
