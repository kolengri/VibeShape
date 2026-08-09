import {
  computeFeatureContentHash,
  type FeatureContentEnvironment,
  type FeatureContentHasher,
  sha256Schema,
} from "@vibeshape/domain/feature-content-identity"
import {
  evaluateFeatureGraph,
  type FeatureDiagnostic,
  type FeatureEvaluationRecord,
  type FeatureGraph,
  type FeatureGraphEvaluation,
  featureEvaluationRecordSchema,
} from "@vibeshape/domain/feature-graph"
import type { FeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import { type FeatureId, featureIdSchema } from "@vibeshape/domain/identifiers"
import {
  type FeatureContentIdentity,
  type FeatureEvaluationDependency,
  type FeatureEvaluationEngineResult,
  type FeatureMeshPolicy,
  featureContentEnvironmentSchema,
  featureContentIdentitySchema,
  featureEvaluationEngineResultSchema,
  featureMeshPolicySchema,
  type GeometryDiagnosticCode,
  type GeometryProgressStage,
  geometryDiagnosticCodeSchema,
  serializeFeatureContentEnvironment,
} from "@vibeshape/protocol"
import { z } from "zod"

const coordinatorDiagnosticCodeSchema = z.enum([
  "worker-request-failed",
  "unexpected-worker-response",
])

const geometryEvaluationPortResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      geometry: featureEvaluationEngineResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      diagnosticCode: z.union([geometryDiagnosticCodeSchema, coordinatorDiagnosticCodeSchema]),
    })
    .strict(),
])

export const featureGeometryRecordSchema = z
  .object({
    featureId: featureIdSchema,
    contentHash: sha256Schema,
    meshPolicy: featureMeshPolicySchema,
    geometry: featureEvaluationEngineResultSchema,
  })
  .strict()

export type FeatureGeometryRecord = Readonly<z.infer<typeof featureGeometryRecordSchema>>

export type FeatureGeometryEvaluationRequest = Readonly<{
  documentId: string
  revision: number
  generation: number
  featureId: FeatureId
  content: FeatureContentIdentity
  contentHash: string
  dependencies: readonly FeatureEvaluationDependency[]
  mesh: FeatureMeshPolicy
  onProgress?: (stage: GeometryProgressStage, fraction: number) => void
}>

export type FeatureGeometryEvaluationPortResult =
  | { ok: true; geometry: FeatureEvaluationEngineResult }
  | {
      ok: false
      diagnosticCode: GeometryDiagnosticCode | z.infer<typeof coordinatorDiagnosticCodeSchema>
    }

export type FeatureGeometryEvaluationPort = (
  request: FeatureGeometryEvaluationRequest,
) => FeatureGeometryEvaluationPortResult | Promise<FeatureGeometryEvaluationPortResult>

export type FeatureRebuildDiagnostic = Readonly<{
  code:
    | "invalid-previous-feature-state"
    | "invalid-feature-content-environment"
    | "invalid-feature-mesh-policy"
    | "invalid-dirty-feature"
    | "invalid-previous-feature-result"
  message: string
}>

export type FeatureRebuildState = Readonly<{
  evaluation: FeatureGraphEvaluation
  geometry: readonly FeatureGeometryRecord[]
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
}>

export type FeatureRebuildResult =
  | ({ ok: true } & FeatureRebuildState)
  | { ok: false; diagnostic: FeatureRebuildDiagnostic }

function failed(code: string, values: FeatureDiagnostic["values"] = {}) {
  return { status: "failed", diagnostics: [{ code, values }] } as const
}

function previousResultsById(inputs: readonly unknown[]) {
  const byId = new Map<FeatureId, FeatureEvaluationRecord>()
  for (const input of inputs) {
    const parsed = featureEvaluationRecordSchema.safeParse(input)
    if (!parsed.success || byId.has(parsed.data.featureId)) return null
    byId.set(parsed.data.featureId, parsed.data)
  }
  return byId
}

