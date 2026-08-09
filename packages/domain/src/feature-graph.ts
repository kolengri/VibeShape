import { z } from "zod"
import {
  type FeatureId,
  featureIdSchema,
  moduleIdSchema,
  moduleVersionSchema,
  technicalIdentifierSchema,
} from "./identifiers"
import { topoRefSchema } from "./topology"

const MAX_FEATURES = 100_000
const MAX_PARAMETERS = 512
const MAX_PARAMETER_BYTES = 1024 * 1024
const MAX_DIAGNOSTIC_VALUE_BYTES = 64 * 1024
const MAX_DEPENDENCIES = 1_024
const MAX_REFERENCES = 4_096
const MAX_GRAPH_DEPENDENCIES = 1_000_000
const MAX_GRAPH_REFERENCES = 1_000_000
const MAX_BLOCKERS = 32
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 digest.")

const featureLabelSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((label) => label.trim() === label, "Feature labels must be normalized.")

export const featureTypeSchema = z
  .object({
    moduleId: moduleIdSchema,
    moduleVersion: moduleVersionSchema,
    typeId: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
  })
  .strict()

export const featureParametersSchema = z
  .record(z.string().min(1).max(128), z.json())
  .refine(
    (parameters) => Object.keys(parameters).length <= MAX_PARAMETERS,
    `Feature parameters are limited to ${MAX_PARAMETERS} keys.`,
  )

function hasUniqueValues(values: readonly string[]) {
  return new Set(values).size === values.length
}

function encodedParameterBytes(parameters: Record<string, unknown>) {
  return [...JSON.stringify(parameters)].reduce((bytes, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    const continuationBytes = [codePoint > 0x7f, codePoint > 0x7ff, codePoint > 0xffff].filter(
      Boolean,
    ).length
    return bytes + 1 + continuationBytes
  }, 0)
}

export const featureRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: featureIdSchema,
    type: featureTypeSchema,
    parameters: featureParametersSchema,
    dependencies: z.array(featureIdSchema).max(MAX_DEPENDENCIES),
    references: z.array(topoRefSchema).max(MAX_REFERENCES),
    suppressed: z.boolean(),
    label: featureLabelSchema.optional(),
  })
  .strict()
  .superRefine((feature, context) => {
    if (!hasUniqueValues(feature.dependencies)) {
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Feature dependencies must be unique.",
      })
    }
    if (feature.dependencies.includes(feature.id)) {
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "A feature cannot depend on itself.",
      })
    }
    const dependencyIds = new Set(feature.dependencies)
    if (!feature.references.every((reference) => dependencyIds.has(reference.featureId))) {
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: "Every topology reference must target a declared feature dependency.",
      })
    }
    if (encodedParameterBytes(feature.parameters) > MAX_PARAMETER_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "Feature parameters exceed the encoded-size limit.",
      })
    }
  })

export const featureDiagnosticSchema = z
  .object({
    code: technicalIdentifierSchema,
    values: z
      .record(z.string().min(1).max(128), z.json())
      .refine(
        (values) => Object.keys(values).length <= 32,
        "Feature diagnostic values are limited to 32 keys.",
      )
      .refine(
        (values) => encodedParameterBytes(values) <= MAX_DIAGNOSTIC_VALUE_BYTES,
        "Feature diagnostic values exceed the encoded-size limit.",
      ),
  })
  .strict()

export const featureEvaluationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), contentHash: sha256Schema }).strict(),
  z
    .object({
      status: z.literal("failed"),
      diagnostics: z.array(featureDiagnosticSchema).min(1).max(32),
    })
    .strict(),
])

export const featureEvaluationRecordSchema = z.discriminatedUnion("status", [
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("succeeded"),
      contentHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("failed"),
      diagnostics: z.array(featureDiagnosticSchema).min(1).max(32),
    })
    .strict(),
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("blocked"),
      blockedBy: z.array(featureIdSchema).min(1).max(MAX_BLOCKERS),
    })
    .strict(),
  z.object({ featureId: featureIdSchema, status: z.literal("suppressed") }).strict(),
])

