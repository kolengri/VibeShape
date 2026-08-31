import {
  booleanFeatureType,
  boxFeatureType,
  computeFeatureContentHash,
  createAngleQuantity,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  extrusionFeatureType,
  type FeatureId,
  featureCoreModule,
  featureIdSchema,
  legacyRevolveFeatureType,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  revolveFeatureType,
  serializeFeatureContentIdentity,
} from "@vibeshape/domain"
import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
  GeometryWorkerRequestError,
} from "@vibeshape/geometry-worker/client"
import {
  extrusionFeatureContentParametersSchema,
  featureContentIdentitySchema,
  revolveFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import { isError } from "is-what"

type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type FeatureResponse = Extract<TerminalResponse, { type: "featureEvaluated" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

interface FeatureEvaluationHarnessState {
  state: "running" | "passed" | "failed"
  box: FeatureResponse | null
  cachedBox: FeatureResponse | null
  positionedBox: FeatureResponse | null
  cylinder: FeatureResponse | null
  extrusion: FeatureResponse | null
  circularArcExtrusion: FeatureResponse | null
  ellipseExtrusion: FeatureResponse | null
  ellipticalArcMinor: FeatureResponse | null
  ellipticalArcMajor: FeatureResponse | null
  ellipticalArcWrapped: FeatureResponse | null
  ellipticalArcReflected: FeatureResponse | null
  extrusionAdd: FeatureResponse | null
  extrusionIntersect: FeatureResponse | null
  extrusionRemove: FeatureResponse | null
  revolve: FeatureResponse | null
  revolveAdd: FeatureResponse | null
  revolveIntersect: FeatureResponse | null
  revolveRemove: FeatureResponse | null
  boolean: FeatureResponse | null
  cachedBoolean: FeatureResponse | null
  invalidBooleanDiagnostic: string | null
  legacyRevolveOperationDiagnostic: string | null
  missingDependencyDiagnostic: string | null
  health: HealthResponse | null
  disposal: DisposalResponse | null
  progress: string[]
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_PRIMITIVE_FEATURES__: FeatureEvaluationHarnessState
  }
}

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const boxFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const positionedBoxFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3112")
const cylinderFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const booleanFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103")
const identicalToolFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104")
const missingBooleanFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3105")
const extrusionFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3106")
const extrusionAddFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3107")
const extrusionRemoveFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3108")
const extrusionIntersectFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3109")
const ellipseExtrusionFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3110")
const ellipticalArcMinorFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3111")
const ellipticalArcMajorFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3114")
const ellipticalArcWrappedFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3115")
const ellipticalArcReflectedFeatureId = featureIdSchema.parse(
  "0195b5ac-b220-7a2c-8c33-67a36a7f3116",
)
const circularArcExtrusionFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3113")
const revolveFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3117")
const revolveAddFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3118")
const revolveRemoveFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3119")
const revolveIntersectFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3120")
const legacyRevolveAddFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3121")
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const profileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3302",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3303",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3304",
] as const
const profilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3321",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3322",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3323",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3324",
] as const
const ellipseProfileEntityId = "0195b5ac-b220-7a2c-8c33-67a36a7f3310"
const ellipticalArcMinorProfileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3311",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3312",
] as const
const ellipticalArcMinorProfilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3331",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3332",
] as const
const ellipticalArcMajorProfileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3341",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3342",
] as const
const ellipticalArcMajorProfilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3361",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3362",
] as const
const ellipticalArcWrappedProfileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3351",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3352",
] as const
const ellipticalArcWrappedProfilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3371",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3372",
] as const
const ellipticalArcReflectedProfileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3381",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3382",
] as const
const ellipticalArcReflectedProfilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3391",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3392",
] as const
const circularArcProfileEntityIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3313",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3314",
] as const
const circularArcProfilePointIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f3333",
  "0195b5ac-b220-7a2c-8c33-67a36a7f3334",
] as const
const generation = 1
const state: FeatureEvaluationHarnessState = {
  state: "running",
  box: null,
  cachedBox: null,
  positionedBox: null,
  cylinder: null,
  extrusion: null,
  circularArcExtrusion: null,
  ellipseExtrusion: null,
  ellipticalArcMinor: null,
  ellipticalArcMajor: null,
  ellipticalArcWrapped: null,
  ellipticalArcReflected: null,
  extrusionAdd: null,
  extrusionIntersect: null,
  extrusionRemove: null,
  revolve: null,
  revolveAdd: null,
  revolveIntersect: null,
  revolveRemove: null,
  boolean: null,
  cachedBoolean: null,
  invalidBooleanDiagnostic: null,
  legacyRevolveOperationDiagnostic: null,
  missingDependencyDiagnostic: null,
  health: null,
  disposal: null,
  progress: [],
  error: null,
}

