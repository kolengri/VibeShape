import {
  booleanFeatureContentParametersSchema,
  boxFeatureContentParametersSchema,
  cylinderFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
  type FeatureContentEnvironment,
  type FeatureEvaluationDependency,
  type FeatureEvaluationEngineResult,
  featureContentEnvironmentSchema,
  type GeometryEngineMetadata,
  type GeometryExportFormat,
  type GeometryProgressStage,
  type GeometryWorkerRequest,
  type KernelSpikeEngineResult,
  type KernelSpikeParameters,
  type TopologyCandidate,
  type TopologySpikeEngineResult,
  type TopologySpikeParameters,
} from "@vibeshape/protocol"
import { isAnyObject } from "is-what"
import {
  assembleWire,
  cast,
  makeCircle,
  makeEllipse,
  makeEllipseArc,
  makeFace,
  makeLine,
  makeThreePointArc,
  type Shape3D,
  type SimplePoint,
  setOC,
  type Wire,
} from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import opencascadeWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url"
import {
  FEATURE_CONTENT_HOST_API_VERSION,
  GEOMETRY_ADAPTER_ID,
  GEOMETRY_ADAPTER_VERSION,
  GEOMETRY_KERNEL_ID,
  MODELING_TOLERANCE_POLICY_VERSION,
  OPENCASCADE_SOURCE_REVISION,
  REPLICAD_OPENCASCADE_VERSION,
  REPLICAD_VERSION,
} from "./build-info"
import {
  ellipticalArcKernelParameters,
  normalizedExtrusionDirection,
} from "./extrusion-curve-geometry"
import {
  createMemoryProfile,
  getWasmHeapBytes,
  type OpenCascadeMemoryModule,
} from "./memory-profile"
import { createOcctCompound } from "./occt-compound"
import { purgeOcctAllocator, runNativeOcctLifecycleCycle } from "./occt-diagnostics"
import { exportOcctStep, importOcctStep } from "./occt-exchange"
import { exportMeshedOcctStl, meshOcctShape } from "./occt-mesh"
import {
  createOcctBox,
  createOcctCylinder,
  cutOcctShapes,
  cutOcctShapesWithHistory,
  cutOcctShapesWithLineage,
  filletOcctEdgesAtZWithHistory,
  filletOcctEdgesAtZWithLineage,
  fuseOcctShapes,
  intersectOcctShapes,
} from "./occt-shapes"
import { DocumentFeatureShapeRegistry, OwnedShapeRegistry } from "./shape-registry"
import {
  captureReplicadTopologyCandidates,
  captureReplicadTopologySnapshot,
  type TopologyCandidateContext,
  type TopologyCaptureSnapshot,
} from "./topology-signatures"

type ProgressReporter = (stage: GeometryProgressStage, fraction: number) => void
type EvaluateFeatureRequest = Extract<GeometryWorkerRequest, { type: "evaluateFeature" }>

export type FeatureEvaluationInput = Pick<
  EvaluateFeatureRequest,
  "documentId" | "featureId" | "content" | "contentHash" | "dependencies" | "mesh"
>

export type FeatureEvaluationResult =
  | { ok: true; result: FeatureEvaluationEngineResult }
  | {
      ok: false
      diagnostic: Readonly<{
        code:
          | "unsupported-feature-type"
          | "invalid-feature-parameters"
          | "invalid-feature-geometry"
          | "missing-feature-dependency"
        message: string
      }>
    }

export type DocumentGeometryExportInput = Readonly<{
  documentId: string
  features: readonly FeatureEvaluationDependency[]
  format: Exclude<GeometryExportFormat, "3mf">
}>

export type DocumentGeometryExportResult = Readonly<{
  file: Uint8Array
  bodyCount: number
}>

export type DocumentPrintMeshExportInput = Readonly<{
  documentId: string
  features: readonly FeatureEvaluationDependency[]
}>

export type DocumentPrintMeshExportResult = Readonly<{
  meshes: readonly Readonly<{
    featureId: string
    vertices: readonly number[]
    triangles: readonly number[]
  }>[]
}>

type OpenCascadeModule = OpenCascadeInstance & OpenCascadeMemoryModule

const MAX_FEATURE_WORKSPACE_LENGTH_MM = 100_000
const PRINT_MESH_CHORD_TOLERANCE_MM = 0.02
const PRINT_MESH_ANGULAR_TOLERANCE_RAD = 0.1
const BOX_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.box#1"
const CYLINDER_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.cylinder#1"
const BOOLEAN_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.boolean#1"
const EXTRUSION_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#1"
const EXTRUSION_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#2"

function featureTypeKey(type: EvaluateFeatureRequest["content"]["feature"]["type"]) {
  return `${type.moduleId}@${type.moduleVersion}:${type.typeId}#${type.schemaVersion}`
}

type OpenCascadeInitializer = (options: {
  locateFile: (path: string) => string
  wasmBinary: Uint8Array
}) => Promise<OpenCascadeInstance>

function initializeOpenCascadeWithOptions(
  options: Parameters<OpenCascadeInitializer>[0],
): Promise<OpenCascadeInstance> {
  // The published declaration omits standard Emscripten module options accepted by the loader.
  return Reflect.apply(initializeOpenCascade, undefined, [options])
}

function isTopAbsShapeEnum(value: unknown): value is TopAbs_ShapeEnum {
  return isAnyObject(value)
}

function readTopAbsShapeEnum(opencascade: OpenCascadeInstance, member: keyof TopAbs_ShapeEnum) {
  const value: unknown = opencascade.TopAbs_ShapeEnum[member]

  // Generated bindings type enum members as `{}` while constructors expect the enum object type.
  if (!isTopAbsShapeEnum(value)) {
    throw new Error(`OpenCascade enum member ${member} is unavailable.`)
  }

  return value
}

function elapsed(startedAt: number) {
  return performance.now() - startedAt
}

function createFeatureContentEnvironment(): FeatureContentEnvironment {
  return featureContentEnvironmentSchema.parse({
    schemaVersion: 0,
    hostApiVersion: FEATURE_CONTENT_HOST_API_VERSION,
    geometry: {
      adapterId: GEOMETRY_ADAPTER_ID,
      adapterVersion: GEOMETRY_ADAPTER_VERSION,
      kernelId: GEOMETRY_KERNEL_ID,
      kernelVersion: REPLICAD_OPENCASCADE_VERSION,
      kernelSourceRevision: OPENCASCADE_SOURCE_REVISION,
    },
    modelingTolerancePolicyVersion: MODELING_TOLERANCE_POLICY_VERSION,
    provider: { kind: "built-in" },
  })
}

function featureFailure(
  code: Extract<FeatureEvaluationResult, { ok: false }>["diagnostic"]["code"],
  message: string,
): Extract<FeatureEvaluationResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message } }
}

function withinFeatureWorkspace(values: readonly number[]) {
  return values.every((value) => value <= MAX_FEATURE_WORKSPACE_LENGTH_MM)
}

function relativeError(expected: number, actual: number) {
  return Math.abs(expected - actual) / Math.max(Math.abs(expected), Number.EPSILON)
}

