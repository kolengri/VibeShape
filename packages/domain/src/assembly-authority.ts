import { z } from "zod"
import {
  type Assembly,
  type AssemblySource,
  assemblyDefinitionIdSchema,
  assemblyDefinitionSchema,
  assemblyInstanceIdSchema,
  assemblyInstanceSchema,
  assemblyJointIdSchema,
  assemblyJointSchema,
  assemblyRigidPoseSchema,
  assemblySchema,
} from "./assembly"
import { solveAssemblyKinematics } from "./assembly-kinematics"
import { assemblyLibraryBindingSchema } from "./assembly-library-binding"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import { canonicalJson } from "./canonical-json"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import type { DocumentNodeRef } from "./document-node"
import type { DocumentSnapshotV3 } from "./document-v3-schema"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
  referenceGeometryModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  importedBodyOutputRole,
  readImportedFeatureParameters,
  validateImportedFeatureAssets,
} from "./part-design-import"
import { meshImportOutputRole, readMeshImportFeatureParameters } from "./part-design-mesh-import"
import { readPatternFeatureParameters } from "./part-design-pattern"
import type { PartOperation } from "./part-operation"
import { classifyPartOperation, featureResultBody, sameBodyReference } from "./part-operation"
import { authoredItemNameSchema } from "./parts"
import { referenceGeometryFeatureTypeHandlers } from "./reference-geometry"
import { validateSketchSourceImportAssets } from "./sketch-source-import"
import { type SourceAsset, sourceAssetsSchema } from "./source-assets"
import {
  type EvaluatedVariable,
  evaluateVariableDefinitions,
  parameterVariableReferences,
  variableReferencesInExpression,
} from "./variables"

export const MAX_ASSEMBLY_PINNED_MODEL_NODES = 4096
export const MAX_ASSEMBLY_PINNED_NODES = 16_384
const pinnedSnapshotSchema = documentSnapshotV1Schema.safeExtend({
  features: documentSnapshotV1Schema.shape.features.max(MAX_ASSEMBLY_PINNED_MODEL_NODES),
  sketches: documentSnapshotV1Schema.shape.sketches.max(MAX_ASSEMBLY_PINNED_MODEL_NODES),
  history: documentSnapshotV1Schema.shape.history.max(MAX_ASSEMBLY_PINNED_MODEL_NODES),
})
export const assemblyPinnedModelSchema = z
  .object({
    sourceIndex: z.number().int().nonnegative().max(255),
    selectedBody: bodyReferenceSchema,
    snapshot: pinnedSnapshotSchema,
    assets: sourceAssetsSchema,
  })
  .strict()
export const pinnedAssemblyDefinitionSchema = assemblyDefinitionSchema.safeExtend({
  pinRevision: z.number().int().positive().safe(),
  pinnedModels: z.array(assemblyPinnedModelSchema).max(256),
  libraryBinding: assemblyLibraryBindingSchema.optional(),
})
export type PinnedAssemblyDefinition = Readonly<z.infer<typeof pinnedAssemblyDefinitionSchema>>