function extrusionFeature(
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly FeatureId[],
  contentParameters: ReturnType<typeof extrusionFeatureContentParametersSchema.parse>,
) {
  return {
    schemaVersion: 0,
    id: featureId,
    type: extrusionFeatureType.type,
    parameters: {
      profile: {
        schemaVersion: 0,
        sketchId,
        outerBoundaryEntityIds: contentParameters.outer.sourceEntityIds,
        holeBoundaryEntityIds: contentParameters.holes.map(
          ({ sourceEntityIds }) => sourceEntityIds,
        ),
      },
      distance: createLengthQuantity(contentParameters.distance),
      symmetric: contentParameters.symmetric,
      operation,
    },
    dependencies,
    references: [],
    suppressed: false,
  }
}

function revolveFeature(
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly FeatureId[],
  contentParameters: ReturnType<typeof revolveFeatureContentParametersSchema.parse>,
) {
  return {
    schemaVersion: 0,
    id: featureId,
    type: revolveFeatureType.type,
    parameters: {
      profile: {
        schemaVersion: 0,
        sketchId,
        outerBoundaryEntityIds: contentParameters.outer.sourceEntityIds,
        holeBoundaryEntityIds: contentParameters.holes.map(
          ({ sourceEntityIds }) => sourceEntityIds,
        ),
      },
      axis: contentParameters.axis,
      angle: createAngleQuantity(contentParameters.angleRadians),
      operation,
    },
    dependencies,
    references: [],
    suppressed: false,
  }
}

const extrusionContentParameters = extrusionFeatureContentParametersSchema.parse({
  sketchId,
  plane: "xz",
  outer: {
    sourceEntityIds: profileEntityIds,
    segments: [
      {
        entityId: profileEntityIds[0],
        type: "line",
        startPointId: profilePointIds[0],
        endPointId: profilePointIds[1],
        start: [0, 0],
        end: [20, 0],
      },
      {
        entityId: profileEntityIds[1],
        type: "line",
        startPointId: profilePointIds[1],
        endPointId: profilePointIds[2],
        start: [20, 0],
        end: [20, 10],
      },
      {
        entityId: profileEntityIds[2],
        type: "line",
        startPointId: profilePointIds[2],
        endPointId: profilePointIds[3],
        start: [20, 10],
        end: [0, 10],
      },
      {
        entityId: profileEntityIds[3],
        type: "line",
        startPointId: profilePointIds[3],
        endPointId: profilePointIds[0],
        start: [0, 10],
        end: [0, 0],
      },
    ],
  },
  holes: [],
  distance: 18,
  symmetric: true,
  operation: "new",
})

