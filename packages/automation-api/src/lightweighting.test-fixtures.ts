import { structuralOptimizationSummarySchema } from "@vibeshape/domain/lightweighting"
import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import { importUploadCommitSchema } from "./imports"
import {
  lightweightingOperationSchema,
  lightweightingSourceIdentitySchema,
} from "./lightweighting-tools"

export const lightweightingId = (n: number) =>
  `0195b5ac-b280-7a2c-8c33-${String(n).padStart(12, "0")}`
export const lightweightingIdentity = lightweightingSourceIdentitySchema.parse({
  partId: lightweightingId(1),
  featureId: lightweightingId(2),
  outputRole: "result",
  contentHash: "a".repeat(64),
})
export const lightweightingSettings = {
  material: { youngModulusMpa: 1000, poissonRatio: 0.3, yieldStrengthMpa: 100, densityKgM3: 1000 },
  safetyFactor: 2,
  maxDisplacementMm: 1,
  cellSizeMm: 1,
  supports: [{ min: [0, 0, 0], max: [1, 2, 2] }],
  loadCases: [{ name: "Tip load", region: { min: [3, 0, 0], max: [4, 2, 2] }, forceN: [0, 0, -1] }],
  preserveRegions: [],
  maxIterations: 4,
}
export function lightweightingMaterialCatalogResult() {
  return { ok: true as const, value: structuralMaterialCatalog }
}
export function lightweightingOperation(request = false) {
  return lightweightingOperationSchema.parse({
    tool: request ? "request_lightweighting" : "analyze_lightweighting",
    arguments: {
      baseRevision: 4,
      source: lightweightingIdentity,
      settings: lightweightingSettings,
      ...(request ? { label: "Lightweighted snapshot" } : {}),
    },
  })
}
const metrics = {
  volumeMm3: 40,
  massKg: 0.00004,
  maxVonMisesMpa: 10,
  maxDisplacementMm: 0.1,
  safetyFactor: 10,
  cases: [
    {
      name: "Tip load",
      maxVonMisesMpa: 10,
      maxDisplacementMm: 0.1,
      safetyFactor: 10,
      complianceNmm: 0.1,
    },
  ],
}
export function lightweightingSummary(improved = true) {
  return structuralOptimizationSummarySchema.parse({
    schemaVersion: 1,
    status: improved ? "improved" : "no-improvement",
    baseline: metrics,
    optimized: { ...metrics, volumeMm3: improved ? 32 : 40, massKg: improved ? 0.000032 : 0.00004 },
    sourceVolumeMm3: 48,
    sourceVolumeLossFraction: 1 / 6,
    cellSizeMm: 1,
    initialCellCount: 40,
    finalCellCount: improved ? 32 : 40,
    iterations: 4,
    evaluations: 6,
    termination: "iteration-limit",
    warnings: ["Preliminary linear-elastic cell analysis."],
  })
}
export function lightweightingSnapshot() {
  return importUploadCommitSchema.parse({
    uploadId: lightweightingId(5),
    documentId: lightweightingId(3),
    baseRevision: 4,
    revision: 5,
    uploadVersion: 2,
    featureId: lightweightingId(6),
    outputRoles: [`mesh.${lightweightingId(7)}`],
  })
}
