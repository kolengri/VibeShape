import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import type { StructuralOptimizationInput } from "@vibeshape/structural-optimization/contract"
import { generativeDesignInputSchema } from "@vibeshape/structural-optimization/generative-design"
import type { RegionFields } from "./lightweighting-model"

export type GenerativeDesignFields = {
  retainedMassPercents: string
  additionalMaterialIds: string[]
  obstacles: { id: number; region: RegionFields }[]
}

export function generativeDesignInput(
  analysis: StructuralOptimizationInput,
  fields: GenerativeDesignFields,
  currentMaterialName: string,
) {
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value))
  const additional = fields.additionalMaterialIds.map((id) =>
    structuralMaterialCatalog.presets.find((preset) => preset.id === id),
  )
  if (additional.some((preset) => !preset)) return null
  const parsed = generativeDesignInputSchema.safeParse({
    schemaVersion: 1,
    analysis: {
      ...analysis,
      obstacleRegions: fields.obstacles.map(({ region }) => ({
        min: region.min.map(number),
        max: region.max.map(number),
      })),
    },
    materials: [
      { id: "current", name: currentMaterialName, material: analysis.material },
      ...additional.flatMap((preset) =>
        preset ? [{ id: preset.id, name: preset.referenceName, material: preset.material }] : [],
      ),
    ],
    retainedMassFractions: fields.retainedMassPercents
      .split(",")
      .map((value) => number(value) / 100),
  })
  return parsed.success ? parsed.data : null
}