const revolveContentParameters = revolveFeatureContentParametersSchema.parse({
  sketchId,
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  outer: {
    sourceEntityIds: profileEntityIds,
    segments: [
      {
        entityId: profileEntityIds[0],
        type: "line",
        startPointId: profilePointIds[0],
        endPointId: profilePointIds[1],
        start: [0, 0],
        end: [10, 0],
      },
      {
        entityId: profileEntityIds[1],
        type: "line",
        startPointId: profilePointIds[1],
        endPointId: profilePointIds[2],
        start: [10, 0],
        end: [10, 10],
      },
      {
        entityId: profileEntityIds[2],
        type: "line",
        startPointId: profilePointIds[2],
        endPointId: profilePointIds[3],
        start: [10, 10],
        end: [0, 10],
      },
      {
        entityId: profileEntityIds[3],
        type: "line",
        startPointId: profilePointIds[3],
        endPointId: profilePointIds[0],
        start: [0, 10],
        end: [0, 0],
      },
    ],
  },
  holes: [],
  axis: "y",
  axisOrigin: [0, 0, 0],
  axisDirection: [0, 1, 0],
  angleRadians: Math.PI * 2,
  operation: "new",
})

const ellipseExtrusionContentParameters = extrusionFeatureContentParametersSchema.parse({
  sketchId,
  plane: "xy",
  outer: {
    sourceEntityIds: [ellipseProfileEntityId],
    segments: [
      {
        entityId: ellipseProfileEntityId,
        type: "ellipse",
        center: [0, 0],
        primaryAxisPoint: [5, 0],
        secondaryAxisPoint: [0, 10],
      },
    ],
  },
  holes: [],
  distance: 12,
  symmetric: false,
  operation: "new",
})

function ellipticalArcExtrusionContentParameters(
  entityIds: readonly [string, string],
  pointIds: readonly [string, string],
  primaryAxisPoint: readonly [number, number],
  secondaryAxisPoint: readonly [number, number],
  startAngle: number,
  endAngle: number,
) {
  const point = (angle: number) =>
    [
      primaryAxisPoint[0] * Math.cos(angle) + secondaryAxisPoint[0] * Math.sin(angle),
      primaryAxisPoint[1] * Math.cos(angle) + secondaryAxisPoint[1] * Math.sin(angle),
    ] as [number, number]
  const start = point(startAngle)
  const end = point(endAngle)
  return extrusionFeatureContentParametersSchema.parse({
    sketchId,
    plane: "xy",
    outer: {
      sourceEntityIds: entityIds,
      segments: [
        {
          entityId: entityIds[0],
          type: "elliptical-arc",
          startPointId: pointIds[0],
          endPointId: pointIds[1],
          center: [0, 0],
          primaryAxisPoint,
          secondaryAxisPoint,
          start,
          end,
        },
        {
          entityId: entityIds[1],
          type: "line",
          startPointId: pointIds[1],
          endPointId: pointIds[0],
          start: end,
          end: start,
        },
      ],
    },
    holes: [],
    distance: 12,
    symmetric: false,
    operation: "new",
  })
}

const ellipticalArcMinorContentParameters = ellipticalArcExtrusionContentParameters(
  ellipticalArcMinorProfileEntityIds,
  ellipticalArcMinorProfilePointIds,
  [10, 0],
  [0, 5],
  0,
  Math.PI / 2,
)
const ellipticalArcMajorContentParameters = ellipticalArcExtrusionContentParameters(
  ellipticalArcMajorProfileEntityIds,
  ellipticalArcMajorProfilePointIds,
  [10, 0],
  [0, 5],
  Math.PI / 2,
  0,
)
const wrappedDelta = 0.2
const ellipticalArcWrappedContentParameters = ellipticalArcExtrusionContentParameters(
  ellipticalArcWrappedProfileEntityIds,
  ellipticalArcWrappedProfilePointIds,
  [10, 0],
  [0, 5],
  Math.PI * 2 - wrappedDelta,
  wrappedDelta,
)
const ellipticalArcReflectedContentParameters = ellipticalArcExtrusionContentParameters(
  ellipticalArcReflectedProfileEntityIds,
  ellipticalArcReflectedProfilePointIds,
  [-10, 0],
  [0, 5],
  0,
  Math.PI,
)

