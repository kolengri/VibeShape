import {
  boxFeatureType,
  chamferFeatureType,
  computeFeatureContentHash,
  createLengthQuantity,
  type FeatureContentEnvironment,
  type FeatureContentHasher,
  type FeatureContentIdentity,
  type FeatureTypeRegistry,
  featureContentIdentitySchema,
  holeFeatureType,
  multiProfileExtrusionFeatureType,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  type GeometryWorkerClient,
  GeometryWorkerRequestError,
} from "@vibeshape/geometry-worker/client"
import {
  type FeatureEvaluationDependency,
  serializeFeatureContentIdentity,
} from "@vibeshape/protocol"
import { z } from "zod"

type FixtureOptions = Readonly<{
  client: GeometryWorkerClient
  environment: FeatureContentEnvironment
  registry: FeatureTypeRegistry
  hash: FeatureContentHasher
  documentId: string
  generation: number
}>

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const legacyId = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const namedId = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
const missingId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
const aggregateId = "0195b5ac-b220-7a2c-8c33-67a36a7f3205"
const holeV2Id = "0195b5ac-b220-7a2c-8c33-67a36a7f3206"
const holeV2Type = { ...holeFeatureType.type, schemaVersion: 2 as const }

function fixtureRequests(options: FixtureOptions) {
  const { client, documentId, generation } = options
  return {
    async evaluate(
      featureId: string,
      content: FeatureContentIdentity,
      contentHash: string,
      dependencies: readonly FeatureEvaluationDependency[] = [],
    ) {
      const response = await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "evaluateFeature",
        featureId,
        content,
        contentHash,
        dependencies: [...dependencies],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      })
      if (response.type !== "featureEvaluated") throw new Error("Body fixture evaluation failed.")
      return response
    },
    async ownedCount() {
      const response = await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "healthCheck",
      })
      if (response.type !== "health") throw new Error("Body fixture health check failed.")
      return response.ownedShapeCount
    },
  }
}

function authoredEvaluator(options: FixtureOptions) {
  const requests = fixtureRequests(options)
  return async function evaluate(
    id: string,
    type: typeof boxFeatureType.type,
    parameters: unknown,
    dependencies: readonly FeatureEvaluationDependency[] = [],
  ) {
    const content = await computeFeatureContentHash(
      options.registry,
      {
        feature: {
          schemaVersion: 0,
          id,
          type,
          parameters,
          dependencies: dependencies.map(({ featureId }) => featureId),
          references: [],
          suppressed: false,
        },
        dependencies,
        environment: options.environment,
      },
      options.hash,
    )
    if (!content.ok) throw new Error(content.diagnostic.message)
    return {
      result: await requests.evaluate(id, content.identity, content.contentHash, dependencies),
      content,
    }
  }
}

function sourceParameters(width: number) {
  return {
    width: createLengthQuantity(width),
    depth: createLengthQuantity(20),
    height: createLengthQuantity(20),
    centered: false,
  }
}

async function missingDependency(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    if (error instanceof GeometryWorkerRequestError) {
      z.object({
        type: z.literal("failure"),
        diagnostic: z.object({ code: z.literal("missing-feature-dependency") }),
      }).parse(error.response)
      return
    }
    throw error
  }
  throw new Error("An unavailable named body unexpectedly resolved.")
}

function rectangleProfile(offset: number, ordinal: number) {
  const ids = Array.from(
    { length: 8 },
    (_, index) => `0195b5ac-b220-7a2c-8c33-67a36a7f${3300 + ordinal * 10 + index}`,
  )
  const points = [
    [offset, 0],
    [offset + 4, 0],
    [offset + 4, 4],
    [offset, 4],
  ]
  return {
    outer: {
      sourceEntityIds: ids.slice(4),
      segments: points.map((start, index) => ({
        type: "line",
        entityId: ids[index + 4],
        startPointId: ids[index],
        endPointId: ids[(index + 1) % 4],
        start,
        end: points[(index + 1) % 4],
      })),
    },
    holes: [],
  }
}

async function evaluateAggregate(options: FixtureOptions) {
  const content = featureContentIdentitySchema.parse({
    schemaVersion: 0,
    feature: {
      schemaVersion: 0,
      type: multiProfileExtrusionFeatureType.type,
      parameters: {
        sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3300",
        frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
        profiles: [rectangleProfile(0, 0), rectangleProfile(10, 1)],
        distance: 5,
        symmetric: false,
        operation: "new",
      },
      inputs: [],
      references: [],
    },
    environment: options.environment,
  })
  const contentHash = await options.hash(serializeFeatureContentIdentity(content))
  if (typeof contentHash !== "string") throw new Error("Body fixture hash is unavailable.")
  const result = await fixtureRequests(options).evaluate(aggregateId, content, contentHash)
  return { result, contentHash }
}