function runLifecycleIteration(
  ownedShapes: OwnedShapeRegistry,
  opencascade: OpenCascadeModule,
  parameters: KernelSpikeParameters,
) {
  const [boxLength, boxWidth, boxHeight] = parameters.boxSize

  if (parameters.lifecycleOperation === "occt-native-box") {
    runNativeOcctLifecycleCycle(opencascade, "box")
    return
  }

  if (parameters.lifecycleOperation === "occt-native-cylinder") {
    runNativeOcctLifecycleCycle(opencascade, "cylinder")
    return
  }

  if (parameters.lifecycleOperation === "occt-box") {
    const maker = new opencascade.BRepPrimAPI_MakeBox_2(boxLength, boxWidth, boxHeight)
    const shape = maker.Solid()

    try {
      return
    } finally {
      shape.delete()
      maker.delete()
    }
  }

  if (parameters.lifecycleOperation === "occt-cylinder") {
    const maker = new opencascade.BRepPrimAPI_MakeCylinder_1(
      parameters.cylinderRadius,
      parameters.cylinderHeight,
    )
    const shape = maker.Solid()

    try {
      return
    } finally {
      shape.delete()
      maker.delete()
    }
  }

  if (parameters.lifecycleOperation === "box") {
    ownedShapes.dispose(ownedShapes.own(createOcctBox(opencascade, parameters.boxSize)))
    return
  }

  if (parameters.lifecycleOperation === "cylinder") {
    ownedShapes.dispose(
      ownedShapes.own(
        createOcctCylinder(
          opencascade,
          parameters.cylinderRadius,
          parameters.cylinderHeight,
          parameters.cylinderOrigin,
        ),
      ),
    )
    return
  }

  const box = ownedShapes.own(createOcctBox(opencascade, parameters.boxSize))
  const cylinder = ownedShapes.own(
    createOcctCylinder(
      opencascade,
      parameters.cylinderRadius,
      parameters.cylinderHeight,
      parameters.cylinderOrigin,
    ),
  )
  const cutShape = ownedShapes.own(cutOcctShapes(opencascade, box, cylinder))
  ownedShapes.dispose(cutShape)
  ownedShapes.dispose(cylinder)
  ownedShapes.dispose(box)
}

function countSubshapes(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  shapeType: "TopAbs_EDGE" | "TopAbs_FACE" | "TopAbs_SOLID",
) {
  const explorer = new opencascade.TopExp_Explorer_2(
    shape.wrapped,
    readTopAbsShapeEnum(opencascade, shapeType),
    readTopAbsShapeEnum(opencascade, "TopAbs_SHAPE"),
  )
  const hashes = new Set<number>()

  try {
    while (explorer.More()) {
      const current = explorer.Current()

      try {
        hashes.add(current.HashCode(2_147_483_647))
      } finally {
        current.delete()
      }

      explorer.Next()
    }
  } finally {
    explorer.delete()
  }

  return hashes.size
}

function measureShape(opencascade: OpenCascadeInstance, shape: Shape3D) {
  const analyzer = new opencascade.BRepCheck_Analyzer(shape.wrapped, true, false)
  const volumeProperties = new opencascade.GProp_GProps_1()
  const surfaceProperties = new opencascade.GProp_GProps_1()
  const boundingBox = new opencascade.Bnd_Box_1()

  try {
    opencascade.BRepGProp.VolumeProperties_1(shape.wrapped, volumeProperties, false, false, false)
    opencascade.BRepGProp.SurfaceProperties_1(shape.wrapped, surfaceProperties, false, false)
    opencascade.BRepBndLib.Add(shape.wrapped, boundingBox, true)
    const xMin = { current: 0 }
    const yMin = { current: 0 }
    const zMin = { current: 0 }
    const xMax = { current: 0 }
    const yMax = { current: 0 }
    const zMax = { current: 0 }
    // The generated declaration misses Emscripten's mutable numeric out-parameter objects.
    Reflect.apply(boundingBox.Get, boundingBox, [xMin, yMin, zMin, xMax, yMax, zMax])

    return {
      valid: analyzer.IsValid_2(),
      volume: volumeProperties.Mass(),
      surfaceArea: surfaceProperties.Mass(),
      bounds: {
        min: [xMin.current, yMin.current, zMin.current] as [number, number, number],
        max: [xMax.current, yMax.current, zMax.current] as [number, number, number],
      },
      faceCount: countSubshapes(opencascade, shape, "TopAbs_FACE"),
      edgeCount: countSubshapes(opencascade, shape, "TopAbs_EDGE"),
      solidCount: countSubshapes(opencascade, shape, "TopAbs_SOLID"),
    }
  } finally {
    analyzer.delete()
    volumeProperties.delete()
    surfaceProperties.delete()
    boundingBox.delete()
  }
}

function tessellate(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  parameters: { meshTolerance: number; angularTolerance: number },
) {
  const source = meshOcctShape(opencascade, shape, {
    tolerance: parameters.meshTolerance,
    angularTolerance: parameters.angularTolerance,
  })
  const positions = Float32Array.from(source.vertices)
  const normals = Float32Array.from(source.normals)
  const indices = Uint32Array.from(source.triangles)
  const triangleFaceIds = new Uint32Array(indices.length / 3)

  for (const group of source.faceGroups) {
    const firstTriangle = group.start / 3
    const triangleCount = group.count / 3
    triangleFaceIds.fill(group.faceId, firstTriangle, firstTriangle + triangleCount)
  }

  if (positions.length !== normals.length || indices.length % 3 !== 0) {
    throw new Error("Replicad returned a malformed tessellation payload.")
  }

  return { positions, normals, indices, triangleFaceIds }
}

function nearlyEqual(left: number, right: number, tolerance = 1e-6) {
  return Math.abs(left - right) <= tolerance
}

function firstMatchingRole(rules: Array<readonly [matches: boolean, role: string]>) {
  return rules.find(([matches]) => matches)?.[1]
}

function cylinderSemanticRole(
  context: TopologyCandidateContext,
  parameters: KernelSpikeParameters,
) {
  const { centroid, direction } = context.signature
  if (!direction) return undefined
  const [x, y] = centroid
  const [normalX, normalY, normalZ] = direction
  const [holeX, holeY] = parameters.cylinderOrigin
  return firstMatchingRole([
    [nearlyEqual(x, holeX) && nearlyEqual(y, holeY) && Math.abs(normalZ) < 1e-6, "hole.wall"],
    [normalX < -0.5, "top-fillet.surface.x-min"],
    [normalX > 0.5, "top-fillet.surface.x-max"],
    [normalY < -0.5, "top-fillet.surface.y-min"],
    [normalY > 0.5, "top-fillet.surface.y-max"],
  ])
}

