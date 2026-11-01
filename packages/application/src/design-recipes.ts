import {
  canonicalJson,
  createFeatureTypeRegistry,
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  referenceGeometryFeatureTypeHandlers,
  referenceGeometryModule,
} from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "@vibeshape/domain/document"
import {
  documentAuthoritySnapshotSchema,
  projectAuthoredDocumentSnapshotToV1,
} from "@vibeshape/domain/document-v2"
import { projectFirstPartyFeatureSemanticInputs } from "@vibeshape/domain/feature-semantic-inputs"
import { commandIdSchema, draftIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { authorityTransactionSchema } from "./authority-transaction"

const MAX_RECIPE_BYTES = 2 * 1024 * 1024
const recipeDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f3100"
const recipeTimestamp = "2026-01-01T00:00:00.000Z"
function encodedBytes(text: string) {
  return [...text].reduce((bytes, character) => {
    const point = character.codePointAt(0) ?? 0
    return bytes + 1 + Number(point > 0x7f) + Number(point > 0x7ff) + Number(point > 0xffff)
  }, 0)
}

const firstPartyModules = [
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
  referenceGeometryModule,
]
const modules = createModuleRegistry(firstPartyModules)
if (!modules.ok) throw new Error(modules.diagnostic.message)
const handlers = [...partDesignFeatureTypeHandlers, ...referenceGeometryFeatureTypeHandlers]
const types = createFeatureTypeRegistry(modules.registry, handlers)
if (!types.ok) throw new Error(types.diagnostic.message)
const featureTypes = types.registry

const recipeShape = z
  .object({
    format: z.literal("vibeshape.recipe"),
    version: z.literal(1),
    name: documentSnapshotV1Schema.shape.name,
    displayUnits: documentSnapshotV1Schema.shape.displayUnits,
    variables: documentSnapshotV1Schema.shape.variables,
    sketches: documentSnapshotV1Schema.shape.sketches,
    features: documentSnapshotV1Schema.shape.features,
    history: documentSnapshotV1Schema.shape.history,
  })
  .strict()

function recipeModel(recipe: z.infer<typeof recipeShape>) {
  const { format: _format, version: _version, ...model } = recipe
  return {
    ...model,
    schemaVersion: 1,
    id: recipeDocumentId,
    revision: 0,
    createdAt: recipeTimestamp,
    updatedAt: recipeTimestamp,
  }
}

function validateRecipeFeature(
  feature: z.infer<typeof recipeShape>["features"][number],
  index: number,
  context: z.RefinementCtx,
) {
  const { semanticInputs: _semanticInputs, ...record } = feature
  const validated = featureTypes.validateFeature({ ...record, schemaVersion: 0 })
  if (!validated.ok)
    context.addIssue({
      code: "custom",
      path: ["features", index],
      message: validated.diagnostic.message,
    })
  const semantic = projectFirstPartyFeatureSemanticInputs(feature)
  if (
    !semantic.recognized ||
    !semantic.ok ||
    canonicalJson(semantic.inputs) !== canonicalJson(feature.semanticInputs)
  )
    context.addIssue({
      code: "custom",
      path: ["features", index, "semanticInputs"],
      message: "Recipe semantic dependencies must match the registered feature declaration.",
    })
  if (feature.references.length || feature.type.typeId.includes("import"))
    context.addIssue({
      code: "custom",
      path: ["features", index],
      message:
        "Asset imports and topology-bound feature references cannot be replayed as a recipe.",
    })
}
function validateRecipeSketch(
  sketch: z.infer<typeof recipeShape>["sketches"][number],
  index: number,
  context: z.RefinementCtx,
) {
  if (
    sketch.support ||
    sketch.sourceImport ||
    sketch.externalReferences?.some((reference) => reference.kind?.startsWith("model-"))
  )
    context.addIssue({
      code: "custom",
      path: ["sketches", index],
      message: "Asset-backed or model-supported sketches cannot be replayed as a recipe.",
    })
}

/** A recipe is data. Neither importing it nor opening a saved design executes code. */
export const designRecipeSchema = recipeShape.superRefine((recipe, context) => {
  if (encodedBytes(JSON.stringify(recipe)) > MAX_RECIPE_BYTES)
    context.addIssue({ code: "custom", message: "The recipe exceeds 2 MiB." })
  if (recipe.history.length + recipe.variables.length > 254)
    context.addIssue({
      code: "custom",
      message: "A recipe is limited to 254 model items and variables.",
    })
  const model = documentSnapshotV1Schema.safeParse(recipeModel(recipe))
  if (!model.success)
    for (const issue of model.error.issues)
      context.addIssue({ code: "custom", path: issue.path, message: issue.message })
  recipe.features.forEach((feature, index) => {
    validateRecipeFeature(feature, index, context)
  })
  recipe.sketches.forEach((sketch, index) => {
    validateRecipeSketch(sketch, index, context)
  })
})
export type DesignRecipe = z.infer<typeof designRecipeSchema>
type Failure = { ok: false; message: string }
function failure(message: string): Failure {
  return { ok: false, message }
}

function firstIssue(result: { error: z.ZodError }) {
  return result.error.issues[0]?.message ?? "The design recipe is invalid."
}

export function readDesignRecipe(input: unknown): { ok: true; recipe: DesignRecipe } | Failure {
  const parsed = designRecipeSchema.safeParse(input)
  return parsed.success ? { ok: true, recipe: parsed.data } : failure(firstIssue(parsed))
}

function modelProjection(snapshot: z.infer<typeof documentAuthoritySnapshotSchema>) {
  return snapshot.schemaVersion === 1 ? snapshot : projectAuthoredDocumentSnapshotToV1(snapshot)
}

function wholeDesignLimitation(snapshot: z.infer<typeof documentAuthoritySnapshotSchema>) {
  if (snapshot.schemaVersion === 1) return null
  if (snapshot.folders.length) return "History folders require native .vshape export."
  if (
    snapshot.parts.some(
      (part, index) =>
        !part.visible ||
        part.name !==
          (snapshot.features.find((feature) => feature.id === part.bodyHistory[0]?.featureId)
            ?.label ?? `Part ${index + 1}`),
    )
  )
    return "Authored part naming requires native .vshape export."
  if (
    "assembly" in snapshot &&
    Object.values(snapshot.assembly).some((items) => Array.isArray(items) && items.length)
  )
    return "Assemblies require native .vshape export."
  return extendedMetadataLimitation(snapshot)
}

function extendedMetadataLimitation(snapshot: {
  id: string
  surfaceTextures?: readonly unknown[]
  assets?: readonly unknown[]
  repairIntents?: readonly unknown[]
  partAppearances?: readonly unknown[]
}) {
  if (snapshot.surfaceTextures?.length) return "Surface textures require native .vshape export."
  if (snapshot.assets?.length) return "Source assets require native .vshape export."
  if (snapshot.repairIntents?.length)
    return "Retained repair History requires native .vshape export."
  if (snapshot.partAppearances?.length) return "Part appearance requires native .vshape export."
  return null
}

function uuidValues(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string")
    for (const match of value.matchAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g,
    ))
      result.add(match[0])
  else if (Array.isArray(value)) for (const item of value) uuidValues(item, result)
  else if (value !== null && typeof value === "object")
    for (const item of Object.values(value)) uuidValues(item, result)
  return result
}

