import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  lightweightingId,
  lightweightingIdentity,
  lightweightingSnapshot,
  lightweightingSummary,
} from "./lightweighting.test-fixtures"
import {
  printOptimizationOperationSchema,
  printOptimizationSummarySchema,
} from "./print-optimization-tools"

export function printOptimizationFace(z = 0) {
  return bodyFaceRefSchema.parse({
    schemaVersion: 1,
    featureId: lightweightingIdentity.featureId,
    outputRole: "result",
    kind: "face",
    semanticRole: "cap",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 100,
      centroid: [0, 0, z],
      bounds: { min: [-5, -5, z], max: [5, 5, z] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
      direction: [0, 0, 1],
      directionMode: "oriented",
    },
  })
}

export function printOptimizationOperation(request = false) {
  return printOptimizationOperationSchema.parse({
    tool: request ? "request_print_optimization" : "analyze_print_optimization",
    arguments: {
      baseRevision: 4,
      source: lightweightingIdentity,
      settings: {
        bedFace: printOptimizationFace(),
        preserveFaces: [printOptimizationFace(1)],
        material: { kind: "preset", presetId: "pla" },
        cellSizeMm: 1,
      },
      ...(request ? { label: "Exact print snapshot" } : {}),
    },
  })
}

export function printOptimizationSummary(improved = true) {
  const base = lightweightingSummary(improved)
  const metrics = (source: typeof base.baseline) => ({
    ...source,
    cases: ["Axial tension", "Bending 1", "Bending 2", "Torsion"].map((name) => ({
      ...source.cases[0],
      name,
    })),
  })
  const fdmMetrics = {
    unsupportedAreaMm2: 0,
    requiresSupports: false,
    minFeatureSizeBoundMm: 1,
    buildHeightMm: 8,
  }
  const fdm = {
    settings: {
      buildDirection: "+z",
      supportMode: "allowed",
      minFeatureSizeMm: 1,
      layerHeightMm: 0.2,
      maxOverhangAngleDeg: 45,
    },
    approximation: "conservative-voxel",
    minimumFeatureCubeCells: 1,
    horizontalReachMm: 0.2 * Math.tan(Math.PI / 4),
    buildPlateCoordinateMm: 0,
    baseline: fdmMetrics,
    optimized: fdmMetrics,
  }
  const baseline = metrics(base.baseline)
  const optimized = metrics(base.optimized)
  return printOptimizationSummarySchema.parse({
    proposal: {
      ...base,
      baseline,
      optimized,
      fdm,
      relativePerformance: { minStiffnessFraction: 0.9, minStrengthFraction: 0.9 },
      evaluations: 8,
      algorithm: {
        kind: "simp",
        settings: { kind: "simp", volumeFraction: 0.1, filterRadiusMm: 1.5, penalty: 3 },
        densityIterations: 4,
        converged: false,
        maxDensityChange: 0.1,
        targetCellCount: 4,
        achievedCellCount: improved ? 32 : 40,
        targetStatus: "not-reached",
        projectionEvaluations: 2,
      },
    },
    exact: improved
      ? {
          sourceVolumeMm3: 48,
          volumeMm3: 32,
          preservedFaceCount: 1,
          verification: {
            ...base,
            status: "no-improvement",
            baseline: optimized,
            optimized,
            sourceVolumeMm3: 32,
            sourceVolumeLossFraction: 0,
            initialCellCount: 32,
            finalCellCount: 32,
            iterations: 0,
            evaluations: 2,
            fdm,
          },
        }
      : null,
    configuration: {
      material: {
        youngModulusMpa: 2300,
        poissonRatio: 0.35,
        yieldStrengthMpa: 51,
        densityKgM3: 1240,
      },
      cellSizeMm: 1,
      minFeatureSizeMm: 1,
      layerHeightMm: 0.2,
      maxIterations: 24,
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
      supportMode: "allowed",
    },
    scenarioBasis: "normalized-longest-span-end-clamped",
    sourceToPrintFrame: { originMm: [0, 0, 0], rotation: [0, 0, 0, 1] },
  })
}

export function printOptimizationValue(request = false, improved = true) {
  return {
    documentId: lightweightingId(3),
    baseRevision: 4,
    source: lightweightingIdentity,
    summary: printOptimizationSummary(improved),
    ...(request ? { snapshot: improved ? lightweightingSnapshot() : null } : {}),
  }
}