const circularArcExtrusionContentParameters = extrusionFeatureContentParametersSchema.parse({
  sketchId,
  plane: "xy",
  outer: {
    sourceEntityIds: circularArcProfileEntityIds,
    segments: [
      {
        entityId: circularArcProfileEntityIds[0],
        type: "arc",
        startPointId: circularArcProfilePointIds[0],
        endPointId: circularArcProfilePointIds[1],
        start: [10, 0],
        middle: [-10, 0],
        end: [0, -10],
      },
      {
        entityId: circularArcProfileEntityIds[1],
        type: "line",
        startPointId: circularArcProfilePointIds[1],
        endPointId: circularArcProfilePointIds[0],
        start: [0, -10],
        end: [10, 0],
      },
    ],
  },
  holes: [],
  distance: 12,
  symmetric: false,
  operation: "new",
})

window.__VIBESHAPE_PRIMITIVE_FEATURES__ = state

function statusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The primitive feature status element is missing.")
  return element
}

function expectResponse<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): Extract<TerminalResponse, { type: Type }> {
  if (response.type !== type) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }
  return response as Extract<TerminalResponse, { type: Type }>
}

function featureRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function feature(
  kind: "boolean" | "box" | "cylinder",
  featureId: FeatureId,
  dependencies: readonly FeatureId[],
  origin: readonly [number, number, number] = [0, 0, 0],
) {
  if (kind === "box") {
    return {
      schemaVersion: 0,
      id: featureId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(2, "cm"),
        depth: createLengthQuantity(30),
        height: createLengthQuantity(1, "in"),
        centered: false,
        origin: {
          x: createLengthQuantity(origin[0]),
          y: createLengthQuantity(origin[1]),
          z: createLengthQuantity(origin[2]),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }
  }
  if (kind === "cylinder") {
    return {
      schemaVersion: 0,
      id: featureId,
      type: cylinderFeatureType.type,
      parameters: {
        radius: createLengthQuantity(5),
        height: createLengthQuantity(60),
        centered: true,
        origin: {
          x: createLengthQuantity(origin[0]),
          y: createLengthQuantity(origin[1]),
          z: createLengthQuantity(origin[2]),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }
  }
  return {
    schemaVersion: 0,
    id: featureId,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies,
    references: [],
    suppressed: false,
  }
}

async function sha256(canonicalPayload: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function evaluate(
  client: GeometryWorkerClient,
  kind: "boolean" | "box" | "cylinder",
  featureId: FeatureId,
  environment: unknown,
  dependencies: readonly { featureId: FeatureId; contentHash: string }[] = [],
  origin: readonly [number, number, number] = [0, 0, 0],
) {
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: feature(
        kind,
        featureId,
        dependencies.map(({ featureId: dependencyId }) => dependencyId),
        origin,
      ),
      dependencies,
      environment,
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  const wireContent = featureContentIdentitySchema.parse(content.identity)

  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: wireContent,
        contentHash: content.contentHash,
        dependencies: [...dependencies],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      },
      {
        onProgress(stage) {
          state.progress.push(stage)
        },
      },
    ),
    "featureEvaluated",
  )
}

async function evaluateExtrusion(
  client: GeometryWorkerClient,
  environment: unknown,
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly { featureId: FeatureId; contentHash: string }[],
  contentParameters = extrusionContentParameters,
) {
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: extrusionFeature(
        featureId,
        operation,
        dependencies.map(({ featureId: dependencyId }) => dependencyId),
        contentParameters,
      ),
      dependencies,
      environment,
      contentParameters: { ...contentParameters, operation },
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: featureContentIdentitySchema.parse(content.identity),
        contentHash: content.contentHash,
        dependencies: [...dependencies],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      },
      {
        onProgress(stage) {
          state.progress.push(stage)
        },
      },
    ),
    "featureEvaluated",
  )
}