export type FeatureRecord = Readonly<z.infer<typeof featureRecordSchema>>
export type FeatureParameters = Readonly<z.infer<typeof featureParametersSchema>>
export type FeatureDiagnostic = Readonly<z.infer<typeof featureDiagnosticSchema>>
export type FeatureEvaluationOutcome = Readonly<z.infer<typeof featureEvaluationOutcomeSchema>>
export type FeatureEvaluationRecord = Readonly<z.infer<typeof featureEvaluationRecordSchema>>

export type FeatureGraphDiagnostic = Readonly<{
  code:
    | "feature-limit"
    | "invalid-feature"
    | "feature-dependency-limit"
    | "feature-reference-limit"
    | "duplicate-feature"
    | "missing-feature-dependency"
    | "feature-dependency-cycle"
  message: string
  issues: readonly { path: string; message: string }[]
}>

export type FeatureGraph = Readonly<{
  features: readonly FeatureRecord[]
  evaluationOrder: readonly FeatureRecord[]
  getFeature: (featureId: string) => FeatureRecord | undefined
  dependenciesOf: (featureId: string) => readonly FeatureRecord[]
  dependentsOf: (featureId: string) => readonly FeatureRecord[]
}>

export type FeatureGraphResult =
  | { ok: true; graph: FeatureGraph }
  | { ok: false; diagnostic: FeatureGraphDiagnostic }

export type FeatureEvaluationDiagnostic = Readonly<{
  code: "invalid-dirty-feature" | "invalid-previous-feature-result"
  message: string
}>

export type FeatureEvaluationContext = Readonly<{
  feature: FeatureRecord
  dependencies: readonly FeatureEvaluationRecord[]
  previous: FeatureEvaluationRecord | undefined
}>

export type FeatureGraphEvaluation = Readonly<{
  records: readonly FeatureEvaluationRecord[]
  dirtyFeatureIds: readonly FeatureId[]
  evaluatedFeatureIds: readonly FeatureId[]
  reusedFeatureIds: readonly FeatureId[]
}>

export type FeatureGraphEvaluationResult =
  | { ok: true; evaluation: FeatureGraphEvaluation }
  | { ok: false; diagnostic: FeatureEvaluationDiagnostic }

function graphDiagnostic(
  code: FeatureGraphDiagnostic["code"],
  message: string,
  issues: FeatureGraphDiagnostic["issues"] = [],
): Extract<FeatureGraphResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, issues } }
}

function invalidFeatureDiagnostic(
  index: number,
  error: z.ZodError,
): Extract<FeatureGraphResult, { ok: false }> {
  return graphDiagnostic(
    "invalid-feature",
    `Feature at presentation index ${index} is invalid.`,
    error.issues.slice(0, 8).map((issue) => ({
      path: [index, ...issue.path].map(String).join("."),
      message: issue.message,
    })),
  )
}

function parseFeatures(inputs: readonly unknown[]) {
  const features: FeatureRecord[] = []
  let dependencyCount = 0
  let referenceCount = 0
  for (const [index, input] of inputs.entries()) {
    const parsed = featureRecordSchema.safeParse(input)
    if (!parsed.success) return invalidFeatureDiagnostic(index, parsed.error)
    dependencyCount += parsed.data.dependencies.length
    referenceCount += parsed.data.references.length
    if (dependencyCount > MAX_GRAPH_DEPENDENCIES) {
      return graphDiagnostic(
        "feature-dependency-limit",
        `A document may contain at most ${MAX_GRAPH_DEPENDENCIES} feature dependencies.`,
      )
    }
    if (referenceCount > MAX_GRAPH_REFERENCES) {
      return graphDiagnostic(
        "feature-reference-limit",
        `A document may contain at most ${MAX_GRAPH_REFERENCES} topology references.`,
      )
    }
    features.push(parsed.data)
  }
  return { ok: true as const, features }
}

function indexFeatures(features: readonly FeatureRecord[]) {
  const featuresById = new Map<FeatureId, FeatureRecord>()
  for (const feature of features) {
    if (featuresById.has(feature.id)) {
      return graphDiagnostic("duplicate-feature", `Feature ${feature.id} appears more than once.`)
    }
    featuresById.set(feature.id, feature)
  }
  return { ok: true as const, featuresById }
}

