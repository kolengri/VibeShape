import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  computeFeatureContentHash,
  type FeatureContentEnvironment,
  type FeatureContentHasher,
  sha256Schema,
} from "@vibeshape/domain/feature-content-identity"
import {
  createFeatureGraph,
  evaluateFeatureGraph,
  type FeatureDiagnostic,
  type FeatureEvaluationContext,
  type FeatureEvaluationRecord,
  type FeatureGraph,
  type FeatureGraphEvaluation,
  type FeatureParameters,
  type FeatureRecord,
  featureEvaluationRecordSchema,
  featureParametersSchema,
  serializeFeatureRecord,
} from "@vibeshape/domain/feature-graph"
import type { FeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import { type FeatureId, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { evaluateVariableDefinitions } from "@vibeshape/domain/variables"
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

const rebuildIdentitySchema = z
  .object({
    documentId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value.trim() === value, "Document IDs must be normalized."),
    revision: revisionSchema,
    generation: revisionSchema,
  })
  .strict()

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
    | "invalid-rebuild-identity"
    | "previous-document-mismatch"
    | "future-previous-revision"
    | "invalid-feature-content-environment"
    | "invalid-feature-mesh-policy"
    | "invalid-dirty-feature"
    | "invalid-previous-feature-result"
  message: string
}>

export type FeatureRebuildState = Readonly<{
  documentId: string
  revision: number
  generation: number
  features: readonly FeatureRecord[]
  evaluation: FeatureGraphEvaluation
  geometry: readonly FeatureGeometryRecord[]
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
}>

export type FeatureRebuildResult =
  | ({ ok: true } & FeatureRebuildState)
  | { ok: false; diagnostic: FeatureRebuildDiagnostic }

export type FeatureRebuildInput = Readonly<{
  documentId: string
  revision: number
  generation: number
  graph: FeatureGraph
  registry: FeatureTypeRegistry
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
  previous?: FeatureRebuildState
  hash: FeatureContentHasher
  evaluateGeometry: FeatureGeometryEvaluationPort
  onProgress?: (featureId: FeatureId, stage: GeometryProgressStage, fraction: number) => void
}>

type CoordinatedFeatureRebuildInput = FeatureRebuildInput &
  Readonly<{
    contentParametersByFeatureId?: ReadonlyMap<FeatureId, FeatureParameters>
    forcedDirtyFeatureIds?: readonly FeatureId[]
    preflightFailures?: ReadonlyMap<FeatureId, FeatureDiagnostic>
  }>

export type DocumentFeatureRebuildDiagnostic = Readonly<{
  code: "invalid-document-snapshot"
  message: string
}>

export type DocumentFeatureRebuildResult =
  | FeatureRebuildResult
  | { ok: false; diagnostic: DocumentFeatureRebuildDiagnostic }

export type DocumentFeatureRebuildInput = Readonly<{
  document: unknown
  generation: number
  registry: FeatureTypeRegistry
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
  previous?: FeatureRebuildState
  hash: FeatureContentHasher
  evaluateGeometry: FeatureGeometryEvaluationPort
  prepareFeatureContent?: DocumentFeatureContentPreparationPort
  onProgress?: (featureId: FeatureId, stage: GeometryProgressStage, fraction: number) => void
}>

export type DocumentFeatureContentPreparationResult =
  | Readonly<{ ok: true; parameters: unknown }>
  | Readonly<{ ok: false; diagnostic: FeatureDiagnostic }>

export type DocumentFeatureContentPreparationPort = (
  input: Readonly<{
    document: DocumentSnapshot
    feature: FeatureRecord
    features?: readonly FeatureRecord[]
  }>,
) =>
  | DocumentFeatureContentPreparationResult
  | null
  | Promise<DocumentFeatureContentPreparationResult | null>

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

function parseRebuildIdentity(input: {
  documentId: unknown
  revision: unknown
  generation: unknown
}) {
  return rebuildIdentitySchema.safeParse({
    documentId: input.documentId,
    revision: input.revision,
    generation: input.generation,
  })
}

