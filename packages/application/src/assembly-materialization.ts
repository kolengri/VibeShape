import {
  classifyPartOperation,
  featureResultBody,
  referenceGeometryFeatureTypeHandlers,
  sameBodyReference,
} from "@vibeshape/domain"
import {
  type AssemblyDefinitionId,
  type AssemblyInstanceId,
  type AssemblyRigidPose,
  type AssemblySource,
  type AssemblyVector3,
  MAX_ASSEMBLY_COORDINATE_MM,
} from "@vibeshape/domain/assembly"
import {
  type PinnedAssemblyDefinition,
  projectAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyOccurrencePose,
  solveAssemblyKinematics,
} from "@vibeshape/domain/assembly-kinematics"
import type {
  AssemblyConstraintDiagnosticCode,
  AssemblyConstraintSolvePort,
  AssemblyConstraintSolveResult,
} from "@vibeshape/domain/assembly-mates"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "@vibeshape/domain/document"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import {
  featureEvaluationRecordSchema,
  featureRecordsSchema,
} from "@vibeshape/domain/feature-graph"
import { createFeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
  referenceGeometryModule,
} from "@vibeshape/domain/modules"
import { partDesignFeatureTypeHandlers } from "@vibeshape/domain/part-design"
import { readImportedFeatureParameters } from "@vibeshape/domain/part-design-import"
import { readMeshImportFeatureParameters } from "@vibeshape/domain/part-design-mesh-import"
import { type SourceAsset, sourceAssetDigestSchema } from "@vibeshape/domain/source-assets"
import { evaluateVariableDefinitions } from "@vibeshape/domain/variables"
import {
  type FeatureContentEnvironment,
  type FeatureMeshPolicy,
  featureContentEnvironmentSchema,
  featureMeshPolicySchema,
  type SourceAssetMaterialization,
  sourceAssetMaterializationSchema,
  topologyCandidatesSchema,
} from "@vibeshape/protocol"
import { z } from "zod"
import { resolveAssemblyMateFrames } from "./assembly-mate-frames"
import { type FeatureRebuildState, featureGeometryRecordSchema } from "./feature-rebuild"
import type { ModelBodyGeometry } from "./model-bodies"

const MAX_ASSEMBLY_MATERIALIZATION_NODES = 4096
const MAX_ASSEMBLY_OCCURRENCE_BODIES = 4096
const MAX_ASSEMBLY_MATERIALIZATION_BYTES = 64 * 1024 * 1024
type PinnedModel = PinnedAssemblyDefinition["pinnedModels"][number]
type MaterializationFailureCode =
  | AssemblyConstraintDiagnosticCode
  | "mate-solver-unavailable"
  | "invalid-assembly-document"
  | "assembly-budget-exceeded"
  | "source-bytes-unavailable"
  | "source-bytes-invalid"
  | "pinned-rebuild-failed"
  | "pinned-rebuild-stale"
  | "pinned-geometry-invalid"
  | "pinned-content-hash-mismatch"
  | "selected-output-missing"
  | "transformed-geometry-out-of-bounds"
  | "materialization-cache-disposed"

export type AssemblyMaterializedOccurrence = Readonly<{
  instanceId: AssemblyInstanceId
  definitionId: AssemblyDefinitionId
  pinRevision: number
  sourceIndex: number
  selectedBody: BodyReference
  geometryFrame: AssemblyRigidPose
  representation: "exact-solid" | "triangle-mesh"
  /** Current frozen body evidence in its original coordinates; native consumers apply geometryFrame. */
  geometry: ModelBodyGeometry
  mesh: ModelBodyGeometry["mesh"]
  bounds: ModelBodyGeometry["shape"]["bounds"]
}>
export type AssemblyMaterializationResult =
  | Readonly<{
      ok: true
      documentId: DocumentSnapshotV4["id"]
      revision: number
      occurrences: readonly AssemblyMaterializedOccurrence[]
      kinematics?: Omit<Extract<AssemblyConstraintSolveResult, { ok: true }>, "ok" | "instances">
    }>
  | Readonly<{
      ok: false
      code: MaterializationFailureCode
      message: string
      jointIds?: readonly string[]
    }>