function planeSemanticRole(
  context: TopologyCandidateContext,
  parameters: Pick<KernelSpikeParameters, "boxSize">,
) {
  const { centroid, direction } = context.signature
  if (!direction) return undefined
  const [length, width, height] = parameters.boxSize
  const [x, y, z] = centroid
  const [normalX, normalY, normalZ] = direction
  return firstMatchingRole([
    [Math.abs(normalZ) > 0.999 && nearlyEqual(z, 0), "base-extrude.cap.start"],
    [Math.abs(normalZ) > 0.999 && nearlyEqual(z, height), "base-extrude.cap.end"],
    [Math.abs(normalX) > 0.999 && nearlyEqual(x, -length / 2), "base-extrude.side.x-min"],
    [Math.abs(normalX) > 0.999 && nearlyEqual(x, length / 2), "base-extrude.side.x-max"],
    [Math.abs(normalY) > 0.999 && nearlyEqual(y, -width / 2), "base-extrude.side.y-min"],
    [Math.abs(normalY) > 0.999 && nearlyEqual(y, width / 2), "base-extrude.side.y-max"],
  ])
}

type BooleanContentParameters = ReturnType<typeof booleanFeatureContentParametersSchema.parse>
type BoxContentParameters = ReturnType<typeof boxFeatureContentParametersSchema.parse>
type CylinderContentParameters = ReturnType<typeof cylinderFeatureContentParametersSchema.parse>
type ExtrusionContentParameters = ReturnType<typeof extrusionFeatureContentParametersSchema.parse>

function boxFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: BoxContentParameters,
) {
  if (context.kind !== "face" || context.signature.geometryClass !== "PLANE") {
    return undefined
  }
  const { centroid, direction } = context.signature
  if (!direction) return undefined
  const minimumZ = parameters.centered ? -parameters.height / 2 : 0
  const maximumZ = parameters.centered ? parameters.height / 2 : parameters.height
  const axes = [
    {
      coordinate: centroid[0],
      normal: direction[0],
      minimum: -parameters.width / 2,
      maximum: parameters.width / 2,
      minimumRole: "primitive.box.side.x-min",
      maximumRole: "primitive.box.side.x-max",
    },
    {
      coordinate: centroid[1],
      normal: direction[1],
      minimum: -parameters.depth / 2,
      maximum: parameters.depth / 2,
      minimumRole: "primitive.box.side.y-min",
      maximumRole: "primitive.box.side.y-max",
    },
    {
      coordinate: centroid[2],
      normal: direction[2],
      minimum: minimumZ,
      maximum: maximumZ,
      minimumRole: "primitive.box.cap.start",
      maximumRole: "primitive.box.cap.end",
    },
  ]
  const axis = axes.find(({ normal }) => Math.abs(normal) > 0.999)
  if (!axis) return undefined
  return firstMatchingRole([
    [nearlyEqual(axis.coordinate, axis.minimum), axis.minimumRole],
    [nearlyEqual(axis.coordinate, axis.maximum), axis.maximumRole],
  ])
}

function cylinderFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: CylinderContentParameters,
) {
  if (context.kind !== "face") return undefined
  if (context.signature.geometryClass === "CYLINDRE") return "primitive.cylinder.wall"
  if (context.signature.geometryClass !== "PLANE" || !context.signature.direction) return undefined
  const z = context.signature.centroid[2]
  const minimumZ = parameters.centered ? -parameters.height / 2 : 0
  const maximumZ = parameters.centered ? parameters.height / 2 : parameters.height
  return firstMatchingRole([
    [nearlyEqual(z, minimumZ), "primitive.cylinder.cap.start"],
    [nearlyEqual(z, maximumZ), "primitive.cylinder.cap.end"],
  ])
}

type ParsedFeature =
  | { kind: "boolean"; parameters: BooleanContentParameters }
  | { kind: "box"; parameters: BoxContentParameters }
  | { kind: "cylinder"; parameters: CylinderContentParameters }
  | { kind: "extrusion"; parameters: ExtrusionContentParameters }

type FeatureParseResult =
  | { ok: true; feature: ParsedFeature }
  | {
      ok: false
      diagnostic: Extract<FeatureEvaluationResult, { ok: false }>["diagnostic"]
    }

function invalidInputCardinality(message: string) {
  return featureFailure("invalid-feature-parameters", message)
}

function parseBoxFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 0 ||
    feature.references.length !== 0 ||
    input.dependencies.length !== 0
  ) {
    return invalidInputCardinality("Box features cannot declare dependency inputs.")
  }
  const parameters = boxFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Box content parameters are invalid.")
  }
  if (
    !withinFeatureWorkspace([parameters.data.width, parameters.data.depth, parameters.data.height])
  ) {
    return featureFailure(
      "invalid-feature-parameters",
      `Box dimensions must not exceed ${MAX_FEATURE_WORKSPACE_LENGTH_MM} mm.`,
    )
  }
  return { ok: true, feature: { kind: "box", parameters: parameters.data } }
}

function parseCylinderFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 0 ||
    feature.references.length !== 0 ||
    input.dependencies.length !== 0
  ) {
    return invalidInputCardinality("Cylinder features cannot declare dependency inputs.")
  }
  const parameters = cylinderFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Cylinder content parameters are invalid.")
  }
  if (!withinFeatureWorkspace([parameters.data.radius, parameters.data.height])) {
    return featureFailure(
      "invalid-feature-parameters",
      `Cylinder dimensions must not exceed ${MAX_FEATURE_WORKSPACE_LENGTH_MM} mm.`,
    )
  }
  return { ok: true, feature: { kind: "cylinder", parameters: parameters.data } }
}

function parseBooleanFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 2 ||
    feature.references.length !== 0 ||
    input.dependencies.length !== 2
  ) {
    return invalidInputCardinality("Boolean subtraction requires two ordered dependency inputs.")
  }
  const parameters = booleanFeatureContentParametersSchema.safeParse(feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind: "boolean", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Boolean content parameters are invalid.")
}

function extrusionInputCardinalityIsValid(
  input: FeatureEvaluationInput,
  parameters: ExtrusionContentParameters,
) {
  const dependencies = input.dependencies
  if (input.content.feature.inputs.length !== dependencies.length) return false
  const supportFeatureId = parameters.supportFeatureId
  if (parameters.operation === "new") {
    if (!supportFeatureId) return dependencies.length === 0
    return dependencies.length === 1 && dependencies[0]?.featureId === supportFeatureId
  }
  if (dependencies.length < 1 || dependencies.length > 2) return false
  return !supportFeatureId || dependencies.some(({ featureId }) => featureId === supportFeatureId)
}

function extrusionReferencesAreValid(
  input: FeatureEvaluationInput,
  parameters: ExtrusionContentParameters,
) {
  const references = input.content.feature.references
  if (!parameters.supportFeatureId) return references.length === 0
  const supportInputIndex = input.dependencies.findIndex(
    ({ featureId }) => featureId === parameters.supportFeatureId,
  )
  return (
    supportInputIndex >= 0 &&
    references.length === 1 &&
    references[0]?.inputIndex === supportInputIndex
  )
}

function parseExtrusionFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = extrusionFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Extrusion content parameters are invalid.")
  }
  if (!extrusionInputCardinalityIsValid(input, parameters.data)) {
    return invalidInputCardinality(
      parameters.data.operation === "new"
        ? "A new-body extrusion may depend only on its sketch support."
        : `A ${parameters.data.operation} extrusion requires one target and may also depend on its sketch support.`,
    )
  }
  if (!extrusionReferencesAreValid(input, parameters.data)) {
    return invalidInputCardinality(
      "An extrusion sketch-support reference must match its support dependency.",
    )
  }
  return { ok: true, feature: { kind: "extrusion", parameters: parameters.data } }
}