function refKey(ref: DocumentNodeRef) {
  return `${ref.kind}:${ref.id}`
}
function importedAssetId(feature: DocumentSnapshotV1["features"][number]) {
  return (readImportedFeatureParameters(feature) ?? readMeshImportFeatureParameters(feature))
    ?.sourceAssetId
}
function featureClosure(snapshot: DocumentSnapshotV1, featureId: string) {
  const graph = createDocumentDependencyGraph(snapshot)
  if (!graph.ok) throw new Error("Assembly source dependency declarations must be complete.")
  const root = snapshot.features.find((feature) => feature.id === featureId)
  if (!root || root.suppressed)
    throw new Error("Assembly source body must have an available producer.")
  const pending: DocumentNodeRef[] = [{ kind: "feature", id: root.id }]
  const closure = new Set<string>()
  while (pending.length) {
    const ref = pending.pop()
    if (!ref || closure.has(refKey(ref))) continue
    closure.add(refKey(ref))
    pending.push(...graph.graph.dependenciesOf(ref))
  }
  if (
    graph.graph.dependencyModelIssues.some(({ featureId }) => closure.has(`feature:${featureId}`))
  )
    throw new Error("A frozen body requires complete declarations for every selected dependency.")
  return closure
}
function featureRegistry() {
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
const pinnedFeatureRegistry = featureRegistry()
function validatePinnedFeature(
  feature: DocumentSnapshotV1["features"][number],
  variables: ReadonlyMap<string, EvaluatedVariable>,
) {
  if (feature.suppressed) throw new Error("A pinned body cannot depend on suppressed geometry.")
  const projection = projectFirstPartyFeatureSemanticInputs(feature)
  if (
    !projection.recognized ||
    !projection.ok ||
    canonicalJson(projection.inputs) !== canonicalJson(feature.semanticInputs)
  )
    throw new Error("Pinned first-party semantic inputs must be canonical.")
  const { semanticInputs: _inputs, ...model } = feature
  const resolved = pinnedFeatureRegistry.resolveFeatureParameters(
    { ...model, schemaVersion: 0 },
    variables,
  )
  if (!resolved.ok || !pinnedFeatureRegistry.validateFeature(resolved.feature).ok)
    throw new Error("Pinned assembly feature parameters are invalid.")
  return { ...feature, parameters: resolved.feature.parameters }
}
function declaredBodies(operation: PartOperation, feature: DocumentSnapshotV1["features"][number]) {
  switch (operation.kind) {
    case "new":
    case "modify":
      return [featureResultBody(feature)]
    case "independent-outputs":
      return operation.outputs
    case "compound":
      return operation.entries.map(({ output }) => output)
    case "fan-out":
      return [operation.continuation, ...operation.createdOutputs]
    case "unmanaged":
      return []
  }
}
function validatePinnedFeatures(snapshot: DocumentSnapshotV1, selectedBody: BodyReference) {
  const variables = evaluateVariableDefinitions(snapshot.variables)
  if (!variables.ok) throw new Error("Pinned assembly variables are invalid.")
  const features = snapshot.features.map((feature) =>
    validatePinnedFeature(feature, variables.valuesByName),
  )
  const feature = features.find(({ id }) => id === selectedBody.featureId)
  if (!feature) throw new Error("The pinned body producer is missing.")
  const operation = classifyPartOperation(
    feature,
    readPatternFeatureParameters(feature)?.count.value,
  )
  if (!declaredBodies(operation, feature).some((body) => sameBodyReference(body, selectedBody)))
    throw new Error("The pinned semantic producer does not declare the selected body role.")
}
function importedOutput(
  feature: DocumentSnapshotV1["features"][number],
  source: Extract<AssemblySource, { kind: "asset-output" }>,
) {
  const exact = readImportedFeatureParameters(feature)
  const parameters = exact ?? readMeshImportFeatureParameters(feature)
  if (
    feature.suppressed ||
    parameters?.sourceAssetId !== source.assetId ||
    parameters.source.digest !== source.digest ||
    !parameters.outputs.some(({ outputId }) => outputId === source.outputId)
  )
    return null
  const { sourceAssetId: _id, ...content } = parameters
  return {
    selectedBody: bodyReferenceSchema.parse({
      schemaVersion: 0,
      featureId: feature.id,
      outputRole: exact
        ? importedBodyOutputRole(source.outputId)
        : meshImportOutputRole(source.outputId),
    }),
    content: { type: feature.type, parameters: content },
  }
}
function validateSelectedSource(
  source: AssemblySource,
  pinned: z.infer<typeof assemblyPinnedModelSchema>,
) {
  if (source.kind === "part") {
    if (!sameBodyReference(source.body, pinned.selectedBody))
      throw new Error("A frozen Part source must retain its selected body identity.")
    return
  }
  const feature = pinned.snapshot.features.find(({ id }) => id === pinned.selectedBody.featureId)
  const output = feature && importedOutput(feature, source)
  if (!output || !sameBodyReference(output.selectedBody, pinned.selectedBody))
    throw new Error("A frozen asset source requires its captured import producer and output role.")
}
function validatePinnedModel(
  definition: PinnedAssemblyDefinition,
  pinned: z.infer<typeof assemblyPinnedModelSchema>,
) {
  const source = definition.sources[pinned.sourceIndex]
  if (!source) throw new Error("A pinned model must select an existing source index.")
  validateSelectedSource(source, pinned)
  const closure = featureClosure(pinned.snapshot, pinned.selectedBody.featureId)
  if (
    closure.size !== pinned.snapshot.history.length ||
    pinned.snapshot.history.some((ref) => !closure.has(refKey(ref)))
  )
    throw new Error("A pinned model must contain exactly its body's dependency closure.")
  validatePinnedFeatures(pinned.snapshot, pinned.selectedBody)
  if (canonicalJson(captureVariables(pinned.snapshot)) !== canonicalJson(pinned.snapshot.variables))
    throw new Error("Pinned variables must belong to the selected dependency closure.")
  const sourceIssue = validateImportedFeatureAssets({
    features: pinned.snapshot.features,
    assets: pinned.assets,
  })
  if (sourceIssue) throw new Error(sourceIssue)
  const sketchSourceIssue = validateSketchSourceImportAssets({
    sketches: pinned.snapshot.sketches,
    assets: pinned.assets,
  })
  if (sketchSourceIssue) throw new Error(sketchSourceIssue)
  const used = new Set([
    ...pinned.snapshot.features.flatMap((feature) => {
      const id = importedAssetId(feature)
      return id ? [id] : []
    }),
    ...pinned.snapshot.sketches.flatMap((sketch) =>
      sketch.sourceImport ? [sketch.sourceImport.assetId] : [],
    ),
  ])
  if (pinned.assets.some((asset) => !used.has(asset.id)))
    throw new Error("Pinned source descriptors must belong to the captured body closure.")
}
export function projectAssemblyAuthority(assembly: AssemblyAuthority): Assembly {
  return {
    ...assembly,
    definitions: assembly.definitions.map(
      ({
        pinRevision: _revision,
        pinnedModels: _models,
        libraryBinding: _binding,
        ...definition
      }) => definition,
    ),
  }
}
function validateDefinitions(definitions: readonly PinnedAssemblyDefinition[]) {
  let nodes = 0
  for (const definition of definitions) {
    const expected = definition.sources.map((_source, index) => index)
    if (
      canonicalJson(expected) !==
      canonicalJson(definition.pinnedModels.map(({ sourceIndex }) => sourceIndex))
    )
      throw new Error("Every assembly source requires one ordered frozen model.")
    for (const pinned of definition.pinnedModels) {
      nodes += pinned.snapshot.history.length
      if (nodes > MAX_ASSEMBLY_PINNED_NODES)
        throw new Error("Pinned assembly dependency nodes exceed the document budget.")
      validatePinnedModel(definition, pinned)
    }
  }
}
export const assemblyAuthoritySchema = z
  .object({
    schemaVersion: z.literal(1),
    definitions: z.array(pinnedAssemblyDefinitionSchema).max(256),
    instances: z.array(assemblyInstanceSchema).max(256),
    joints: z.array(assemblyJointSchema).max(255),
  })
  .strict()
  .superRefine((authority, context) => {
    const pure = assemblySchema.safeParse(projectAssemblyAuthority(authority))
    if (!pure.success)
      for (const issue of pure.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    try {
      validateDefinitions(authority.definitions)
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["definitions"],
        message: error instanceof Error ? error.message : "The frozen assembly source is invalid.",
      })
    }
    const ids = [...authority.definitions, ...authority.instances, ...authority.joints].map(
      ({ id }) => id,
    )
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Assembly records require distinct stable identities across collections.",
      })
    if (pure.success && !solveAssemblyKinematics(pure.data).ok)
      context.addIssue({
        code: "custom",
        message: "Assembly poses exceed their composed world bounds.",
      })
  })