function sameMeshPolicy(left: FeatureMeshPolicy, right: FeatureMeshPolicy) {
  return (
    left.chordTolerance === right.chordTolerance && left.angularTolerance === right.angularTolerance
  )
}

function parsePreviousState(previous: FeatureRebuildState) {
  const environment = featureContentEnvironmentSchema.safeParse(previous.environment)
  const mesh = featureMeshPolicySchema.safeParse(previous.mesh)
  const recordsById = previousResultsById(previous.evaluation.records)
  return environment.success && mesh.success && recordsById
    ? { environment: environment.data, mesh: mesh.data, recordsById }
    : null
}

function geometryMatchesPreviousResult(
  geometry: FeatureGeometryRecord,
  recordsById: ReadonlyMap<FeatureId, FeatureEvaluationRecord>,
  environment: FeatureContentEnvironment,
  mesh: FeatureMeshPolicy,
) {
  const record = recordsById.get(geometry.featureId)
  return (
    record?.status === "succeeded" &&
    record.contentHash === geometry.contentHash &&
    sameMeshPolicy(geometry.meshPolicy, mesh) &&
    serializeFeatureContentEnvironment(geometry.geometry.engine.featureContentEnvironment) ===
      serializeFeatureContentEnvironment(environment)
  )
}

function indexSnapshotGeometry(
  inputs: readonly unknown[],
  recordsById: ReadonlyMap<FeatureId, FeatureEvaluationRecord>,
  environment: FeatureContentEnvironment,
  mesh: FeatureMeshPolicy,
) {
  const geometryById = new Map<FeatureId, FeatureGeometryRecord>()
  for (const input of inputs) {
    const parsed = featureGeometryRecordSchema.safeParse(input)
    if (!parsed.success || geometryById.has(parsed.data.featureId)) return null
    if (!geometryMatchesPreviousResult(parsed.data, recordsById, environment, mesh)) return null
    geometryById.set(parsed.data.featureId, parsed.data)
  }
  const missingGeometry = [...recordsById.values()].some(
    (record) => record.status === "succeeded" && !geometryById.has(record.featureId),
  )
  return missingGeometry ? null : geometryById
}

function indexPreviousState(
  graph: FeatureGraph,
  previous: FeatureRebuildState | undefined,
  environment: FeatureContentEnvironment,
  mesh: FeatureMeshPolicy,
) {
  if (!previous) {
    return {
      records: [] as readonly FeatureEvaluationRecord[],
      geometryById: new Map<FeatureId, FeatureGeometryRecord>(),
      reusable: true,
    }
  }

  const parsed = parsePreviousState(previous)
  if (!parsed) return null
  const allGeometryById = indexSnapshotGeometry(
    previous.geometry,
    parsed.recordsById,
    parsed.environment,
    parsed.mesh,
  )
  if (!allGeometryById) return null

  const records = [...parsed.recordsById.values()].filter((record) =>
    graph.getFeature(record.featureId),
  )
  const geometryById = new Map(
    [...allGeometryById].filter(([featureId]) => graph.getFeature(featureId)),
  )

  return {
    records,
    geometryById,
    reusable:
      serializeFeatureContentEnvironment(parsed.environment) ===
        serializeFeatureContentEnvironment(environment) && sameMeshPolicy(parsed.mesh, mesh),
  }
}

function successfulDependencies(records: readonly FeatureEvaluationRecord[]) {
  return records.map((record) => ({
    featureId: record.featureId,
    contentHash: (record as Extract<FeatureEvaluationRecord, { status: "succeeded" }>).contentHash,
  }))
}

function presentGeometry(
  graph: FeatureGraph,
  evaluation: FeatureGraphEvaluation,
  geometryById: ReadonlyMap<FeatureId, FeatureGeometryRecord>,
) {
  const recordsById = new Map(evaluation.records.map((record) => [record.featureId, record]))
  return graph.features.flatMap((feature) => {
    const record = recordsById.get(feature.id)
    const geometry = geometryById.get(feature.id)
    return record?.status === "succeeded" && geometry?.contentHash === record.contentHash
      ? [geometry]
      : []
  })
}