function findMissingDependency(
  features: readonly FeatureRecord[],
  featuresById: ReadonlyMap<FeatureId, FeatureRecord>,
) {
  for (const feature of features) {
    const missing = feature.dependencies.find((dependencyId) => !featuresById.has(dependencyId))
    if (missing) return { feature, missing }
  }
  return null
}

function createDependentsIndex(features: readonly FeatureRecord[]) {
  const dependentsById = new Map<FeatureId, FeatureRecord[]>(
    features.map((feature) => [feature.id, []]),
  )
  for (const feature of features) {
    for (const dependencyId of feature.dependencies) {
      dependentsById.get(dependencyId)?.push(feature)
    }
  }
  return dependentsById
}

class ReadyFeatureQueue {
  readonly #items: FeatureRecord[] = []
  readonly #presentationIndex: ReadonlyMap<FeatureId, number>

  constructor(presentationIndex: ReadonlyMap<FeatureId, number>) {
    this.#presentationIndex = presentationIndex
  }

  get length() {
    return this.#items.length
  }

  push(feature: FeatureRecord) {
    this.#items.push(feature)
    this.#bubbleUp(this.#items.length - 1)
  }

  shift() {
    const first = this.#items[0]
    const last = this.#items.pop()
    if (this.#items.length > 0 && last) {
      this.#items[0] = last
      this.#sinkDown(0)
    }
    return first
  }

  #priority(feature: FeatureRecord) {
    return this.#presentationIndex.get(feature.id) as number
  }

  #swap(left: number, right: number) {
    const value = this.#items[left] as FeatureRecord
    this.#items[left] = this.#items[right] as FeatureRecord
    this.#items[right] = value
  }

  #bubbleUp(startIndex: number) {
    let index = startIndex
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (
        this.#priority(this.#items[parent] as FeatureRecord) <=
        this.#priority(this.#items[index] as FeatureRecord)
      )
        return
      this.#swap(parent, index)
      index = parent
    }
  }

  #sinkDown(startIndex: number) {
    let index = startIndex
    while (index * 2 + 1 < this.#items.length) {
      const left = index * 2 + 1
      const right = left + 1
      const child = this.#lowerPriorityIndex(left, right)
      if (
        this.#priority(this.#items[index] as FeatureRecord) <=
        this.#priority(this.#items[child] as FeatureRecord)
      )
        return
      this.#swap(index, child)
      index = child
    }
  }

  #lowerPriorityIndex(left: number, right: number) {
    const rightFeature = this.#items[right]
    if (!rightFeature) return left
    return this.#priority(rightFeature) < this.#priority(this.#items[left] as FeatureRecord)
      ? right
      : left
  }
}

function createEvaluationOrder(
  features: readonly FeatureRecord[],
  dependentsById: ReadonlyMap<FeatureId, readonly FeatureRecord[]>,
) {
  const presentationIndex = new Map(features.map((feature, index) => [feature.id, index]))
  const remainingDependencies = new Map(
    features.map((feature) => [feature.id, feature.dependencies.length]),
  )
  const ready = new ReadyFeatureQueue(presentationIndex)
  for (const feature of features) {
    if (feature.dependencies.length === 0) ready.push(feature)
  }
  const order: FeatureRecord[] = []
  while (ready.length > 0) {
    const feature = ready.shift() as FeatureRecord
    order.push(feature)
    for (const dependent of dependentsById.get(feature.id) ?? []) {
      const remaining = (remainingDependencies.get(dependent.id) as number) - 1
      remainingDependencies.set(dependent.id, remaining)
      if (remaining === 0) ready.push(dependent)
    }
  }
  return order
}