function dependencyClosure(model: DocumentSnapshotV1, selected: readonly string[]) {
  const nodes = new Map(
    [...model.features, ...model.sketches].map((item) => [item.id as string, item]),
  )
  const included = new Set(selected)
  const pending = [...selected]
  while (pending.length) {
    const id = pending.pop()
    const node = id ? nodes.get(id) : undefined
    if (!node) continue
    for (const reference of uuidValues(node))
      if (nodes.has(reference) && !included.has(reference)) {
        included.add(reference)
        pending.push(reference)
      }
  }
  return included
}

/** Selected macros include their dependency closure so replay never borrows the destination model. */
export function exportDesignRecipe(
  input: unknown,
  selectedIds?: readonly string[],
): { ok: true; recipe: DesignRecipe } | Failure {
  const parsed = documentAuthoritySnapshotSchema.safeParse(input)
  if (!parsed.success) return failure("The authored design is unavailable or invalid.")
  if (!selectedIds) {
    const limitation = wholeDesignLimitation(parsed.data)
    if (limitation) return failure(limitation)
  }
  const model = modelProjection(parsed.data)
  const included = selectedIds ? dependencyClosure(model, selectedIds) : null
  if (selectedIds?.some((id) => !model.history.some((item) => item.id === id)))
    return failure("A recorded History item is no longer available.")
  return readDesignRecipe({
    format: "vibeshape.recipe",
    version: 1,
    name: model.name,
    displayUnits: model.displayUnits,
    variables: model.variables,
    sketches: model.sketches.filter((item) => !included || included.has(item.id)),
    features: model.features.filter((item) => !included || included.has(item.id)),
    history: model.history.filter((item) => !included || included.has(item.id)),
  })
}