async function evaluateRevolve(
  client: GeometryWorkerClient,
  environment: unknown,
  featureId: FeatureId,
  operation: "add" | "intersect" | "new" | "remove",
  dependencies: readonly { featureId: FeatureId; contentHash: string }[],
) {
  const contentParameters = { ...revolveContentParameters, operation }
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: revolveFeature(
        featureId,
        operation,
        dependencies.map(({ featureId: dependencyId }) => dependencyId),
        contentParameters,
      ),
      dependencies,
      environment,
      contentParameters,
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  return expectResponse(
    await client.request(
      {
        ...createGeometryRequestEnvelope(documentId, generation, 1),
        type: "evaluateFeature",
        featureId,
        content: featureContentIdentitySchema.parse(content.identity),
        contentHash: content.contentHash,
        dependencies: [...dependencies],
        mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      },
      {
        onProgress(stage) {
          state.progress.push(stage)
        },
      },
    ),
    "featureEvaluated",
  )
}

async function evaluateLegacyModifyingRevolve(
  client: GeometryWorkerClient,
  environment: unknown,
  dependencies: readonly { featureId: FeatureId; contentHash: string }[],
) {
  const operation = "add" as const
  const contentParameters = { ...revolveContentParameters, operation }
  const content = await computeFeatureContentHash(
    featureRegistry(),
    {
      feature: revolveFeature(
        legacyRevolveAddFeatureId,
        operation,
        dependencies.map(({ featureId }) => featureId),
        contentParameters,
      ),
      dependencies,
      environment,
      contentParameters,
    },
    sha256,
  )
  if (!content.ok) throw new Error(content.diagnostic.message)
  const legacyIdentity = featureContentIdentitySchema.parse({
    ...content.identity,
    feature: {
      ...content.identity.feature,
      type: legacyRevolveFeatureType.type,
    },
  })
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation, 1),
      type: "evaluateFeature",
      featureId: legacyRevolveAddFeatureId,
      content: legacyIdentity,
      contentHash: await sha256(serializeFeatureContentIdentity(legacyIdentity)),
      dependencies: [...dependencies],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }),
    "featureEvaluated",
  )
}

function featureFailureResponse(error: unknown) {
  if (!(error instanceof GeometryWorkerRequestError)) return null
  const response = error.response
  if (response?.type !== "failure") return null
  return response
}

async function expectedEvaluationFailure(
  operation: () => Promise<FeatureResponse>,
  unexpectedSuccessMessage: string,
) {
  try {
    await operation()
    throw new Error(unexpectedSuccessMessage)
  } catch (error) {
    const response = featureFailureResponse(error)
    if (!response) throw error
    return response.diagnostic.code
  }
}