const FEATURE_PARSERS = new Map<string, (input: FeatureEvaluationInput) => FeatureParseResult>([
  [BOOLEAN_FEATURE_TYPE_KEY, parseBooleanFeature],
  [BOX_FEATURE_TYPE_KEY, parseBoxFeature],
  [CYLINDER_FEATURE_TYPE_KEY, parseCylinderFeature],
  [EXTRUSION_FEATURE_TYPE_KEY, parseExtrusionFeature],
  [EXTRUSION_FEATURE_TYPE_V2_KEY, parseExtrusionFeature],
])

function parseFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const key = featureTypeKey(feature.type)
  const parse = FEATURE_PARSERS.get(key)
  if (parse) return parse(input)

  return featureFailure(
    "unsupported-feature-type",
    `Feature type ${key} is not supported by the geometry evaluator.`,
  )
}

function applyExtrusionOperation(
  opencascade: OpenCascadeInstance,
  parameters: ExtrusionContentParameters,
  target: Shape3D,
  tool: Shape3D,
) {
  switch (parameters.operation) {
    case "add":
      return fuseOcctShapes(opencascade, target, tool)
    case "remove":
      return cutOcctShapes(opencascade, target, tool)
    case "intersect":
      return intersectOcctShapes(opencascade, target, tool)
    case "new":
      throw new Error("A new-body extrusion cannot modify a target shape.")
  }
}

function createExtrusionFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: ExtrusionContentParameters,
  dependencyShapes: readonly Shape3D[],
) {
  const tool = createExtrusionShape(opencascade, parameters)
  if (parameters.operation === "new") return tool
  const target = dependencyShapes[0]
  if (!target) {
    tool.delete()
    throw new Error("Extrusion target dependency shape is unavailable.")
  }
  try {
    return applyExtrusionOperation(opencascade, parameters, target, tool)
  } finally {
    tool.delete()
  }
}

function createFeatureShape(
  opencascade: OpenCascadeInstance,
  feature: ParsedFeature,
  dependencyShapes: readonly Shape3D[],
) {
  if (feature.kind === "box") {
    const { width, depth, height, centered } = feature.parameters
    return createOcctBox(opencascade, [width, depth, height], centered)
  }

  if (feature.kind === "cylinder") {
    const { radius, height, centered } = feature.parameters
    return createOcctCylinder(opencascade, radius, height, [0, 0, centered ? -height / 2 : 0])
  }

  if (feature.kind === "extrusion") {
    return createExtrusionFeatureShape(opencascade, feature.parameters, dependencyShapes)
  }

  const [target, tool] = dependencyShapes
  if (!target || !tool) throw new Error("Boolean dependency shapes are unavailable.")
  return cutOcctShapes(opencascade, target, tool)
}

function extrusionPlane(parameters: ExtrusionContentParameters) {
  const frame = parameters.frame
  if (frame) {
    return {
      normal: frame.normal,
      point: ([x, y]: readonly [number, number], offset = 0): SimplePoint => [
        frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y + frame.normal[0] * offset,
        frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y + frame.normal[1] * offset,
        frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y + frame.normal[2] * offset,
      ],
      local: (point: readonly [number, number, number]) => {
        const offset = [
          point[0] - frame.origin[0],
          point[1] - frame.origin[1],
          point[2] - frame.origin[2],
        ] as const
        return [dot3(offset, frame.xAxis), dot3(offset, frame.yAxis)] as const
      },
      coordinate: (point: readonly [number, number, number]) =>
        dot3(
          [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]],
          frame.normal,
        ),
    }
  }
  switch (parameters.plane) {
    case "xy":
      return {
        normal: [0, 0, 1] as [number, number, number],
        point: ([x, y]: readonly [number, number], offset = 0): SimplePoint => [x, y, offset],
        local: ([x, y]: readonly [number, number, number]) => [x, y] as const,
        coordinate: ([, , z]: readonly [number, number, number]) => z,
      }
    case "xz":
      return {
        normal: [0, -1, 0] as [number, number, number],
        point: ([x, y]: readonly [number, number], offset = 0): SimplePoint => [x, -offset, y],
        local: ([x, _y, z]: readonly [number, number, number]) => [x, z] as const,
        coordinate: ([, y]: readonly [number, number, number]) => -y,
      }
    case "yz":
      return {
        normal: [1, 0, 0] as [number, number, number],
        point: ([x, y]: readonly [number, number], offset = 0): SimplePoint => [offset, x, y],
        local: ([_x, y, z]: readonly [number, number, number]) => [y, z] as const,
        coordinate: ([x]: readonly [number, number, number]) => x,
      }
    default:
      throw new Error("Extrusion content is missing a sketch placement.")
  }
}

function dot3(left: readonly [number, number, number], right: readonly [number, number, number]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function extrusionCapRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
) {
  if (context.kind !== "face") return undefined
  const plane = extrusionPlane(parameters)
  const direction = context.signature.direction
  if (
    context.signature.geometryClass !== "PLANE" ||
    !direction ||
    Math.abs(dot3(direction, plane.normal)) <= 0.999
  ) {
    return undefined
  }
  const startOffset = parameters.symmetric ? -parameters.distance / 2 : 0
  const coordinate = plane.coordinate(context.signature.centroid)
  return firstMatchingRole([
    [nearlyEqual(coordinate, startOffset), "extrusion.cap.start"],
    [nearlyEqual(coordinate, startOffset + parameters.distance), "extrusion.cap.end"],
  ])
}

function extrusionLineSideRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
) {
  if (context.kind !== "face") return undefined
  const segments = [parameters.outer, ...parameters.holes].flatMap(({ segments }) => segments)
  const plane = extrusionPlane(parameters)
  const localCentroid = plane.local(context.signature.centroid)
  const lineMatches = segments.filter((segment) => {
    if (segment.type !== "line") return false
    const midpoint = [
      (segment.start[0] + segment.end[0]) / 2,
      (segment.start[1] + segment.end[1]) / 2,
    ] as const
    return Math.hypot(localCentroid[0] - midpoint[0], localCentroid[1] - midpoint[1]) <= 1e-6
  })
  return lineMatches.length === 1 ? `extrusion.side.${lineMatches[0]?.entityId}` : undefined
}

function extrusionCurvedSideRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
) {
  if (context.kind !== "face" || context.signature.geometryClass === "PLANE") return undefined
  const segments = [parameters.outer, ...parameters.holes].flatMap(({ segments }) => segments)
  const curvedSegments = segments.filter((segment) => segment.type !== "line")
  return curvedSegments.length === 1 ? `extrusion.side.${curvedSegments[0]?.entityId}` : undefined
}

function extrusionFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
) {
  return (
    extrusionCapRole(context, parameters) ??
    extrusionLineSideRole(context, parameters) ??
    extrusionCurvedSideRole(context, parameters)
  )
}