export type AssemblyMaterializationOptions = Readonly<{
  document: unknown
  contentEnvironment: FeatureContentEnvironment
  meshPolicy: FeatureMeshPolicy
  sha256: (data: string | Uint8Array) => Promise<string>
  readSourceBytes: (asset: SourceAsset) => Promise<Uint8Array | null>
  rebuildPinnedModel: (
    snapshot: DocumentSnapshotV1,
    assets: readonly SourceAssetMaterialization[],
  ) => Promise<FeatureRebuildState>
  solveAssemblyConstraints?: AssemblyConstraintSolvePort
  cache?: AssemblyMaterializationCache
}>
class MaterializationFailure extends Error {
  constructor(
    readonly code: MaterializationFailureCode,
    message: string,
    readonly jointIds?: readonly string[],
  ) {
    super(message)
  }
}
function fail(code: MaterializationFailureCode, message: string): never {
  throw new MaterializationFailure(code, message)
}

/** Stores only verified derived buffers; disposal also invalidates pending publication. */
export class AssemblyMaterializationCache {
  #entries = new Map<
    string,
    { nodes: number; bytes: number; promise: Promise<FeatureRebuildState> }
  >()
  #epoch = 0
  #disposed = false
  assertUsable() {
    if (this.#disposed)
      fail("materialization-cache-disposed", "The assembly materialization cache is disposed.")
  }
  clear() {
    this.#epoch += 1
    this.#entries.clear()
  }
  dispose() {
    this.#disposed = true
    this.clear()
  }
  #evictOldest() {
    const oldest = this.#entries.keys().next().value
    if (oldest === undefined)
      fail("assembly-budget-exceeded", "The frozen model exceeds the cache budget.")
    this.#entries.delete(oldest)
  }
  #reserveNodes(nodes: number) {
    if (!Number.isInteger(nodes) || nodes < 1 || nodes > MAX_ASSEMBLY_MATERIALIZATION_NODES)
      fail("assembly-budget-exceeded", "The frozen model exceeds the cache node budget.")
    while (
      [...this.#entries.values()].reduce((total, entry) => total + entry.nodes, nodes) >
      MAX_ASSEMBLY_MATERIALIZATION_NODES
    )
      this.#evictOldest()
  }
  #publish(key: string, promise: Promise<FeatureRebuildState>, state: FeatureRebuildState) {
    const entry = this.#entries.get(key)
    if (!entry || entry.promise !== promise) return
    entry.bytes = stateBytes(state)
    while (
      [...this.#entries.values()].reduce((total, value) => total + value.bytes, 0) >
      MAX_ASSEMBLY_MATERIALIZATION_BYTES
    )
      this.#evictOldest()
  }
  async resolve(key: string, nodes: number, rebuild: () => Promise<FeatureRebuildState>) {
    this.assertUsable()
    const previous = this.#entries.get(key)
    if (previous) return previous.promise
    this.#reserveNodes(nodes)
    const epoch = this.#epoch
    const promise = rebuild().then((state) => {
      if (this.#disposed || epoch !== this.#epoch)
        fail(
          "materialization-cache-disposed",
          "The pending assembly materialization was invalidated.",
        )
      this.#publish(key, promise, state)
      return state
    })
    this.#entries.set(key, { nodes, bytes: 0, promise })
    try {
      return await promise
    } catch (error) {
      if (this.#entries.get(key)?.promise === promise) this.#entries.delete(key)
      throw error
    }
  }
}

const rebuildStateSchema = z
  .object({
    ok: z.literal(true).optional(),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    features: featureRecordsSchema.max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
    evaluation: z
      .object({
        records: z.array(featureEvaluationRecordSchema).max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
        dirtyFeatureIds: z.array(featureIdSchema).max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
        evaluatedFeatureIds: z.array(featureIdSchema).max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
        reusedFeatureIds: z.array(featureIdSchema).max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
      })
      .strict(),
    geometry: z.array(featureGeometryRecordSchema).max(MAX_ASSEMBLY_MATERIALIZATION_NODES),
    environment: featureContentEnvironmentSchema,
    mesh: featureMeshPolicySchema,
  })
  .strict()
function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    partDesignModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [
    ...partDesignFeatureTypeHandlers,
    ...referenceGeometryFeatureTypeHandlers,
  ])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
const pinnedRegistry = registry()
function expectedFeatures(snapshot: DocumentSnapshotV1) {
  const variables = evaluateVariableDefinitions(snapshot.variables)
  if (!variables.ok) fail("pinned-geometry-invalid", "Frozen variable expressions are invalid.")
  return snapshot.features.map(({ semanticInputs: _inputs, ...feature }) => {
    const resolved = pinnedRegistry.resolveFeatureParameters(
      { ...feature, schemaVersion: 0 },
      variables.valuesByName,
    )
    if (!resolved.ok)
      fail("pinned-geometry-invalid", "Frozen feature parameters cannot be resolved.")
    return resolved.feature
  })
}
function stateIdentityMatches(
  state: FeatureRebuildState,
  pinned: PinnedModel,
  options: AssemblyMaterializationOptions,
) {
  return (
    state.documentId === pinned.snapshot.id &&
    state.revision === pinned.snapshot.revision &&
    canonicalJson(state.features) === canonicalJson(expectedFeatures(pinned.snapshot)) &&
    canonicalJson(state.environment) === canonicalJson(options.contentEnvironment) &&
    canonicalJson(state.mesh) === canonicalJson(options.meshPolicy)
  )
}
function recordEvidenceMatches(
  record: FeatureRebuildState["evaluation"]["records"][number] | undefined,
  body: FeatureRebuildState["geometry"][number] | undefined,
  options: AssemblyMaterializationOptions,
) {
  return (
    record?.status === "succeeded" &&
    body !== undefined &&
    record.contentHash === body.contentHash &&
    canonicalJson(body.meshPolicy) === canonicalJson(options.meshPolicy) &&
    canonicalJson(body.geometry.engine.featureContentEnvironment) ===
      canonicalJson(options.contentEnvironment)
  )
}
function validateStateRecords(state: FeatureRebuildState, options: AssemblyMaterializationOptions) {
  const evaluations = new Map(state.evaluation.records.map((record) => [record.featureId, record]))
  const geometry = new Map(state.geometry.map((record) => [record.featureId, record]))
  if (evaluations.size !== state.features.length || geometry.size !== state.geometry.length)
    fail("pinned-geometry-invalid", "Frozen feature evidence has missing or duplicate producers.")
  for (const feature of state.features)
    if (!recordEvidenceMatches(evaluations.get(feature.id), geometry.get(feature.id), options))
      fail(
        "pinned-geometry-invalid",
        "Every frozen dependency requires matching successful current geometry.",
      )
  if (geometry.size !== state.features.length)
    fail("pinned-geometry-invalid", "The frozen rebuild contains unrelated geometry.")
}
function validateState(
  input: unknown,
  pinned: PinnedModel,
  options: AssemblyMaterializationOptions,
): FeatureRebuildState {
  const parsed = rebuildStateSchema.safeParse(input)
  if (!parsed.success)
    fail("pinned-geometry-invalid", "The frozen rebuild returned invalid geometry evidence.")
  const state = parsed.data
  if (!stateIdentityMatches(state, pinned, options))
    fail(
      "pinned-rebuild-stale",
      "The rebuilt geometry does not belong to the frozen source and runtime policy.",
    )
  validateStateRecords(state, options)
  return state
}
function defaultSingleBody(
  feature: FeatureRebuildState["features"][number],
  selectedBody: BodyReference,
) {
  const operation = classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] })
  return (
    (operation.kind === "new" || operation.kind === "modify") &&
    sameBodyReference(featureResultBody(feature), selectedBody)
  )
}
function singleExactAggregate(geometry: FeatureRebuildState["geometry"][number]["geometry"]) {
  return (
    !geometry.bodies?.length &&
    geometry.representation !== "triangle-mesh" &&
    geometry.shape.valid &&
    geometry.shape.solidCount === 1 &&
    geometry.shape.volume > 0
  )
}
function bodyForSource(
  state: FeatureRebuildState,
  pinned: PinnedModel,
  source: AssemblySource,
): ModelBodyGeometry {
  const feature = state.features.find(({ id }) => id === pinned.selectedBody.featureId)
  const record = state.geometry.find(({ featureId }) => featureId === pinned.selectedBody.featureId)
  if (!feature || !record)
    fail("selected-output-missing", "The selected frozen producer is missing.")
  if (source.kind === "part" && record.contentHash !== source.contentHash)
    fail(
      "pinned-content-hash-mismatch",
      "The rebuilt Part content hash differs from its immutable source pin.",
    )
  const selected = record.geometry.bodies?.find(
    ({ outputRole }) => outputRole === pinned.selectedBody.outputRole,
  )
  if (selected) return { featureId: feature.id, contentHash: record.contentHash, ...selected }
  if (defaultSingleBody(feature, pinned.selectedBody) && singleExactAggregate(record.geometry))
    return {
      featureId: feature.id,
      contentHash: record.contentHash,
      outputRole: "result",
      representation: "exact-solid",
      shape: record.geometry.shape,
      mesh: record.geometry.mesh,
      topologyCandidates: record.geometry.topologyCandidates,
    }
  fail("selected-output-missing", "The rebuilt producer does not prove the selected output role.")
}
function validateAssetSource(
  state: FeatureRebuildState,
  pinned: PinnedModel,
  source: AssemblySource,
) {
  if (source.kind !== "asset-output") return
  const feature = state.features.find(({ id }) => id === pinned.selectedBody.featureId)
  const parameters =
    feature && (readImportedFeatureParameters(feature) ?? readMeshImportFeatureParameters(feature))
  if (
    !parameters ||
    parameters.sourceAssetId !== source.assetId ||
    parameters.source.digest !== source.digest
  )
    fail(
      "pinned-content-hash-mismatch",
      "The selected source import no longer matches its frozen asset digest.",
    )
}
function activeModels(document: DocumentSnapshotV4) {
  const used = new Set(document.assembly.instances.map(({ definitionId }) => definitionId))
  return document.assembly.definitions
    .filter(({ id }) => used.has(id))
    .flatMap((definition) => definition.pinnedModels.map((pinned) => ({ definition, pinned })))
}
function geometryKey(pinned: PinnedModel, options: AssemblyMaterializationOptions) {
  const { name: _name, createdAt: _created, updatedAt: _updated, ...snapshot } = pinned.snapshot
  return canonicalJson({
    snapshot,
    assets: pinned.assets,
    environment: options.contentEnvironment,
    mesh: options.meshPolicy,
  })
}
async function verifiedBytes(
  models: ReturnType<typeof activeModels>,
  options: AssemblyMaterializationOptions,
) {
  const required = new Map(
    models.flatMap(({ pinned }) => pinned.assets.map((asset) => [asset.id, asset] as const)),
  )
  if (required.size > 128)
    fail("assembly-budget-exceeded", "Assembly source materialization exceeds its asset catalog.")
  const verified = new Map<string, SourceAssetMaterialization>()
  for (const asset of required.values()) {
    let input: Uint8Array | null
    try {
      input = await options.readSourceBytes(asset)
    } catch {
      fail("source-bytes-unavailable", "Assembly source bytes could not be read.")
    }
    if (!input) fail("source-bytes-unavailable", "Assembly source bytes are missing.")
    const materialization = sourceAssetMaterializationSchema.safeParse({ asset, bytes: input })
    if (!materialization.success)
      fail("source-bytes-invalid", "Assembly source bytes have an invalid descriptor or length.")
    const digest = sourceAssetDigestSchema.safeParse(
      await options.sha256(materialization.data.bytes),
    )
    if (!digest.success || digest.data !== asset.digest)
      fail(
        "source-bytes-invalid",
        "Assembly source bytes do not match the immutable SHA-256 digest.",
      )
    verified.set(asset.id, materialization.data)
  }
  return verified
}
function rotate(vector: AssemblyVector3, pose: AssemblyRigidPose): [number, number, number] {
  const [a, b, c] = vector
  const [x, y, z, w] = pose.quaternion
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a)
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]
}
function worldPoint(vector: AssemblyVector3, pose: AssemblyRigidPose): [number, number, number] {
  const point = rotate(vector, pose)
  return [
    point[0] + pose.translation[0],
    point[1] + pose.translation[1],
    point[2] + pose.translation[2],
  ]
}
function bounded(vector: readonly number[]) {
  if (
    vector.some(
      (value) => !Number.isFinite(value) || Math.abs(value) > MAX_ASSEMBLY_COORDINATE_MM + 1e-9,
    )
  )
    fail(
      "transformed-geometry-out-of-bounds",
      "The transformed assembly body exceeds the finite world bounds.",
    )
}
function transformedBounds(bounds: ModelBodyGeometry["shape"]["bounds"], pose: AssemblyRigidPose) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = worldPoint([x, y, z], pose)
        bounded(point)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis] ?? Infinity, point[axis] ?? Infinity)
          max[axis] = Math.max(max[axis] ?? -Infinity, point[axis] ?? -Infinity)
        }
      }
  return { min, max }
}
function meshBytes(mesh: ModelBodyGeometry["mesh"]) {
  return (
    mesh.positions.byteLength +
    mesh.normals.byteLength +
    mesh.indices.byteLength +
    mesh.triangleFaceIds.byteLength
  )
}
function validMeshLayout(mesh: ModelBodyGeometry["mesh"]) {
  return (
    mesh.positions.length > 0 &&
    mesh.positions.length % 3 === 0 &&
    mesh.normals.length === mesh.positions.length &&
    mesh.indices.length > 0 &&
    mesh.indices.length % 3 === 0 &&
    mesh.triangleFaceIds.length === mesh.indices.length / 3
  )
}
function vectorAt(buffer: Float32Array, offset: number): [number, number, number] {
  return [buffer[offset] ?? NaN, buffer[offset + 1] ?? NaN, buffer[offset + 2] ?? NaN]
}
function validateMeshValues(mesh: ModelBodyGeometry["mesh"]) {
  if (
    mesh.indices.some((index) => index >= mesh.positions.length / 3) ||
    mesh.positions.some((value) => !Number.isFinite(value)) ||
    mesh.normals.some((value) => !Number.isFinite(value))
  )
    fail(
      "pinned-geometry-invalid",
      "The selected body has non-finite vertices or invalid triangle indices.",
    )
  for (let i = 0; i < mesh.positions.length; i += 3) {
    bounded(vectorAt(mesh.positions, i))
    if (Math.abs(Math.hypot(...vectorAt(mesh.normals, i)) - 1) > 1e-5)
      fail("pinned-geometry-invalid", "The selected body requires finite unit normals.")
  }
}
function validateRepresentation(body: ModelBodyGeometry) {
  const { shape } = body
  if (body.representation === "triangle-mesh") {
    if (shape.solidCount !== 0 || shape.volume !== 0 || body.topologyCandidates.length)
      fail(
        "pinned-geometry-invalid",
        "Triangle meshes cannot claim exact solid or topology evidence.",
      )
    return
  }
  if (
    shape.solidCount !== 1 ||
    shape.volume <= 0 ||
    shape.bounds.min.some((value, axis) => value >= (shape.bounds.max[axis] ?? -Infinity))
  )
    fail(
      "pinned-geometry-invalid",
      "An exact assembly body requires a valid positive-volume single solid.",
    )
}
function validateBody(body: ModelBodyGeometry) {
  const { shape, mesh } = body
  if (
    !shape.valid ||
    shape.bounds.min.some((value, axis) => value > (shape.bounds.max[axis] ?? -Infinity))
  )
    fail("pinned-geometry-invalid", "The selected body has invalid bounds or validity evidence.")
  bounded(shape.bounds.min)
  bounded(shape.bounds.max)
  if (!validMeshLayout(mesh))
    fail("pinned-geometry-invalid", "The selected body has malformed triangle buffers.")
  validateMeshValues(mesh)
  validateRepresentation(body)
}
function copyMesh(mesh: ModelBodyGeometry["mesh"]) {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    indices: mesh.indices.slice(),
    triangleFaceIds: mesh.triangleFaceIds.slice(),
  }
}
function stateBytes(state: FeatureRebuildState) {
  return state.geometry.reduce(
    (total, record) =>
      total +
      meshBytes(record.geometry.mesh) +
      (record.geometry.bodies ?? []).reduce((sum, body) => sum + meshBytes(body.mesh), 0),
    0,
  )
}
function ownState(state: FeatureRebuildState): FeatureRebuildState {
  return {
    ...state,
    geometry: state.geometry.map((record) => ({
      ...record,
      geometry: {
        ...record.geometry,
        mesh: copyMesh(record.geometry.mesh),
        ...(record.geometry.bodies
          ? {
              bodies: record.geometry.bodies.map((body) => ({
                ...body,
                mesh: copyMesh(body.mesh),
              })),
            }
          : {}),
      },
    })),
  }
}
function transformMesh(mesh: ModelBodyGeometry["mesh"], pose: AssemblyRigidPose) {
  const positions = new Float32Array(mesh.positions.length),
    normals = new Float32Array(mesh.normals.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point = worldPoint(
      [mesh.positions[i] ?? 0, mesh.positions[i + 1] ?? 0, mesh.positions[i + 2] ?? 0],
      pose,
    )
    bounded(point)
    positions.set(point, i)
    normals.set(
      rotate([mesh.normals[i] ?? 0, mesh.normals[i + 1] ?? 0, mesh.normals[i + 2] ?? 0], pose),
      i,
    )
  }
  return {
    positions,
    normals,
    indices: mesh.indices.slice(),
    triangleFaceIds: mesh.triangleFaceIds.slice(),
  }
}
function copyBody(body: ModelBodyGeometry): ModelBodyGeometry {
  return {
    ...body,
    shape: {
      ...body.shape,
      bounds: { min: [...body.shape.bounds.min], max: [...body.shape.bounds.max] },
    },
    mesh: {
      positions: body.mesh.positions.slice(),
      normals: body.mesh.normals.slice(),
      indices: body.mesh.indices.slice(),
      triangleFaceIds: body.mesh.triangleFaceIds.slice(),
    },
    topologyCandidates: topologyCandidatesSchema.parse(body.topologyCandidates),
  }
}
async function rebuildModels(
  models: ReturnType<typeof activeModels>,
  assets: Map<string, SourceAssetMaterialization>,
  options: AssemblyMaterializationOptions,
) {
  const states = new Map<PinnedModel, FeatureRebuildState>()
  const promises = new Map<string, Promise<FeatureRebuildState>>()
  let nodes = 0
  for (const { definition, pinned } of models) {
    const source = definition.sources[pinned.sourceIndex]
    if (!source) fail("pinned-geometry-invalid", "A frozen source index is unavailable.")
    const payload = geometryKey(pinned, options)
    const key = sourceAssetDigestSchema.parse(await options.sha256(payload))
    let promise = promises.get(key)
    if (!promise) {
      nodes += pinned.snapshot.history.length
      if (nodes > MAX_ASSEMBLY_MATERIALIZATION_NODES)
        fail(
          "assembly-budget-exceeded",
          "Active frozen assembly closures exceed the rebuild node budget.",
        )
      const build = async () => {
        const materializations = pinned.assets.map((asset) => {
          const found = assets.get(asset.id)
          if (!found) fail("source-bytes-unavailable", "A frozen import source is unavailable.")
          return sourceAssetMaterializationSchema.parse(found)
        })
        const state = validateState(
          await options.rebuildPinnedModel(
            documentSnapshotV1Schema.parse(pinned.snapshot),
            materializations,
          ),
          pinned,
          options,
        )
        validateAssetSource(state, pinned, source)
        validateBody(bodyForSource(state, pinned, source))
        return ownState(state)
      }
      promise = options.cache
        ? options.cache.resolve(key, pinned.snapshot.history.length, build)
        : build()
      promises.set(key, promise)
    }
    states.set(pinned, validateState(await promise, pinned, options))
  }
  return states
}
async function occurrencePoses(
  document: DocumentSnapshotV4,
  states: Map<PinnedModel, FeatureRebuildState>,
  options: AssemblyMaterializationOptions,
) {
  const authority = projectAssemblyAuthority(document.assembly)
  const sourceDefinitions = document.assembly.definitions
  let poses: readonly AssemblyOccurrencePose[]
  let kinematics:
    | Omit<Extract<AssemblyConstraintSolveResult, { ok: true }>, "ok" | "instances">
    | undefined
  if (authority.schemaVersion === 1) {
    const legacy = solveAssemblyKinematics(authority)
    if (!legacy.ok) fail("invalid-assembly-document", legacy.diagnostic.message)
    poses = legacy.instances
  } else {
    if (!options.solveAssemblyConstraints)
      fail("mate-solver-unavailable", "The general assembly mate solver is unavailable.")
    const sources = sourceDefinitions.flatMap((definition) =>
      definition.pinnedModels
        .filter((pinned) => states.has(pinned))
        .map((pinned) => {
          const body = occurrenceBody(definition, pinned, states)
          return {
            definitionId: definition.id,
            sourceIndex: pinned.sourceIndex,
            selectedBody: pinned.selectedBody,
            representation: body.representation ?? ("exact-solid" as const),
            candidates: body.topologyCandidates,
          }
        }),
    )
    const resolved = resolveAssemblyMateFrames(authority, sourceDefinitions, sources)
    if (!resolved.ok)
      throw new MaterializationFailure(resolved.code, resolved.message, resolved.jointIds)
    const solved = await options.solveAssemblyConstraints(resolved.assembly)
    if (!solved.ok) throw new MaterializationFailure(solved.code, solved.message, solved.jointIds)
    poses = solved.instances
    const { ok: _ok, instances: _instances, ...summary } = solved
    kinematics = summary
  }
  return { poses, kinematics }
}
async function occurrences(
  document: DocumentSnapshotV4,
  states: Map<PinnedModel, FeatureRebuildState>,
  options: AssemblyMaterializationOptions,
) {
  const { poses, kinematics } = await occurrencePoses(document, states, options)
  const definitions = new Map(
    document.assembly.definitions.map((definition) => [definition.id, definition]),
  )
  const result: AssemblyMaterializedOccurrence[] = []
  for (const pose of poses) {
    const definition = definitions.get(pose.definitionId)
    if (!definition) fail("invalid-assembly-document", "An assembly definition is unavailable.")
    for (const pinned of definition.pinnedModels) {
      const body = occurrenceBody(definition, pinned, states)
      if (result.length >= MAX_ASSEMBLY_OCCURRENCE_BODIES)
        fail("assembly-budget-exceeded", "Assembly occurrences exceed their body catalog budget.")
      result.push(occurrenceEvidence(pose, definition, pinned, body))
    }
  }
  return { occurrences: result, ...(kinematics ? { kinematics } : {}) }
}
function occurrenceBody(
  definition: PinnedAssemblyDefinition,
  pinned: PinnedModel,
  states: Map<PinnedModel, FeatureRebuildState>,
) {
  const state = states.get(pinned),
    source = definition.sources[pinned.sourceIndex]
  if (!state || !source)
    fail("pinned-geometry-invalid", "An assembly source has no frozen geometry.")
  validateAssetSource(state, pinned, source)
  const body = bodyForSource(state, pinned, source)
  validateBody(body)
  return body
}
function occurrenceEvidence(
  pose: AssemblyOccurrencePose,
  definition: PinnedAssemblyDefinition,
  pinned: PinnedModel,
  body: ModelBodyGeometry,
): AssemblyMaterializedOccurrence {
  return {
    instanceId: pose.instanceId,
    definitionId: pose.definitionId,
    geometryFrame: pose.geometryFrame,
    pinRevision: definition.pinRevision,
    sourceIndex: pinned.sourceIndex,
    selectedBody: pinned.selectedBody,
    representation: body.representation ?? "exact-solid",
    geometry: copyBody(body),
    mesh: transformMesh(body.mesh, pose.geometryFrame),
    bounds: transformedBounds(body.shape.bounds, pose.geometryFrame),
  }
}
export async function materializeAssembly(
  options: AssemblyMaterializationOptions,
): Promise<AssemblyMaterializationResult> {
  try {
    options.cache?.assertUsable()
    const parsed = documentSnapshotV4Schema.safeParse(options.document)
    if (!parsed.success)
      fail("invalid-assembly-document", "The V3 assembly or immutable source pins are invalid.")
    const policies = {
      contentEnvironment: featureContentEnvironmentSchema.parse(options.contentEnvironment),
      meshPolicy: featureMeshPolicySchema.parse(options.meshPolicy),
    }
    const input = { ...options, ...policies }
    const models = activeModels(parsed.data)
    const assets = await verifiedBytes(models, input)
    const states = await rebuildModels(models, assets, input)
    options.cache?.assertUsable()
    return {
      ok: true,
      documentId: parsed.data.id,
      revision: parsed.data.revision,
      ...(await occurrences(parsed.data, states, input)),
    }
  } catch (error) {
    return error instanceof MaterializationFailure
      ? {
          ok: false,
          code: error.code,
          message: error.message,
          ...(error.jointIds ? { jointIds: error.jointIds } : {}),
        }
      : {
          ok: false,
          code: "pinned-rebuild-failed",
          message: "Assembly source geometry could not be materialized.",
        }
  }
}