export type AssemblyAuthority = Readonly<z.infer<typeof assemblyAuthoritySchema>>
export function emptyAssemblyAuthority(): AssemblyAuthority {
  return { schemaVersion: 1, definitions: [], instances: [], joints: [] }
}
type SourceAuthority = Omit<DocumentSnapshotV3, "schemaVersion"> & {
  schemaVersion: 4
  assets: readonly SourceAsset[]
}
function captureVariables(snapshot: DocumentSnapshotV1) {
  const selected = new Set(
    parameterVariableReferences([
      snapshot.features.map(({ parameters }) => parameters),
      snapshot.sketches,
    ]),
  )
  const pending = [...selected]
  while (pending.length) {
    const name = pending.pop()
    const variable = snapshot.variables.find((value) => value.name === name)
    if (!variable) throw new Error("A captured body references an unavailable variable.")
    for (const dependency of variableReferencesInExpression(variable.expression))
      if (!selected.has(dependency)) {
        selected.add(dependency)
        pending.push(dependency)
      }
  }
  return snapshot.variables.filter(({ name }) => selected.has(name))
}
function selectSourceBody(authority: SourceAuthority, source: AssemblySource): BodyReference {
  if (source.kind === "part") {
    const part = authority.parts.find(({ id }) => id === source.partId)
    if (!part?.bodyHistory.some((body) => sameBodyReference(body, source.body)))
      throw new Error("The selected Part does not own the captured source body.")
    return source.body
  }
  const candidates = authority.features.flatMap((feature) => {
    const output = importedOutput(feature, source)
    return output ? [output] : []
  })
  if (!candidates.length)
    throw new Error("Import the asset before creating an assembly definition.")
  if (new Set(candidates.map(({ content }) => canonicalJson(content))).size !== 1)
    throw new Error("The asset has conflicting import manifests; select an explicit Part source.")
  candidates.sort((a, b) =>
    a.selectedBody.featureId < b.selectedBody.featureId
      ? -1
      : a.selectedBody.featureId > b.selectedBody.featureId
        ? 1
        : 0,
  )
  const selected = candidates[0]
  if (!selected) throw new Error("The imported source producer is unavailable.")
  return selected.selectedBody
}
function captureModel(authority: SourceAuthority, source: AssemblySource, sourceIndex: number) {
  const selectedBody = selectSourceBody(authority, source)
  const snapshot = documentSnapshotV1Schema.parse({
    schemaVersion: 1,
    id: authority.id,
    revision: authority.revision,
    name: authority.name,
    displayUnits: authority.displayUnits,
    variables: authority.variables,
    features: authority.features,
    sketches: authority.sketches,
    history: authority.history,
    createdAt: authority.createdAt,
    updatedAt: authority.updatedAt,
  })
  const closure = featureClosure(snapshot, selectedBody.featureId)
  if (authority.surfaceTextures.some((layer) => closure.has(`feature:${layer.featureId}`)))
    throw new Error(
      "Assembly/library pins for textured sources are not supported; remove/detach texture layers or use an untextured source.",
    )
  const history = snapshot.history.filter((ref) => closure.has(refKey(ref)))
  const features = history.flatMap((ref) =>
    ref.kind === "feature" ? snapshot.features.filter(({ id }) => id === ref.id) : [],
  )
  const sketches = history.flatMap((ref) =>
    ref.kind === "sketch" ? snapshot.sketches.filter(({ id }) => id === ref.id) : [],
  )
  const frozen = { ...snapshot, history, features, sketches }
  const requiredAssets = new Set([
    ...features.flatMap((feature) => {
      const id = importedAssetId(feature)
      return id ? [id] : []
    }),
    ...sketches.flatMap((sketch) => (sketch.sourceImport ? [sketch.sourceImport.assetId] : [])),
  ])
  return assemblyPinnedModelSchema.parse({
    sourceIndex,
    selectedBody,
    snapshot: { ...frozen, variables: captureVariables(frozen) },
    assets: authority.assets.filter(({ id }) => requiredAssets.has(id)),
  })
}
/** Geometry must independently verify contentHash; domain captures only declared semantic authority. */
export function captureAssemblyDefinition(
  authority: SourceAuthority,
  definitionInput: unknown,
  pinRevision = 1,
): PinnedAssemblyDefinition {
  const definition = assemblyDefinitionSchema.parse(definitionInput)
  const pinnedModels = definition.sources.map((source, index) =>
    captureModel(authority, source, index),
  )
  const pinned = pinnedAssemblyDefinitionSchema.parse({ ...definition, pinRevision, pinnedModels })
  validateDefinitions([pinned])
  const issue = validateAssemblySourcePins(
    { ...emptyAssemblyAuthority(), definitions: [pinned] },
    authority.assets,
  )
  if (issue) throw new Error(issue)
  return pinned
}
export function validateAssemblySourcePins(
  assembly: AssemblyAuthority,
  assets: readonly SourceAsset[],
): string | null {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const sourceIds = assemblySourceIds(assembly, assets)
  if (
    [...assembly.definitions, ...assembly.instances, ...assembly.joints].some(({ id }) =>
      sourceIds.has(id),
    )
  )
    return "Assembly records must not reuse their immutable source identities."
  for (const definition of assembly.definitions) {
    const issue = validateDefinitionAssets(definition, byId)
    if (issue) return issue
  }
  return null
}
function assemblySourceIds(assembly: AssemblyAuthority, assets: readonly SourceAsset[]) {
  const sourceIds = new Set<string>(assets.flatMap((asset) => [asset.id, ...asset.outputs]))
  for (const definition of assembly.definitions) {
    for (const pinned of definition.pinnedModels) sourceIds.add(pinned.selectedBody.featureId)
    for (const source of definition.sources) {
      if (source.kind === "part") {
        sourceIds.add(source.partId)
        sourceIds.add(source.body.featureId)
      }
    }
  }
  return sourceIds
}
function sourceAssetMatches(source: AssemblySource, byId: ReadonlyMap<string, SourceAsset>) {
  if (source.kind === "part") return true
  const asset = byId.get(source.assetId)
  return asset?.digest === source.digest && asset.outputs.includes(source.outputId)
}
function pinnedAssetsMatch(
  pinned: z.infer<typeof assemblyPinnedModelSchema>,
  byId: ReadonlyMap<string, SourceAsset>,
) {
  return pinned.assets.every((asset) => {
    const current = byId.get(asset.id)
    return current !== undefined && canonicalJson(current) === canonicalJson(asset)
  })
}
function validateDefinitionAssets(
  definition: PinnedAssemblyDefinition,
  byId: ReadonlyMap<string, SourceAsset>,
): string | null {
  if (!definition.sources.every((source) => sourceAssetMatches(source, byId)))
    return "An assembly asset pin requires its original immutable descriptor, digest and output."
  if (!definition.pinnedModels.every((pinned) => pinnedAssetsMatch(pinned, byId)))
    return "A pinned assembly import must match the document's immutable source descriptor."
  return null
}