function parsePreviousState(previous: FeatureRebuildState) {
  const identity = parseRebuildIdentity(previous)
  const environment = featureContentEnvironmentSchema.safeParse(previous.environment)
  const mesh = featureMeshPolicySchema.safeParse(previous.mesh)
  const recordsById = previousResultsById(previous.evaluation.records)
  const featureGraph = createFeatureGraph(previous.features)
  if (
    !identity.success ||
    !environment.success ||
    !mesh.success ||
    !recordsById ||
    !featureGraph.ok
  ) {
    return null
  }
  if (
    recordsById.size !== featureGraph.graph.features.length ||
    featureGraph.graph.features.some((feature) => !recordsById.has(feature.id))
  ) {
    return null
  }
  return {
    identity: identity.data,
    environment: environment.data,
    mesh: mesh.data,
    recordsById,
    featureGraph: featureGraph.graph,
  }
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
  sourceGraph: FeatureGraph,
) {
  const geometryById = new Map<FeatureId, FeatureGeometryRecord>()
  for (const input of inputs) {
    const parsed = featureGeometryRecordSchema.safeParse(input)
    if (
      !parsed.success ||
      !sourceGraph.getFeature(parsed.data.featureId) ||
      geometryById.has(parsed.data.featureId)
    ) {
      return null
    }
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
  generation: number,
) {
  if (!previous) {
    return {
      records: [] as readonly FeatureEvaluationRecord[],
      geometryById: new Map<FeatureId, FeatureGeometryRecord>(),
      features: [] as readonly FeatureRecord[],
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
    parsed.featureGraph,
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
    features: parsed.featureGraph.features,
    reusable:
      serializeFeatureContentEnvironment(parsed.environment) ===
        serializeFeatureContentEnvironment(environment) &&
      sameMeshPolicy(parsed.mesh, mesh) &&
      parsed.identity.generation === generation,
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

function schedulingFingerprint(feature: FeatureRecord) {
  const { label: _label, ...evaluationInput } = feature
  return serializeFeatureRecord(evaluationInput)
}

function detectChangedFeatureIds(graph: FeatureGraph, previousFeatures: readonly FeatureRecord[]) {
  const previousById = new Map(
    previousFeatures.map((feature) => [feature.id, schedulingFingerprint(feature)]),
  )
  return graph.features
    .filter((feature) => previousById.get(feature.id) !== schedulingFingerprint(feature))
    .map((feature) => feature.id)
}

type PreparedFeatureRebuild = Readonly<{
  identity: z.infer<typeof rebuildIdentitySchema>
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
  previous: NonNullable<ReturnType<typeof indexPreviousState>>
}>

type FeatureRebuildFailure = Readonly<{
  ok: false
  result: Extract<FeatureRebuildResult, { ok: false }>
}>

type FeatureRebuildPreparation =
  | { ok: true; prepared: PreparedFeatureRebuild }
  | FeatureRebuildFailure

type RebuildIdentity = z.infer<typeof rebuildIdentitySchema>

type PreparedRebuildPolicies = Readonly<{
  environment: FeatureContentEnvironment
  mesh: FeatureMeshPolicy
}>

function rebuildFailure(
  code: FeatureRebuildDiagnostic["code"],
  message: string,
): Extract<FeatureRebuildResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message } }
}

function prepareRebuildIdentity(
  input: CoordinatedFeatureRebuildInput,
): { ok: true; identity: RebuildIdentity } | FeatureRebuildFailure {
  const identity = parseRebuildIdentity(input)
  if (!identity.success) {
    return {
      ok: false,
      result: rebuildFailure(
        "invalid-rebuild-identity",
        "The rebuild document, revision, or generation identity is invalid.",
      ),
    }
  }
  if (
    input.previous?.documentId !== undefined &&
    input.previous.documentId !== identity.data.documentId
  ) {
    return {
      ok: false,
      result: rebuildFailure(
        "previous-document-mismatch",
        "Previous rebuild state belongs to a different document.",
      ),
    }
  }
  if (input.previous && input.previous.revision > identity.data.revision) {
    return {
      ok: false,
      result: rebuildFailure(
        "future-previous-revision",
        "Previous rebuild state cannot come from a future document revision.",
      ),
    }
  }
  return { ok: true, identity: identity.data }
}

function prepareRebuildPolicies(
  input: CoordinatedFeatureRebuildInput,
): { ok: true; policies: PreparedRebuildPolicies } | FeatureRebuildFailure {
  const environment = featureContentEnvironmentSchema.safeParse(input.environment)
  if (!environment.success) {
    return {
      ok: false,
      result: rebuildFailure(
        "invalid-feature-content-environment",
        "The feature content environment is invalid.",
      ),
    }
  }
  const mesh = featureMeshPolicySchema.safeParse(input.mesh)
  if (!mesh.success) {
    return {
      ok: false,
      result: rebuildFailure("invalid-feature-mesh-policy", "The feature mesh policy is invalid."),
    }
  }
  return { ok: true, policies: { environment: environment.data, mesh: mesh.data } }
}

function prepareFeatureRebuild(input: CoordinatedFeatureRebuildInput): FeatureRebuildPreparation {
  const identity = prepareRebuildIdentity(input)
  if (!identity.ok) return identity
  const policies = prepareRebuildPolicies(input)
  if (!policies.ok) return policies
  const previous = indexPreviousState(
    input.graph,
    input.previous,
    policies.policies.environment,
    policies.policies.mesh,
    identity.identity.generation,
  )
  if (!previous) {
    return {
      ok: false,
      result: rebuildFailure(
        "invalid-previous-feature-state",
        "Previous rebuild state must be valid, unique, and pair every successful result with matching geometry.",
      ),
    }
  }
  return {
    ok: true,
    prepared: {
      identity: identity.identity,
      environment: policies.policies.environment,
      mesh: policies.policies.mesh,
      previous,
    },
  }
}

async function scheduledFeatureContent(
  input: CoordinatedFeatureRebuildInput,
  prepared: PreparedFeatureRebuild,
  context: FeatureEvaluationContext,
) {
  const dependencies = successfulDependencies(context.dependencies)
  const preparedParameters = input.contentParametersByFeatureId?.get(context.feature.id)
  const content = await computeFeatureContentHash(
    input.registry,
    {
      feature: context.feature,
      dependencies,
      environment: prepared.environment,
      ...(preparedParameters ? { contentParameters: preparedParameters } : {}),
    },
    input.hash,
  )
  if (!content.ok) {
    return {
      ok: false as const,
      result: failed("org.vibeshape.feature.content-identity-failed", {
        reason: content.diagnostic.code,
      }),
    }
  }
  const wireContent = featureContentIdentitySchema.safeParse(content.identity)
  return wireContent.success
    ? ({
        ok: true as const,
        dependencies,
        contentHash: content.contentHash,
        wireContent: wireContent.data,
      } as const)
    : ({
        ok: false as const,
        result: failed("org.vibeshape.feature.worker-contract-rejected"),
      } as const)
}

function canReuseScheduledFeature(
  prepared: PreparedFeatureRebuild,
  context: FeatureEvaluationContext,
  contentHash: string,
) {
  const previousGeometry = prepared.previous.geometryById.get(context.feature.id)
  return (
    prepared.previous.reusable &&
    context.previous?.status === "succeeded" &&
    context.previous.contentHash === contentHash &&
    previousGeometry?.contentHash === contentHash
  )
}

async function requestFeatureGeometry(
  input: CoordinatedFeatureRebuildInput,
  prepared: PreparedFeatureRebuild,
  context: FeatureEvaluationContext,
  content: Extract<Awaited<ReturnType<typeof scheduledFeatureContent>>, { ok: true }>,
) {
  let output: unknown
  try {
    output = await input.evaluateGeometry({
      documentId: prepared.identity.documentId,
      revision: prepared.identity.revision,
      generation: prepared.identity.generation,
      featureId: context.feature.id,
      content: content.wireContent,
      contentHash: content.contentHash,
      dependencies: content.dependencies,
      mesh: prepared.mesh,
      ...(input.onProgress
        ? {
            onProgress: (stage, fraction) =>
              input.onProgress?.(context.feature.id, stage, fraction),
          }
        : {}),
    })
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
    serializeFeatureContentEnvironment(parsed.data.geometry.engine.featureContentEnvironment) !==
    serializeFeatureContentEnvironment(prepared.environment)
  ) {
    return failed("org.vibeshape.feature.worker-contract-rejected", {
      reason: "feature-content-environment-mismatch",
    })
  }
  prepared.previous.geometryById.set(context.feature.id, {
    featureId: context.feature.id,
    contentHash: content.contentHash,
    meshPolicy: prepared.mesh,
    geometry: parsed.data.geometry,
  })
  return { status: "succeeded", contentHash: content.contentHash } as const
}

async function evaluateScheduledFeature(
  input: CoordinatedFeatureRebuildInput,
  prepared: PreparedFeatureRebuild,
  context: FeatureEvaluationContext,
) {
  const preflightFailure = input.preflightFailures?.get(context.feature.id)
  if (preflightFailure) return failed(preflightFailure.code, preflightFailure.values)
  const content = await scheduledFeatureContent(input, prepared, context)
  if (!content.ok) return content.result
  if (canReuseScheduledFeature(prepared, context, content.contentHash)) {
    return { status: "succeeded", contentHash: content.contentHash } as const
  }
  return requestFeatureGeometry(input, prepared, context, content)
}

async function runFeatureRebuild(
  input: CoordinatedFeatureRebuildInput,
): Promise<FeatureRebuildResult> {
  const preparation = prepareFeatureRebuild(input)
  if (!preparation.ok) return preparation.result
  const { identity, environment, mesh, previous } = preparation.prepared

  const detectedChangedFeatureIds = previous.reusable
    ? detectChangedFeatureIds(input.graph, previous.features)
    : input.graph.features.map((feature) => feature.id)
  const changedFeatureIds = [
    ...new Set([...detectedChangedFeatureIds, ...(input.forcedDirtyFeatureIds ?? [])]),
  ]
  const evaluation = await evaluateFeatureGraph(input.graph, {
    changedFeatureIds,
    previousResults: previous.records,
    evaluate: (context) => evaluateScheduledFeature(input, preparation.prepared, context),
  })
  if (!evaluation.ok) return evaluation

  return {
    ok: true,
    documentId: identity.documentId,
    revision: identity.revision,
    generation: identity.generation,
    features: input.graph.features,
    evaluation: evaluation.evaluation,
    geometry: presentGeometry(input.graph, evaluation.evaluation, previous.geometryById),
    environment,
    mesh,
  }
}

export function rebuildFeatureGraph(input: FeatureRebuildInput): Promise<FeatureRebuildResult> {
  return runFeatureRebuild(input)
}

function invalidDocumentSnapshot(message: string): DocumentFeatureRebuildResult {
  return { ok: false, diagnostic: { code: "invalid-document-snapshot", message } }
}

function resolveDocumentFeatures(
  document: DocumentSnapshot,
  registry: FeatureTypeRegistry,
  variables: Extract<ReturnType<typeof evaluateVariableDefinitions>, { ok: true }>,
) {
  const preflightFailures = new Map<FeatureId, FeatureDiagnostic>()
  const features = document.features.map((feature) => {
    const resolved = registry.resolveFeatureParameters(feature, variables.valuesByName)
    if (resolved.ok) return resolved.feature
    preflightFailures.set(feature.id, {
      code: "org.vibeshape.feature.parameter-expression-failed",
      values: {
        reason: resolved.diagnostic.reason,
        ...(resolved.diagnostic.issues[0]?.path
          ? { path: resolved.diagnostic.issues[0].path }
          : {}),
      },
    })
    return feature
  })
  return { features, preflightFailures }
}

async function callFeatureContentPreparer(
  prepareFeatureContent: DocumentFeatureContentPreparationPort,
  document: DocumentSnapshot,
  feature: FeatureRecord,
  features: readonly FeatureRecord[],
) {
  try {
    return await prepareFeatureContent({ document, feature, features })
  } catch {
    return {
      ok: false as const,
      diagnostic: {
        code: "org.vibeshape.feature.content-preparation-failed",
        values: { reason: "preparation-threw" },
      },
    }
  }
}

async function prepareDocumentFeatureContent(
  input: DocumentFeatureRebuildInput,
  document: DocumentSnapshot,
  features: readonly FeatureRecord[],
  preflightFailures: Map<FeatureId, FeatureDiagnostic>,
) {
  const parametersByFeatureId = new Map<FeatureId, FeatureParameters>()
  if (!input.prepareFeatureContent) return parametersByFeatureId
  for (const feature of features) {
    if (preflightFailures.has(feature.id)) continue
    const prepared = await callFeatureContentPreparer(
      input.prepareFeatureContent,
      document,
      feature,
      features,
    )
    if (!prepared) continue
    if (!prepared.ok) {
      preflightFailures.set(feature.id, prepared.diagnostic)
      continue
    }
    const parameters = featureParametersSchema.safeParse(prepared.parameters)
    if (parameters.success) {
      parametersByFeatureId.set(feature.id, parameters.data)
    } else {
      preflightFailures.set(feature.id, {
        code: "org.vibeshape.feature.content-preparation-failed",
        values: { reason: "invalid-prepared-parameters" },
      })
    }
  }
  return parametersByFeatureId
}

export async function rebuildDocumentFeatures(
  input: DocumentFeatureRebuildInput,
): Promise<DocumentFeatureRebuildResult> {
  const document = documentSnapshotSchema.safeParse(input.document)
  if (!document.success) {
    return invalidDocumentSnapshot("The committed document snapshot is invalid.")
  }
  const variables = evaluateVariableDefinitions(document.data.variables)
  if (!variables.ok) return invalidDocumentSnapshot(variables.diagnostic.message)
  const { features, preflightFailures } = resolveDocumentFeatures(
    document.data,
    input.registry,
    variables,
  )
  const graph = createFeatureGraph(features)
  if (!graph.ok) return invalidDocumentSnapshot(graph.diagnostic.message)
  const contentParametersByFeatureId = await prepareDocumentFeatureContent(
    input,
    document.data,
    features,
    preflightFailures,
  )

  return runFeatureRebuild({
    documentId: document.data.id,
    revision: document.data.revision,
    generation: input.generation,
    graph: graph.graph,
    registry: input.registry,
    environment: input.environment,
    mesh: input.mesh,
    hash: input.hash,
    evaluateGeometry: input.evaluateGeometry,
    contentParametersByFeatureId,
    forcedDirtyFeatureIds: [
      ...new Set([...preflightFailures.keys(), ...contentParametersByFeatureId.keys()]),
    ],
    preflightFailures,
    ...(input.previous ? { previous: input.previous } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  })
}