export function emitDesignRecipeTypeScript(recipe: DesignRecipe) {
  return `// VibeShape recipe v1. Run in Scripts and macros; opening a file never runs it.\n// Edit parameters, or use TypeScript loops and Math to construct this object.\n// Replay appends independent copies in one Undo step.\nconst recipe = ${JSON.stringify(designRecipeSchema.parse(recipe), null, 2)};\n\nexport default recipe;\n`
}

export type MacroRecording = Readonly<{
  documentId: string
  baseRevision: number
  historyIds: readonly string[]
}>
export function startMacroRecording(
  input: unknown,
): { ok: true; recording: MacroRecording } | Failure {
  const parsed = documentAuthoritySnapshotSchema.safeParse(input)
  if (!parsed.success) return failure("Open a design before recording a macro.")
  return {
    ok: true,
    recording: {
      documentId: parsed.data.id,
      baseRevision: parsed.data.revision,
      historyIds: parsed.data.history.map((item) => item.id),
    },
  }
}
export function stopMacroRecording(recording: MacroRecording, input: unknown) {
  const parsed = documentAuthoritySnapshotSchema.safeParse(input)
  if (!parsed.success || parsed.data.id !== recording.documentId)
    return failure("The recorded design is no longer active.")
  const before = new Set(recording.historyIds)
  const selected = parsed.data.history.filter((item) => !before.has(item.id)).map((item) => item.id)
  if (!selected.length)
    return failure("No new History items were recorded. Existing-item edits are not recorded.")
  const result = exportDesignRecipe(parsed.data, selected)
  return result.ok
    ? {
        ...result,
        recordedCount: selected.length,
        dependencyCount: result.recipe.history.length - selected.length,
      }
    : result
}

const replayOptionsSchema = z
  .object({
    transactionId: draftIdSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

function remapRecipe(recipe: DesignRecipe, target: DocumentSnapshotV1, createId: () => string) {
  const occupied = new Set([...uuidValues(target), ...uuidValues(recipe)])
  const remapped = new Map<string, string>()
  for (const id of uuidValues(recipe)) {
    const fresh = createId()
    if (!commandIdSchema.safeParse(fresh).success || occupied.has(fresh))
      return failure("Recipe identities must be fresh, valid, and unique.")
    remapped.set(id, fresh)
    occupied.add(fresh)
  }
  const names = new Set(target.variables.map((variable) => variable.name))
  const renamed = new Map<string, string>()
  for (const variable of recipe.variables) {
    let name = variable.name
    let suffix = 1
    while (names.has(name)) name = `${variable.name.slice(0, 52)}_recipe${suffix++}`
    names.add(name)
    renamed.set(variable.name, name)
  }
  function walk(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      if (key === "expression")
        return value.replace(
          /#([A-Za-z_][A-Za-z0-9_]*)/g,
          (match, name: string) => `#${renamed.get(name) ?? match.slice(1)}`,
        )
      return value.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g,
        (id) => remapped.get(id) ?? id,
      )
    }
    if (Array.isArray(value)) return value.map((item) => walk(item))
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name)]),
      )
    return value
  }
  const mapped = walk(recipe) as DesignRecipe
  return readDesignRecipe({
    ...mapped,
    variables: mapped.variables.map((variable, index) => ({
      ...variable,
      name: renamed.get(recipe.variables[index]?.name ?? "") ?? variable.name,
    })),
  })
}