const metadata = z
  .object({
    kind: z.literal("definition.update"),
    definitionId: assemblyDefinitionIdSchema,
    name: authoredItemNameSchema.optional(),
    sourceFrame: assemblyRigidPoseSchema.optional(),
  })
  .strict()
  .refine((change) => change.name !== undefined || change.sourceFrame !== undefined)
const referenceMutations = [
  z
    .object({
      kind: z.literal("definition.detach-library"),
      definitionId: assemblyDefinitionIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("definition.remove"),
      definitionId: assemblyDefinitionIdSchema,
      cascade: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("instance.create"), instance: assemblyInstanceSchema }).strict(),
  z.object({ kind: z.literal("instance.update"), instance: assemblyInstanceSchema }).strict(),
  z
    .object({
      kind: z.literal("instance.remove"),
      instanceId: assemblyInstanceIdSchema,
      cascade: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("joint.create"), joint: assemblyJointSchema }).strict(),
  z.object({ kind: z.literal("joint.update"), joint: assemblyJointSchema }).strict(),
  z.object({ kind: z.literal("joint.remove"), jointId: assemblyJointIdSchema }).strict(),
] as const
const pinnedMutations = [
  z
    .object({
      kind: z.literal("definition.insert-pinned"),
      definition: pinnedAssemblyDefinitionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("definition.relink-pinned"),
      definition: pinnedAssemblyDefinitionSchema,
    })
    .strict(),
] as const
export const assemblyMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("definition.create"), definition: assemblyDefinitionSchema }).strict(),
  metadata,
  z.object({ kind: z.literal("definition.relink"), definition: assemblyDefinitionSchema }).strict(),
  ...pinnedMutations,
  ...referenceMutations,
])
export const assemblyMutationsSchema = z.array(assemblyMutationSchema).min(1).max(256)
export type AssemblyMutation = z.infer<typeof assemblyMutationSchema>
export const capturedAssemblyMutationSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("definition.create"), definition: pinnedAssemblyDefinitionSchema })
    .strict(),
  metadata,
  z
    .object({ kind: z.literal("definition.relink"), definition: pinnedAssemblyDefinitionSchema })
    .strict(),
  ...pinnedMutations,
  ...referenceMutations,
])
export const capturedAssemblyMutationsSchema = z
  .array(capturedAssemblyMutationSchema)
  .min(1)
  .max(256)