async function evaluateHoleV2(
  options: FixtureOptions,
  requests: ReturnType<typeof fixtureRequests>,
  source: Awaited<ReturnType<ReturnType<typeof authoredEvaluator>>>,
  named: FeatureEvaluationDependency,
) {
  const content = featureContentIdentitySchema.parse({
    schemaVersion: 1,
    feature: {
      schemaVersion: 0,
      type: holeV2Type,
      parameters: {
        frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
        centers: [[0, 0, 20]],
        diameter: 2,
        direction: "reverse",
        extent: "blind",
        depth: 5,
      },
      inputs: [source.content.contentHash],
      inputRoles: ["result"],
      references: [],
    },
    environment: options.environment,
  })
  const contentHash = await options.hash(serializeFeatureContentIdentity(content))
  if (typeof contentHash !== "string") throw new Error("Hole v2 fixture hash is unavailable.")
  return requests.evaluate(holeV2Id, content, contentHash, [named])
}

async function evaluateNamedCacheSequence(
  evaluate: ReturnType<typeof authoredEvaluator>,
  requests: ReturnType<typeof fixtureRequests>,
  named: FeatureEvaluationDependency,
  treatment: { distance: ReturnType<typeof createLengthQuantity> },
) {
  const ownedCounts: number[] = []
  for (const width of [22, 20, 22, 20]) {
    const changedSource = await evaluate(sourceId, boxFeatureType.type, sourceParameters(width))
    if (width === 22) {
      await missingDependency(() => evaluate(namedId, chamferFeatureType.type, treatment, [named]))
    }
    await evaluate(namedId, chamferFeatureType.type, treatment, [
      { ...named, contentHash: changedSource.content.contentHash },
    ])
    ownedCounts.push(await requests.ownedCount())
  }
  return ownedCounts
}

export async function evaluateBodyOutputFixture(options: FixtureOptions) {
  const evaluate = authoredEvaluator(options)
  const requests = fixtureRequests(options)
  const source = await evaluate(sourceId, boxFeatureType.type, sourceParameters(20))
  const whole = { featureId: sourceId, contentHash: source.content.contentHash }
  const named = { ...whole, outputRole: "result" }
  const treatment = { distance: createLengthQuantity(1) }
  const legacy = await evaluate(legacyId, chamferFeatureType.type, treatment, [whole])
  const selected = await evaluate(namedId, chamferFeatureType.type, treatment, [named])
  const cached = await evaluate(namedId, chamferFeatureType.type, treatment, [named])
  const holeV2 = await evaluateHoleV2(options, requests, source, named)
  const rejected: string[] = []
  await missingDependency(() =>
    evaluate(missingId, chamferFeatureType.type, treatment, [
      { ...named, outputRole: "pattern.instance.1" },
    ]),
  )
  rejected.push("unknown-role")

  const ownedCounts = await evaluateNamedCacheSequence(evaluate, requests, named, treatment)
  rejected.push("stale-source-before-cache-hit")

  const aggregate = await evaluateAggregate(options)
  await missingDependency(() =>
    evaluate(missingId, chamferFeatureType.type, treatment, [
      { featureId: aggregateId, contentHash: aggregate.contentHash, outputRole: "result" },
    ]),
  )
  rejected.push("unnamed-multi-solid-result")
  const sourceAfter = await evaluate(sourceId, boxFeatureType.type, sourceParameters(20))
  return {
    legacyVolume: legacy.result.shape.volume,
    namedVolume: selected.result.shape.volume,
    differentHashes: legacy.content.contentHash !== selected.content.contentHash,
    cacheHit: cached.result.cache.brepHit,
    sourceVolume: source.result.shape.volume,
    sourceVolumeAfter: sourceAfter.result.shape.volume,
    holeV2Volume: holeV2.shape.volume,
    holeV2BodyRoles: holeV2.bodies?.map(({ outputRole }) => outputRole) ?? [],
    aggregateSolidCount: aggregate.result.shape.solidCount,
    aggregateVolume: aggregate.result.shape.volume,
    ownedCounts,
    rejected,
  }
}
