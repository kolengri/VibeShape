import { quickLightweightingSummarySchema } from "@vibeshape/domain/quick-lightweighting"
import {
  lightweightingId,
  lightweightingIdentity,
  lightweightingSnapshot,
} from "./lightweighting.test-fixtures"
import { quickLightweightingOperationSchema } from "./quick-lightweighting-tools"

export const quickLightweightingSettings = {
  mode: "preserve-exterior" as const,
  removalPercent: 35,
  cellSizeMm: 1,
  skinThicknessMm: 2,
}
export function quickLightweightingOperation(request = false) {
  return quickLightweightingOperationSchema.parse({
    tool: request ? "request_quick_lightweighting" : "analyze_quick_lightweighting",
    arguments: {
      baseRevision: 4,
      source: lightweightingIdentity,
      settings: quickLightweightingSettings,
      ...(request ? { label: "Quick lightweighted snapshot" } : {}),
    },
  })
}
export function quickLightweightingSummary() {
  return quickLightweightingSummarySchema.parse({
    schemaVersion: 1,
    mode: "preserve-exterior",
    requestedRemovalPercent: 35,
    removedPercent: 100 / 3,
    sourceVolumeMm3: 48,
    resultVolumeMm3: 32,
    cellSizeMm: 1,
    skinThicknessMm: 2,
    cellType: "gyroid",
    latticeCellSizeMm: 6,
    warnings: ["Load-free geometry; structural performance is not evaluated."],
  })
}
export function quickLightweightingValue(request = false) {
  return {
    documentId: lightweightingId(3),
    baseRevision: 4,
    source: lightweightingIdentity,
    summary: quickLightweightingSummary(),
    ...(request ? { snapshot: lightweightingSnapshot() } : {}),
  }
}