type ExtrusionPlane = ReturnType<typeof extrusionPlane>
type ExtrusionSegment = ExtrusionContentParameters["outer"]["segments"][number]

function extrusionNormal(plane: ExtrusionPlane, reverse: boolean): SimplePoint {
  return reverse ? (plane.normal.map((coordinate) => -coordinate) as SimplePoint) : plane.normal
}

function extrusionEllipseEdge(
  plane: ExtrusionPlane,
  segment: Extract<ExtrusionSegment, { type: "ellipse" }>,
  offset: number,
  reverse: boolean,
) {
  const center = plane.point(segment.center, offset)
  const primaryAxisPoint = plane.point(segment.primaryAxisPoint, offset)
  const secondaryAxisPoint = plane.point(segment.secondaryAxisPoint, offset)
  const primaryRadius = Math.hypot(
    segment.primaryAxisPoint[0] - segment.center[0],
    segment.primaryAxisPoint[1] - segment.center[1],
  )
  const secondaryRadius = Math.hypot(
    segment.secondaryAxisPoint[0] - segment.center[0],
    segment.secondaryAxisPoint[1] - segment.center[1],
  )
  const primaryIsMajor = primaryRadius >= secondaryRadius
  return makeEllipse(
    primaryIsMajor ? primaryRadius : secondaryRadius,
    primaryIsMajor ? secondaryRadius : primaryRadius,
    center,
    extrusionNormal(plane, reverse),
    normalizedExtrusionDirection(center, primaryIsMajor ? primaryAxisPoint : secondaryAxisPoint),
  )
}

function extrusionEllipticalArcEdge(
  plane: ExtrusionPlane,
  segment: Extract<ExtrusionSegment, { type: "elliptical-arc" }>,
  offset: number,
  reverse: boolean,
) {
  const center = plane.point(segment.center, offset)
  const primaryAxisPoint = plane.point(segment.primaryAxisPoint, offset)
  const secondaryAxisPoint = plane.point(segment.secondaryAxisPoint, offset)
  const parameters = ellipticalArcKernelParameters({
    center,
    end: plane.point(segment.end, offset),
    normal: plane.normal,
    primaryAxisPoint,
    reverse,
    secondaryAxisPoint,
    start: plane.point(segment.start, offset),
  })
  return makeEllipseArc(
    parameters.majorRadius,
    parameters.minorRadius,
    parameters.startParameter,
    parameters.endParameter,
    parameters.center,
    parameters.normal,
    parameters.xDirection,
  )
}

function extrusionOpenCurveEdge(
  plane: ExtrusionPlane,
  segment: Extract<ExtrusionSegment, { type: "arc" | "line" }>,
  offset: number,
  reverse: boolean,
) {
  const start = reverse ? segment.end : segment.start
  const end = reverse ? segment.start : segment.end
  if (segment.type === "line") {
    return makeLine(plane.point(start, offset), plane.point(end, offset))
  }
  return makeThreePointArc(
    plane.point(start, offset),
    plane.point(segment.middle, offset),
    plane.point(end, offset),
  )
}

function extrusionSegmentEdge(
  plane: ExtrusionPlane,
  segment: ExtrusionSegment,
  offset: number,
  reverse: boolean,
) {
  if (segment.type === "circle") {
    return makeCircle(
      segment.radius,
      plane.point(segment.center, offset),
      extrusionNormal(plane, reverse),
    )
  }
  if (segment.type === "ellipse") {
    return extrusionEllipseEdge(plane, segment, offset, reverse)
  }
  if (segment.type === "elliptical-arc") {
    return extrusionEllipticalArcEdge(plane, segment, offset, reverse)
  }
  return extrusionOpenCurveEdge(plane, segment, offset, reverse)
}

function extrusionLoopWire(
  parameters: ExtrusionContentParameters,
  loop: ExtrusionContentParameters["outer"],
  offset: number,
  reverse: boolean,
) {
  const plane = extrusionPlane(parameters)
  const orderedSegments = reverse ? [...loop.segments].reverse() : loop.segments
  const edges = orderedSegments.map((segment) =>
    extrusionSegmentEdge(plane, segment, offset, reverse),
  )
  try {
    return assembleWire(edges)
  } finally {
    for (const edge of edges) edge.delete()
  }
}

function createExtrusionShape(
  opencascade: OpenCascadeInstance,
  parameters: ExtrusionContentParameters,
) {
  const plane = extrusionPlane(parameters)
  const startOffset = parameters.symmetric ? -parameters.distance / 2 : 0
  const outer = extrusionLoopWire(parameters, parameters.outer, startOffset, false)
  const holes: Wire[] = []
  let face: ReturnType<typeof makeFace> | null = null
  const vector = new opencascade.gp_Vec_4(
    plane.normal[0] * parameters.distance,
    plane.normal[1] * parameters.distance,
    plane.normal[2] * parameters.distance,
  )
  try {
    for (const hole of parameters.holes) {
      holes.push(extrusionLoopWire(parameters, hole, startOffset, true))
    }
    face = makeFace(outer, holes)
    const builder = new opencascade.BRepPrimAPI_MakePrism_1(face.wrapped, vector, false, true)
    try {
      return cast(builder.Shape()).asShape3D()
    } finally {
      builder.delete()
    }
  } finally {
    vector.delete()
    face?.delete()
    for (const hole of holes) hole.delete()
    outer.delete()
  }
}

function captureFeatureTopology(shape: Shape3D, feature: ParsedFeature) {
  if (feature.kind === "boolean") return captureReplicadTopologyCandidates(shape)
  return captureReplicadTopologyCandidates(shape, {
    semanticRole: (context) =>
      feature.kind === "box"
        ? boxFeatureSemanticRole(context, feature.parameters)
        : feature.kind === "cylinder"
          ? cylinderFeatureSemanticRole(context, feature.parameters)
          : extrusionFeatureSemanticRole(context, feature.parameters),
  })
}

function evaluateFeatureGeometry(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  feature: ParsedFeature,
) {
  const startedAt = performance.now()
  const metrics = measureShape(opencascade, shape)
  if (!metrics.valid || metrics.solidCount !== 1 || metrics.volume <= 0) {
    throw new Error("Feature evaluation did not produce one valid positive-volume solid.")
  }
  return {
    metrics,
    topologyCandidates: captureFeatureTopology(shape, feature),
    evaluationMs: elapsed(startedAt),
  }
}

function tessellateFeatureGeometry(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  meshPolicy: FeatureEvaluationInput["mesh"],
) {
  const startedAt = performance.now()
  const mesh = tessellate(opencascade, shape, {
    meshTolerance: meshPolicy.chordTolerance,
    angularTolerance: meshPolicy.angularTolerance,
  })
  return { mesh, tessellationMs: elapsed(startedAt) }
}

function disposeFeatureShape(shape: Shape3D | null) {
  if (!shape) return true
  try {
    shape.delete()
    return true
  } catch {
    return false
  }
}

type FeatureShapeSource =
  | { ok: true; brepHit: true; shape: Shape3D }
  | { ok: true; brepHit: false; dependencies: Shape3D[] }
  | Extract<FeatureEvaluationResult, { ok: false }>