function historyReplayCommand(
  recipe: DesignRecipe,
  item: DesignRecipe["history"][number],
  historyAfter: DesignRecipe["history"][number] | null,
) {
  if (item.kind === "sketch")
    return {
      kind: "org.vibeshape.history.insert-sketch",
      payload: { sketch: recipe.sketches.find((sketch) => sketch.id === item.id), historyAfter },
    }
  const feature = recipe.features.find((feature) => feature.id === item.id)
  if (!feature) throw new Error("A replay feature is missing.")
  const { semanticInputs: _semanticInputs, ...record } = feature
  return {
    kind: "org.vibeshape.history.insert-feature",
    payload: { feature: { ...record, schemaVersion: 0 }, historyAfter },
  }
}

function createReplayTransaction(
  recipe: DesignRecipe,
  projected: DocumentSnapshotV1,
  authority: z.infer<typeof replayOptionsSchema>,
  createId: () => string,
) {
  const commands: unknown[] = []
  const commandIds = new Set<string>([
    ...uuidValues(projected),
    ...uuidValues(recipe),
    authority.transactionId,
  ])
  function append(kind: string, payload: unknown) {
    const commandId = createId()
    if (!commandIdSchema.safeParse(commandId).success || commandIds.has(commandId))
      throw new Error("Recipe command identities must be fresh and unique.")
    commandIds.add(commandId)
    commands.push({
      schemaVersion: 1,
      kind,
      commandId,
      documentId: projected.id,
      baseRevision: projected.revision + commands.length,
      issuedAt: authority.issuedAt,
      actor: authority.actor,
      payload,
    })
  }
  try {
    if (recipe.variables.length)
      append("org.vibeshape.variable.replace-table", {
        variables: [...projected.variables, ...recipe.variables],
      })
    let historyAfter = projected.history.at(-1) ?? null
    for (const item of recipe.history) {
      const command = historyReplayCommand(recipe, item, historyAfter)
      append(command.kind, command.payload)
      historyAfter = item
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The recipe identities are invalid.")
  }
  if (!commands.length) return failure("The recipe has no model items or variables to replay.")
  const transaction = authorityTransactionSchema.safeParse({
    transactionId: authority.transactionId,
    commands,
  })
  return transaction.success
    ? { ok: true as const, transaction: transaction.data }
    : failure(firstIssue(transaction))
}

/** Returns a revision-bound transaction; the existing authored authority owns persistence and Undo. */
export function prepareDesignRecipeReplay(
  input: unknown,
  targetInput: unknown,
  optionsInput: unknown,
  createId: () => string,
) {
  const recipe = readDesignRecipe(input)
  if (!recipe.ok) return recipe
  const target = documentAuthoritySnapshotSchema.safeParse(targetInput)
  const options = replayOptionsSchema.safeParse(optionsInput)
  if (!target.success || !options.success)
    return failure("The replay destination or transaction authority is invalid.")
  const authority = options.data
  const projected = modelProjection(target.data)
  const remapped = remapRecipe(recipe.recipe, projected, createId)
  if (!remapped.ok) return remapped
  const transaction = createReplayTransaction(remapped.recipe, projected, authority, createId)
  if (!transaction.ok) return transaction
  const previewModel = documentSnapshotV1Schema.safeParse({
    ...projected,
    variables: [...projected.variables, ...remapped.recipe.variables],
    sketches: [...projected.sketches, ...remapped.recipe.sketches],
    features: [...projected.features, ...remapped.recipe.features],
    history: [...projected.history, ...remapped.recipe.history],
  })
  if (!previewModel.success) return failure(firstIssue(previewModel))
  return {
    ok: true as const,
    transaction: transaction.transaction,
    model: previewModel.data,
    recipe: remapped.recipe,
    renamedVariables: remapped.recipe.variables
      .filter((variable, index) => variable.name !== recipe.recipe.variables[index]?.name)
      .map((variable) => variable.name),
  }
}
