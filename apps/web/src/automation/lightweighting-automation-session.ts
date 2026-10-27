import { lightweightingSourceIdentitySchema } from "@vibeshape/automation-api/lightweighting-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { createLightweightingProposalCoordinator } from "@vibeshape/automation-host/lightweighting-proposal"
import {
  optimizeStructuralModel,
  StructuralOptimizationError,
} from "@vibeshape/structural-optimization/client"
import {
  compactStructuralSourceMesh,
  encodeStructuralStl,
} from "@vibeshape/structural-optimization/mesh"
import type { LightweightingSource } from "../features/lightweighting/lightweighting-model"
import { automationReviews } from "./automation-review-controller"
import type { ImportSessionConfiguration } from "./import-upload-session"
import { createBrowserLightweightingSnapshotSession } from "./lightweighting-snapshot-session"

/** A separate private import session prevents external upload tools replacing a computed candidate. */
export function createBrowserLightweightingAutomationSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review"> & {
    readSource: (partId: string) => LightweightingSource | null
  },
  reviews = automationReviews,
) {
  const snapshots = createBrowserLightweightingSnapshotSession(configuration, reviews)
  const coordinator = createLightweightingProposalCoordinator({
    describeFailure(error) {
      return error instanceof StructuralOptimizationError
        ? localFailure(error.code, error.message.slice(0, 512), true)
        : null
    },
    createCancellation() {
      const controller = new AbortController()
      return { signal: controller.signal, abort: () => controller.abort() }
    },
    observeCancellation(signal, cancel) {
      signal?.addEventListener("abort", cancel, { once: true })
      return () => signal?.removeEventListener("abort", cancel)
    },
    documentId: configuration.documentId,
    isActive: configuration.isActive,
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
      const result = await optimizeStructuralModel(
        {
          schemaVersion: 1,
          mesh: compactStructuralSourceMesh({
            vertices: Array.from(source.body.mesh.positions),
            indices: Array.from(source.body.mesh.indices),
          }),
          ...settings,
        },
        { signal },
      )
      const { mesh, ...summary } = result
      return { summary, payload: mesh }
    },
    async requestSnapshot(actor, source, settings, summary, mesh, label, signal) {
      return snapshots.request(
        actor,
        source,
        label,
        encodeStructuralStl(mesh, settings.cellSizeMm),
        "lightweighted-snapshot.stl",
        {
          lightweighting: {
            sourceName: source.partName,
            source: source.identity,
            settings,
            summary,
          },
        },
        signal,
      )
    },
    cancelSnapshot: () => snapshots.cancel(),
  })
  return {
    execute: coordinator.execute,
    cancel: () => coordinator.cancel(),
    dispose() {
      coordinator.dispose()
      snapshots.dispose()
    },
  }
}