function resolveFeatureShapeSource(
  registry: DocumentFeatureShapeRegistry<Shape3D>,
  input: FeatureEvaluationInput,
): FeatureShapeSource {
  const cached = registry.get(input.documentId, input.featureId, input.contentHash)
  if (cached) return { ok: true, shape: cached, brepHit: true }

  const dependencies = registry.resolve(input.documentId, input.dependencies)
  if (!dependencies) {
    return featureFailure(
      "missing-feature-dependency",
      "One or more exact feature dependency shapes are unavailable.",
    )
  }

  return { ok: true, dependencies, brepHit: false }
}

interface TopologyHolePosition {
  role: "negative" | "center" | "positive"
  origin: [number, number, number]
}

function createTopologyHolePositions(parameters: TopologySpikeParameters): TopologyHolePosition[] {
  const [centerX, centerY] = parameters.holeCenter
  const z = -5
  if (parameters.holeCount === 0) return []
  if (parameters.holeCount === 1) return [{ role: "center", origin: [centerX, centerY, z] }]
  const positions: TopologyHolePosition[] = [
    { role: "negative", origin: [centerX - parameters.holeSpacing, centerY, z] },
    { role: "positive", origin: [centerX + parameters.holeSpacing, centerY, z] },
  ]
  return parameters.holeCount === 3
    ? [...positions, { role: "center", origin: [centerX, centerY, z] }]
    : positions
}

function outerFilletSemanticRole(direction: readonly number[]) {
  const [normalX, normalY] = direction
  return firstMatchingRole([
    [(normalX as number) < -0.5, "top-fillet.surface.x-min"],
    [(normalX as number) > 0.5, "top-fillet.surface.x-max"],
    [(normalY as number) < -0.5, "top-fillet.surface.y-min"],
    [(normalY as number) > 0.5, "top-fillet.surface.y-max"],
  ])
}

function topologySpikeSemanticRole(
  context: TopologyCandidateContext,
  parameters: TopologySpikeParameters,
  holes: TopologyHolePosition[],
) {
  if (context.kind !== "face") return undefined
  if (context.signature.geometryClass === "PLANE") {
    return planeSemanticRole(context, parameters)
  }
  if (context.signature.geometryClass !== "CYLINDRE" || !context.signature.direction) {
    return undefined
  }
  const [x, y] = context.signature.centroid
  const [, , normalZ] = context.signature.direction
  const hole = holes.find(({ origin }) => nearlyEqual(x, origin[0]) && nearlyEqual(y, origin[1]))
  if (hole && Math.abs(normalZ) < 1e-6) {
    return `pattern.hole.${hole.role}.wall`
  }
  return outerFilletSemanticRole(context.signature.direction)
}

function outputLineageToken(semanticRole: string) {
  return `output:${semanticRole}`
}

function createOutputLineage(
  snapshot: TopologyCaptureSnapshot,
  semanticRole: (context: TopologyCandidateContext) => string | undefined,
) {
  const lineage = new Map<number, string[]>()
  for (const candidate of snapshot.candidates) {
    const role = semanticRole(candidate)
    const shapeKey = snapshot.transientShapeKeys.get(candidate.candidateId)
    if (role && shapeKey !== undefined) lineage.set(shapeKey, [outputLineageToken(role)])
  }
  return lineage
}

function mergeOutputLineage(...sources: Array<ReadonlyMap<number, readonly string[]>>) {
  const merged = new Map<number, string[]>()
  for (const source of sources) {
    for (const [shapeKey, tokens] of source) {
      merged.set(shapeKey, [...new Set([...(merged.get(shapeKey) ?? []), ...tokens])].sort())
    }
  }
  return merged
}

function annotateTopologySnapshot(
  snapshot: TopologyCaptureSnapshot,
  lineage: ReadonlyMap<number, readonly string[]>,
  semanticRole: (context: TopologyCandidateContext) => string | undefined,
): TopologyCandidate[] {
  return snapshot.candidates.map((candidate) => {
    const shapeKey = snapshot.transientShapeKeys.get(candidate.candidateId)
    const role = semanticRole(candidate)
    return {
      ...candidate,
      lineageTokens: shapeKey === undefined ? [] : [...(lineage.get(shapeKey) ?? [])],
      ...(role ? { semanticRole: role } : {}),
    }
  })
}

function kernelFixtureSemanticRole(
  context: TopologyCandidateContext,
  parameters: KernelSpikeParameters,
) {
  if (context.kind !== "face") return undefined
  if (context.signature.geometryClass === "CYLINDRE") {
    return cylinderSemanticRole(context, parameters)
  }
  if (context.signature.geometryClass === "PLANE") {
    return planeSemanticRole(context, parameters)
  }
  return undefined
}

export interface GeometryKernelEngine {
  initialize(): Promise<GeometryEngineMetadata>
  isInitialized(): boolean
  getFeatureContentEnvironment(): FeatureContentEnvironment | null
  evaluateFeature(
    input: FeatureEvaluationInput,
    reportProgress: ProgressReporter,
  ): Promise<FeatureEvaluationResult>
  exportDocument(input: DocumentGeometryExportInput): Promise<DocumentGeometryExportResult>
  exportPrintMeshes(input: DocumentPrintMeshExportInput): Promise<DocumentPrintMeshExportResult>
  runKernelSpike(
    parameters: KernelSpikeParameters,
    reportProgress: ProgressReporter,
  ): Promise<KernelSpikeEngineResult>
  runTopologySpike(parameters: TopologySpikeParameters): Promise<TopologySpikeEngineResult>
  getHealth(): {
    initialized: boolean
    ownedShapeCount: number
    wasmHeapBytes: number
  }
  synchronizeDocumentFeatures(
    documentId: string,
    retainedFeatures: readonly { featureId: string; contentHash: string }[],
  ): number
  disposeDocument(documentId: string): number
}

export class ReplicadGeometryEngine implements GeometryKernelEngine {
  readonly #ownedShapes = new OwnedShapeRegistry()
  readonly #featureShapes = new DocumentFeatureShapeRegistry<Shape3D>()
  #metadata: GeometryEngineMetadata | null = null
  #opencascade: OpenCascadeModule | null = null
  #initialization: Promise<GeometryEngineMetadata> | null = null

  isInitialized() {
    return this.#metadata !== null && this.#opencascade !== null
  }

  getFeatureContentEnvironment() {
    return this.#metadata?.featureContentEnvironment ?? null
  }

  async initialize() {
    if (this.#metadata) {
      return this.#metadata
    }

    this.#initialization ??= this.#initializeOnce()

    try {
      return await this.#initialization
    } catch (error) {
      this.#initialization = null
      throw error
    }
  }