export function createFeatureGraph(inputs: readonly unknown[]): FeatureGraphResult {
  if (inputs.length > MAX_FEATURES) {
    return graphDiagnostic(
      "feature-limit",
      `A document may contain at most ${MAX_FEATURES} features.`,
    )
  }
  const parsed = parseFeatures(inputs)
  if (!parsed.ok) return parsed
  const indexed = indexFeatures(parsed.features)
  if (!indexed.ok) return indexed
  const missing = findMissingDependency(parsed.features, indexed.featuresById)
  if (missing) {
    return graphDiagnostic(
      "missing-feature-dependency",
      `Feature ${missing.feature.id} requires missing feature ${missing.missing}.`,
    )
  }
  const dependentsById = createDependentsIndex(parsed.features)
  const evaluationOrder = createEvaluationOrder(parsed.features, dependentsById)
  if (evaluationOrder.length !== parsed.features.length) {
    return graphDiagnostic(
      "feature-dependency-cycle",
      "The feature dependency graph contains a cycle.",
    )
  }
  const graph: FeatureGraph = {
    features: parsed.features,
    evaluationOrder,
    getFeature: (featureId) => indexed.featuresById.get(featureId as FeatureId),
    dependenciesOf: (featureId) =>
      (indexed.featuresById.get(featureId as FeatureId)?.dependencies ?? []).map(
        (dependencyId) => indexed.featuresById.get(dependencyId) as FeatureRecord,
      ),
    dependentsOf: (featureId) => dependentsById.get(featureId as FeatureId) ?? [],
  }
  return { ok: true, graph }
}

export const featureRecordsSchema = z
  .array(featureRecordSchema)
  .max(MAX_FEATURES)
  .superRefine((features, context) => {
    const result = createFeatureGraph(features)

    if (result.ok) return

    context.addIssue({
      code: "custom",
      message: result.diagnostic.message,
    })
    for (const issue of result.diagnostic.issues.slice(0, 8)) {
      context.addIssue({
        code: "custom",
        path: issue.path.split(".").filter(Boolean),
        message: issue.message,
      })
    }
  })

function evaluationDiagnostic(
  code: FeatureEvaluationDiagnostic["code"],
  message: string,
): FeatureGraphEvaluationResult {
  return { ok: false, diagnostic: { code, message } }
}

function indexPreviousResults(graph: FeatureGraph, inputs: readonly unknown[]) {
  const recordsById = new Map<FeatureId, FeatureEvaluationRecord>()
  for (const input of inputs) {
    const parsed = featureEvaluationRecordSchema.safeParse(input)
    if (!parsed.success || !previousResultBelongsToGraph(graph, parsed.data)) return null
    if (recordsById.has(parsed.data.featureId)) return null
    recordsById.set(parsed.data.featureId, parsed.data)
  }
  return recordsById
}

function previousResultBelongsToGraph(graph: FeatureGraph, record: FeatureEvaluationRecord) {
  if (!graph.getFeature(record.featureId)) return false
  if (record.status !== "blocked") return true
  return record.blockedBy.every(
    (featureId) => featureId !== record.featureId && graph.getFeature(featureId) !== undefined,
  )
}

function parseDirtyFeatureIds(graph: FeatureGraph, inputs: readonly unknown[]) {
  const dirty = new Set<FeatureId>()
  for (const input of inputs) {
    const parsed = featureIdSchema.safeParse(input)
    if (!parsed.success || !graph.getFeature(parsed.data)) return null
    dirty.add(parsed.data)
  }
  return dirty
}

function addImplicitDirtyRoots(
  graph: FeatureGraph,
  dirty: Set<FeatureId>,
  previousById: ReadonlyMap<FeatureId, FeatureEvaluationRecord>,
) {
  for (const feature of graph.features) {
    const previous = previousById.get(feature.id)
    if (!previous || previous.status === "blocked") dirty.add(feature.id)
    if (previous?.status === "suppressed" && !feature.suppressed) dirty.add(feature.id)
  }
}

function expandDirtyFeatures(graph: FeatureGraph, roots: ReadonlySet<FeatureId>) {
  const affected = new Set(roots)
  const queue = [...roots]
  for (const featureId of queue) {
    for (const dependent of graph.dependentsOf(featureId)) {
      if (affected.has(dependent.id)) continue
      affected.add(dependent.id)
      queue.push(dependent.id)
    }
  }
  return affected
}

function failureDiagnostic(code: string): FeatureDiagnostic {
  return featureDiagnosticSchema.parse({ code, values: {} })
}

