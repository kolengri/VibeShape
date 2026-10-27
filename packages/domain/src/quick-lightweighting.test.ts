import { describe, expect, it } from "bun:test"
import {
  quickLightweightingSettingsSchema,
  quickLightweightingSummarySchema,
  resolveQuickLightweightingSettings,
} from "./quick-lightweighting"

const settings = {
  mode: "preserve-exterior" as const,
  removalPercent: 50,
  cellSizeMm: 0.3,
  skinThicknessMm: 0.6,
}

describe("load-free TPMS settings and measured summaries", () => {
  it("preserves the omitted Gyroid and six-sample cell defaults", () => {
    const parsed = quickLightweightingSettingsSchema.parse(settings)
    expect(parsed.cellType).toBeUndefined()
    const effective = resolveQuickLightweightingSettings(parsed)
    expect(effective.cellType).toBe("gyroid")
    expect(effective.latticeCellSizeMm).toBeCloseTo(1.8, 12)
  })

  it("defaults Schwarz D to twelve samples without overriding an explicit period", () => {
    const parsed = quickLightweightingSettingsSchema.parse({ ...settings, cellType: "schwarz-d" })
    expect(resolveQuickLightweightingSettings(parsed).latticeCellSizeMm).toBeCloseTo(3.6, 12)
    expect(
      resolveQuickLightweightingSettings({ ...parsed, latticeCellSizeMm: 1.8 }).latticeCellSizeMm,
    ).toBe(1.8)
  })

  it.each(["gyroid", "schwarz-p", "schwarz-d"] as const)(
    "accepts independent cells with at least six samples for %s",
    (cellType) => {
      for (const latticeCellSizeMm of [1.8, 2.4, 3.6, 6, 30]) {
        const parsed = quickLightweightingSettingsSchema.parse({
          ...settings,
          cellType,
          latticeCellSizeMm,
        })
        expect(resolveQuickLightweightingSettings(parsed)).toMatchObject({
          cellType,
          latticeCellSizeMm,
        })
      }
    },
  )

  it.each([1.79, Number.NaN, Number.POSITIVE_INFINITY, null])(
    "rejects an unresolved or out-of-range lattice cell %s",
    (latticeCellSizeMm) => {
      expect(
        quickLightweightingSettingsSchema.safeParse({ ...settings, latticeCellSizeMm }).success,
      ).toBe(false)
    },
  )

  it("accepts positive physical scales and removal beyond former policy ranges", () => {
    for (const cellSizeMm of [0.005, 1001])
      for (const removalPercent of [1, 99])
        expect(
          quickLightweightingSettingsSchema.safeParse({
            ...settings,
            cellSizeMm,
            skinThicknessMm: 2 * cellSizeMm,
            latticeCellSizeMm: 13 * cellSizeMm,
            removalPercent,
          }).success,
        ).toBe(true)
    for (const removalPercent of [0, 100, -1, Number.NaN])
      expect(
        quickLightweightingSettingsSchema.safeParse({ ...settings, removalPercent }).success,
      ).toBe(false)
    expect(
      quickLightweightingSummarySchema.safeParse({
        schemaVersion: 1,
        mode: "preserve-exterior",
        requestedRemovalPercent: 1,
        removedPercent: 0.1,
        sourceVolumeMm3: 1000,
        resultVolumeMm3: 999,
        cellSizeMm: 0.3,
        skinThicknessMm: 0.6,
        cellType: "gyroid",
        latticeCellSizeMm: 30,
        warnings: [],
      }).success,
    ).toBe(true)
  })

  it("requires supported effective cells and rejects the superseded Gyroid-only summary", () => {
    const summary = {
      schemaVersion: 1,
      mode: "preserve-exterior",
      requestedRemovalPercent: 50,
      removedPercent: 50,
      sourceVolumeMm3: 100,
      resultVolumeMm3: 50,
      cellSizeMm: 0.3,
      skinThicknessMm: 0.6,
      cellType: "schwarz-d",
      latticeCellSizeMm: 3.6,
      warnings: [],
    }
    expect(quickLightweightingSummarySchema.safeParse(summary).success).toBe(true)
    expect(
      quickLightweightingSummarySchema.safeParse({ ...summary, cellType: "octet" }).success,
    ).toBe(false)
    expect(
      quickLightweightingSummarySchema.safeParse({ ...summary, gyroidPeriodMm: 1.8 }).success,
    ).toBe(false)
  })
})
