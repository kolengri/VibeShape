import { preparePrintOptimization } from "@vibeshape/structural-optimization/print-optimization"
import type { LightweightingFields, LightweightingSource } from "./lightweighting-model"
import { sameLightweightingSource } from "./lightweighting-model"
import { faceTriangleIndices } from "./lightweighting-surface-selection"

export type PrintOptimizationFields = {
  captured: LightweightingSource | null
  bedFace: number | null
  preserveFaces: number[]
  cellSizeMm: string
  minFeatureSizeMm: string
  layerHeightMm: string
  stiffnessPercent: string
  strengthPercent: string
  maxIterations: string
  supportMode: "allowed" | "forbidden"
}

export function initialPrintOptimizationFields(
  source: LightweightingSource | null,
): PrintOptimizationFields {
  const defaults = defaultPrintOptimizationParameters(source)
  return {
    captured: source,
    bedFace: null,
    preserveFaces: [],
    cellSizeMm: String(defaults.cellSizeMm),
    minFeatureSizeMm: String(defaults.minFeatureSizeMm),
    layerHeightMm: String(defaults.layerHeightMm),
    stiffnessPercent: "90",
    strengthPercent: "90",
    maxIterations: "24",
    supportMode: "allowed",
  }
}

/** The editor and paired automation resolve the same geometry-dependent defaults. */
export function defaultPrintOptimizationParameters(source: LightweightingSource | null) {
  const bounds = source?.body.shape.bounds ?? { min: [0, 0, 0], max: [16, 8, 8] }
  const spans = bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0))
  const cell = Number(
    Math.max(0.01, Math.min(Math.max(...spans) / 16, Math.min(...spans) / 4)).toPrecision(4),
  )
  return {
    cellSizeMm: cell,
    minFeatureSizeMm: Math.max(0.8, cell),
    layerHeightMm: Math.min(0.2, cell),
  }
}

const numeric = (value: string) => (value.trim() === "" ? Number.NaN : Number(value))

export function samePrintOptimizationSource(
  current: LightweightingSource | null,
  captured: LightweightingSource | null,
) {
  return (
    captured !== null &&
    sameLightweightingSource(current, captured) &&
    current?.body.mesh.triangleFaceIds === captured.body.mesh.triangleFaceIds
  )
}

export function preparePrintFields(
  source: LightweightingSource,
  material: LightweightingFields,
  fields: PrintOptimizationFields,
) {
  if (!samePrintOptimizationSource(source, fields.captured) || fields.bedFace === null) return null
  const prepared = preparePrintOptimization({
    mesh: {
      vertices: Array.from(source.body.mesh.precisePositions ?? source.body.mesh.positions),
      indices: Array.from(source.body.mesh.indices),
    },
    bedTriangleIndices: faceTriangleIndices(source, [fields.bedFace]),
    preserveTriangleIndices: faceTriangleIndices(source, fields.preserveFaces),
    material: {
      youngModulusMpa: numeric(material.youngModulusMpa),
      poissonRatio: numeric(material.poissonRatio),
      yieldStrengthMpa: numeric(material.yieldStrengthMpa),
      densityKgM3: numeric(material.densityKgM3),
    },
    cellSizeMm: numeric(fields.cellSizeMm),
    minFeatureSizeMm: numeric(fields.minFeatureSizeMm),
    layerHeightMm: numeric(fields.layerHeightMm),
    maxIterations: numeric(fields.maxIterations),
    minStiffnessFraction: numeric(fields.stiffnessPercent) / 100,
    minStrengthFraction: numeric(fields.strengthPercent) / 100,
    supportMode: fields.supportMode,
  })
  return {
    ...prepared,
    analysisContext: {
      scenarioBasis: "normalized-longest-span-end-clamped" as const,
      sourceToPrintFrame: prepared.frame,
      bedTriangleIndices: faceTriangleIndices(source, [fields.bedFace]),
      materialModel: "isotropic-without-layer-adhesion" as const,
    },
  }
}