async function run() {
  const client = createGeometryWorkerClient()
  const status = statusElement()
  try {
    const initialized = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "initializeEngine",
      }),
      "initialized",
    )
    const environment = initialized.engine.featureContentEnvironment
    const box = await evaluate(client, "box", boxFeatureId, environment)
    state.box = box
    state.cachedBox = await evaluate(client, "box", boxFeatureId, environment)
    state.positionedBox = await evaluate(
      client,
      "box",
      positionedBoxFeatureId,
      environment,
      [],
      [12, -8, 7],
    )
    const cylinder = await evaluate(client, "cylinder", cylinderFeatureId, environment)
    state.cylinder = cylinder
    state.extrusion = await evaluateExtrusion(client, environment, extrusionFeatureId, "new", [])
    state.ellipseExtrusion = await evaluateExtrusion(
      client,
      environment,
      ellipseExtrusionFeatureId,
      "new",
      [],
      ellipseExtrusionContentParameters,
    )
    state.ellipticalArcMinor = await evaluateExtrusion(
      client,
      environment,
      ellipticalArcMinorFeatureId,
      "new",
      [],
      ellipticalArcMinorContentParameters,
    )
    state.ellipticalArcMajor = await evaluateExtrusion(
      client,
      environment,
      ellipticalArcMajorFeatureId,
      "new",
      [],
      ellipticalArcMajorContentParameters,
    )
    state.ellipticalArcWrapped = await evaluateExtrusion(
      client,
      environment,
      ellipticalArcWrappedFeatureId,
      "new",
      [],
      ellipticalArcWrappedContentParameters,
    )
    state.ellipticalArcReflected = await evaluateExtrusion(
      client,
      environment,
      ellipticalArcReflectedFeatureId,
      "new",
      [],
      ellipticalArcReflectedContentParameters,
    )
    state.circularArcExtrusion = await evaluateExtrusion(
      client,
      environment,
      circularArcExtrusionFeatureId,
      "new",
      [],
      circularArcExtrusionContentParameters,
    )
    const extrusionTarget = [{ featureId: boxFeatureId, contentHash: box.contentHash }]
    state.extrusionAdd = await evaluateExtrusion(
      client,
      environment,
      extrusionAddFeatureId,
      "add",
      extrusionTarget,
    )
    state.extrusionRemove = await evaluateExtrusion(
      client,
      environment,
      extrusionRemoveFeatureId,
      "remove",
      extrusionTarget,
    )
    state.extrusionIntersect = await evaluateExtrusion(
      client,
      environment,
      extrusionIntersectFeatureId,
      "intersect",
      extrusionTarget,
    )
    state.revolve = await evaluateRevolve(client, environment, revolveFeatureId, "new", [])
    state.revolveAdd = await evaluateRevolve(
      client,
      environment,
      revolveAddFeatureId,
      "add",
      extrusionTarget,
    )
    state.revolveRemove = await evaluateRevolve(
      client,
      environment,
      revolveRemoveFeatureId,
      "remove",
      extrusionTarget,
    )
    state.revolveIntersect = await evaluateRevolve(
      client,
      environment,
      revolveIntersectFeatureId,
      "intersect",
      extrusionTarget,
    )
    const booleanDependencies = [
      { featureId: boxFeatureId, contentHash: box.contentHash },
      { featureId: cylinderFeatureId, contentHash: cylinder.contentHash },
    ]
    state.boolean = await evaluate(
      client,
      "boolean",
      booleanFeatureId,
      environment,
      booleanDependencies,
    )
    const identicalTool = await evaluate(client, "box", identicalToolFeatureId, environment)
    state.invalidBooleanDiagnostic = await expectedEvaluationFailure(
      () =>
        evaluate(client, "boolean", booleanFeatureId, environment, [
          { featureId: boxFeatureId, contentHash: box.contentHash },
          { featureId: identicalToolFeatureId, contentHash: identicalTool.contentHash },
        ]),
      "Boolean evaluation unexpectedly accepted an empty subtraction result.",
    )
    state.cachedBoolean = await evaluate(
      client,
      "boolean",
      booleanFeatureId,
      environment,
      booleanDependencies,
    )
    state.missingDependencyDiagnostic = await expectedEvaluationFailure(
      () =>
        evaluate(client, "boolean", missingBooleanFeatureId, environment, [
          { featureId: boxFeatureId, contentHash: "d".repeat(64) },
          { featureId: cylinderFeatureId, contentHash: "e".repeat(64) },
        ]),
      "Boolean evaluation unexpectedly accepted unavailable dependency shapes.",
    )
    state.legacyRevolveOperationDiagnostic = await expectedEvaluationFailure(
      () => evaluateLegacyModifyingRevolve(client, environment, extrusionTarget),
      "Schema-version-1 Revolve unexpectedly accepted a modifying operation.",
    )
    state.health = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "healthCheck",
      }),
      "health",
    )
    state.disposal = expectResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, generation),
        type: "disposeDocument",
      }),
      "documentDisposed",
    )
    state.state = "passed"
    status.dataset.state = "passed"
    status.textContent = "Primitive feature evaluation passed."
  } catch (error) {
    state.state = "failed"
    state.error = isError(error) ? error.message : "Unknown primitive feature failure."
    status.dataset.state = "failed"
    status.textContent = state.error
  } finally {
    client.terminate()
  }
}

void run()