  async #initializeOnce() {
    const startedAt = performance.now()
    const wasmResponse = await fetch(opencascadeWasmUrl)

    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch OpenCascade WASM: HTTP ${wasmResponse.status}.`)
    }

    const wasmBinary = new Uint8Array(await wasmResponse.arrayBuffer())
    const opencascade: OpenCascadeModule = await initializeOpenCascadeWithOptions({
      locateFile: () => opencascadeWasmUrl,
      wasmBinary,
    })

    setOC(opencascade)
    this.#opencascade = opencascade
    this.#metadata = {
      adapter: "replicad",
      adapterVersion: GEOMETRY_ADAPTER_VERSION,
      replicadVersion: REPLICAD_VERSION,
      opencascadePackageVersion: REPLICAD_OPENCASCADE_VERSION,
      opencascadeSourceRevision: OPENCASCADE_SOURCE_REVISION,
      wasmBytes: wasmBinary.byteLength,
      initializedInMs: elapsed(startedAt),
      featureContentEnvironment: createFeatureContentEnvironment(),
    }

    return this.#metadata
  }

  getHealth() {
    return {
      initialized: this.isInitialized(),
      ownedShapeCount: this.#ownedShapes.size + this.#featureShapes.size,
      wasmHeapBytes: getWasmHeapBytes(this.#opencascade),
    }
  }

  disposeDocument(documentId: string) {
    this.#ownedShapes.disposeAll()
    return this.#featureShapes.disposeDocument(documentId)
  }

  synchronizeDocumentFeatures(
    documentId: string,
    retainedFeatures: readonly { featureId: string; contentHash: string }[],
  ) {
    return this.#featureShapes.synchronize(documentId, retainedFeatures)
  }

  async evaluateFeature(
    input: FeatureEvaluationInput,
    reportProgress: ProgressReporter,
  ): Promise<FeatureEvaluationResult> {
    const engine = await this.initialize()
    const opencascade = this.#opencascade
    if (!opencascade) {
      return featureFailure("invalid-feature-geometry", "OpenCascade did not initialize.")
    }

    reportProgress("feature-validation", 0.1)
    const parsed = parseFeature(input)
    if (!parsed.ok) return parsed

    const totalStartedAt = performance.now()
    const source = resolveFeatureShapeSource(this.#featureShapes, input)
    if (!source.ok) return source
    let temporaryShape: Shape3D | null = null

    try {
      reportProgress("feature-evaluation", 0.35)
      const shape = source.brepHit
        ? source.shape
        : createFeatureShape(opencascade, parsed.feature, source.dependencies)
      if (!source.brepHit) temporaryShape = shape
      const evaluation = evaluateFeatureGeometry(opencascade, shape, parsed.feature)

      reportProgress("feature-tessellation", 0.7)
      const tessellation = tessellateFeatureGeometry(opencascade, shape, input.mesh)

      if (temporaryShape) {
        this.#featureShapes.replace(
          input.documentId,
          input.featureId,
          input.contentHash,
          temporaryShape,
        )
        temporaryShape = null
      }

      reportProgress("complete", 1)
      return {
        ok: true,
        result: {
          engine,
          shape: evaluation.metrics,
          topologyCandidates: evaluation.topologyCandidates,
          mesh: tessellation.mesh,
          cache: { brepHit: source.brepHit },
          timings: {
            evaluationMs: evaluation.evaluationMs,
            tessellationMs: tessellation.tessellationMs,
            totalMs: elapsed(totalStartedAt),
          },
        },
      }
    } catch {
      const cleanupSucceeded = disposeFeatureShape(temporaryShape)
      return featureFailure(
        "invalid-feature-geometry",
        cleanupSucceeded
          ? "Feature geometry evaluation failed."
          : "Feature geometry evaluation failed and temporary shape cleanup did not complete.",
      )
    }
  }

  async exportDocument(input: DocumentGeometryExportInput): Promise<DocumentGeometryExportResult> {
    const opencascade = this.#opencascade
    if (!opencascade) throw new Error("OpenCascade did not initialize.")
    if (input.features.length === 0) throw new Error("No exportable feature bodies were provided.")

    const sourceShapes = this.#featureShapes.resolve(input.documentId, input.features)
    if (!sourceShapes) {
      throw new Error("One or more exact feature bodies are unavailable for export.")
    }

    const compound = sourceShapes.length > 1 ? createOcctCompound(opencascade, sourceShapes) : null
    const exportShape = compound ?? sourceShapes[0]
    if (!exportShape) throw new Error("No exportable feature body was resolved.")

    try {
      const file =
        input.format === "step"
          ? exportOcctStep(opencascade, exportShape.wrapped)
          : new Uint8Array(await exportMeshedOcctStl(opencascade, exportShape, true).arrayBuffer())
      return { file, bodyCount: sourceShapes.length }
    } finally {
      compound?.delete()
    }
  }

  async exportPrintMeshes(
    input: DocumentPrintMeshExportInput,
  ): Promise<DocumentPrintMeshExportResult> {
    const opencascade = this.#opencascade
    if (!opencascade) throw new Error("OpenCascade did not initialize.")
    if (input.features.length === 0) throw new Error("No exportable feature bodies were provided.")
    const sourceShapes = this.#featureShapes.resolve(input.documentId, input.features)
    if (!sourceShapes)
      throw new Error("One or more exact feature bodies are unavailable for export.")
    return {
      meshes: sourceShapes.map((shape, index) => {
        try {
          const mesh = meshOcctShape(opencascade, shape, {
            tolerance: PRINT_MESH_CHORD_TOLERANCE_MM,
            angularTolerance: PRINT_MESH_ANGULAR_TOLERANCE_RAD,
          })
          return {
            featureId: input.features[index]?.featureId ?? "unknown-feature",
            vertices: mesh.vertices,
            triangles: mesh.triangles,
          }
        } finally {
          opencascade.BRepTools.Clean(shape.wrapped, true)
        }
      }),
    }
  }

  async runKernelSpike(parameters: KernelSpikeParameters, reportProgress: ProgressReporter) {
    const engine = await this.initialize()
    const opencascade = this.#opencascade

    if (!opencascade) {
      throw new Error("OpenCascade did not initialize.")
    }

    const totalStartedAt = performance.now()
    let finalShape: Shape3D | null = null
    let importedShape: Shape3D | null = null
    const memoryProfile = createMemoryProfile(opencascade)
    memoryProfile.capture("initialized")

    try {
      reportProgress("creating-primitives", 0.1)
      let stageStartedAt = performance.now()
      const [, , boxHeight] = parameters.boxSize
      const box = this.#ownedShapes.own(createOcctBox(opencascade, parameters.boxSize))
      const cylinder = this.#ownedShapes.own(
        createOcctCylinder(
          opencascade,
          parameters.cylinderRadius,
          parameters.cylinderHeight,
          parameters.cylinderOrigin,
        ),
      )
      const createPrimitivesMs = elapsed(stageStartedAt)
      memoryProfile.capture("primitives-created")

      reportProgress("boolean-cut", 0.2)
      stageStartedAt = performance.now()
      const booleanCut = cutOcctShapesWithHistory(opencascade, box, cylinder)
      const cutShape = this.#ownedShapes.own(booleanCut.shape)
      this.#ownedShapes.dispose(box)
      this.#ownedShapes.dispose(cylinder)
      const booleanCutMs = elapsed(stageStartedAt)
      memoryProfile.capture("boolean-completed")

      reportProgress("fillet", 0.3)
      stageStartedAt = performance.now()
      const fillet = filletOcctEdgesAtZWithHistory(
        opencascade,
        cutShape,
        parameters.filletRadius,
        boxHeight,
      )
      finalShape = this.#ownedShapes.own(fillet.shape)
      this.#ownedShapes.dispose(cutShape)
      const filletMs = elapsed(stageStartedAt)
      memoryProfile.capture("fillet-completed")

      const topologyCandidates = captureReplicadTopologyCandidates(finalShape, {
        semanticRole: (context) => kernelFixtureSemanticRole(context, parameters),
      })

      reportProgress("validation", 0.4)
      stageStartedAt = performance.now()
      const shape = measureShape(opencascade, finalShape)
      const validationMs = elapsed(stageStartedAt)
      memoryProfile.capture("validation-completed")

      if (!shape.valid || shape.solidCount !== 1 || shape.volume <= 0) {
        throw new Error("The kernel result is not one valid positive-volume solid.")
      }

      reportProgress("tessellation", 0.5)
      stageStartedAt = performance.now()
      const mesh = tessellate(opencascade, finalShape, parameters)
      const tessellationMs = elapsed(stageStartedAt)
      memoryProfile.capture("tessellation-completed")

      reportProgress("step-export", 0.6)
      stageStartedAt = performance.now()
      const stepBytes = exportOcctStep(opencascade, finalShape.wrapped)
      const stepExportMs = elapsed(stageStartedAt)
      memoryProfile.capture("step-exported")

      reportProgress("step-import", 0.7)
      stageStartedAt = performance.now()
      importedShape = this.#ownedShapes.own(importOcctStep(opencascade, stepBytes))
      const importedShapeMetrics = measureShape(opencascade, importedShape)
      const stepImportMs = elapsed(stageStartedAt)
      memoryProfile.capture("step-imported")

      reportProgress("stl-export", 0.8)
      stageStartedAt = performance.now()
      const stlBlob = exportMeshedOcctStl(opencascade, finalShape, true)
      const stlBytes = (await stlBlob.arrayBuffer()).byteLength
      const stlExportMs = elapsed(stageStartedAt)
      memoryProfile.capture("stl-exported")

      reportProgress("lifecycle-check", 0.9)
      stageStartedAt = performance.now()
      const lifecycle = this.#runLifecycleCheck(parameters)
      const lifecycleCheckMs = elapsed(stageStartedAt)
      memoryProfile.capture("lifecycle-completed")

      reportProgress("complete", 1)

      return {
        engine,
        shape,
        history: {
          booleanCut: booleanCut.history,
          fillet: fillet.history,
        },
        topologyCandidates,
        mesh,
        exchange: {
          stepBytes: stepBytes.byteLength,
          stepFile: stepBytes,
          stlBytes,
          importedShape: importedShapeMetrics,
          relativeVolumeError: relativeError(shape.volume, importedShapeMetrics.volume),
        },
        lifecycle,
        memory: memoryProfile.memory,
        timings: {
          createPrimitivesMs,
          booleanCutMs,
          filletMs,
          validationMs,
          tessellationMs,
          stepExportMs,
          stepImportMs,
          stlExportMs,
          lifecycleCheckMs,
          totalMs: elapsed(totalStartedAt),
        },
      }
    } finally {
      this.#ownedShapes.disposeAll()
      memoryProfile.capture("shapes-disposed")
    }
  }

  async runTopologySpike(parameters: TopologySpikeParameters) {
    const engine = await this.initialize()
    const opencascade = this.#opencascade
    if (!opencascade) {
      throw new Error("OpenCascade did not initialize.")
    }

    const holes = createTopologyHolePositions(parameters)
    let currentShape = this.#ownedShapes.own(createOcctBox(opencascade, parameters.boxSize))
    let currentLineage = createOutputLineage(
      captureReplicadTopologySnapshot(currentShape),
      (context) => planeSemanticRole(context, parameters),
    )
    try {
      for (const hole of holes) {
        const tool = this.#ownedShapes.own(
          createOcctCylinder(
            opencascade,
            parameters.holeRadius,
            parameters.boxSize[2] + 10,
            hole.origin,
          ),
        )
        const toolLineage = createOutputLineage(captureReplicadTopologySnapshot(tool), (context) =>
          context.kind === "face" && context.signature.geometryClass === "CYLINDRE"
            ? `pattern.hole.${hole.role}.wall`
            : undefined,
        )
        const cut = cutOcctShapesWithLineage(
          opencascade,
          currentShape,
          tool,
          mergeOutputLineage(currentLineage, toolLineage),
        )
        const cutShape = this.#ownedShapes.own(cut.shape)
        this.#ownedShapes.dispose(tool)
        this.#ownedShapes.dispose(currentShape)
        currentShape = cutShape
        currentLineage = cut.lineage
      }

      if (parameters.filletRadius !== null) {
        const fillet = filletOcctEdgesAtZWithLineage(
          opencascade,
          currentShape,
          parameters.filletRadius,
          parameters.boxSize[2],
          currentLineage,
        )
        const filleted = this.#ownedShapes.own(fillet.shape)
        this.#ownedShapes.dispose(currentShape)
        currentShape = filleted
        currentLineage = fillet.lineage
      }

      const shape = measureShape(opencascade, currentShape)
      if (!shape.valid || shape.solidCount !== 1 || shape.volume <= 0) {
        throw new Error("The topology spike result is not one valid positive-volume solid.")
      }
      const topologyCandidates = annotateTopologySnapshot(
        captureReplicadTopologySnapshot(currentShape),
        currentLineage,
        (context) => topologySpikeSemanticRole(context, parameters, holes),
      )
      return { engine, shape, topologyCandidates }
    } finally {
      this.#ownedShapes.disposeAll()
    }
  }

  #runLifecycleCheck(parameters: KernelSpikeParameters) {
    const opencascade = this.#opencascade

    if (!opencascade) {
      throw new Error("OpenCascade did not initialize.")
    }

    const ownedShapesBefore = this.#ownedShapes.size
    const wasmHeapBytesBefore = getWasmHeapBytes(opencascade)

    for (let iteration = 0; iteration < parameters.lifecycleIterations; iteration += 1) {
      runLifecycleIteration(this.#ownedShapes, opencascade, parameters)
    }

    const ownedShapesAfter = this.#ownedShapes.size
    const releasedBlocks = parameters.purgeAfterLifecycle ? purgeOcctAllocator(opencascade) : 0
    const wasmHeapBytesAfter = getWasmHeapBytes(opencascade)

    if (ownedShapesAfter !== ownedShapesBefore) {
      throw new Error("Owned shape count changed during the lifecycle check.")
    }

    return {
      operation: parameters.lifecycleOperation,
      iterations: parameters.lifecycleIterations,
      ownedShapesBefore,
      ownedShapesAfter,
      wasmHeapBytesBefore,
      wasmHeapBytesAfter,
      wasmHeapGrowthBytes: wasmHeapBytesAfter - wasmHeapBytesBefore,
      allocatorPurge: {
        requested: parameters.purgeAfterLifecycle,
        releasedBlocks,
      },
    }
  }
}
