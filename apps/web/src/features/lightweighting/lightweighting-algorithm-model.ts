import type { StructuralOptimizationSettings } from "@vibeshape/domain/lightweighting"

export type LightweightingAlgorithmFields = {
  kind: "greedy" | "simp" | "adaptive-lattice"
  volumePercent: string
  filterRadiusMm: string
  penalty: string
  lattice: "gyroid" | "schwarz-p" | "schwarz-d"
  cellPeriodMm: string
  minWallThicknessMm: string
  maxWallThicknessMm: string
  skinThicknessMm: string
  field: "strain-energy" | "von-mises"
  gamma: string
}

export function initialAlgorithmFields(cellSizeMm: number): LightweightingAlgorithmFields {
  const length = (cells: number) => String(cells * cellSizeMm)
  return {
    kind: "greedy",
    volumePercent: "50",
    filterRadiusMm: length(1.5),
    penalty: "3",
    lattice: "gyroid",
    cellPeriodMm: length(10),
    minWallThicknessMm: length(2),
    maxWallThicknessMm: length(4),
    skinThicknessMm: "0",
    field: "strain-energy",
    gamma: "1",
  }
}

export function algorithmInput(
  fields: LightweightingAlgorithmFields,
): StructuralOptimizationSettings["algorithm"] {
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value))
  if (fields.kind === "greedy") return undefined
  if (fields.kind === "simp")
    return {
      kind: "simp",
      volumeFraction: number(fields.volumePercent) / 100,
      filterRadiusMm: number(fields.filterRadiusMm),
      penalty: number(fields.penalty),
    }
  return {
    kind: "adaptive-lattice",
    lattice: fields.lattice,
    cellPeriodMm: number(fields.cellPeriodMm),
    minWallThicknessMm: number(fields.minWallThicknessMm),
    maxWallThicknessMm: number(fields.maxWallThicknessMm),
    skinThicknessMm: number(fields.skinThicknessMm),
    field: fields.field,
    gamma: number(fields.gamma),
  }
}
