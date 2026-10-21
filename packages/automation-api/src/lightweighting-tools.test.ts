import { describe, expect, it } from "bun:test"
import type { StructuralAlgorithmSummary } from "@vibeshape/domain/lightweighting"
import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import {
  lightweightingId,
  lightweightingOperation,
  lightweightingSettings,
  lightweightingSnapshot,
  lightweightingStiffnessSummary,
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

function algorithmEvidence(kind: "simp" | "adaptive-lattice"): StructuralAlgorithmSummary {
  return kind === "simp"
    ? {
        kind,
        settings: { kind, volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
        densityIterations: 4,
        converged: false,
        maxDensityChange: 0.1,
        targetCellCount: 32,
        achievedCellCount: 32,
        targetStatus: "reached",
        projectionEvaluations: 2,
      }
    : {
        kind,
        settings: {
          kind,
          lattice: "gyroid",
          cellPeriodMm: 8,
          minWallThicknessMm: 2,
          maxWallThicknessMm: 3,
          skinThicknessMm: 0,
          field: "strain-energy",
          gamma: 1,
        },
        fieldMin: 0.1,
        fieldMax: 1,
        requestedWallMinMm: 2,
        requestedWallMaxMm: 3,
        minimumFeatureSizeBoundMm: 2,
        projectionEvaluations: 2,
        thresholdPasses: 4,
      }
}

function evidenceWithCounters(
  evidence: StructuralAlgorithmSummary,
  iterations: number,
  projections: number,
  improved = true,
): StructuralAlgorithmSummary {
  if (evidence.kind === "adaptive-lattice")
    return { ...evidence, thresholdPasses: iterations, projectionEvaluations: projections }
  return {
    ...evidence,
    densityIterations: iterations,
    projectionEvaluations: projections,
    achievedCellCount: improved ? 32 : 40,
    targetStatus: improved ? "reached" : "not-reached",
  }
}
function algorithmResponse(
  request: boolean,
  algorithm: StructuralAlgorithmSummary,
  iterations: number,
  evaluations: number,
  improved = true,
) {
  return {
    documentId: lightweightingId(3),
    baseRevision: 4,
    source: lightweightingOperation(request).arguments.source,
    summary: { ...lightweightingSummary(improved), iterations, algorithm, evaluations },
    ...(request ? { snapshot: improved ? lightweightingSnapshot() : null } : {}),
  }
}

describe("bounded paired-browser lightweighting contracts", () => {
  it.each(["simp", "adaptive-lattice"] as const)(
    "binds %s projection evidence to its budget and total FEM evaluations",
    (kind) => {
      for (const request of [false, true]) {
        const base = lightweightingOperation(request)
        const evidence = algorithmEvidence(kind)
        for (const [budget, iterations, projections, evaluationDelta, accepted] of [
          [0, 0, 0, 0, true],
          [0, 0, 80, -80, false],
          [0, 0, 1, 0, false],
          [1, 1, 1, 0, true],
          [1, 1, 2, 0, kind === "simp"],
          [1, 1, 3, 0, false],
          [40, 40, 80, 0, false],
          [40, 40, 2, 0, true],
          [4, 4, 1, -1, false],
          [4, 4, 1, 1, false],
        ] as const) {
          const operation = {
            ...base,
            arguments: {
              ...base.arguments,
              settings: {
                ...base.arguments.settings,
                algorithm: evidence.settings,
                maxIterations: budget,
              },
            },
          }
          const algorithm = evidenceWithCounters(evidence, iterations, projections, budget > 0)
          const value = algorithmResponse(
            request,
            algorithm,
            iterations,
            2 + (kind === "simp" ? iterations : 0) + projections + evaluationDelta,
            budget > 0,
          )
          const schema = request ? lightweightingRequestSchema : lightweightingAnalysisSchema
          expect(schema.safeParse(value).success).toBe(true)
          expect(lightweightingResultContextMatches(operation, { ok: true, value })).toBe(accepted)
        }
      }
    },
  )

  it.each(["simp", "adaptive-lattice"] as const)(
    "binds %s iteration evidence to the summary and request budget",
    (kind) => {
      for (const request of [false, true]) {
        const operation = lightweightingOperation(request)
        const evidence = algorithmEvidence(kind)
        const withAlgorithm = {
          ...operation,
          arguments: {
            ...operation.arguments,
            settings: { ...operation.arguments.settings, algorithm: evidence.settings },
          },
        }
        for (const [iterations, counter, accepted] of [
          [0, 0, true],
          [4, 4, true],
          [1, 0, false],
          [1, 4, false],
          [1, 40, false],
          [4, 1, false],
          [5, 5, false],
        ] as const) {
          const algorithm = evidenceWithCounters(evidence, counter, iterations === 0 ? 0 : 2)
          const value = algorithmResponse(
            request,
            algorithm,
            iterations,
            2 + algorithm.projectionEvaluations + (kind === "simp" ? iterations : 0),
          )
          const schema = request ? lightweightingRequestSchema : lightweightingAnalysisSchema
          expect(schema.safeParse(value).success).toBe(true)
          expect(lightweightingResultContextMatches(withAlgorithm, { ok: true, value })).toBe(
            accepted,
          )
        }
      }
    },
  )
  it("binds algorithm evidence to the requested settings on local and remote transports", () => {
    for (const request of [false, true]) {
      const operation = lightweightingOperation(request)
      const algorithm = {
        kind: "simp",
        volumeFraction: 0.8,
        filterRadiusMm: 1.5,
        penalty: 3,
      } as const
      const withAlgorithm = {
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...operation.arguments.settings, algorithm },
        },
      }
      for (const schema of [localOperationSchema, remoteOperationSchema])
        expect(schema.parse(withAlgorithm).arguments).toMatchObject({ settings: { algorithm } })
      const evidence = {
        kind: "simp",
        settings: algorithm,
        densityIterations: 4,
        converged: false,
        maxDensityChange: 0.1,
        targetCellCount: 32,
        achievedCellCount: 32,
        targetStatus: "reached",
        projectionEvaluations: 2,
      }
      const value = {
        documentId: lightweightingId(3),
        baseRevision: 4,
        source: operation.arguments.source,
        summary: { ...lightweightingSummary(), evaluations: 8, algorithm: evidence },
        ...(request ? { snapshot: lightweightingSnapshot() } : {}),
      }
      expect(lightweightingResultContextMatches(withAlgorithm, { ok: true, value })).toBe(true)
      expect(lightweightingResultContextMatches(operation, { ok: true, value })).toBe(false)
      for (const patch of [
        undefined,
        { ...evidence, settings: { ...algorithm, penalty: 2 } },
        { ...evidence, achievedCellCount: 31 },
      ]) {
        expect(
          lightweightingResultContextMatches(withAlgorithm, {
            ok: true,
            value: { ...value, summary: { ...value.summary, algorithm: patch } },
          }),
        ).toBe(false)
      }
    }
  })
  it("preserves adaptive lattice settings and rejects underresolved walls before dispatch", () => {
    const algorithm = {
      kind: "adaptive-lattice",
      lattice: "gyroid",
      cellPeriodMm: 10,
      minWallThicknessMm: 2,
      maxWallThicknessMm: 4,
      skinThicknessMm: 1,
      field: "strain-energy",
      gamma: 1,
    }
    for (const schema of [localOperationSchema, remoteOperationSchema]) {
      const operation = lightweightingOperation()
      const withAlgorithm = {
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...operation.arguments.settings, algorithm },
        },
      }
      expect(schema.parse(withAlgorithm).arguments).toMatchObject({ settings: { algorithm } })
      for (const patch of [
        { minWallThicknessMm: 0.5 },
        { cellPeriodMm: 3 },
        { skinThicknessMm: 0.5 },
        { gamma: 0 },
        { field: "stress-guess" },
      ])
        expect(
          schema.safeParse({
            ...withAlgorithm,
            arguments: {
              ...withAlgorithm.arguments,
              settings: {
                ...withAlgorithm.arguments.settings,
                algorithm: { ...algorithm, ...patch },
              },
            },
          }).success,
        ).toBe(false)
    }
  })
  it("binds FDM evidence to the request before accepting analysis or an applied snapshot", () => {
    for (const request of [false, true]) {
      const operation = lightweightingOperation(request)
      const settings = {
        buildDirection: "+z",
        supportMode: "forbidden",
        minFeatureSizeMm: 0.5,
        layerHeightMm: 0.2,
        maxOverhangAngleDeg: 0,
      }
      const withFdm = {
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...operation.arguments.settings, fdm: settings },
        },
      }
      const metrics = {
        unsupportedAreaMm2: 0,
        requiresSupports: false,
        minFeatureSizeBoundMm: 0.999998,
        buildHeightMm: 2,
      }
      const fdm = {
        settings,
        approximation: "conservative-voxel",
        minimumFeatureCubeCells: 1,
        horizontalReachMm: 0,
        buildPlateCoordinateMm: 0,
        baseline: metrics,
        optimized: metrics,
      }
      const value = {
        documentId: lightweightingId(3),
        baseRevision: 4,
        source: operation.arguments.source,
        summary: { ...lightweightingSummary(), fdm },
        ...(request ? { snapshot: lightweightingSnapshot() } : {}),
      }
      expect(lightweightingResultContextMatches(withFdm, { ok: true, value })).toBe(true)
      expect(lightweightingResultContextMatches(operation, { ok: true, value })).toBe(false)
      for (const patch of [
        { fdm: undefined },
        { fdm: { ...fdm, settings: { ...settings, buildDirection: "-z" } } },
        { fdm: { ...fdm, optimized: { ...metrics, minFeatureSizeBoundMm: 0.4 } } },
        {
          fdm: { ...fdm, optimized: { ...metrics, unsupportedAreaMm2: 1, requiresSupports: true } },
        },
      ])
        expect(
          lightweightingResultContextMatches(withFdm, {
            ok: true,
            value: { ...value, summary: { ...value.summary, ...patch } },
          }),
        ).toBe(false)
    }
  })
  it("preserves both FDM support policies on paired transports and rejects invalid layer settings", () => {
    for (const request of [false, true]) {
      const operation = lightweightingOperation(request)
      for (const supportMode of ["allowed", "forbidden"]) {
        const fdm = {
          supportMode,
          buildDirection: "-y",
          minFeatureSizeMm: 1.2,
          layerHeightMm: 0.2,
          maxOverhangAngleDeg: 45,
        }
        const withFdm = {
          ...operation,
          arguments: {
            ...operation.arguments,
            settings: { ...operation.arguments.settings, fdm },
          },
        }
        for (const schema of [localOperationSchema, remoteOperationSchema]) {
          expect(schema.parse(withFdm).arguments).toMatchObject({ settings: { fdm } })
          for (const invalid of [{ maxOverhangAngleDeg: 90 }, { layerHeightMm: 2 }])
            expect(
              schema.safeParse({
                ...withFdm,
                arguments: {
                  ...withFdm.arguments,
                  settings: {
                    ...withFdm.arguments.settings,
                    fdm: { ...fdm, ...invalid },
                  },
                },
              }).success,
            ).toBe(false)
        }
      }
    }
  })
  it("preserves bounded keep-out boxes on both transports and rejects degenerate regions", () => {
    for (const request of [false, true]) {
      const operation = lightweightingOperation(request)
      const obstacleRegions = [{ min: [1, 2, 3], max: [4, 5, 6] }]
      const withObstacles = {
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...operation.arguments.settings, obstacleRegions },
        },
      }
      for (const schema of [localOperationSchema, remoteOperationSchema]) {
        const parsed = schema.parse(withObstacles)
        expect(parsed.arguments).toMatchObject({ settings: { obstacleRegions } })
        expect(
          schema.safeParse({
            ...withObstacles,
            arguments: {
              ...withObstacles.arguments,
              settings: {
                ...withObstacles.arguments.settings,
                obstacleRegions: [{ min: [1, 2, 3], max: [1, 5, 6] }],
              },
            },
          }).success,
        ).toBe(false)
      }
    }
  })
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
  it.each([false, true])(
    "binds the structural retained-mass objective and target status (reached=%s)",
    (reached) => {
      const base = lightweightingOperation()
      const summary = lightweightingStiffnessSummary(reached)
      const operation = {
        ...base,
        arguments: {
          ...base.arguments,
          settings: {
            ...base.arguments.settings,
            objective: { kind: "maximize-stiffness", retainedMassFraction: reached ? 0.8 : 0.6 },
          },
        },
      }
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      const value = {
        documentId: lightweightingId(3),
        baseRevision: 4,
        source: base.arguments.source,
        summary,
      }
      expect(lightweightingResultContextMatches(operation, { ok: true, value })).toBe(true)
      for (const patch of [
        { kind: "minimize-mass" },
        { ...summary.objective, retainedMassFraction: 0.5 },
        { ...summary.objective, targetMassKg: 0.00001 },
        { ...summary.objective, targetCellCount: 10 },
        { ...summary.objective, achievedRetainedMassFraction: 0.5 },
        { ...summary.objective, targetStatus: reached ? "not-reached" : "reached" },
      ])
        expect(
          lightweightingResultContextMatches(operation, {
            ok: true,
            value: { ...value, summary: { ...summary, objective: patch } },
          }),
        ).toBe(false)
      expect(
        lightweightingResultContextMatches(operation, {
          ok: true,
          value: { ...value, summary: { ...summary, objective: undefined } },
        }),
      ).toBe(false)
      expect(lightweightingResultContextMatches(base, { ok: true, value })).toBe(false)
      expect(
        lightweightingResultContextMatches(operation, {
          ok: true,
          value: {
            ...value,
            summary: {
              ...summary,
              optimized: { ...summary.optimized, massKg: 0.00002 },
              objective: { ...summary.objective, achievedRetainedMassFraction: 0.5 },
            },
          },
        }),
      ).toBe(false)
    },
  )
  it("accepts explicit minimum-mass intent and rejects invalid objective budgets", () => {
    const base = lightweightingOperation()
    const withObjective = (objective: unknown) => ({
      ...base,
      arguments: { ...base.arguments, settings: { ...base.arguments.settings, objective } },
    })
    expect(localOperationSchema.safeParse(withObjective({ kind: "minimize-mass" })).success).toBe(
      true,
    )
    for (const objective of [
      { kind: "maximize-stiffness", retainedMassFraction: 0.09 },
      { kind: "maximize-stiffness", retainedMassFraction: 1.01 },
      { kind: "maximize-stiffness", retainedMassFraction: Number.NaN },
      { kind: "maximize-stiffness" },
      { kind: "minimize-mass", retainedMassFraction: 0.5 },
    ])
      expect(localOperationSchema.safeParse(withObjective(objective)).success).toBe(false)
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