export type CapturedAssemblyMutation = z.infer<typeof capturedAssemblyMutationSchema>

function upsert<T extends { id: string }>(records: readonly T[], record: T, create: boolean) {
  const index = records.findIndex(({ id }) => id === record.id)
  if (index < 0 !== create)
    throw new Error(
      create ? "An assembly identity already exists." : "An assembly record to update is missing.",
    )
  return create ? [...records, record] : records.map((old) => (old.id === record.id ? record : old))
}
function removeInstances(
  assembly: AssemblyAuthority,
  ids: Set<string>,
  cascade: boolean,
): AssemblyAuthority {
  for (let changed = true; changed; ) {
    changed = false
    for (const joint of assembly.joints)
      if (ids.has(joint.parentInstanceId) && !ids.has(joint.childInstanceId)) {
        if (!cascade)
          throw new Error(
            "Removing an occurrence with dependent children requires explicit cascade.",
          )
        ids.add(joint.childInstanceId)
        changed = true
      }
  }
  return {
    ...assembly,
    instances: assembly.instances.filter(({ id }) => !ids.has(id)),
    joints: assembly.joints.filter(
      (joint) => !ids.has(joint.parentInstanceId) && !ids.has(joint.childInstanceId),
    ),
  }
}
function replaceDefinition(
  assembly: AssemblyAuthority,
  change: Extract<CapturedAssemblyMutation, { definition: PinnedAssemblyDefinition }>,
): AssemblyAuthority {
  const previous = assembly.definitions.find(({ id }) => id === change.definition.id)
  const create = change.kind === "definition.create" || change.kind === "definition.insert-pinned"
  const revision = create ? 1 : (previous?.pinRevision ?? 0) + 1
  if (change.definition.pinRevision !== revision)
    throw new Error("A source relink must advance the captured pin revision exactly once.")
  return {
    ...assembly,
    definitions: upsert(assembly.definitions, change.definition, create),
  }
}
function updateDefinition(
  assembly: AssemblyAuthority,
  change: Extract<CapturedAssemblyMutation, { kind: "definition.update" }>,
  definition: PinnedAssemblyDefinition,
): AssemblyAuthority {
  const updated = {
    ...definition,
    ...(change.name === undefined ? {} : { name: change.name }),
    ...(change.sourceFrame === undefined ? {} : { sourceFrame: change.sourceFrame }),
  }
  return { ...assembly, definitions: upsert(assembly.definitions, updated, false) }
}
function changeDefinition(
  assembly: AssemblyAuthority,
  change: Extract<CapturedAssemblyMutation, { kind: `definition.${string}` }>,
): AssemblyAuthority {
  if ("definition" in change) return replaceDefinition(assembly, change)
  const definition = assembly.definitions.find(({ id }) => id === change.definitionId)
  if (!definition) throw new Error("The assembly definition is missing.")
  if (change.kind === "definition.update") return updateDefinition(assembly, change, definition)
  if (change.kind === "definition.detach-library") {
    if (!definition.libraryBinding)
      throw new Error("The assembly definition has no library reference to detach.")
    const { libraryBinding: _binding, ...detached } = definition
    return { ...assembly, definitions: upsert(assembly.definitions, detached, false) }
  }
  const ids = new Set(
    assembly.instances
      .filter(({ definitionId }) => definitionId === definition.id)
      .map(({ id }) => id),
  )
  if (ids.size && !change.cascade)
    throw new Error("Removing a used definition requires explicit cascade.")
  return {
    ...removeInstances(assembly, ids, change.cascade),
    definitions: assembly.definitions.filter(({ id }) => id !== definition.id),
  }
}
function changeInstance(
  assembly: AssemblyAuthority,
  change: Extract<
    CapturedAssemblyMutation,
    { kind: "instance.create" | "instance.update" | "instance.remove" }
  >,
): AssemblyAuthority {
  if (change.kind !== "instance.remove")
    return {
      ...assembly,
      instances: upsert(assembly.instances, change.instance, change.kind === "instance.create"),
    }
  if (!assembly.instances.some(({ id }) => id === change.instanceId))
    throw new Error("The assembly occurrence is missing.")
  return removeInstances(assembly, new Set([change.instanceId]), change.cascade)
}
function changeJoint(
  assembly: AssemblyAuthority,
  change: Extract<
    CapturedAssemblyMutation,
    { kind: "joint.create" | "joint.update" | "joint.remove" }
  >,
): AssemblyAuthority {
  if (change.kind !== "joint.remove")
    return {
      ...assembly,
      joints: upsert(assembly.joints, change.joint, change.kind === "joint.create"),
    }
  if (!assembly.joints.some(({ id }) => id === change.jointId))
    throw new Error("The assembly joint is missing.")
  return { ...assembly, joints: assembly.joints.filter(({ id }) => id !== change.jointId) }
}
function changeAssembly(
  current: AssemblyAuthority,
  change: CapturedAssemblyMutation,
): AssemblyAuthority {
  if (isDefinitionMutation(change)) return changeDefinition(current, change)
  if (
    change.kind === "instance.create" ||
    change.kind === "instance.update" ||
    change.kind === "instance.remove"
  )
    return changeInstance(current, change)
  return changeJoint(current, change)
}
function isDefinitionMutation(
  change: CapturedAssemblyMutation,
): change is Extract<CapturedAssemblyMutation, { kind: `definition.${string}` }> {
  return change.kind.startsWith("definition.")
}
export function applyCapturedAssemblyMutations(
  assembly: AssemblyAuthority,
  input: unknown,
): AssemblyAuthority {
  const changes = capturedAssemblyMutationsSchema.parse(input)
  let current = assembly
  for (const change of changes) current = changeAssembly(current, change)
  const parsed = assemblyAuthoritySchema.parse(current)
  if (canonicalJson(parsed) === canonicalJson(assembly))
    throw new Error("The assembly mutation is a semantic no-op.")
  return parsed
}
export function captureAssemblyMutations(
  authority: SourceAuthority,
  assembly: AssemblyAuthority,
  input: unknown,
): readonly CapturedAssemblyMutation[] {
  const changes = assemblyMutationsSchema.parse(input)
  let definitions = [...assembly.definitions]
  return changes.map((change): CapturedAssemblyMutation => {
    if (!("definition" in change)) return change
    const previous = definitions.find(({ id }) => id === change.definition.id)
    if (change.kind === "definition.insert-pinned" || change.kind === "definition.relink-pinned") {
      validateDefinitions([change.definition])
      const create = change.kind === "definition.insert-pinned"
      definitions = upsert(definitions, change.definition, create)
      return change
    }
    const definition = captureAssemblyDefinition(
      authority,
      change.definition,
      change.kind === "definition.create" ? 1 : (previous?.pinRevision ?? 0) + 1,
    )
    definitions = upsert(definitions, definition, change.kind === "definition.create")
    return { ...change, definition }
  })
}

