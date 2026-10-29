import { importUploadCommitSchema } from "@vibeshape/automation-api/imports"
import { lightweightingSourceIdentitySchema } from "@vibeshape/automation-api/lightweighting-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { printOptimizationSummarySchema } from "@vibeshape/automation-api/print-optimization-tools"
import { createPrintOptimizationProposalCoordinator } from "@vibeshape/automation-host/print-optimization-proposal"
import {
  optimizeStructuralModel,
  StructuralOptimizationError,
} from "@vibeshape/structural-optimization/client"
import { PrintOptimizationSetupError } from "@vibeshape/structural-optimization/print-optimization"
import type { LightweightingSource } from "../features/lightweighting/lightweighting-model"
import { prepareAutomatedPrintOptimization } from "../features/lightweighting/prepare-automated-print-optimization"
import {
  type ExactPrintGeometryPort,
  prepareExactPrintSnapshot,
} from "../features/lightweighting/prepare-exact-print-snapshot"
import { samePrintOptimizationSource } from "../features/lightweighting/print-optimization-model"
import { automationReviews } from "./automation-review-controller"
import { createImportAutomationSession } from "./import-automation-session"
import type { ImportReviewInput, ImportSessionConfiguration } from "./import-upload-session"

/** Exact computed sources remain private to the same reviewed import authority as UI Apply. */
export function createBrowserPrintOptimizationAutomationSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review"> & {
    readSource: (partId: string) => LightweightingSource | null
    geometry: ExactPrintGeometryPort
  },
  reviews = automationReviews,
) {
  let captured: LightweightingSource | null = null
  let evidence: Pick<ImportReviewInput, "printOptimization"> | undefined
  const current = (source: LightweightingSource) =>
    configuration.isActive() &&
    samePrintOptimizationSource(configuration.readSource(source.partId), source)
  function assertCurrent(source: LightweightingSource, signal: AbortSignal) {
    if (!current(source) || signal.aborted)
      throw new StructuralOptimizationError(
        "request-cancelled",
        "The captured print source changed or the operation was cancelled.",
      )
  }
  const imports = createImportAutomationSession(
    {
      ...configuration,
      isActive: () => configuration.isActive() && (!captured || current(captured)),
      reviewContext: () => evidence,
    },
    reviews,
  )
  const coordinator = createPrintOptimizationProposalCoordinator({
    documentId: configuration.documentId,
    isActive: configuration.isActive,
    createCancellation() {
      const controller = new AbortController()
      return { signal: controller.signal, abort: () => controller.abort() }
    },
    observeCancellation(signal, cancel) {
      signal?.addEventListener("abort", cancel, { once: true })
      return () => signal?.removeEventListener("abort", cancel)
    },
    describeFailure(error) {
      return error instanceof StructuralOptimizationError ||
        error instanceof PrintOptimizationSetupError
        ? localFailure(error.code, error.message.slice(0, 512), true)
        : null
    },
    readSource(identity) {
      const source = configuration.readSource(identity.partId)
      return source
        ? {
            ...source,
            documentId: source.context.documentId,
            revision: source.context.revision,
            identity: lightweightingSourceIdentitySchema.parse({
              partId: source.partId,
              featureId: source.featureId,
              outputRole: source.outputRole,
              contentHash: source.contentHash,
            }),
          }
        : null
    },
    async optimize(source, settings, signal) {
      const prepared = prepareAutomatedPrintOptimization(source, settings)
      const input = { ...prepared.input, includeVoxelGrid: true }
      const result = await optimizeStructuralModel(input, { signal })
      assertCurrent(source, signal)
      const { mesh: _mesh, voxelGrid: _voxelGrid, ...proposal } = result
      const payload =
        result.status === "improved"
          ? await prepareExactPrintSnapshot({
              geometry: configuration.geometry,
              source,
              input,
              result,
              preserveFaceIds: prepared.preserveFaceIds,
              frame: prepared.frame,
              toPrintMesh: prepared.toPrintMesh,
              signal,
              current: () => current(source),
              onProgress: () => {},
            })
          : null
      assertCurrent(source, signal)
      if (result.status === "improved" && !payload)
        throw new StructuralOptimizationError(
          "request-cancelled",
          "The exact print result was cancelled or became stale.",
        )
      const summary = printOptimizationSummarySchema.parse({
        proposal,
        exact: payload?.exact ?? null,
        configuration: prepared.configuration,
        scenarioBasis: "normalized-longest-span-end-clamped",
        sourceToPrintFrame: prepared.frame,
      })
      return { summary, payload }
    },
    async requestSnapshot(actor, source, settings, summary, payload, label, signal) {
      if (!payload || !summary.exact || !current(source))
        return localFailure(
          "stale-revision",
          "The exact print snapshot is unavailable or stale.",
          true,
        )
      captured = source
      evidence = {
        printOptimization: {
          sourceName: source.partName,
          source: source.identity,
          settings,
          summary,
        },
      }
      try {
        const applied = await imports.requestPrepared(
          actor,
          {
            prepared: payload.prepared,
            revision: source.context.revision,
            sourceUnit: "millimeter",
            label,
          },
          signal,
        )
        return applied.ok
          ? { ok: true as const, value: importUploadCommitSchema.parse(applied.value) }
          : applied
      } finally {
        imports.cancel()
        captured = null
        evidence = undefined
      }
    },
    cancelSnapshot: () => imports.cancel(),
  })
  return {
    execute: coordinator.execute,
    cancel: () => coordinator.cancel(),
    dispose() {
      coordinator.dispose()
      imports.dispose()
    },
  }
}
