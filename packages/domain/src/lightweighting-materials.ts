import { z } from "zod"
import { structuralMaterialSchema } from "./lightweighting"

export const structuralMaterialPresetIdSchema = z.enum([
  "pla",
  "petg",
  "abs",
  "asa",
  "pc-blend",
  "nylon",
  "aluminum-6061-t6",
  "steel-304",
])
export const structuralMaterialPresetSchema = z
  .object({
    id: structuralMaterialPresetIdSchema,
    referenceName: z.string().min(1).max(120),
    category: z.enum(["printed-plastic", "metal"]),
    basis: z.enum(["printed-horizontal", "printed-xy", "extruded-t6", "cold-rolled-sheet"]),
    material: structuralMaterialSchema,
    poissonRatioBasis: z.literal("assumed"),
    yieldStrengthBasis: z.enum(["sample-mean", "minimum-rp02"]),
    sourceRevision: z.string().min(1).max(120),
    sourceUrls: z.array(z.url()).min(1).max(3),
  })
  .strict()
export type StructuralMaterialPresetId = z.infer<typeof structuralMaterialPresetIdSchema>
export type StructuralMaterialPreset = z.infer<typeof structuralMaterialPresetSchema>
export const structuralMaterialCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    presets: z.array(structuralMaterialPresetSchema).length(8),
    limitations: z.array(z.string().min(1).max(500)).min(1).max(8),
  })
  .strict()

// Published sample means (metals: stated minimum yield); Poisson ratios are explicit assumptions.
export const structuralMaterialCatalog = structuralMaterialCatalogSchema.parse({
  schemaVersion: 1,
  presets: [
    {
      id: "pla",
      referenceName: "Prusament PLA",
      category: "printed-plastic",
      basis: "printed-horizontal",
      material: {
        youngModulusMpa: 2300,
        poissonRatio: 0.35,
        yieldStrengthMpa: 51,
        densityKgM3: 1240,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v1.1, 2022-02-16",
      sourceUrls: [
        "https://prusament.com/wp-content/uploads/2022/10/PLA_Prusament_TDS_2021_10_EN.pdf",
      ],
    },
    {
      id: "petg",
      referenceName: "UltiMaker PETG",
      category: "printed-plastic",
      basis: "printed-xy",
      material: {
        youngModulusMpa: 1939,
        poissonRatio: 0.35,
        yieldStrengthMpa: 46.2,
        densityKgM3: 1270,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v1.00, 2022-04-29",
      sourceUrls: [
        "https://um-support-files.ultimaker.com/materials/2.85mm/tds/PETG/Ultimaker-PETG-TDS-v1.00.pdf",
      ],
    },
    {
      id: "abs",
      referenceName: "UltiMaker ABS",
      category: "printed-plastic",
      basis: "printed-xy",
      material: {
        youngModulusMpa: 1962,
        poissonRatio: 0.35,
        yieldStrengthMpa: 38.1,
        densityKgM3: 1100,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v5.00, 2022-04-20",
      sourceUrls: [
        "https://um-support-files.ultimaker.com/materials/2.85mm/tds/ABS/Ultimaker-ABS-TDS-v5.00.pdf",
      ],
    },
    {
      id: "asa",
      referenceName: "Prusament ASA",
      category: "printed-plastic",
      basis: "printed-horizontal",
      material: {
        youngModulusMpa: 1600,
        poissonRatio: 0.35,
        yieldStrengthMpa: 42,
        densityKgM3: 1070,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v1.1, 2022-02-16",
      sourceUrls: [
        "https://prusament.com/wp-content/uploads/2022/10/ASA_Prusament_TDS_2022_16_EN.pdf",
      ],
    },
    {
      id: "pc-blend",
      referenceName: "Prusament PC Blend",
      category: "printed-plastic",
      basis: "printed-horizontal",
      material: {
        youngModulusMpa: 1900,
        poissonRatio: 0.35,
        yieldStrengthMpa: 63,
        densityKgM3: 1220,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v1.1, 2022-02-16",
      sourceUrls: [
        "https://prusament.com/wp-content/uploads/2022/10/PCBlend_Prusament_TDS_2022_16_EN.pdf",
      ],
    },
    {
      id: "nylon",
      referenceName: "UltiMaker Nylon (PA6/66)",
      category: "printed-plastic",
      basis: "printed-xy",
      material: {
        youngModulusMpa: 2331,
        poissonRatio: 0.35,
        yieldStrengthMpa: 63.1,
        densityKgM3: 1140,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "sample-mean",
      sourceRevision: "v2.00 footer, 2022-04-20",
      sourceUrls: [
        "https://um-support-files.ultimaker.com/materials/2.85mm/tds/NYLON/Ultimaker-Nylon-TDS-v5.00.pdf",
      ],
    },
    {
      id: "aluminum-6061-t6",
      referenceName: "Hydro 6061-T6 / T6511",
      category: "metal",
      basis: "extruded-t6",
      material: {
        youngModulusMpa: 69000,
        poissonRatio: 0.33,
        yieldStrengthMpa: 240,
        densityKgM3: 2700,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "minimum-rp02",
      sourceRevision: "6061: 2019/01 (02/2019); pipe/tube: 08/2023",
      sourceUrls: [
        "https://www.hydro.com/globalassets/01-products--services/extruded-profiles/americas/ena-resources/alloy-data-sheets/hydro_2019_data_sheet_6061.pdf",
        "https://www.hydro.com/globalassets/01-products--services/extruded-profiles/americas/ena-resources/sales-literature/pipe_tube_combined_july_2023_gelato.pdf",
      ],
    },
    {
      id: "steel-304",
      referenceName: "Outokumpu Core 304 / 1.4301",
      category: "metal",
      basis: "cold-rolled-sheet",
      material: {
        youngModulusMpa: 200000,
        poissonRatio: 0.3,
        yieldStrengthMpa: 230,
        densityKgM3: 7900,
      },
      poissonRatioBasis: "assumed",
      yieldStrengthBasis: "minimum-rp02",
      sourceRevision: "1560EN:4, November 2022",
      sourceUrls: [
        "https://www.outokumpu.com/en/products/product-ranges/-/media/files/products/core/outokumpu-core-range-datasheet.pdf?modified=20251117111909&revision=025e9931-a1d5-4c8f-8ff5-f881d38916da",
      ],
    },
  ],
  limitations: [
    "Presets are editable starting assumptions for the named grades and specimen conditions, not universal material properties or certified design allowables.",
    "All Poisson ratios are assumed, not measured by the linked datasheets.",
    "Printed sample values refer to 100% infill in the stated test orientation. Layer adhesion, infill, moisture, temperature and print settings can change performance; the solver remains isotropic.",
    "TPU and other elastomers are omitted because this linear-elastic yield-limited solver does not model their nonlinear behavior.",
  ],
})