function pinnedDefinitionContent(definition: PinnedAssemblyDefinition) {
  return {
    ...definition,
    pinnedModels: definition.pinnedModels.map(
      ({ sourceIndex, selectedBody, assets, snapshot }) => ({
        sourceIndex,
        selectedBody,
        assets,
        snapshot: {
          features: snapshot.features,
          sketches: snapshot.sketches,
          history: snapshot.history,
          variables: snapshot.variables,
        },
      }),
    ),
  }
}
/** Replayed creates and relinks must capture precisely the then-current semantic source. */
export function validateCapturedAssemblySources(
  authority: SourceAuthority,
  assembly: AssemblyAuthority,
  input: unknown,
) {
  const changes = capturedAssemblyMutationsSchema.parse(input)
  const commands = changes.map((change) => {
    if (change.kind !== "definition.create" && change.kind !== "definition.relink") return change
    const {
      pinRevision: _revision,
      pinnedModels: _models,
      libraryBinding: _binding,
      ...definition
    } = change.definition
    return { ...change, definition }
  })
  const semantic = (mutations: readonly CapturedAssemblyMutation[]) =>
    mutations.map((change) =>
      change.kind === "definition.create" || change.kind === "definition.relink"
        ? { ...change, definition: pinnedDefinitionContent(change.definition) }
        : change,
    )
  if (
    canonicalJson(semantic(captureAssemblyMutations(authority, assembly, commands))) !==
    canonicalJson(semantic(changes))
  )
    throw new Error(
      "Captured assembly source snapshots do not match their authoritative source revision.",
    )
}