export async function rebuildFeatureGraph(input: {
  documentId: string
  revision: number
  generation: number
  graph: FeatureGraph
  registry: FeatureTypeRegistry
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
  changedFeatureIds: readonly unknown[]
  previous?: FeatureRebuildState
  hash: FeatureContentHasher
  evaluateGeometry: FeatureGeometryEvaluationPort
  onProgress?: (featureId: FeatureId, stage: GeometryProgressStage, fraction: number) => void
}): Promise<FeatureRebuildResult> {
  const environment = featureContentEnvironmentSchema.safeParse(input.environment)
  if (!environment.success) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-feature-content-environment",
        message: "The feature content environment is invalid.",
      },
    }
  }
  const mesh = featureMeshPolicySchema.safeParse(input.mesh)
  if (!mesh.success) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-feature-mesh-policy",
        message: "The feature mesh policy is invalid.",
      },
    }
  }
  const previous = indexPreviousState(input.graph, input.previous, environment.data, mesh.data)
  if (!previous) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-previous-feature-state",
        message:
          "Previous rebuild state must be valid, unique, and pair every successful result with matching geometry.",
      },
    }
  }

  const changedFeatureIds = previous.reusable
    ? input.changedFeatureIds
    : input.graph.features.map((feature) => feature.id)
  const evaluation = await evaluateFeatureGraph(input.graph, {
    changedFeatureIds,
    previousResults: previous.records,
    async evaluate(context) {
      const dependencies = successfulDependencies(context.dependencies)
      const content = await computeFeatureContentHash(
        input.registry,
        {
          feature: context.feature,
          dependencies,
          environment: environment.data,
        },
        input.hash,
      )
      if (!content.ok) {
        return failed("org.vibeshape.feature.content-identity-failed", {
          reason: content.diagnostic.code,
        })
      }

      const wireContent = featureContentIdentitySchema.safeParse(content.identity)
      if (!wireContent.success) {
        return failed("org.vibeshape.feature.worker-contract-rejected")
      }

      let output: unknown
      try {
        const request: FeatureGeometryEvaluationRequest = {
          documentId: input.documentId,
          revision: input.revision,
          generation: input.generation,
          featureId: context.feature.id,
          content: wireContent.data,
          contentHash: content.contentHash,
          dependencies,
          mesh: mesh.data,
          ...(input.onProgress
            ? {
                onProgress: (stage, fraction) =>
                  input.onProgress?.(context.feature.id, stage, fraction),
              }
            : {}),
        }
        output = await input.evaluateGeometry(request)
      } catch {
        return failed("org.vibeshape.feature.geometry-evaluation-failed", {
          reason: "worker-request-failed",
        })
      }

      const parsed = geometryEvaluationPortResultSchema.safeParse(output)
      if (!parsed.success) {
        return failed("org.vibeshape.feature.geometry-evaluation-failed", {
          reason: "unexpected-worker-response",
        })
      }
      if (!parsed.data.ok) {
        return failed("org.vibeshape.feature.geometry-evaluation-failed", {
          reason: parsed.data.diagnosticCode,
        })
      }
      if (
        serializeFeatureContentEnvironment(
          parsed.data.geometry.engine.featureContentEnvironment,
        ) !== serializeFeatureContentEnvironment(environment.data)
      ) {
        return failed("org.vibeshape.feature.worker-contract-rejected", {
          reason: "feature-content-environment-mismatch",
        })
      }

      previous.geometryById.set(context.feature.id, {
        featureId: context.feature.id,
        contentHash: content.contentHash,
        meshPolicy: mesh.data,
        geometry: parsed.data.geometry,
      })
      return { status: "succeeded", contentHash: content.contentHash }
    },
  })
  if (!evaluation.ok) return evaluation

  return {
    ok: true,
    evaluation: evaluation.evaluation,
    geometry: presentGeometry(input.graph, evaluation.evaluation, previous.geometryById),
    environment: environment.data,
    mesh: mesh.data,
  }
}
