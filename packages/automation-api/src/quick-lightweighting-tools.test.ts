import { describe, expect, it } from "bun:test"
import { lightweightingId, lightweightingSnapshot } from "./lightweighting.test-fixtures"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  quickLightweightingOperation,
  quickLightweightingSettings,
  quickLightweightingValue,
} from "./quick-lightweighting.test-fixtures"
import { quickLightweightingResultContextMatches } from "./quick-lightweighting-tools"
import { remoteOperationSchema } from "./remote-session"
import { localToolAnnotations } from "./tool-metadata"

describe("load-free lightweighting transport contracts", () => {
  it.each([false, true])(
    "advertises strict bounded inputs and truthful annotations (request=%s)",
    (request) => {
      const operation = quickLightweightingOperation(request)
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      expect(localToolAnnotations(operation.tool)).toMatchObject({
        readOnlyHint: !request,
        destructiveHint: request,
        openWorldHint: false,
      })
      for (const extra of [{ mesh: {} }, { actor: {} }, { approved: true }, { script: "" }])
        expect(
          localOperationSchema.safeParse({
            ...operation,
            arguments: { ...operation.arguments, ...extra },
          }).success,
        ).toBe(false)
      expect(
        localToolOutputs[operation.tool].safeParse({
          ok: true,
          value: quickLightweightingValue(request),
        }).success,
      ).toBe(true)
    },
  )
  it.each(["gyroid", "schwarz-p", "schwarz-d"] as const)(
    "binds %s and independent lattice period on both transports",
    (cellType) => {
      const base = quickLightweightingOperation()
      const operation = {
        ...base,
        arguments: {
          ...base.arguments,
          settings: { ...base.arguments.settings, cellType, latticeCellSizeMm: 9 },
        },
      }
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      const baseValue = quickLightweightingValue()
      const value = {
        ...baseValue,
        summary: { ...baseValue.summary, cellType, latticeCellSizeMm: 9 },
      }
      expect(quickLightweightingResultContextMatches(operation, { ok: true, value })).toBe(true)
      expect(
        quickLightweightingResultContextMatches(operation, {
          ok: true,
          value: { ...value, summary: { ...value.summary, latticeCellSizeMm: 6 } },
        }),
      ).toBe(false)
      expect(
        quickLightweightingResultContextMatches(operation, {
          ok: true,
          value: {
            ...value,
            summary: { ...value.summary, cellType: cellType === "gyroid" ? "schwarz-p" : "gyroid" },
          },
        }),
      ).toBe(false)
    },
  )
  it("rejects unsafe settings before dispatch", () => {
    const operation = quickLightweightingOperation()
    for (const patch of [
      { removalPercent: Number.NaN },
      { removalPercent: 81 },
      { cellSizeMm: 0 },
      { skinThicknessMm: 1.99 },
      { mode: "maximum-stiffness" },
      { material: {} },
      { cellType: "unsupported" },
      { latticeCellSizeMm: Number.NaN },
      { latticeCellSizeMm: 5.99 },
      { latticeCellSizeMm: 12.01 },
    ])
      expect(
        localOperationSchema.safeParse({
          ...operation,
          arguments: {
            ...operation.arguments,
            settings: { ...quickLightweightingSettings, ...patch },
          },
        }).success,
      ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        ...operation,
        arguments: {
          ...operation.arguments,
          settings: { ...quickLightweightingSettings, mode: "open-organic", skinThicknessMm: 0 },
        },
      }).success,
    ).toBe(true)
  })
  it.each([false, true])(
    "rejects forged source/settings/volume/snapshot evidence (request=%s)",
    (request) => {
      const operation = quickLightweightingOperation(request)
      const value = quickLightweightingValue(request)
      expect(
        quickLightweightingResultContextMatches(
          operation,
          { ok: true, value },
          lightweightingId(3),
        ),
      ).toBe(true)
      for (const patch of [
        { documentId: lightweightingId(4) },
        { baseRevision: 5 },
        { source: { ...value.source, contentHash: "b".repeat(64) } },
        { summary: { ...value.summary, requestedRemovalPercent: 36 } },
        { summary: { ...value.summary, mode: "open-organic" } },
        { summary: { ...value.summary, resultVolumeMm3: 48 } },
        { summary: { ...value.summary, removedPercent: 50 } },
        { summary: { ...value.summary, latticeCellSizeMm: 7 } },
        { summary: { ...value.summary, cellType: "schwarz-p" } },
        { summary: { ...value.summary, safetyFactor: 2 } },
        { mesh: { vertices: [], indices: [] } },
        ...(request
          ? [{ snapshot: null }, { snapshot: { ...lightweightingSnapshot(), revision: 4 } }]
          : []),
      ])
        expect(
          quickLightweightingResultContextMatches(
            operation,
            { ok: true, value: { ...value, ...patch } },
            lightweightingId(3),
          ),
        ).toBe(false)
    },
  )
})