async function evaluateFeature(
  context: FeatureEvaluationContext,
  evaluate: (context: FeatureEvaluationContext) => unknown | Promise<unknown>,
): Promise<FeatureEvaluationRecord> {
  try {
    const outcome = featureEvaluationOutcomeSchema.safeParse(await evaluate(context))
    if (!outcome.success) {
      return {
        featureId: context.feature.id,
        status: "failed",
        diagnostics: [failureDiagnostic("org.vibeshape.feature.invalid-evaluator-output")],
      }
    }
    return { featureId: context.feature.id, ...outcome.data }
  } catch {
    return {
      featureId: context.feature.id,
      status: "failed",
      diagnostics: [failureDiagnostic("org.vibeshape.feature.evaluator-threw")],
    }
  }
}

function blockingFeatureIds(dependencies: readonly FeatureEvaluationRecord[]) {
  const blockers: FeatureId[] = []
  for (const dependency of dependencies) {
    if (dependency.status === "failed" || dependency.status === "suppressed") {
      blockers.push(dependency.featureId)
    }
    if (dependency.status === "blocked") blockers.push(...dependency.blockedBy)
  }
  return [...new Set(blockers)].slice(0, MAX_BLOCKERS)
}

async function evaluateGraphFeature(input: {
  feature: FeatureRecord
  dependencyRecords: readonly FeatureEvaluationRecord[]
  previous: FeatureEvaluationRecord | undefined
  dirty: boolean
  evaluate: (context: FeatureEvaluationContext) => unknown | Promise<unknown>
}) {
  if (input.feature.suppressed) {
    return {
      record: { featureId: input.feature.id, status: "suppressed" } as const,
      action: "none",
    }
  }
  const blockedBy = blockingFeatureIds(input.dependencyRecords)
  if (blockedBy.length > 0) {
    return {
      record: { featureId: input.feature.id, status: "blocked", blockedBy } as const,
      action: "none",
    }
  }
  if (!input.dirty && input.previous) return { record: input.previous, action: "reused" }
  return {
    record: await evaluateFeature(
      {
        feature: input.feature,
        dependencies: input.dependencyRecords,
        previous: input.previous,
      },
      input.evaluate,
    ),
    action: "evaluated",
  }
}

export async function evaluateFeatureGraph(
  graph: FeatureGraph,
  input: {
    changedFeatureIds: readonly unknown[]
    previousResults?: readonly unknown[]
    evaluate: (context: FeatureEvaluationContext) => unknown | Promise<unknown>
  },
): Promise<FeatureGraphEvaluationResult> {
  const previousById = indexPreviousResults(graph, input.previousResults ?? [])
  if (!previousById) {
    return evaluationDiagnostic(
      "invalid-previous-feature-result",
      "Previous feature results must be valid, unique, and owned by the graph.",
    )
  }
  const dirtyRoots = parseDirtyFeatureIds(graph, input.changedFeatureIds)
  if (!dirtyRoots) {
    return evaluationDiagnostic(
      "invalid-dirty-feature",
      "Every changed feature must be a valid member of the graph.",
    )
  }
  addImplicitDirtyRoots(graph, dirtyRoots, previousById)
  const dirty = expandDirtyFeatures(graph, dirtyRoots)
  const recordsById = new Map<FeatureId, FeatureEvaluationRecord>()
  const evaluatedFeatureIds: FeatureId[] = []
  const reusedFeatureIds: FeatureId[] = []
  for (const feature of graph.evaluationOrder) {
    const dependencyRecords = feature.dependencies.map(
      (dependencyId) => recordsById.get(dependencyId) as FeatureEvaluationRecord,
    )
    const evaluated = await evaluateGraphFeature({
      feature,
      dependencyRecords,
      previous: previousById.get(feature.id),
      dirty: dirty.has(feature.id),
      evaluate: input.evaluate,
    })
    recordsById.set(feature.id, evaluated.record)
    if (evaluated.action === "evaluated") evaluatedFeatureIds.push(feature.id)
    if (evaluated.action === "reused") reusedFeatureIds.push(feature.id)
  }
  return {
    ok: true,
    evaluation: {
      records: graph.features.map(
        (feature) => recordsById.get(feature.id) as FeatureEvaluationRecord,
      ),
      dirtyFeatureIds: graph.evaluationOrder
        .filter((feature) => dirty.has(feature.id))
        .map((feature) => feature.id),
      evaluatedFeatureIds,
      reusedFeatureIds,
    },
  }
}
