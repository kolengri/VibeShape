import { describe, expect, it } from "vitest"
import {
  structuralMaterialCatalog,
  structuralMaterialCatalogSchema,
} from "./lightweighting-materials"

describe("published structural material examples", () => {
  it("uses printed tensile values and converted units instead of filament or flexural values", () => {
    const byId = Object.fromEntries(
      structuralMaterialCatalog.presets.map((preset) => [preset.id, preset]),
    )
    expect(byId.pla).toMatchObject({
      basis: "printed-horizontal",
      material: { youngModulusMpa: 2300, yieldStrengthMpa: 51, densityKgM3: 1240 },
    })
    expect(byId.abs).toMatchObject({
      basis: "printed-xy",
      material: { youngModulusMpa: 1962, yieldStrengthMpa: 38.1, densityKgM3: 1100 },
    })
    expect(byId["steel-304"]).toMatchObject({
      basis: "cold-rolled-sheet",
      yieldStrengthBasis: "minimum-rp02",
      material: { youngModulusMpa: 200000, yieldStrengthMpa: 230, densityKgM3: 7900 },
    })
    expect(byId["aluminum-6061-t6"]).toMatchObject({
      material: { youngModulusMpa: 69000, yieldStrengthMpa: 240, densityKgM3: 2700 },
    })
    for (const preset of structuralMaterialCatalog.presets) {
      expect(preset.poissonRatioBasis).toBe("assumed")
      expect(preset.sourceRevision.length).toBeGreaterThan(0)
      for (const url of preset.sourceUrls) expect(url.startsWith("https://")).toBe(true)
    }
  })
  it("rejects invalid numerical properties and unsupported unqualified presets", () => {
    const catalog = {
      ...structuralMaterialCatalog,
      presets: structuralMaterialCatalog.presets.map((preset) => ({
        ...preset,
        material: { ...preset.material },
      })),
    }
    const first = catalog.presets[0]
    if (!first) throw new Error("Expected a PLA example.")
    first.material.youngModulusMpa = Number.NaN
    expect(structuralMaterialCatalogSchema.safeParse(catalog).success).toBe(false)
    expect(
      structuralMaterialCatalogSchema.safeParse({ ...structuralMaterialCatalog, arbitrary: true })
        .success,
    ).toBe(false)
    expect(
      structuralMaterialCatalogSchema.safeParse({
        ...structuralMaterialCatalog,
        presets: [...structuralMaterialCatalog.presets, { id: "tpu" }],
      }).success,
    ).toBe(false)
  })
})
