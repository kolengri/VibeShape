import {
  booleanFeatureContentParametersSchema,
  boxFeatureContentParametersSchema,
  type CompoundFeatureContentParameters,
  chamferFeatureContentParametersSchema,
  compoundFeatureContentParametersSchema,
  coneFeatureContentParametersSchema,
  cylinderFeatureContentParametersSchema,
  DEFAULT_SURFACE_TEXTURE_QUALITY,
  datumPlaneFeatureContentParametersSchema,
  extrusionExtentBounds,
  extrusionFeatureContentParametersSchema,
  extrusionFeatureContentParametersV5Schema,
  extrusionMultiProfileFeatureContentParametersSchema,
  extrusionMultiProfileModifyingFeatureContentParametersSchema,
  type FeatureContentEnvironment,
  type FeatureEvaluationDependency,
  type FeatureEvaluationEngineResult,
  featureContentEnvironmentSchema,
  featureEvaluationInputSchema,
  filletFeatureContentParametersSchema,
  type GeometryEngineMetadata,
  type GeometryExportFormat,
  type GeometryProgressStage,
  type GeometryWorkerRequest,
  type HoleFeatureContentParameters,
  holeFeatureContentParametersSchema,
  type ImportedFeatureContentParameters,
  type InspectSourceImportInput,
  importedFeatureContentParametersSchema,
  importedSourceMaterializationSchema,
  inspectSourceImportInputSchema,
  type KernelSpikeEngineResult,
  type KernelSpikeParameters,
  type LoftFeatureContentParameters,
  type LoftFeatureContentParametersV2,
  type LoftFeatureContentParametersV3,
  loftFeatureContentParametersSchema,
  loftFeatureContentParametersV2Schema,
  loftFeatureContentParametersV3Schema,
  type MirrorFeatureContentParameters,
  type MirrorFeatureContentParametersV2,
  mirrorFeatureContentParametersSchema,
  mirrorFeatureContentParametersV2Schema,
  type PatternFeatureContentParameters,
  type PlacementFeatureContentParameters,
  patternContentOutputRoles,
  patternFeatureContentParametersSchema,
  placementFeatureContentParametersSchema,
  pyramidFeatureContentParametersSchema,
  revolveFeatureContentParametersSchema,
  revolveMultiProfileFeatureContentParametersSchema,
  revolveMultiProfileModifyingFeatureContentParametersSchema,
  type ShellFeatureContentParameters,
  type SourceAssetMaterialization,
  type SourceImportInspection,
  SPLIT_OUTPUT_ROLES,
  type SplitFeatureContentParameters,
  type SurfaceTextureExportLayers,
  type SurfaceTextureMeshLayer,
  type SurfaceTextureQuality,
  type SweepFeatureContentParameters,
  shellFeatureContentParametersSchema,
  shellFeatureContentParametersV2Schema,
  sourceImportInspectionSchema,
  sphereFeatureContentParametersSchema,
  splitFeatureContentParametersSchema,
  sweepFeatureContentParametersSchema,
  type ThreadContentParameters,
  type TopologyCandidate,
  type TopologySpikeEngineResult,
  type TopologySpikeParameters,
  threadContentParametersSchema,
  torusFeatureContentParametersSchema,
  unionFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import { isAnyObject } from "is-what"
import type { Face } from "replicad"
import {
  assembleWire,
  cast,
  makeCircle,
  makeEllipse,
  makeEllipseArc,
  makeFace,
  makeLine,
  makePolygon,
  makeThreePointArc,
  measureShapeSurfaceProperties,
  type Shape3D,
  type ShapeMesh,
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
  disposeTemporaryShape,
  featureResultMetricsAreValid,
  featureSolidCountLimit,
} from "./feature-result-validation"
import {
  createMemoryProfile,
  getWasmHeapBytes,
  type OpenCascadeMemoryModule,
} from "./memory-profile"
import { exportOcctAssemblyStep } from "./occt-assembly-export"
import {
  createOcctBodyCompound,
  createOcctBodyUnion,
  disposeBodyCombination,
  type OwnedBodyCombination,
} from "./occt-body-combination"
import { takeResolvedBodyFace } from "./occt-body-face"
import { createOcctCompound } from "./occt-compound"
import { makeOcctCubicBezierEdge } from "./occt-cubic-bezier"
import { purgeOcctAllocator, runNativeOcctLifecycleCycle } from "./occt-diagnostics"
import { treatAllOcctEdges, treatSelectedOcctEdges } from "./occt-edge-treatment"
import { exportOcctStep, importOcctStep } from "./occt-exchange"
import { measureOcctInterference } from "./occt-interference"
import { createOcctLoft } from "./occt-loft"
import { createOcctLoftPatchNetwork, type LoftEndSupport } from "./occt-loft-filling"
import { exportMeshedOcctStl, meshOcctShape } from "./occt-mesh"
import { mirrorOcctShape } from "./occt-mirror"
import { patternOcctShape } from "./occt-pattern"
import { placeOcctShape } from "./occt-placement"
import { splitOcctShape } from "./occt-plane-split"
import {
  createOcctBox,
  createOcctCone,
  createOcctCylinder,
  createOcctPyramid,
  createOcctSphere,
  createOcctTorus,
  cutOcctShapes,
  cutOcctShapesWithHistory,
  cutOcctShapesWithLineage,
  filletOcctEdgesAtZWithHistory,
  filletOcctEdgesAtZWithLineage,
  fuseOcctShapes,
  intersectOcctShapes,
} from "./occt-shapes"
import { shellOcctShape } from "./occt-shell"
import { inspectOcctSourceImport, rebuildOcctSourceImport } from "./occt-source-import"
import { createOcctSweep } from "./occt-sweep"
import { threadOcctShape } from "./occt-thread"
import { revolveProfileCrossesAxis } from "./revolve-profile"
import { resolveSelectedEdgeKeys } from "./selected-edge-resolver"
import { DocumentFeatureShapeRegistry, OwnedShapeRegistry } from "./shape-registry"
import { encodeSurfaceTextureStl, SurfaceTextureError, textureSurfaceMesh } from "./surface-texture"
import {
  captureReplicadTopologyCandidates,
  captureReplicadTopologySnapshot,
  type TopologyCandidateContext,
  type TopologyCaptureSnapshot,
} from "./topology-signatures"

type ProgressReporter = (stage: GeometryProgressStage, fraction: number) => void
type EvaluateFeatureRequest = Extract<GeometryWorkerRequest, { type: "evaluateFeature" }>
type SelectedEdgeReference = Readonly<
  Omit<FeatureEvaluationInput["content"]["feature"]["references"][number], "kind"> & {
    kind: "edge"
    inputIndex: number
  }
>

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

export type PlanarFaceSectionInput = Readonly<{
  documentId: string
  sourceFeatureId: string
  sourceContentHash: string
  /** Worker-local hash resolved from the current rebuild; never persisted or returned. */
  resolvedFaceKey: number
  reference: Readonly<{
    featureId: string
    kind: "face"
  }>
  planeOrigin: readonly [number, number, number]
  planeNormal: readonly [number, number, number]
}>

export type PlanarFaceSectionResult =
  | Readonly<{
      ok: true
      endpoints: readonly [readonly [number, number, number], readonly [number, number, number]]
    }>
  | Readonly<{
      ok: false
      diagnostic: Readonly<{
        code:
          | "missing-body"
          | "missing-face"
          | "non-planar-face"
          | "invalid-plane"
          | "parallel-plane"
          | "coplanar-plane"
          | "disjoint-plane"
          | "multiple-edges"
          | "non-linear-edge"
          | "zero-length"
        message: string
      }>
    }>

export type DocumentGeometryExportInput = Readonly<{
  documentId: string
  features: readonly FeatureEvaluationDependency[]
  format: Exclude<GeometryExportFormat, "3mf">
  surfaceTextures?: SurfaceTextureExportLayers
  textureQuality?: SurfaceTextureQuality
}>

export type DocumentGeometryExportResult = Readonly<{
  file: Uint8Array
  bodyCount: number
}>

export type DocumentPrintMeshExportInput = Readonly<{
  documentId: string
  features: readonly FeatureEvaluationDependency[]
  surfaceTextures?: SurfaceTextureExportLayers
  textureQuality?: SurfaceTextureQuality
}>

export type DocumentPrintMeshExportResult = Readonly<{
  meshes: readonly Readonly<{
    featureId: string
    outputRole?: string
    vertices: readonly number[]
    triangles: readonly number[]
  }>[]
}>

type OpenCascadeModule = OpenCascadeInstance & OpenCascadeMemoryModule

const MAX_FEATURE_WORKSPACE_LENGTH_MM = 100_000
const LOFT_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.loft#1"
const SWEEP_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.sweep#1"
const PATTERN_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.pattern#1"
const SPLIT_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.split#1"
const IMPORTED_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.imported#1"
const THREAD_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.thread#1"
const SHELL_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.shell#1"
const SHELL_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.shell#2"
const MIRROR_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.mirror#1"
const MIRROR_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.mirror#2"
const PLACEMENT_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.placement#1"
const COMPOUND_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.compound#1"
const UNION_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.union#1"
const COMPOUND_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.compound#2"
const UNION_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.union#2"
const PRINT_MESH_CHORD_TOLERANCE_MM = 0.02
const PRINT_MESH_ANGULAR_TOLERANCE_RAD = 0.1
const BOX_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.box#1"
const CYLINDER_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.cylinder#1"
const SPHERE_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.sphere#1"
const CONE_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.cone#1"
const PYRAMID_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.pyramid#1"
const TORUS_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.torus#1"
const BOOLEAN_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.boolean#1"
const FILLET_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.fillet#1"
const CHAMFER_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.chamfer#1"
const FILLET_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.fillet#2"
const CHAMFER_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.chamfer#2"
const EXTRUSION_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#1"
const EXTRUSION_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#2"
const EXTRUSION_FEATURE_TYPE_V3_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#3"
const EXTRUSION_FEATURE_TYPE_V4_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#4"
const EXTRUSION_FEATURE_TYPE_V5_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.extrusion#5"
const REVOLVE_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#1"
const REVOLVE_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#2"
const REVOLVE_FEATURE_TYPE_V3_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#3"
const REVOLVE_FEATURE_TYPE_V4_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#4"
const REVOLVE_FEATURE_TYPE_V5_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#5"
const REVOLVE_FEATURE_TYPE_V6_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.revolve#6"
const DATUM_PLANE_FEATURE_TYPE_KEY =
  "org.vibeshape.core.reference-geometry@0.1.0:org.vibeshape.feature.reference-geometry.datum-plane#1"
const HOLE_FEATURE_TYPE_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.hole#1"
const HOLE_FEATURE_TYPE_V2_KEY =
  "org.vibeshape.core.part-design@0.1.0:org.vibeshape.feature.part-design.hole#2"

function featureTypeKey(type: EvaluateFeatureRequest["content"]["feature"]["type"]) {
  return `${type.moduleId}@${type.moduleVersion}:${type.typeId}#${type.schemaVersion}`
}

const SECTION_TOLERANCE_MM = 1e-7

function sectionFailure(
  code: Exclude<PlanarFaceSectionResult, { ok: true }>["diagnostic"]["code"],
  message: string,
): PlanarFaceSectionResult {
  return { ok: false, diagnostic: { code, message } }
}

type SectionNormal = readonly [number, number, number]

function normalizedSectionNormal(input: PlanarFaceSectionInput): SectionNormal | null {
  const length = Math.hypot(...input.planeNormal)
  if (
    !Number.isFinite(length) ||
    length <= Number.EPSILON ||
    input.planeOrigin.some((value) => !Number.isFinite(value))
  ) {
    return null
  }
  return input.planeNormal.map((value) => value / length) as [number, number, number]
}

function takeResolvedFace(shape: Shape3D, resolvedFaceKey: number) {
  const faces = shape.faces
  const resolved = faces.find((candidate) => candidate.hashCode === resolvedFaceKey)
  for (const candidate of faces) {
    if (candidate !== resolved) candidate.delete()
  }
  return resolved
}

function readFaceNormal(face: ReturnType<typeof takeResolvedFace>): SectionNormal {
  if (!face) throw new Error("Cannot read the normal of a missing face.")
  const vector = face.normalAt()
  try {
    return vector.toTuple()
  } finally {
    vector.delete()
  }
}

function parallelFaceFailure(
  face: NonNullable<ReturnType<typeof takeResolvedFace>>,
  targetNormal: SectionNormal,
  planeOrigin: PlanarFaceSectionInput["planeOrigin"],
): PlanarFaceSectionResult | null {
  const faceNormal = readFaceNormal(face)
  const alignment = Math.abs(
    faceNormal[0] * targetNormal[0] +
      faceNormal[1] * targetNormal[1] +
      faceNormal[2] * targetNormal[2],
  )
  if (Math.abs(alignment - 1) > 1e-6) return null

  const properties = measureShapeSurfaceProperties(face)
  let centroid: readonly [number, number, number]
  try {
    centroid = properties.centerOfMass
  } finally {
    properties.delete()
  }
  const distance = Math.abs(
    (centroid[0] - planeOrigin[0]) * targetNormal[0] +
      (centroid[1] - planeOrigin[1]) * targetNormal[1] +
      (centroid[2] - planeOrigin[2]) * targetNormal[2],
  )
  const coplanar = distance <= SECTION_TOLERANCE_MM
  return sectionFailure(
    coplanar ? "coplanar-plane" : "parallel-plane",
    coplanar
      ? "The target plane is coplanar with the face."
      : "The target plane is parallel to the face.",
  )
}

function collectSectionEdges(
  opencascade: OpenCascadeModule,
  section: InstanceType<OpenCascadeModule["BRepAlgoAPI_Section_5"]>,
) {
  const edgeType = opencascade.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum
  const shapeType = opencascade.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
  const resultShape = section.Shape()
  const explorer = new opencascade.TopExp_Explorer_2(resultShape, edgeType, shapeType)
  const edges: ReturnType<typeof opencascade.TopoDS.Edge_1>[] = []
  try {
    while (explorer.More()) {
      const rawEdge = explorer.Current()
      try {
        edges.push(opencascade.TopoDS.Edge_1(rawEdge))
      } finally {
        rawEdge.delete()
      }
      explorer.Next()
    }
    return edges
  } finally {
    explorer.delete()
    resultShape.delete()
  }
}

function readLinearSectionEndpoints(
  opencascade: OpenCascadeModule,
  edge: ReturnType<typeof opencascade.TopoDS.Edge_1>,
): PlanarFaceSectionResult {
  const adaptor = new opencascade.BRepAdaptor_Curve_2(edge)
  try {
    if (adaptor.GetType() !== opencascade.GeomAbs_CurveType.GeomAbs_Line) {
      return sectionFailure("non-linear-edge", "The planar section edge is not linear.")
    }
    const start = adaptor.Value(adaptor.FirstParameter())
    const end = adaptor.Value(adaptor.LastParameter())
    try {
      const endpoints = [
        [start.X(), start.Y(), start.Z()],
        [end.X(), end.Y(), end.Z()],
      ] as const
      const length = Math.hypot(
        endpoints[1][0] - endpoints[0][0],
        endpoints[1][1] - endpoints[0][1],
        endpoints[1][2] - endpoints[0][2],
      )
      return length <= SECTION_TOLERANCE_MM
        ? sectionFailure("zero-length", "The planar section edge has zero length.")
        : { ok: true, endpoints }
    } finally {
      start.delete()
      end.delete()
    }
  } finally {
    adaptor.delete()
  }
}

function sectionEdgesResult(
  opencascade: OpenCascadeModule,
  edges: readonly ReturnType<typeof opencascade.TopoDS.Edge_1>[],
): PlanarFaceSectionResult {
  if (edges.length === 0) {
    return sectionFailure("disjoint-plane", "The target plane does not intersect the face.")
  }
  if (edges.length !== 1) {
    return sectionFailure("multiple-edges", "The planar section produced multiple edges.")
  }
  const edge = edges[0]
  return edge
    ? readLinearSectionEndpoints(opencascade, edge)
    : sectionFailure("multiple-edges", "The planar section produced no usable edge.")
}

function sectionPlanarFace(
  opencascade: OpenCascadeModule,
  shape: Shape3D,
  input: PlanarFaceSectionInput,
): PlanarFaceSectionResult {
  if (input.reference.featureId !== input.sourceFeatureId) {
    return sectionFailure("missing-face", "The planar-face reference belongs to another feature.")
  }
  const targetNormal = normalizedSectionNormal(input)
  if (!targetNormal) {
    return sectionFailure("invalid-plane", "The target plane has an invalid origin or normal.")
  }

  const face = takeResolvedFace(shape, input.resolvedFaceKey)
  if (!face) return sectionFailure("missing-face", "The resolved planar face is unavailable.")
  try {
    if (face.geomType !== "PLANE") {
      return sectionFailure("non-planar-face", "The resolved face is not planar.")
    }
    const parallelFailure = parallelFaceFailure(face, targetNormal, input.planeOrigin)
    if (parallelFailure) return parallelFailure

    const point = new opencascade.gp_Pnt_3(...input.planeOrigin)
    const direction = new opencascade.gp_Dir_4(...targetNormal)
    const plane = new opencascade.gp_Pln_3(point, direction)
    const progress = new opencascade.Message_ProgressRange_1()
    const section = new opencascade.BRepAlgoAPI_Section_5(face.wrapped, plane, false)
    try {
      section.Build(progress)
      const edges = collectSectionEdges(opencascade, section)
      try {
        return sectionEdgesResult(opencascade, edges)
      } finally {
        for (const edge of edges) edge.delete()
      }
    } finally {
      section.delete()
      progress.delete()
      plane.delete()
      direction.delete()
      point.delete()
    }
  } finally {
    face.delete()
  }
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

function boxWithinFeatureWorkspace(parameters: BoxContentParameters) {
  const [originX, originY, originZ] = parameters.origin
  const halfWidth = parameters.width / 2
  const halfDepth = parameters.depth / 2
  const minimumZ = parameters.centered ? originZ - parameters.height / 2 : originZ
  const maximumZ = minimumZ + parameters.height

  return withinFeatureWorkspace([
    parameters.width,
    parameters.depth,
    parameters.height,
    Math.abs(originX - halfWidth),
    Math.abs(originX + halfWidth),
    Math.abs(originY - halfDepth),
    Math.abs(originY + halfDepth),
    Math.abs(minimumZ),
    Math.abs(maximumZ),
  ])
}

function cylinderWithinFeatureWorkspace(parameters: CylinderContentParameters) {
  const [originX, originY, originZ] = parameters.origin
  const minimumZ = parameters.centered ? originZ - parameters.height / 2 : originZ
  const maximumZ = minimumZ + parameters.height

  return withinFeatureWorkspace([
    parameters.radius,
    parameters.height,
    Math.abs(originX) + parameters.radius,
    Math.abs(originY) + parameters.radius,
    Math.abs(minimumZ),
    Math.abs(maximumZ),
  ])
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
    // Report analytical extents with shape tolerance, independent of display mesh deflection.
    opencascade.BRepBndLib.AddOptimal(shape.wrapped, boundingBox, false, true)
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
  return tessellationPayload(source)
}

function tessellationPayload(source: ShapeMesh) {
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

function hasEnabledSurfaceTextures(input: DocumentPrintMeshExportInput) {
  return (
    input.surfaceTextures?.some((group) => group.layers.some((layer) => layer.enabled)) ?? false
  )
}

function isTexturedStlExport(input: DocumentGeometryExportInput) {
  return input.format === "stl" && hasEnabledSurfaceTextures(input)
}

function validateTextureExportBodies(input: DocumentPrintMeshExportInput) {
  const selected = new Set(
    input.features.map((feature) => `${feature.featureId}:${feature.outputRole ?? "result"}`),
  )
  for (const group of input.surfaceTextures ?? [])
    if (
      group.layers.some((layer) => layer.enabled) &&
      !selected.has(`${group.featureId}:${group.outputRole}`)
    )
      throw new SurfaceTextureError(
        "surface-texture-invalid-target",
        "A textured body is missing from the selected export. Refresh the body selection before exporting.",
      )
}

function createTextureExportBudget(input: DocumentPrintMeshExportInput) {
  const quality = input.textureQuality ?? DEFAULT_SURFACE_TEXTURE_QUALITY
  const enabled = hasEnabledSurfaceTextures(input)
  let remainingTriangles = quality.maxTriangles
  return {
    currentQuality: (): SurfaceTextureQuality => ({ ...quality, maxTriangles: remainingTriangles }),
    consume: (triangleCount: number) => {
      if (!enabled) return
      remainingTriangles -= triangleCount
      if (remainingTriangles < 0)
        throw new SurfaceTextureError(
          "surface-texture-resource-limit",
          "The combined export exceeds the texture triangle budget. Export fewer bodies or use a coarser mesh.",
        )
    },
  }
}

function exportTextureLayers(
  input: DocumentPrintMeshExportInput,
  feature: FeatureEvaluationDependency,
) {
  return (
    input.surfaceTextures
      ?.filter(
        (group) =>
          group.featureId === feature.featureId &&
          group.outputRole === (feature.outputRole ?? "result"),
      )
      .flatMap((group) => group.layers) ?? []
  )
}

async function texturePrintMesh(
  source: ShapeMesh,
  layers: readonly SurfaceTextureMeshLayer[],
  quality: SurfaceTextureQuality,
) {
  if (!layers.some((layer) => layer.enabled))
    return { vertices: source.vertices, triangles: source.triangles }
  if (quality.maxTriangles < 12)
    throw new SurfaceTextureError(
      "surface-texture-resource-limit",
      "The combined export exceeds the texture triangle budget. Export fewer bodies or use a coarser mesh.",
    )
  const textured = await textureSurfaceMesh(tessellationPayload(source), layers, quality)
  return {
    vertices: Array.from(textured.mesh.positions),
    triangles: Array.from(textured.mesh.indices),
  }
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
type FilletContentParameters = ReturnType<typeof filletFeatureContentParametersSchema.parse>
type ChamferContentParameters = ReturnType<typeof chamferFeatureContentParametersSchema.parse>
type BoxContentParameters = ReturnType<typeof boxFeatureContentParametersSchema.parse>
type CylinderContentParameters = ReturnType<typeof cylinderFeatureContentParametersSchema.parse>
type SphereContentParameters = ReturnType<typeof sphereFeatureContentParametersSchema.parse>
type ConeContentParameters = ReturnType<typeof coneFeatureContentParametersSchema.parse>
type PyramidContentParameters = ReturnType<typeof pyramidFeatureContentParametersSchema.parse>
type TorusContentParameters = ReturnType<typeof torusFeatureContentParametersSchema.parse>
type ExtrusionContentParameters = ReturnType<
  typeof extrusionFeatureContentParametersSchema.parse
> & {
  reversed?: boolean
  secondDistance?: number | null
}
type ExtrusionExtentContentParameters = ReturnType<
  typeof extrusionFeatureContentParametersV5Schema.parse
>
type ExtrusionMultiProfileContentParameters = ReturnType<
  typeof extrusionMultiProfileFeatureContentParametersSchema.parse
>
type ExtrusionMultiProfileModifyingContentParameters = ReturnType<
  typeof extrusionMultiProfileModifyingFeatureContentParametersSchema.parse
>
export type RevolveContentParameters = ReturnType<
  typeof revolveFeatureContentParametersSchema.parse
>
type RevolveMultiProfileContentParameters = ReturnType<
  typeof revolveMultiProfileFeatureContentParametersSchema.parse
>
type RevolveMultiProfileModifyingContentParameters = ReturnType<
  typeof revolveMultiProfileModifyingFeatureContentParametersSchema.parse
>
type DatumPlaneContentParameters = ReturnType<typeof datumPlaneFeatureContentParametersSchema.parse>
type HoleContentParameters = HoleFeatureContentParameters

function boxTopologyAxes(context: TopologyCandidateContext, parameters: BoxContentParameters) {
  const { centroid } = context.signature
  const [originX, originY, originZ] = parameters.origin
  const minimumZ = originZ + (parameters.centered ? -parameters.height / 2 : 0)
  const maximumZ = originZ + (parameters.centered ? parameters.height / 2 : parameters.height)
  return [
    {
      name: "x",
      coordinate: centroid[0],
      minimum: originX - parameters.width / 2,
      maximum: originX + parameters.width / 2,
      minimumRole: "primitive.box.side.x-min",
      maximumRole: "primitive.box.side.x-max",
    },
    {
      name: "y",
      coordinate: centroid[1],
      minimum: originY - parameters.depth / 2,
      maximum: originY + parameters.depth / 2,
      minimumRole: "primitive.box.side.y-min",
      maximumRole: "primitive.box.side.y-max",
    },
    {
      name: "z",
      coordinate: centroid[2],
      minimum: minimumZ,
      maximum: maximumZ,
      minimumRole: "primitive.box.cap.start",
      maximumRole: "primitive.box.cap.end",
    },
  ] as const
}

type BoxTopologyAxis = ReturnType<typeof boxTopologyAxes>[number]

function boxBoundary(axis: BoxTopologyAxis) {
  return firstMatchingRole([
    [nearlyEqual(axis.coordinate, axis.minimum), "min"],
    [nearlyEqual(axis.coordinate, axis.maximum), "max"],
  ])
}

function boxVertexRole(axes: ReturnType<typeof boxTopologyAxes>) {
  const boundaries = axes.map(boxBoundary)
  return boundaries.every((value) => value !== undefined)
    ? `primitive.box.vertex.x-${boundaries[0]}.y-${boundaries[1]}.z-${boundaries[2]}`
    : undefined
}

function boxEdgeRole(
  axes: ReturnType<typeof boxTopologyAxes>,
  direction: readonly [number, number, number],
) {
  const varyingAxis = axes.findIndex((_, index) => Math.abs(direction[index] ?? 0) > 0.999)
  const varying = axes[varyingAxis]
  if (!varying) return undefined
  const fixedBoundaries = axes.map((axis, index) =>
    index === varyingAxis ? null : boxBoundary(axis),
  )
  if (fixedBoundaries.some((value, index) => index !== varyingAxis && value === undefined)) {
    return undefined
  }
  const fixedRole = axes
    .map((axis, index) => (index === varyingAxis ? null : `${axis.name}-${fixedBoundaries[index]}`))
    .filter((value) => value !== null)
    .join(".")
  return `primitive.box.edge.${varying.name}.${fixedRole}`
}

function boxFaceRole(
  axes: ReturnType<typeof boxTopologyAxes>,
  direction: readonly [number, number, number],
) {
  const axis = axes.find((_, index) => Math.abs(direction[index] ?? 0) > 0.999)
  if (!axis) return undefined
  return firstMatchingRole([
    [nearlyEqual(axis.coordinate, axis.minimum), axis.minimumRole],
    [nearlyEqual(axis.coordinate, axis.maximum), axis.maximumRole],
  ])
}

export function boxFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: BoxContentParameters,
) {
  const axes = boxTopologyAxes(context, parameters)
  if (context.kind === "vertex" && context.signature.geometryClass === "POINT") {
    return boxVertexRole(axes)
  }
  const { direction } = context.signature
  if (!direction) return undefined
  if (context.kind === "edge" && context.signature.geometryClass === "LINE") {
    return boxEdgeRole(axes, direction)
  }
  return context.kind === "face" && context.signature.geometryClass === "PLANE"
    ? boxFaceRole(axes, direction)
    : undefined
}

function cylinderFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: CylinderContentParameters,
) {
  const z = context.signature.centroid[2]
  const originZ = parameters.origin[2]
  const minimumZ = originZ + (parameters.centered ? -parameters.height / 2 : 0)
  const maximumZ = originZ + (parameters.centered ? parameters.height / 2 : parameters.height)
  if (context.kind === "edge" && context.signature.geometryClass === "CIRCLE") {
    return firstMatchingRole([
      [nearlyEqual(z, minimumZ), "primitive.cylinder.edge.start"],
      [nearlyEqual(z, maximumZ), "primitive.cylinder.edge.end"],
    ])
  }
  if (context.kind !== "face") return undefined
  if (context.signature.geometryClass === "CYLINDRE") return "primitive.cylinder.wall"
  if (context.signature.geometryClass !== "PLANE" || !context.signature.direction) return undefined
  return firstMatchingRole([
    [nearlyEqual(z, minimumZ), "primitive.cylinder.cap.start"],
    [nearlyEqual(z, maximumZ), "primitive.cylinder.cap.end"],
  ])
}

function coneFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: ConeContentParameters,
) {
  const minimumZ = parameters.origin[2] - (parameters.centered ? parameters.height / 2 : 0)
  const z = context.signature.centroid[2]
  switch (`${context.kind}:${context.signature.geometryClass}`) {
    case "face:CONE":
      return "primitive.cone.wall"
    case "face:PLANE":
      return nearlyEqual(z, minimumZ) ? "primitive.cone.cap.start" : undefined
    case "edge:CIRCLE":
      return nearlyEqual(z, minimumZ) ? "primitive.cone.edge.start" : undefined
    case "vertex:POINT":
      return nearlyEqual(z, minimumZ + parameters.height) ? "primitive.cone.apex" : undefined
    default:
      return undefined
  }
}

function pyramidAngularRoleIndex(
  centroid: readonly number[],
  parameters: PyramidContentParameters,
  midpoint: boolean,
) {
  const angle = Math.atan2(
    (centroid[1] ?? 0) - parameters.origin[1],
    (centroid[0] ?? 0) - parameters.origin[0],
  )
  const turns = angle / (2 * Math.PI)
  const index = Math.round(turns * parameters.sides - (midpoint ? 0.5 : 0))
  return ((index % parameters.sides) + parameters.sides) % parameters.sides
}

function pyramidFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: PyramidContentParameters,
) {
  const minimumZ = parameters.origin[2] - (parameters.centered ? parameters.height / 2 : 0)
  const atBase = nearlyEqual(context.signature.centroid[2], minimumZ)
  switch (context.kind) {
    case "face":
      return atBase
        ? "primitive.pyramid.base"
        : `primitive.pyramid.side.${pyramidAngularRoleIndex(context.signature.centroid, parameters, true)}`
    case "edge":
      return atBase
        ? `primitive.pyramid.base.edge.${pyramidAngularRoleIndex(context.signature.centroid, parameters, true)}`
        : `primitive.pyramid.ridge.${pyramidAngularRoleIndex(context.signature.centroid, parameters, false)}`
    case "vertex":
      return atBase
        ? `primitive.pyramid.base.vertex.${pyramidAngularRoleIndex(context.signature.centroid, parameters, false)}`
        : "primitive.pyramid.apex"
  }
}

type ParsedFeature =
  | { kind: "boolean"; parameters: BooleanContentParameters }
  | { kind: "fillet"; parameters: FilletContentParameters }
  | { kind: "chamfer"; parameters: ChamferContentParameters }
  | {
      kind: "selected-fillet"
      parameters: FilletContentParameters
      references: readonly SelectedEdgeReference[]
    }
  | {
      kind: "selected-chamfer"
      parameters: ChamferContentParameters
      references: readonly SelectedEdgeReference[]
    }
  | { kind: "box"; parameters: BoxContentParameters }
  | { kind: "cylinder"; parameters: CylinderContentParameters }
  | { kind: "sphere"; parameters: SphereContentParameters }
  | { kind: "cone"; parameters: ConeContentParameters }
  | { kind: "pyramid"; parameters: PyramidContentParameters }
  | { kind: "torus"; parameters: TorusContentParameters }
  | { kind: "datum-plane"; parameters: DatumPlaneContentParameters }
  | { kind: "extrusion"; parameters: ExtrusionContentParameters }
  | { kind: "extent-extrusion"; parameters: ExtrusionExtentContentParameters }
  | { kind: "multi-extrusion"; parameters: ExtrusionMultiProfileContentParameters }
  | {
      kind: "multi-extrusion-modifying"
      parameters: ExtrusionMultiProfileModifyingContentParameters
    }
  | { kind: "revolve"; parameters: RevolveContentParameters }
  | { kind: "multi-revolve"; parameters: RevolveMultiProfileContentParameters }
  | {
      kind: "multi-revolve-modifying"
      parameters: RevolveMultiProfileModifyingContentParameters
    }
  | { kind: "hole"; parameters: HoleContentParameters }
  | { kind: "placement"; parameters: PlacementFeatureContentParameters }
  | {
      kind: "shell"
      parameters: ShellFeatureContentParameters
      openingResolution: "exact" | "durable"
    }
  | { kind: "thread"; parameters: ThreadContentParameters }
  | { kind: "imported"; parameters: ImportedFeatureContentParameters }
  | { kind: "split"; parameters: SplitFeatureContentParameters }
  | { kind: "pattern"; parameters: PatternFeatureContentParameters }
  | { kind: "constrained-loft"; parameters: LoftFeatureContentParametersV3 }
  | { kind: "loft"; parameters: LoftFeatureContentParameters | LoftFeatureContentParametersV2 }
  | { kind: "sweep"; parameters: SweepFeatureContentParameters }
  | {
      kind: "mirror"
      parameters: MirrorFeatureContentParameters | MirrorFeatureContentParametersV2
    }
  | { kind: "compound"; parameters: CompoundFeatureContentParameters }
  | { kind: "union" }

type PrimitiveFeature = Extract<
  ParsedFeature,
  { kind: "box" | "cylinder" | "sphere" | "cone" | "torus" | "pyramid" }
>
const PRIMITIVE_FEATURE_KINDS = new Set<ParsedFeature["kind"]>([
  "box",
  "cylinder",
  "sphere",
  "cone",
  "torus",
  "pyramid",
])

function isPrimitiveFeature(feature: ParsedFeature): feature is PrimitiveFeature {
  return PRIMITIVE_FEATURE_KINDS.has(feature.kind)
}

type FeatureParseResult =
  | { ok: true; feature: ParsedFeature }
  | {
      ok: false
      diagnostic: Extract<FeatureEvaluationResult, { ok: false }>["diagnostic"]
    }

function invalidInputCardinality(message: string) {
  return featureFailure("invalid-feature-parameters", message)
}

function parseRadialPrimitiveParameters(
  parameters: unknown,
  kind: "sphere" | "cone" | "torus" | "pyramid",
): PrimitiveFeature | null {
  switch (kind) {
    case "sphere": {
      const parsed = sphereFeatureContentParametersSchema.safeParse(parameters)
      return parsed.success ? { kind, parameters: parsed.data } : null
    }
    case "cone": {
      const parsed = coneFeatureContentParametersSchema.safeParse(parameters)
      return parsed.success ? { kind, parameters: parsed.data } : null
    }
    case "torus": {
      const parsed = torusFeatureContentParametersSchema.safeParse(parameters)
      return parsed.success ? { kind, parameters: parsed.data } : null
    }
    case "pyramid": {
      const parsed = pyramidFeatureContentParametersSchema.safeParse(parameters)
      return parsed.success ? { kind, parameters: parsed.data } : null
    }
  }
}

function parseRadialPrimitiveFeature(
  input: FeatureEvaluationInput,
  kind: "sphere" | "cone" | "torus" | "pyramid",
): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 0 ||
    feature.references.length !== 0 ||
    input.dependencies.length !== 0
  ) {
    return invalidInputCardinality(
      `${kind} features cannot declare dependency inputs or references.`,
    )
  }
  const parsed = parseRadialPrimitiveParameters(feature.parameters, kind)
  return parsed
    ? { ok: true, feature: parsed }
    : featureFailure(
        "invalid-feature-parameters",
        `${kind} content dimensions or placement are invalid.`,
      )
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
  if (!boxWithinFeatureWorkspace(parameters.data)) {
    return featureFailure(
      "invalid-feature-parameters",
      `Box dimensions and placement must stay within ${MAX_FEATURE_WORKSPACE_LENGTH_MM} mm of the world origin.`,
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
  if (!cylinderWithinFeatureWorkspace(parameters.data)) {
    return featureFailure(
      "invalid-feature-parameters",
      `Cylinder dimensions and placement must stay within ${MAX_FEATURE_WORKSPACE_LENGTH_MM} mm of the world origin.`,
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

function parseEdgeTreatmentFeature(
  input: FeatureEvaluationInput,
  kind: "fillet" | "chamfer",
): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 1 ||
    feature.references.length !== 0 ||
    input.dependencies.length !== 1
  ) {
    return invalidInputCardinality(
      "Edge treatment requires exactly one target dependency and no topology references.",
    )
  }
  const schema =
    kind === "fillet" ? filletFeatureContentParametersSchema : chamferFeatureContentParametersSchema
  const parameters = schema.safeParse(feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind, parameters: parameters.data } as ParsedFeature }
    : featureFailure("invalid-feature-parameters", "Edge treatment content parameters are invalid.")
}

function parseSelectedEdgeTreatmentFeature(
  input: FeatureEvaluationInput,
  kind: "fillet" | "chamfer",
): FeatureParseResult {
  const feature = input.content.feature
  if (
    feature.inputs.length !== 1 ||
    feature.references.length < 1 ||
    feature.references.length > 256 ||
    input.dependencies.length !== 1
  ) {
    return invalidInputCardinality(
      "Selected edge treatment requires one target dependency and 1 to 256 topology references.",
    )
  }
  if (
    feature.references.some((reference) => reference.inputIndex !== 0 || reference.kind !== "edge")
  ) {
    return invalidInputCardinality(
      "Selected edge treatment references must target edges in input 0.",
    )
  }
  if (kind === "fillet") {
    const parameters = filletFeatureContentParametersSchema.safeParse(feature.parameters)
    if (!parameters.success) {
      return featureFailure(
        "invalid-feature-parameters",
        "Edge treatment content parameters are invalid.",
      )
    }
    return {
      ok: true,
      feature: {
        kind: "selected-fillet",
        parameters: parameters.data,
        references: feature.references as unknown as readonly SelectedEdgeReference[],
      },
    }
  }
  const parameters = chamferFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Edge treatment content parameters are invalid.",
    )
  }
  return {
    ok: true,
    feature: {
      kind: "selected-chamfer",
      parameters: parameters.data,
      references: feature.references as unknown as readonly SelectedEdgeReference[],
    },
  }
}

function extrusionInputCardinalityIsValid(
  input: FeatureEvaluationInput,
  parameters: Pick<ExtrusionContentParameters, "operation" | "supportFeatureId">,
) {
  const dependencies = input.dependencies
  if (input.content.feature.inputs.length !== dependencies.length) return false
  return parameters.operation === "new"
    ? newBodyInputCardinalityIsValid(dependencies, parameters.supportFeatureId)
    : modifyingInputCardinalityIsValid(dependencies, parameters.supportFeatureId)
}

function newBodyInputCardinalityIsValid(
  dependencies: FeatureEvaluationInput["dependencies"],
  supportFeatureId: string | undefined,
) {
  return supportFeatureId
    ? dependencies.length === 1 && dependencies[0]?.featureId === supportFeatureId
    : dependencies.length === 0
}

function modifyingInputCardinalityIsValid(
  dependencies: FeatureEvaluationInput["dependencies"],
  supportFeatureId: string | undefined,
) {
  if (!supportFeatureId) return dependencies.length === 1
  if (dependencies.length === 1) return dependencies[0]?.featureId === supportFeatureId
  return (
    dependencies.length === 2 &&
    dependencies[0]?.featureId !== supportFeatureId &&
    dependencies[1]?.featureId === supportFeatureId
  )
}

function supportReferencesAreValid(
  input: FeatureEvaluationInput,
  supportFeatureId: string | undefined,
) {
  const references = input.content.feature.references
  if (!supportFeatureId) return references.length === 0
  const supportInputIndex = input.dependencies.findIndex(
    ({ featureId }) => featureId === supportFeatureId,
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
  if (!supportReferencesAreValid(input, parameters.data.supportFeatureId)) {
    return invalidInputCardinality(
      "An extrusion sketch-support reference must match its support dependency.",
    )
  }
  return { ok: true, feature: { kind: "extrusion", parameters: parameters.data } }
}

function parseMultiExtrusionFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = extrusionMultiProfileFeatureContentParametersSchema.safeParse(
    feature.parameters,
  )
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Multi-profile extrusion content parameters are invalid.",
    )
  }
  if (
    !newBodyInputCardinalityIsValid(input.dependencies, parameters.data.supportFeatureId) ||
    !supportReferencesAreValid(input, parameters.data.supportFeatureId) ||
    feature.inputs.length !== input.dependencies.length
  ) {
    return invalidInputCardinality(
      "A multi-profile extrusion may depend only on its sketch support.",
    )
  }
  return { ok: true, feature: { kind: "multi-extrusion", parameters: parameters.data } }
}

function parseMultiExtrusionModifyingFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = extrusionMultiProfileModifyingFeatureContentParametersSchema.safeParse(
    feature.parameters,
  )
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Multi-profile modifying extrusion content parameters are invalid.",
    )
  }
  if (
    !modifyingInputCardinalityIsValid(input.dependencies, parameters.data.supportFeatureId) ||
    !supportReferencesAreValid(input, parameters.data.supportFeatureId) ||
    feature.inputs.length !== input.dependencies.length
  ) {
    return invalidInputCardinality(
      "A multi-profile modifying extrusion requires one target and may also depend on its sketch support.",
    )
  }
  return {
    ok: true,
    feature: { kind: "multi-extrusion-modifying", parameters: parameters.data },
  }
}

function parseExtrusionExtentFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const parameters = extrusionFeatureContentParametersV5Schema.safeParse(
    input.content.feature.parameters,
  )
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Extrusion extent content parameters are invalid.",
    )
  }
  if (
    !extrusionInputCardinalityIsValid(input, parameters.data) ||
    !supportReferencesAreValid(input, parameters.data.supportFeatureId)
  ) {
    return invalidInputCardinality(
      "Extrusion extent inputs must match the explicit target and sketch support.",
    )
  }
  return { ok: true, feature: { kind: "extent-extrusion", parameters: parameters.data } }
}

function parseRevolveFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = revolveFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Revolve content parameters are invalid.")
  }
  if (!revolveInputCardinalityIsValid(input, parameters.data)) {
    return invalidInputCardinality(
      parameters.data.operation === "new"
        ? "A new-body revolve may depend only on its sketch support and model-edge axis source."
        : `A ${parameters.data.operation} revolve requires one target and may also depend on its sketch support and model-edge axis source.`,
    )
  }
  if (!supportReferencesAreValid(input, parameters.data.supportFeatureId)) {
    return invalidInputCardinality(
      "A revolve sketch-support reference must match its support dependency.",
    )
  }
  if (revolveProfileCrossesAxis(parameters.data)) {
    return featureFailure(
      "invalid-feature-parameters",
      "Revolve profiles must not cross the selected axis.",
    )
  }
  return { ok: true, feature: { kind: "revolve", parameters: parameters.data } }
}

function parseMultiRevolveFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = revolveMultiProfileFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Multi-profile revolve content parameters are invalid.",
    )
  }
  if (
    !newBodyInputCardinalityIsValid(input.dependencies, parameters.data.supportFeatureId) ||
    !supportReferencesAreValid(input, parameters.data.supportFeatureId) ||
    feature.inputs.length !== input.dependencies.length
  ) {
    return invalidInputCardinality("A multi-profile revolve may depend only on its sketch support.")
  }
  if (
    parameters.data.axis.kind === "model-edge" &&
    parameters.data.axis.reference.kind !== "edge"
  ) {
    return featureFailure(
      "invalid-feature-parameters",
      "A multi-profile revolve axis must reference an edge.",
    )
  }
  for (const profile of parameters.data.profiles) {
    if (revolveProfileCrossesAxis({ ...parameters.data, ...profile })) {
      return featureFailure(
        "invalid-feature-parameters",
        "Revolve profiles must not cross the selected axis.",
      )
    }
  }
  return { ok: true, feature: { kind: "multi-revolve", parameters: parameters.data } }
}

function parseMultiRevolveModifyingFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = revolveMultiProfileModifyingFeatureContentParametersSchema.safeParse(
    feature.parameters,
  )
  if (!parameters.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Multi-profile modifying revolve content parameters are invalid.",
    )
  }
  if (
    !revolveInputCardinalityIsValid(input, parameters.data) ||
    !supportReferencesAreValid(input, parameters.data.supportFeatureId)
  ) {
    return invalidInputCardinality(
      "A multi-profile modifying revolve requires one target and may also depend on its sketch support and model-edge axis source.",
    )
  }
  for (const profile of parameters.data.profiles) {
    if (revolveProfileCrossesAxis({ ...parameters.data, ...profile })) {
      return featureFailure(
        "invalid-feature-parameters",
        "Revolve profiles must not cross the selected axis.",
      )
    }
  }
  return {
    ok: true,
    feature: { kind: "multi-revolve-modifying", parameters: parameters.data },
  }
}

function parseLegacyRevolveFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const parameters = revolveFeatureContentParametersSchema.safeParse(
    input.content.feature.parameters,
  )
  if (!parameters.success || parameters.data.operation !== "new") {
    return featureFailure(
      "invalid-feature-parameters",
      "Schema-version-1 Revolve content only supports new-body operation intent.",
    )
  }
  return parseRevolveFeature(input)
}

export function revolveInputCardinalityIsValid(
  input: FeatureEvaluationInput,
  parameters: Pick<RevolveContentParameters, "axis" | "operation" | "supportFeatureId">,
) {
  const dependencies = input.dependencies
  if (input.content.feature.inputs.length !== dependencies.length) return false
  const targetFeatureId = parameters.operation === "new" ? undefined : dependencies[0]?.featureId
  if (parameters.operation !== "new" && !targetFeatureId) return false
  const axisSourceFeatureId =
    parameters.axis.kind === "model-edge" ? parameters.axis.reference.featureId : undefined
  const expected = [targetFeatureId, parameters.supportFeatureId, axisSourceFeatureId].flatMap(
    (featureId, index, featureIds) =>
      featureId && featureIds.indexOf(featureId) === index ? [featureId] : [],
  )
  return (
    dependencies.length === expected.length &&
    dependencies.every(({ featureId }, index) => featureId === expected[index])
  )
}

function parseDatumPlaneFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const parameters = datumPlaneFeatureContentParametersSchema.safeParse(
    input.content.feature.parameters,
  )
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Datum plane content is invalid.")
  }
  const supportFeatureId = parameters.data.supportFeatureId
  const validDependencies = supportFeatureId
    ? input.dependencies.length === 1 && input.dependencies[0]?.featureId === supportFeatureId
    : input.dependencies.length === 0
  if (
    input.content.feature.inputs.length !== input.dependencies.length ||
    !validDependencies ||
    !supportReferencesAreValid(input, supportFeatureId)
  ) {
    return invalidInputCardinality(
      "A datum plane may depend only on its matching face-support reference.",
    )
  }
  return { ok: true, feature: { kind: "datum-plane", parameters: parameters.data } }
}

function parseHoleFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  const parameters = holeFeatureContentParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Hole content parameters are invalid.")
  }
  if (!holeInputCardinalityIsValid(input, parameters.data.supportInputIndex)) {
    return invalidInputCardinality(
      "A hole requires one target and an optional distinct sketch-support dependency.",
    )
  }
  return { ok: true, feature: { kind: "hole", parameters: parameters.data } }
}

function parseHoleFeatureV2(input: FeatureEvaluationInput): FeatureParseResult {
  if (input.content.schemaVersion !== 1) {
    return featureFailure(
      "invalid-feature-parameters",
      "A version-2 hole requires version-1 canonical body identity.",
    )
  }
  const targetRole = input.content.feature.inputRoles[0]
  if (targetRole === null || targetRole === undefined) {
    return featureFailure(
      "invalid-feature-parameters",
      "A version-2 hole requires a named canonical target body role.",
    )
  }
  const parameters = holeFeatureContentParametersSchema.safeParse(input.content.feature.parameters)
  if (!parameters.success) {
    return featureFailure("invalid-feature-parameters", "Hole content parameters are invalid.")
  }
  if (parameters.data.supportInputIndex === 0 && targetRole !== "result") {
    return featureFailure(
      "invalid-feature-parameters",
      "A hole target selected from input 0 must use the whole result body.",
    )
  }
  if (parameters.data.supportInputIndex === 1 && input.content.feature.inputRoles[1] !== null) {
    return featureFailure(
      "invalid-feature-parameters",
      "A distinct hole support input must remain the whole result body.",
    )
  }
  return parseHoleFeature(input)
}

function holeInputCardinalityIsValid(
  input: FeatureEvaluationInput,
  supportInputIndex: HoleContentParameters["supportInputIndex"],
) {
  const expectedInputs = supportInputIndex === 1 ? 2 : 1
  const references = supportInputIndex === undefined ? 0 : 1
  return (
    input.content.feature.inputs.length === expectedInputs &&
    input.dependencies.length === expectedInputs &&
    input.content.feature.references.length === references &&
    (supportInputIndex === undefined ||
      input.content.feature.references[0]?.inputIndex === supportInputIndex)
  )
}

function hasNamedCombinationInputs(input: FeatureEvaluationInput): boolean {
  if (input.content.schemaVersion !== 1) return false
  const feature = input.content.feature
  return (
    feature.inputs.length >= 2 &&
    feature.inputs.length <= 8 &&
    input.dependencies.length === feature.inputs.length &&
    feature.references.length === 0 &&
    feature.inputRoles.every((role) => role !== null)
  )
}

function hasSlottedCombinationInputs(input: FeatureEvaluationInput): boolean {
  if (input.content.schemaVersion !== 2) return false
  return (
    input.content.feature.inputs.length === input.dependencies.length &&
    input.content.feature.references.length === 0
  )
}

function parseBodyCombinationFeature(
  input: FeatureEvaluationInput,
  kind: "compound" | "union",
  version = 1,
): FeatureParseResult {
  const feature = input.content.feature
  const validInputs =
    version === 1 ? hasNamedCombinationInputs(input) : hasSlottedCombinationInputs(input)
  if (!validInputs) {
    return invalidInputCardinality(
      "Select two to eight exact bodies using the registered version's named body input contract.",
    )
  }
  if (kind === "union") {
    return unionFeatureContentParametersSchema.safeParse(feature.parameters).success
      ? { ok: true, feature: { kind: "union" } }
      : featureFailure("invalid-feature-parameters", "Union content parameters are invalid.")
  }
  const parameters = compoundFeatureContentParametersSchema.safeParse(feature.parameters)
  const bodyCount =
    input.content.schemaVersion === 2
      ? input.content.feature.inputSlots.length
      : feature.inputs.length
  return parameters.success && parameters.data.outputRoles.length === bodyCount
    ? { ok: true, feature: { kind: "compound", parameters: parameters.data } }
    : featureFailure(
        "invalid-feature-parameters",
        "Compound requires one authored output role per selected body.",
      )
}

function hasExactSingleBodyInput(input: FeatureEvaluationInput): input is FeatureEvaluationInput & {
  content: Extract<FeatureEvaluationInput["content"], { schemaVersion: 1 }>
} {
  return (
    input.content.schemaVersion === 1 &&
    input.content.feature.inputs.length === 1 &&
    input.dependencies.length === 1 &&
    input.content.feature.references.length === 0 &&
    input.content.feature.inputRoles[0] != null
  )
}

function parsePlacementFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  if (!hasExactSingleBodyInput(input)) {
    return invalidInputCardinality(
      "Placement requires one exact named body dependency and no topology references.",
    )
  }
  const parameters = placementFeatureContentParametersSchema.safeParse(feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind: "placement", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Placement content parameters are invalid.")
}

function parseImportedFeature(input: FeatureEvaluationInput): FeatureParseResult {
  if (
    input.dependencies.length !== 0 ||
    input.content.feature.inputs.length !== 0 ||
    input.content.feature.references.length !== 0
  )
    return invalidInputCardinality(
      "Imported bodies require immutable source content without feature dependencies or topology references.",
    )
  const parameters = importedFeatureContentParametersSchema.safeParse(
    input.content.feature.parameters,
  )
  return parameters.success
    ? { ok: true, feature: { kind: "imported", parameters: parameters.data } }
    : featureFailure(
        "invalid-feature-parameters",
        "Imported source content parameters are invalid.",
      )
}

function parseThreadFeature(input: FeatureEvaluationInput): FeatureParseResult {
  if (!hasExactSingleBodyInput(input))
    return invalidInputCardinality(
      "Thread requires one exact named body dependency and no topology references.",
    )
  const parameters = threadContentParametersSchema.safeParse(input.content.feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind: "thread", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Thread content parameters are invalid.")
}

function parseMirrorFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const feature = input.content.feature
  if (!hasExactSingleBodyInput(input)) {
    return invalidInputCardinality(
      "Mirror requires one exact named body dependency and no topology references.",
    )
  }
  const parameters = (
    feature.type.schemaVersion === 2
      ? mirrorFeatureContentParametersV2Schema
      : mirrorFeatureContentParametersSchema
  ).safeParse(feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind: "mirror", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Mirror content parameters are invalid.")
}

function analyticalSketchInputsAreValid(
  input: FeatureEvaluationInput,
  sketches: readonly { supportFeatureId?: string | undefined }[],
  maximumDependencies = 8,
) {
  return (
    input.dependencies.length <= maximumDependencies &&
    input.content.feature.inputs.length === input.dependencies.length &&
    sketches.every(
      ({ supportFeatureId }) =>
        !supportFeatureId ||
        input.dependencies.some(({ featureId }) => featureId === supportFeatureId),
    )
  )
}

function parseLoftFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const schema =
    featureTypeKey(input.content.feature.type) === LOFT_FEATURE_TYPE_KEY
      ? loftFeatureContentParametersSchema
      : loftFeatureContentParametersV2Schema
  const parameters = schema.safeParse(input.content.feature.parameters)
  if (!parameters.success)
    return featureFailure("invalid-feature-parameters", "Loft analytical sections are invalid.")
  if (!analyticalSketchInputsAreValid(input, parameters.data.sections, 24))
    return invalidInputCardinality("Loft requires the exact scheduled sketch owner inputs.")
  return { ok: true, feature: { kind: "loft", parameters: parameters.data } }
}

function parseConstrainedLoftFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const parsed = loftFeatureContentParametersV3Schema.safeParse(input.content.feature.parameters)
  if (!parsed.success)
    return featureFailure("invalid-feature-parameters", "Constrained Loft parameters are invalid.")
  const parameters = parsed.data
  if (
    !analyticalSketchInputsAreValid(
      input,
      [
        ...parameters.sections,
        ...parameters.rails.map((r) => r.path),
        ...parameters.guides.map((g) => g.path),
      ],
      128,
    )
  )
    return invalidInputCardinality("Constrained Loft requires exact scheduled sketch owner inputs.")
  for (const condition of [...parameters.start, ...parameters.end]) {
    const dependency = input.dependencies[condition.supportInputIndex]
    if (!dependency || dependency.outputRole !== condition.support.outputRole)
      return invalidInputCardinality(
        "Constrained Loft end supports require their exact named body input.",
      )
  }
  return { ok: true, feature: { kind: "constrained-loft", parameters } }
}

function parseSweepFeature(input: FeatureEvaluationInput): FeatureParseResult {
  const parameters = sweepFeatureContentParametersSchema.safeParse(input.content.feature.parameters)
  if (!parameters.success)
    return featureFailure(
      "invalid-feature-parameters",
      "Sweep analytical profile and path are invalid.",
    )
  if (!analyticalSketchInputsAreValid(input, [parameters.data.profile, parameters.data.path]))
    return invalidInputCardinality("Sweep requires the exact scheduled sketch owner inputs.")
  return { ok: true, feature: { kind: "sweep", parameters: parameters.data } }
}

function parsePatternFeature(input: FeatureEvaluationInput): FeatureParseResult {
  if (!hasExactSingleBodyInput(input))
    return invalidInputCardinality(
      "Pattern requires one exact named body dependency and no topology references.",
    )
  const parameters = patternFeatureContentParametersSchema.safeParse(
    input.content.feature.parameters,
  )
  return parameters.success
    ? { ok: true, feature: { kind: "pattern", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Pattern content parameters are invalid.")
}

function parseSplitFeature(input: FeatureEvaluationInput): FeatureParseResult {
  if (!hasExactSingleBodyInput(input))
    return invalidInputCardinality(
      "Split requires one exact named body dependency and no topology references.",
    )
  const parameters = splitFeatureContentParametersSchema.safeParse(input.content.feature.parameters)
  return parameters.success
    ? { ok: true, feature: { kind: "split", parameters: parameters.data } }
    : featureFailure("invalid-feature-parameters", "Split content parameters are invalid.")
}

function parseShellFeature(input: FeatureEvaluationInput, version = 1): FeatureParseResult {
  const feature = input.content.feature
  if (!hasExactSingleBodyInput(input))
    return invalidInputCardinality(
      "Shell requires one exact named body dependency and no generic topology references.",
    )
  const schema =
    version === 2 ? shellFeatureContentParametersV2Schema : shellFeatureContentParametersSchema
  const parameters = schema.safeParse(feature.parameters)
  if (!parameters.success)
    return featureFailure("invalid-feature-parameters", "Shell content parameters are invalid.")
  const sourceChanged = parameters.data.sourceContentHash !== input.dependencies[0]?.contentHash
  if (version === 1 && sourceChanged)
    return featureFailure(
      "invalid-feature-parameters",
      "Shell source changed. Reselect the opening faces on the current body.",
    )
  const outputRole = input.content.feature.inputRoles[0]
  if (parameters.data.openings.some((opening) => opening.outputRole !== outputRole))
    return featureFailure(
      "invalid-feature-parameters",
      "Shell openings must target the exact input body role. Reselect the opening faces.",
    )
  return {
    ok: true,
    feature: {
      kind: "shell",
      parameters: parameters.data,
      openingResolution: sourceChanged ? "durable" : "exact",
    },
  }
}

const FEATURE_PARSERS = new Map<string, (input: FeatureEvaluationInput) => FeatureParseResult>([
  [COMPOUND_FEATURE_TYPE_KEY, (input) => parseBodyCombinationFeature(input, "compound")],
  [UNION_FEATURE_TYPE_KEY, (input) => parseBodyCombinationFeature(input, "union")],
  [COMPOUND_FEATURE_TYPE_V2_KEY, (input) => parseBodyCombinationFeature(input, "compound", 2)],
  [UNION_FEATURE_TYPE_V2_KEY, (input) => parseBodyCombinationFeature(input, "union", 2)],
  [PLACEMENT_FEATURE_TYPE_KEY, parsePlacementFeature],
  [MIRROR_FEATURE_TYPE_KEY, parseMirrorFeature],
  [MIRROR_FEATURE_TYPE_V2_KEY, parseMirrorFeature],
  [SHELL_FEATURE_TYPE_KEY, parseShellFeature],
  [SHELL_FEATURE_TYPE_V2_KEY, (input) => parseShellFeature(input, 2)],
  [THREAD_FEATURE_TYPE_KEY, parseThreadFeature],
  [IMPORTED_FEATURE_TYPE_KEY, parseImportedFeature],
  [SPLIT_FEATURE_TYPE_KEY, parseSplitFeature],
  [PATTERN_FEATURE_TYPE_KEY, parsePatternFeature],
  [LOFT_FEATURE_TYPE_KEY, parseLoftFeature],
  [LOFT_FEATURE_TYPE_KEY.replace("#1", "#2"), parseLoftFeature],
  [LOFT_FEATURE_TYPE_KEY.replace("#1", "#3"), parseConstrainedLoftFeature],
  [SWEEP_FEATURE_TYPE_KEY, parseSweepFeature],
  [BOOLEAN_FEATURE_TYPE_KEY, parseBooleanFeature],
  [FILLET_FEATURE_TYPE_KEY, (input) => parseEdgeTreatmentFeature(input, "fillet")],
  [CHAMFER_FEATURE_TYPE_KEY, (input) => parseEdgeTreatmentFeature(input, "chamfer")],
  [FILLET_FEATURE_TYPE_V2_KEY, (input) => parseSelectedEdgeTreatmentFeature(input, "fillet")],
  [CHAMFER_FEATURE_TYPE_V2_KEY, (input) => parseSelectedEdgeTreatmentFeature(input, "chamfer")],
  [BOX_FEATURE_TYPE_KEY, parseBoxFeature],
  [CYLINDER_FEATURE_TYPE_KEY, parseCylinderFeature],
  [SPHERE_FEATURE_TYPE_KEY, (input) => parseRadialPrimitiveFeature(input, "sphere")],
  [CONE_FEATURE_TYPE_KEY, (input) => parseRadialPrimitiveFeature(input, "cone")],
  [PYRAMID_FEATURE_TYPE_KEY, (input) => parseRadialPrimitiveFeature(input, "pyramid")],
  [TORUS_FEATURE_TYPE_KEY, (input) => parseRadialPrimitiveFeature(input, "torus")],
  [EXTRUSION_FEATURE_TYPE_KEY, parseExtrusionFeature],
  [EXTRUSION_FEATURE_TYPE_V2_KEY, parseExtrusionFeature],
  [EXTRUSION_FEATURE_TYPE_V3_KEY, parseMultiExtrusionFeature],
  [EXTRUSION_FEATURE_TYPE_V4_KEY, parseMultiExtrusionModifyingFeature],
  [EXTRUSION_FEATURE_TYPE_V5_KEY, parseExtrusionExtentFeature],
  [REVOLVE_FEATURE_TYPE_KEY, parseLegacyRevolveFeature],
  [REVOLVE_FEATURE_TYPE_V2_KEY, parseRevolveFeature],
  [REVOLVE_FEATURE_TYPE_V3_KEY, parseRevolveFeature],
  [REVOLVE_FEATURE_TYPE_V4_KEY, parseRevolveFeature],
  [REVOLVE_FEATURE_TYPE_V5_KEY, parseMultiRevolveFeature],
  [REVOLVE_FEATURE_TYPE_V6_KEY, parseMultiRevolveModifyingFeature],
  [DATUM_PLANE_FEATURE_TYPE_KEY, parseDatumPlaneFeature],
  [HOLE_FEATURE_TYPE_KEY, parseHoleFeature],
  [HOLE_FEATURE_TYPE_V2_KEY, parseHoleFeatureV2],
])

function parseFeatureRequest(
  request: FeatureEvaluationInput,
):
  | { ok: true; input: FeatureEvaluationInput; feature: ParsedFeature }
  | Extract<FeatureParseResult, { ok: false }> {
  const validated = featureEvaluationInputSchema.safeParse(request)
  if (!validated.success) {
    return featureFailure(
      "invalid-feature-parameters",
      "Feature input roles and hashes must match the exact canonical dependency slots.",
    )
  }
  const input = validated.data
  const feature = input.content.feature
  const key = featureTypeKey(feature.type)
  const parse = FEATURE_PARSERS.get(key)
  if (parse) {
    const result = parse(input)
    return result.ok ? { ...result, input } : result
  }

  return featureFailure(
    "unsupported-feature-type",
    `Feature type ${key} is not supported by the geometry evaluator.`,
  )
}

function applyExtrusionOperation(
  opencascade: OpenCascadeInstance,
  parameters: Pick<ExtrusionContentParameters, "operation">,
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

function createDatumPlaneFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: DatumPlaneContentParameters,
) {
  const { frame, size } = parameters
  const half = size / 2
  const thickness = 0.001
  const point = (x: number, y: number): SimplePoint => [
    frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y,
    frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y,
    frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y,
  ]
  const face = makePolygon([
    point(-half, -half),
    point(half, -half),
    point(half, half),
    point(-half, half),
  ])
  const vector = new opencascade.gp_Vec_4(
    frame.normal[0] * thickness,
    frame.normal[1] * thickness,
    frame.normal[2] * thickness,
  )
  try {
    const builder = new opencascade.BRepPrimAPI_MakePrism_1(face.wrapped, vector, false, true)
    try {
      return cast(builder.Shape()).asShape3D()
    } finally {
      builder.delete()
    }
  } finally {
    vector.delete()
    face.delete()
  }
}

function createProfileFeatureShape(
  opencascade: OpenCascadeInstance,
  feature: Extract<
    ParsedFeature,
    {
      kind:
        | "extrusion"
        | "extent-extrusion"
        | "multi-extrusion"
        | "multi-extrusion-modifying"
        | "revolve"
        | "multi-revolve"
        | "multi-revolve-modifying"
    }
  >,
  dependencyShapes: readonly Shape3D[],
) {
  switch (feature.kind) {
    case "extrusion":
      return createExtrusionFeatureShape(opencascade, feature.parameters, dependencyShapes)
    case "extent-extrusion":
      return feature.parameters.operation === "new"
        ? createMultiExtrusionFeatureShape(opencascade, feature.parameters)
        : createMultiExtrusionModifyingFeatureShape(
            opencascade,
            feature.parameters,
            dependencyShapes,
          )
    case "multi-extrusion":
      return createMultiExtrusionFeatureShape(opencascade, feature.parameters)
    case "multi-extrusion-modifying":
      return createMultiExtrusionModifyingFeatureShape(
        opencascade,
        feature.parameters,
        dependencyShapes,
      )
    case "revolve":
      return createRevolveFeatureShape(opencascade, feature.parameters, dependencyShapes)
    case "multi-revolve":
      return createMultiRevolveFeatureShape(opencascade, feature.parameters)
    case "multi-revolve-modifying":
      return createMultiRevolveModifyingFeatureShape(
        opencascade,
        feature.parameters,
        dependencyShapes,
      )
  }
}

function createSketchGeneratedFeatureShape(
  opencascade: OpenCascadeInstance,
  feature:
    | Parameters<typeof createProfileFeatureShape>[1]
    | Extract<ParsedFeature, { kind: "loft" | "sweep" }>,
  dependencyShapes: readonly Shape3D[],
) {
  switch (feature.kind) {
    case "loft":
      return createOcctLoft(opencascade, feature.parameters.sections, {
        ruled: feature.parameters.ruled,
        ...("holeCorrespondence" in feature.parameters
          ? { holeCorrespondence: feature.parameters.holeCorrespondence }
          : {}),
      })
    case "sweep":
      return createOcctSweep(opencascade, feature.parameters)
    default:
      return createProfileFeatureShape(opencascade, feature, dependencyShapes)
  }
}

function createEdgeTreatmentShape(
  opencascade: OpenCascadeInstance,
  feature: Extract<ParsedFeature, { kind: "fillet" | "chamfer" }>,
  target: Shape3D | undefined,
) {
  if (!target) throw new Error("Edge treatment target dependency shape is unavailable.")
  if (measureShape(opencascade, target).solidCount !== 1) {
    throw new Error("Edge treatment requires a single-solid target dependency.")
  }
  const size = feature.kind === "fillet" ? feature.parameters.radius : feature.parameters.distance
  return treatAllOcctEdges(opencascade, target, feature.kind, size)
}

function createSelectedEdgeTreatmentShape(
  opencascade: OpenCascadeInstance,
  feature: Extract<ParsedFeature, { kind: "selected-fillet" | "selected-chamfer" }>,
  target: Shape3D | undefined,
  snapshot: TopologyCaptureSnapshot,
  sourceFeatureId: string,
  resolveReferences: GeometryTopologyResolver | undefined,
) {
  if (!target) throw new Error("Selected edge treatment target dependency shape is unavailable.")
  if (measureShape(opencascade, target).solidCount !== 1) {
    throw new Error("Edge treatment requires a single-solid target dependency.")
  }
  if (!resolveReferences) throw new Error("Selected-edge topology resolution is unavailable.")
  const candidateIds = resolveReferences(feature.references, snapshot.candidates, sourceFeatureId)
  const selectedEdgeKeys = resolveSelectedEdgeKeys(candidateIds, snapshot.transientShapeKeys)
  const operation = feature.kind === "selected-fillet" ? "fillet" : "chamfer"
  const size =
    feature.kind === "selected-fillet" ? feature.parameters.radius : feature.parameters.distance
  return treatSelectedOcctEdges(opencascade, target, operation, size, selectedEdgeKeys)
}

function createBooleanFeatureShape(
  opencascade: OpenCascadeInstance,
  dependencyShapes: readonly Shape3D[],
) {
  const [target, tool] = dependencyShapes
  if (!target || !tool) throw new Error("Boolean dependency shapes are unavailable.")
  return cutOcctShapes(opencascade, target, tool)
}

type HoleCutterParameters = Readonly<{
  origin: readonly [number, number, number]
  height: number
  direction: readonly [number, number, number]
}>

function holeCutterDirection(parameters: HoleContentParameters) {
  const sign = parameters.direction === "forward" ? 1 : -1
  return [
    parameters.frame.normal[0] * sign,
    parameters.frame.normal[1] * sign,
    parameters.frame.normal[2] * sign,
  ] as const
}

function targetMaximumProjection(
  bounds: ReturnType<typeof measureShape>["bounds"],
  direction: readonly [number, number, number],
) {
  let maximum = -Infinity
  for (let index = 0; index < 8; index += 1) {
    const corner = [
      index & 1 ? bounds.max[0] : bounds.min[0],
      index & 2 ? bounds.max[1] : bounds.min[1],
      index & 4 ? bounds.max[2] : bounds.min[2],
    ] as const
    maximum = Math.max(maximum, dot3(corner, direction))
  }
  return maximum
}

function holeCutterParameters(
  parameters: HoleContentParameters,
  center: readonly [number, number, number],
  maximumProjection: number,
  tolerance: number,
): HoleCutterParameters {
  const direction = holeCutterDirection(parameters)
  if (parameters.extent === "blind") {
    return { origin: center, height: parameters.depth ?? 0, direction }
  }
  const height = maximumProjection - dot3(center, direction) + tolerance
  if (height <= tolerance)
    throw new Error("Through-all hole direction does not intersect the target.")
  return { origin: center, height, direction }
}

function cutHoleOnce(
  opencascade: OpenCascadeInstance,
  current: Shape3D,
  tool: Shape3D,
  currentVolume: number,
) {
  const next = cutOcctShapes(opencascade, current, tool)
  try {
    const metrics = measureShape(opencascade, next)
    const volumeDeltaTolerance = Number.EPSILON * 32 * Math.max(1, currentVolume)
    if (
      !metrics.valid ||
      metrics.solidCount !== 1 ||
      metrics.volume <= 0 ||
      metrics.volume >= currentVolume - volumeDeltaTolerance
    ) {
      throw new Error("Hole center does not remove material or produces invalid geometry.")
    }
    return { metrics, shape: next }
  } catch (error) {
    next.delete()
    throw error
  }
}

function createHoleFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: HoleContentParameters,
  dependencyShapes: readonly Shape3D[],
) {
  const target = dependencyShapes[0]
  if (!target) throw new Error("Hole target dependency shape is unavailable.")
  const initialMetrics = measureShape(opencascade, target)
  if (!initialMetrics.valid || initialMetrics.solidCount !== 1 || initialMetrics.volume <= 0) {
    throw new Error("Hole requires a valid single-solid target dependency.")
  }

  const direction = holeCutterDirection(parameters)
  const radius = parameters.diameter / 2
  const tolerance = 1e-3
  const bounds = initialMetrics.bounds
  const maxProjection = targetMaximumProjection(bounds, direction)
  let current = target
  let currentVolume = initialMetrics.volume

  try {
    for (const center of parameters.centers) {
      const cutter = holeCutterParameters(parameters, center, maxProjection, tolerance)
      const tool = createOcctCylinder(
        opencascade,
        radius,
        cutter.height,
        cutter.origin,
        cutter.direction,
      )
      try {
        const result = cutHoleOnce(opencascade, current, tool, currentVolume)
        if (current !== target) current.delete()
        current = result.shape
        currentVolume = result.metrics.volume
      } finally {
        tool.delete()
      }
    }
    return current
  } catch (error) {
    if (current !== target) current.delete()
    throw error
  }
}

function createPlacementFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: PlacementFeatureContentParameters,
  source: Shape3D | undefined,
) {
  if (!source) throw new Error("Placement target body is unavailable.")
  const metrics = measureShape(opencascade, source)
  if (!featureResultMetricsAreValid(metrics, 1))
    throw new Error("Placement requires one valid positive-volume solid.")
  return placeOcctShape(opencascade, source, parameters)
}

function createMirrorFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: MirrorFeatureContentParameters | MirrorFeatureContentParametersV2,
  source: Shape3D | undefined,
) {
  if (!source) throw new Error("Mirror target body is unavailable.")
  validateCombinationSources(opencascade, [source])
  return mirrorOcctShape(opencascade, source, parameters)
}

function validateCombinationSources(opencascade: OpenCascadeInstance, sources: readonly Shape3D[]) {
  for (const source of sources) {
    if (!featureResultMetricsAreValid(measureShape(opencascade, source), 1))
      throw new Error("Each selected body must be a valid positive-volume single solid.")
  }
}

function primitiveBaseOrigin(
  parameters: CylinderContentParameters | ConeContentParameters | PyramidContentParameters,
): [number, number, number] {
  const { origin, height, centered } = parameters
  return [origin[0], origin[1], origin[2] - (centered ? height / 2 : 0)]
}

function createPrimitiveFeatureShape(opencascade: OpenCascadeInstance, feature: PrimitiveFeature) {
  switch (feature.kind) {
    case "box": {
      const { width, depth, height, centered, origin } = feature.parameters
      return createOcctBox(opencascade, [width, depth, height], centered, origin)
    }
    case "cylinder": {
      const { radius, height } = feature.parameters
      return createOcctCylinder(
        opencascade,
        radius,
        height,
        primitiveBaseOrigin(feature.parameters),
      )
    }
    case "sphere":
      return createOcctSphere(opencascade, feature.parameters.radius, feature.parameters.origin)
    case "torus":
      return createOcctTorus(
        opencascade,
        feature.parameters.majorRadius,
        feature.parameters.minorRadius,
        feature.parameters.origin,
      )
    case "cone": {
      const { radius, height } = feature.parameters
      return createOcctCone(opencascade, radius, height, primitiveBaseOrigin(feature.parameters))
    }
    case "pyramid": {
      const { sides, radius, height } = feature.parameters
      return createOcctPyramid(
        opencascade,
        sides,
        radius,
        height,
        primitiveBaseOrigin(feature.parameters),
      )
    }
  }
}

function createFeatureShape(
  opencascade: OpenCascadeInstance,
  feature: Exclude<
    ParsedFeature,
    {
      kind:
        | "constrained-loft"
        | "selected-fillet"
        | "selected-chamfer"
        | "placement"
        | "mirror"
        | "shell"
        | "thread"
        | "imported"
        | "compound"
        | "split"
        | "pattern"
        | "union"
    }
  >,
  dependencyShapes: readonly Shape3D[],
) {
  if (isPrimitiveFeature(feature)) return createPrimitiveFeatureShape(opencascade, feature)
  switch (feature.kind) {
    case "datum-plane":
      return createDatumPlaneFeatureShape(opencascade, feature.parameters)
    case "boolean": {
      return createBooleanFeatureShape(opencascade, dependencyShapes)
    }
    case "hole":
      return createHoleFeatureShape(opencascade, feature.parameters, dependencyShapes)
    case "fillet":
    case "chamfer": {
      return createEdgeTreatmentShape(opencascade, feature, dependencyShapes[0])
    }
    default:
      return createSketchGeneratedFeatureShape(opencascade, feature, dependencyShapes)
  }
}

function extrusionPlane(parameters: Pick<ExtrusionContentParameters, "frame" | "plane">) {
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
  const { start: startOffset, end: endOffset } = extrusionExtentBounds(parameters)
  const coordinate = plane.coordinate(context.signature.centroid)
  return firstMatchingRole([
    [nearlyEqual(coordinate, startOffset), "extrusion.cap.start"],
    [nearlyEqual(coordinate, endOffset), "extrusion.cap.end"],
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

export function extrusionFeatureSemanticRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
  roleIndex = createExtrusionRoleIndex(parameters),
) {
  const segmentRole = extrusionVertexOrEdgeRole(context, parameters, roleIndex)
  return (
    segmentRole ??
    extrusionCapRole(context, parameters) ??
    extrusionLineSideRole(context, parameters) ??
    extrusionCurvedSideRole(context, parameters)
  )
}

type LocalRoleEntry = Readonly<{ id: string; point: readonly [number, number] }>
type ExtrusionRoleIndex = Readonly<{
  endpointBuckets: ReadonlyMap<string, readonly LocalRoleEntry[]>
  lineBuckets: ReadonlyMap<string, readonly LocalRoleEntry[]>
}>

const ROLE_COORDINATE_TOLERANCE = 1e-6

function roleBucketCoordinate(value: number) {
  return Math.floor(value / ROLE_COORDINATE_TOLERANCE)
}

function roleBucketKey(x: number, y: number) {
  return `${roleBucketCoordinate(x)}:${roleBucketCoordinate(y)}`
}

function addRoleEntry(buckets: Map<string, LocalRoleEntry[]>, entry: LocalRoleEntry) {
  const key = roleBucketKey(entry.point[0], entry.point[1])
  const entries = buckets.get(key) ?? []
  entries.push(entry)
  buckets.set(key, entries)
}

function createExtrusionRoleIndex(parameters: ExtrusionContentParameters): ExtrusionRoleIndex {
  const endpointBuckets = new Map<string, LocalRoleEntry[]>()
  const lineBuckets = new Map<string, LocalRoleEntry[]>()
  const segments = [parameters.outer, ...parameters.holes].flatMap(({ segments }) => segments)
  const polygonal = segments.every((segment) => segment.type === "line")
  for (const segment of segments) {
    if (segment.type !== "line") continue
    if (polygonal) {
      addRoleEntry(endpointBuckets, { id: segment.startPointId, point: segment.start })
      addRoleEntry(endpointBuckets, { id: segment.endPointId, point: segment.end })
    }
    addRoleEntry(lineBuckets, {
      id: segment.entityId,
      point: [(segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2],
    })
  }
  return { endpointBuckets, lineBuckets }
}

function matchingRoleIds(
  buckets: ReadonlyMap<string, readonly LocalRoleEntry[]>,
  point: readonly [number, number],
) {
  const bucketX = roleBucketCoordinate(point[0])
  const bucketY = roleBucketCoordinate(point[1])
  const ids = new Set<string>()
  for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
    for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
      const entries = buckets.get(`${bucketX + deltaX}:${bucketY + deltaY}`) ?? []
      for (const entry of entries) {
        if (
          Math.hypot(point[0] - entry.point[0], point[1] - entry.point[1]) <=
          ROLE_COORDINATE_TOLERANCE
        ) {
          ids.add(entry.id)
        }
      }
    }
  }
  return [...ids]
}

function extrusionVertexRole(
  endpointId: string | undefined,
  coordinate: number,
  startOffset: number,
  endOffset: number,
) {
  if (!endpointId) return undefined
  return firstMatchingRole([
    [nearlyEqual(coordinate, startOffset), `extrusion.vertex.${endpointId}.cap.start`],
    [nearlyEqual(coordinate, endOffset), `extrusion.vertex.${endpointId}.cap.end`],
  ])
}

function extrusionLineEdgeRole(
  context: TopologyCandidateContext,
  plane: ExtrusionPlane,
  roleIndex: ExtrusionRoleIndex,
  localCentroid: readonly [number, number],
  endpointId: string | undefined,
  startOffset: number,
  endOffset: number,
) {
  const direction = context.signature.direction
  if (!direction) return undefined
  const coordinate = plane.coordinate(context.signature.centroid)
  if (Math.abs(dot3(direction, plane.normal)) > 0.999) {
    return endpointId && nearlyEqual(coordinate, (startOffset + endOffset) / 2)
      ? `extrusion.edge.${endpointId}.span`
      : undefined
  }
  const cap = firstMatchingRole([
    [nearlyEqual(coordinate, startOffset), "start"],
    [nearlyEqual(coordinate, endOffset), "end"],
  ])
  if (!cap) return undefined
  const lineIds = matchingRoleIds(roleIndex.lineBuckets, localCentroid)
  return lineIds.length === 1 ? `extrusion.edge.${lineIds[0]}.cap.${cap}` : undefined
}

function extrusionVertexOrEdgeRole(
  context: TopologyCandidateContext,
  parameters: ExtrusionContentParameters,
  roleIndex: ExtrusionRoleIndex,
) {
  if (
    (context.kind !== "vertex" || context.signature.geometryClass !== "POINT") &&
    (context.kind !== "edge" || context.signature.geometryClass !== "LINE")
  ) {
    return undefined
  }
  const plane = extrusionPlane(parameters)
  const { start: startOffset, end: endOffset } = extrusionExtentBounds(parameters)
  const coordinate = plane.coordinate(context.signature.centroid)
  const localCentroid = plane.local(context.signature.centroid)
  const endpointIds = matchingRoleIds(roleIndex.endpointBuckets, localCentroid)
  const endpointId = endpointIds.length === 1 ? endpointIds[0] : undefined

  if (context.kind === "vertex") {
    return extrusionVertexRole(endpointId, coordinate, startOffset, endOffset)
  }
  return extrusionLineEdgeRole(
    context,
    plane,
    roleIndex,
    localCentroid,
    endpointId,
    startOffset,
    endOffset,
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
  opencascade: OpenCascadeInstance,
  plane: ExtrusionPlane,
  segment: ExtrusionSegment,
  offset: number,
  reverse: boolean,
) {
  if (segment.type === "cubic-bezier") {
    return makeOcctCubicBezierEdge(
      opencascade,
      {
        start: plane.point(segment.start, offset),
        control1: plane.point(segment.control1, offset),
        control2: plane.point(segment.control2, offset),
        end: plane.point(segment.end, offset),
      },
      reverse,
    )
  }
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
  opencascade: OpenCascadeInstance,
  parameters: Pick<ExtrusionContentParameters, "frame" | "plane">,
  loop: { segments: ExtrusionContentParameters["outer"]["segments"] },
  offset: number,
  reverse: boolean,
) {
  const plane = extrusionPlane(parameters)
  const orderedSegments = reverse ? [...loop.segments].reverse() : loop.segments
  const edges = orderedSegments.map((segment) =>
    extrusionSegmentEdge(opencascade, plane, segment, offset, reverse),
  )
  try {
    return assembleWire(edges)
  } finally {
    for (const edge of edges) edge.delete()
  }
}

function createExtrusionShape(
  opencascade: OpenCascadeInstance,
  parameters: Pick<ExtrusionContentParameters, "frame" | "plane" | "distance" | "symmetric"> &
    Readonly<{
      reversed?: boolean
      secondDistance?: number | null
      outer: ExtrusionContentParameters["outer"]
      holes: ExtrusionContentParameters["holes"]
    }>,
) {
  const plane = extrusionPlane(parameters)
  const { start: startOffset, end: endOffset } = extrusionExtentBounds(parameters)
  const span = endOffset - startOffset
  const outer = extrusionLoopWire(opencascade, parameters, parameters.outer, startOffset, false)
  const holes: Wire[] = []
  let face: ReturnType<typeof makeFace> | null = null
  const vector = new opencascade.gp_Vec_4(
    plane.normal[0] * span,
    plane.normal[1] * span,
    plane.normal[2] * span,
  )
  try {
    for (const hole of parameters.holes) {
      holes.push(extrusionLoopWire(opencascade, parameters, hole, startOffset, true))
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

function createRevolveShape(
  opencascade: OpenCascadeInstance,
  parameters: Pick<
    RevolveContentParameters,
    "frame" | "axisOrigin" | "axisDirection" | "angleRadians"
  > &
    Readonly<{
      outer: RevolveContentParameters["outer"]
      holes: RevolveContentParameters["holes"]
    }>,
) {
  const plane = extrusionPlane(parameters)
  const makeLoop = (
    loop: { segments: RevolveContentParameters["outer"]["segments"] },
    reverse: boolean,
  ) => {
    const orderedSegments = reverse ? [...loop.segments].reverse() : loop.segments
    const edges = orderedSegments.map((segment) =>
      extrusionSegmentEdge(opencascade, plane, segment, 0, reverse),
    )
    try {
      return assembleWire(edges)
    } finally {
      for (const edge of edges) edge.delete()
    }
  }
  const outer = makeLoop(parameters.outer, false)
  try {
    const holes: Wire[] = []
    let face: ReturnType<typeof makeFace> | null = null
    const origin = new opencascade.gp_Pnt_3(...parameters.axisOrigin)
    const direction = new opencascade.gp_Dir_4(...parameters.axisDirection)
    const axis = new opencascade.gp_Ax1_2(origin, direction)
    try {
      for (const hole of parameters.holes) holes.push(makeLoop(hole, true))
      face = makeFace(outer, holes)
      const builder = new opencascade.BRepPrimAPI_MakeRevol_1(
        face.wrapped,
        axis,
        parameters.angleRadians,
        false,
      )
      try {
        return cast(builder.Shape()).asShape3D()
      } finally {
        builder.delete()
      }
    } finally {
      axis.delete()
      direction.delete()
      origin.delete()
      face?.delete()
      for (const hole of holes) hole.delete()
    }
  } finally {
    outer.delete()
  }
}

function createRevolveFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: RevolveContentParameters,
  dependencyShapes: readonly Shape3D[],
) {
  const tool = createRevolveShape(opencascade, parameters)
  if (parameters.operation === "new") return tool
  const target = dependencyShapes[0]
  if (!target) {
    tool.delete()
    throw new Error("Revolve target dependency shape is unavailable.")
  }
  try {
    return applyRevolveOperation(opencascade, parameters, target, tool)
  } finally {
    tool.delete()
  }
}

function applyRevolveOperation(
  opencascade: OpenCascadeInstance,
  parameters: Pick<RevolveContentParameters, "operation">,
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
      throw new Error("A new-body revolve cannot modify a target shape.")
  }
}

function combineMultiProfileTools<Profile>(
  opencascade: OpenCascadeInstance,
  profiles: readonly Profile[],
  createTool: (profile: Profile) => Shape3D,
) {
  let combined: Shape3D | null = null
  try {
    for (const profile of profiles) {
      const tool = createTool(profile)
      if (!combined) {
        combined = tool
        continue
      }
      const previous = combined
      combined = null
      try {
        combined = fuseOcctShapes(opencascade, previous, tool)
      } finally {
        previous.delete()
        tool.delete()
      }
    }
    if (!combined) throw new Error("Multi-profile content must contain at least one profile.")
    return combined
  } catch (error) {
    if (combined) {
      try {
        combined.delete()
      } catch {
        /* best-effort cleanup */
      }
    }
    throw error
  }
}

function createMultiExtrusionFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: ExtrusionMultiProfileContentParameters | ExtrusionExtentContentParameters,
) {
  return combineMultiProfileTools(opencascade, parameters.profiles, (profile) =>
    createExtrusionShape(opencascade, { ...parameters, ...profile }),
  )
}

function createMultiExtrusionModifyingFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: ExtrusionMultiProfileModifyingContentParameters | ExtrusionExtentContentParameters,
  dependencyShapes: readonly Shape3D[],
) {
  const target = dependencyShapes[0]
  if (!target) throw new Error("Multi-profile extrusion target dependency shape is unavailable.")
  const tool = combineMultiProfileTools(opencascade, parameters.profiles, (profile) =>
    createExtrusionShape(opencascade, { ...parameters, ...profile }),
  )
  try {
    return applyExtrusionOperation(opencascade, parameters, target, tool)
  } finally {
    tool.delete()
  }
}

function createMultiRevolveFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: RevolveMultiProfileContentParameters,
) {
  return combineMultiProfileTools(opencascade, parameters.profiles, (profile) =>
    createRevolveShape(opencascade, { ...parameters, ...profile }),
  )
}

function createMultiRevolveModifyingFeatureShape(
  opencascade: OpenCascadeInstance,
  parameters: RevolveMultiProfileModifyingContentParameters,
  dependencyShapes: readonly Shape3D[],
) {
  const target = dependencyShapes[0]
  if (!target) throw new Error("Multi-profile revolve target dependency shape is unavailable.")
  const tool = combineMultiProfileTools(opencascade, parameters.profiles, (profile) =>
    createRevolveShape(opencascade, { ...parameters, ...profile }),
  )
  try {
    return applyRevolveOperation(opencascade, parameters, target, tool)
  } finally {
    tool.delete()
  }
}

function multiExtrusionRoleParameters(
  parameters:
    | ExtrusionMultiProfileContentParameters
    | ExtrusionMultiProfileModifyingContentParameters
    | ExtrusionExtentContentParameters,
): ExtrusionContentParameters | undefined {
  const [first, ...rest] = parameters.profiles
  if (!first) return undefined
  return {
    ...parameters,
    outer: first.outer,
    holes: [...first.holes, ...rest.flatMap((profile) => [profile.outer, ...profile.holes])],
  }
}

function datumPlaneTopologySemanticRole(
  context: TopologyCandidateContext,
  parameters: DatumPlaneContentParameters,
) {
  if (context.kind !== "face" || context.signature.geometryClass !== "PLANE") return undefined
  const direction = context.signature.direction
  if (!direction) return undefined
  return Math.abs(dot3(direction, parameters.frame.normal)) > 0.999 ? "datum.plane" : undefined
}

const primitiveSurfaceRoles = new Map([
  ["sphere:SPHERE", "primitive.sphere.surface"],
  ["torus:TORUS", "primitive.torus.surface"],
])

function primitiveFeatureSemanticRole(
  context: TopologyCandidateContext,
  feature: PrimitiveFeature,
) {
  switch (feature.kind) {
    case "box":
      return boxFeatureSemanticRole(context, feature.parameters)
    case "cylinder":
      return cylinderFeatureSemanticRole(context, feature.parameters)
    case "cone":
      return coneFeatureSemanticRole(context, feature.parameters)
    case "pyramid":
      return pyramidFeatureSemanticRole(context, feature.parameters)
    default:
      return context.kind === "face"
        ? primitiveSurfaceRoles.get(`${feature.kind}:${context.signature.geometryClass}`)
        : undefined
  }
}

function featureTopologySemanticRole(
  context: TopologyCandidateContext,
  feature: ParsedFeature,
  extrusionParameters: ExtrusionContentParameters | undefined,
  extrusionRoleIndex: ExtrusionRoleIndex | undefined,
) {
  if (extrusionParameters) {
    return extrusionFeatureSemanticRole(context, extrusionParameters, extrusionRoleIndex)
  }
  if (isPrimitiveFeature(feature)) return primitiveFeatureSemanticRole(context, feature)
  if (feature.kind === "datum-plane") {
    return datumPlaneTopologySemanticRole(context, feature.parameters)
  }
  return undefined
}

function captureFeatureTopology(shape: Shape3D, feature: ParsedFeature) {
  if (feature.kind === "boolean") return captureReplicadTopologySnapshot(shape)
  const extrusionParameters =
    feature.kind === "extrusion"
      ? feature.parameters
      : feature.kind === "multi-extrusion" ||
          feature.kind === "multi-extrusion-modifying" ||
          feature.kind === "extent-extrusion"
        ? multiExtrusionRoleParameters(feature.parameters)
        : undefined
  const extrusionRoleIndex = extrusionParameters
    ? createExtrusionRoleIndex(extrusionParameters)
    : undefined
  return captureReplicadTopologySnapshot(shape, {
    semanticRole: (context) =>
      featureTopologySemanticRole(context, feature, extrusionParameters, extrusionRoleIndex),
  })
}

function modifierExtrusionHasHeuristicFaces(feature: ParsedFeature) {
  return (
    feature.kind === "multi-extrusion-modifying" ||
    ((feature.kind === "extrusion" || feature.kind === "extent-extrusion") &&
      feature.parameters.operation !== "new")
  )
}

function featureProfileCount(feature: ParsedFeature) {
  if (feature.kind === "compound") return feature.parameters.outputRoles.length
  if (feature.kind === "pattern") return feature.parameters.count
  if (feature.kind === "imported") return feature.parameters.outputs.length
  return feature.kind === "multi-extrusion" ||
    feature.kind === "multi-revolve" ||
    feature.kind === "extent-extrusion"
    ? feature.parameters.profiles.length
    : 1
}

function featureSolidKind(feature: ParsedFeature): Parameters<typeof featureSolidCountLimit>[0] {
  switch (feature.kind) {
    case "extent-extrusion":
      return feature.parameters.operation === "new"
        ? "multi-extrusion"
        : "multi-extrusion-modifying"
    case "constrained-loft":
      return "loft"
    case "selected-fillet":
      return "fillet"
    case "selected-chamfer":
      return "chamfer"
    case "hole":
      return "boolean"
    default:
      return feature.kind
  }
}

const independentBodyBundleKinds = new Set(["compound", "split", "pattern", "imported"])

function featureHasSingleBody(metrics: ReturnType<typeof measureShape>, feature: ParsedFeature) {
  return (
    metrics.solidCount === 1 &&
    feature.kind !== "datum-plane" &&
    !independentBodyBundleKinds.has(feature.kind)
  )
}

function validateAuthoredBodyCardinality(
  metrics: ReturnType<typeof measureShape>,
  feature: ParsedFeature,
  maximumSolidCount: number,
) {
  if (independentBodyBundleKinds.has(feature.kind) && metrics.solidCount !== maximumSolidCount)
    throw new Error("Every authored output must retain one separately owned solid.")
}

function evaluateFeatureGeometry(
  opencascade: OpenCascadeInstance,
  shape: Shape3D,
  feature: ParsedFeature,
) {
  const startedAt = performance.now()
  const metrics = measureShape(opencascade, shape)
  if (
    [
      "placement",
      "mirror",
      "shell",
      "thread",
      "imported",
      "split",
      "pattern",
      "loft",
      "constrained-loft",
      "sweep",
      "compound",
      "union",
    ].includes(feature.kind) &&
    !withinFeatureWorkspace([...metrics.bounds.min, ...metrics.bounds.max].map(Math.abs))
  ) {
    throw new Error("Geometry must remain within the supported world-coordinate bounds.")
  }
  const maximumSolidCount = featureSolidCountLimit(
    featureSolidKind(feature),
    featureProfileCount(feature),
  )
  validateAuthoredBodyCardinality(metrics, feature, maximumSolidCount)
  if (!featureResultMetricsAreValid(metrics, maximumSolidCount)) {
    throw new Error("Feature evaluation did not produce a valid bounded positive-volume result.")
  }
  const topologySnapshot = captureFeatureTopology(shape, feature)
  const hasSingleBody = featureHasSingleBody(metrics, feature)
  return {
    metrics,
    outputs: hasSingleBody ? [{ role: "result", shape }] : [],
    hasSingleBody,
    topologyCandidates: topologySnapshot.candidates,
    topologySnapshot,
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

function createFeatureEvaluationShape(
  opencascade: OpenCascadeInstance,
  source: Extract<FeatureShapeSource, { ok: true }>,
  feature: Exclude<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
  input: FeatureEvaluationInput,
  createUncached: (
    opencascade: OpenCascadeInstance,
    feature: Exclude<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) => Shape3D,
) {
  if (source.brepHit) return { shape: source.shape, temporaryShape: null }
  const shape = createUncached(opencascade, feature, source.dependencies, input)
  return { shape, temporaryShape: shape }
}

function cacheFeatureEvaluation(
  registry: DocumentFeatureShapeRegistry<Shape3D>,
  input: FeatureEvaluationInput,
  temporaryShape: Shape3D | null,
  outputs: readonly { role: string; shape: Shape3D }[],
) {
  if (!temporaryShape) return null
  registry.replace(input.documentId, input.featureId, input.contentHash, temporaryShape, outputs)
  return null
}

function featureEvaluationResult(
  engine: GeometryEngineMetadata,
  evaluation: ReturnType<typeof evaluateFeatureGeometry>,
  tessellation: ReturnType<typeof tessellateFeatureGeometry>,
  brepHit: boolean,
  totalMs: number,
): FeatureEvaluationEngineResult {
  const bodies = evaluation.hasSingleBody
    ? [
        {
          outputRole: "result" as const,
          shape: evaluation.metrics,
          mesh: tessellation.mesh,
          topologyCandidates: evaluation.topologyCandidates,
        },
      ]
    : []
  return {
    engine,
    shape: evaluation.metrics,
    topologyCandidates: evaluation.topologyCandidates,
    mesh: tessellation.mesh,
    bodies,
    cache: { brepHit },
    timings: {
      evaluationMs: evaluation.evaluationMs,
      tessellationMs: tessellation.tessellationMs,
      totalMs,
    },
  }
}

function evaluateOwnedBody(
  opencascade: OpenCascadeInstance,
  output: OwnedBodyCombination["outputs"][number],
  mesh: FeatureEvaluationInput["mesh"],
) {
  const metrics = measureShape(opencascade, output.shape)
  if (!featureResultMetricsAreValid(metrics, 1))
    throw new Error("Named output body geometry is invalid.")
  const snapshot = captureReplicadTopologySnapshot(output.shape)
  const tessellation = tessellateFeatureGeometry(opencascade, output.shape, mesh)
  return {
    snapshot,
    body: {
      outputRole: output.role,
      shape: metrics,
      mesh: tessellation.mesh,
      topologyCandidates: snapshot.candidates,
    },
  }
}

type FeatureShapeSource =
  | { ok: true; brepHit: true; shape: Shape3D }
  | { ok: true; brepHit: false; dependencies: Shape3D[] }
  | Extract<FeatureEvaluationResult, { ok: false }>

function aggregateOwnedOutputs(
  opencascade: OpenCascadeInstance,
  outputs: OwnedBodyCombination["outputs"],
): OwnedBodyCombination {
  const first = outputs[0]
  if (!first) throw new Error("Named output geometry is unavailable.")
  try {
    return {
      shape: createOcctCompound(
        opencascade,
        outputs.map(({ shape }) => shape),
      ),
      outputs,
    }
  } catch (error) {
    if (!disposeBodyCombination({ shape: first.shape, outputs }))
      throw new Error("Aggregate creation and output cleanup failed.", { cause: error })
    throw error
  }
}

function createGeneratedBodyBundle(
  opencascade: OpenCascadeInstance,
  target: Shape3D | undefined,
  feature: Extract<ParsedFeature, { kind: "split" | "pattern" }>,
): OwnedBodyCombination {
  if (!target) throw new Error("Exact target body is unavailable.")
  if (feature.kind === "pattern")
    return aggregateOwnedOutputs(
      opencascade,
      patternOcctShape(opencascade, target, feature.parameters),
    )
  const split = splitOcctShape(opencascade, target, feature.parameters)
  return aggregateOwnedOutputs(opencascade, [
    { role: SPLIT_OUTPUT_ROLES[0], shape: split.negative },
    { role: SPLIT_OUTPUT_ROLES[1], shape: split.positive },
  ])
}

function bodyBundleRoles(
  feature: Extract<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
) {
  switch (feature.kind) {
    case "compound":
      return feature.parameters.outputRoles
    case "split":
      return SPLIT_OUTPUT_ROLES
    case "pattern":
      return patternContentOutputRoles(feature.parameters.count)
    case "imported":
      return feature.parameters.outputs.map(({ outputId }) => `import.${outputId}`)
  }
}

async function bodyBundleForEvaluation(
  registry: DocumentFeatureShapeRegistry<Shape3D>,
  input: FeatureEvaluationInput,
  feature: Extract<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
  source: Extract<FeatureShapeSource, { ok: true }>,
  opencascade: OpenCascadeInstance,
  sourceAsset?: SourceAssetMaterialization,
): Promise<OwnedBodyCombination> {
  if (feature.kind === "imported") {
    if (!sourceAsset) throw new Error("Required immutable source bytes are unavailable.")
    const materialized = importedSourceMaterializationSchema.parse({
      sourceAssetId: sourceAsset.asset.id,
      content: feature.parameters,
      ...sourceAsset,
    })
    if (!source.brepHit) {
      const outputs = await rebuildOcctSourceImport(opencascade, materialized)
      return aggregateOwnedOutputs(
        opencascade,
        outputs.map(({ outputRole, shape }) => ({ role: outputRole, shape })),
      )
    }
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(materialized.bytes))
    const actualHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    if (actualHash !== materialized.asset.digest)
      throw new Error("The cached imported source digest does not match its bytes.")
  }
  if (!source.brepHit) {
    validateCombinationSources(opencascade, source.dependencies)
    if (feature.kind === "imported")
      throw new Error("Imported source materialization did not produce geometry.")
    if (feature.kind === "split" || feature.kind === "pattern")
      return createGeneratedBodyBundle(opencascade, source.dependencies[0], feature)
    return createOcctBodyCompound(opencascade, source.dependencies, feature.parameters.outputRoles)
  }
  const roles = bodyBundleRoles(feature)
  const outputs = roles.map((role) => {
    const shape = registry.getOutput(input.documentId, input.featureId, input.contentHash, role)
    if (!shape) throw new Error("An exact authored output role is unavailable.")
    return { role, shape }
  })
  return { shape: source.shape, outputs }
}

function disposeUncachedBodyBundle(
  bundle: OwnedBodyCombination | null,
  snapshots: WeakMap<Shape3D, TopologyCaptureSnapshot>,
): boolean {
  const cleanupSucceeded = disposeBodyCombination(bundle)
  if (bundle) {
    snapshots.delete(bundle.shape)
    for (const output of bundle.outputs) snapshots.delete(output.shape)
  }
  return cleanupSucceeded
}

function resolveFeatureShapeSource(
  registry: DocumentFeatureShapeRegistry<Shape3D>,
  input: FeatureEvaluationInput,
): FeatureShapeSource {
  const requested =
    input.content.schemaVersion === 2
      ? input.content.feature.inputSlots.map((slot) => ({
          featureId: input.dependencies[slot.inputIndex]?.featureId ?? "",
          contentHash: slot.contentHash,
          outputRole: slot.outputRole,
        }))
      : input.dependencies
  // Validate each ordered exact body even when the combination itself has a cached B-Rep.
  const dependencies = registry.resolve(input.documentId, requested)
  if (!dependencies) {
    return featureFailure(
      "missing-feature-dependency",
      "One or more exact feature dependency shapes are unavailable.",
    )
  }

  const cached = registry.get(input.documentId, input.featureId, input.contentHash)
  if (cached) return { ok: true, shape: cached, brepHit: true }

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

export type AssemblyNativeBody = Readonly<{
  documentId: string
  featureId: string
  contentHash: string
  outputRole: string
  pose: import("@vibeshape/protocol").AssemblyInspection["occurrences"][number]["geometryFrame"]
}>

export interface GeometryKernelEngine {
  initialize(): Promise<GeometryEngineMetadata>
  isInitialized(): boolean
  getFeatureContentEnvironment(): FeatureContentEnvironment | null
  evaluateFeature(
    input: FeatureEvaluationInput,
    reportProgress: ProgressReporter,
    sourceAsset?: SourceAssetMaterialization,
  ): Promise<FeatureEvaluationResult>
  sectionPlanarFace?(input: PlanarFaceSectionInput): Promise<PlanarFaceSectionResult>
  inspectSourceImport?: (input: InspectSourceImportInput) => Promise<SourceImportInspection>
  inspectAssemblyInterference?: (
    left: readonly AssemblyNativeBody[],
    right: readonly AssemblyNativeBody[],
  ) => Promise<{ volume: number; solidCount: number }>
  exportAssemblyStep?: (sources: readonly AssemblyNativeBody[]) => Promise<Uint8Array>
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

export type GeometryShellOpeningResolver = (
  references: ShellFeatureContentParameters["openings"],
  candidates: readonly TopologyCaptureSnapshot["candidates"][number][],
  scope: { featureId: string; outputRole: string },
  mode?: "exact" | "durable",
  options?: { allowSemanticRebinding?: boolean },
) =>
  | { ok: true; candidateIds: readonly string[] }
  | { ok: false; reason: "missing" | "ambiguous" | "changed" | "duplicate" }
class ShellOpeningRepairError extends Error {
  constructor(reason: string) {
    super(`Shell opening faces are ${reason}. Reselect the opening faces on the current body.`)
  }
}
class ConstrainedLoftError extends Error {}

function shellOpeningShapeKeys(candidateIds: readonly string[], snapshot: TopologyCaptureSnapshot) {
  return candidateIds.map((id) => {
    const key = snapshot.transientShapeKeys.get(id)
    if (!id.startsWith("face:") || key === undefined) throw new ShellOpeningRepairError("missing")
    return key
  })
}

export type GeometryTopologyResolver = (
  references: readonly SelectedEdgeReference[],
  candidates: readonly TopologyCaptureSnapshot["candidates"][number][],
  sourceFeatureId: string,
) => readonly string[]

export class ReplicadGeometryEngine implements GeometryKernelEngine {
  readonly #ownedShapes = new OwnedShapeRegistry()
  readonly #topologySnapshots = new WeakMap<Shape3D, TopologyCaptureSnapshot>()
  readonly #modifierExtrusionShapes = new WeakSet<Shape3D>()
  readonly #featureShapes = new DocumentFeatureShapeRegistry<Shape3D>((shape) =>
    this.#topologySnapshots.delete(shape),
  )
  #metadata: GeometryEngineMetadata | null = null
  #opencascade: OpenCascadeModule | null = null
  #initialization: Promise<GeometryEngineMetadata> | null = null

  constructor(
    private readonly resolveReferences?: GeometryTopologyResolver,
    private readonly resolveShellOpenings?: GeometryShellOpeningResolver,
  ) {}

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
    request: FeatureEvaluationInput,
    reportProgress: ProgressReporter,
    sourceAsset?: SourceAssetMaterialization,
  ): Promise<FeatureEvaluationResult> {
    const parsed = parseFeatureRequest(request)
    if (!parsed.ok) return parsed
    const input = parsed.input
    const engine = await this.initialize()
    const opencascade = this.#opencascade
    if (!opencascade) {
      return featureFailure("invalid-feature-geometry", "OpenCascade did not initialize.")
    }

    const feature = parsed.feature
    if (
      feature.kind === "compound" ||
      feature.kind === "split" ||
      feature.kind === "pattern" ||
      feature.kind === "imported"
    )
      return this.#evaluateBodyBundle(
        input,
        feature,
        opencascade,
        engine,
        reportProgress,
        sourceAsset,
      )

    return this.#evaluateSingleBodyFeature(input, feature, opencascade, engine, reportProgress)
  }

  #evaluateSingleBodyFeature(
    input: FeatureEvaluationInput,
    feature: Exclude<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
    opencascade: OpenCascadeInstance,
    engine: GeometryEngineMetadata,
    reportProgress: ProgressReporter,
  ): FeatureEvaluationResult {
    reportProgress("feature-validation", 0.1)
    const totalStartedAt = performance.now()
    const source = resolveFeatureShapeSource(this.#featureShapes, input)
    if (!source.ok) return source
    let temporaryShape: Shape3D | null = null

    try {
      reportProgress("feature-evaluation", 0.35)
      const evaluatedShape = createFeatureEvaluationShape(
        opencascade,
        source,
        feature,
        input,
        (module, feature, dependencies, featureInput) =>
          this.#createUncachedFeature(module, feature, dependencies, featureInput),
      )
      temporaryShape = evaluatedShape.temporaryShape
      const evaluation = evaluateFeatureGeometry(opencascade, evaluatedShape.shape, feature)
      this.#topologySnapshots.set(evaluatedShape.shape, evaluation.topologySnapshot)
      if (modifierExtrusionHasHeuristicFaces(feature))
        this.#modifierExtrusionShapes.add(evaluatedShape.shape)

      reportProgress("feature-tessellation", 0.7)
      const tessellation = tessellateFeatureGeometry(opencascade, evaluatedShape.shape, input.mesh)

      temporaryShape = cacheFeatureEvaluation(
        this.#featureShapes,
        input,
        temporaryShape,
        evaluation.outputs,
      )

      reportProgress("complete", 1)
      return {
        ok: true,
        result: featureEvaluationResult(
          engine,
          evaluation,
          tessellation,
          source.brepHit,
          elapsed(totalStartedAt),
        ),
      }
    } catch (error) {
      const cleanupSucceeded = disposeTemporaryShape(temporaryShape)
      if (cleanupSucceeded && error instanceof ShellOpeningRepairError)
        return featureFailure("invalid-feature-parameters", error.message)
      if (cleanupSucceeded && error instanceof ConstrainedLoftError)
        return featureFailure("invalid-feature-geometry", error.message)
      return featureFailure(
        "invalid-feature-geometry",
        cleanupSucceeded
          ? "Feature geometry evaluation failed."
          : "Feature geometry evaluation failed and temporary shape cleanup did not complete.",
      )
    }
  }

  async #evaluateBodyBundle(
    input: FeatureEvaluationInput,
    feature: Extract<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
    opencascade: OpenCascadeInstance,
    engine: GeometryEngineMetadata,
    reportProgress: ProgressReporter,
    sourceAsset?: SourceAssetMaterialization,
  ): Promise<FeatureEvaluationResult> {
    reportProgress("feature-validation", 0.1)
    const startedAt = performance.now()
    const source = resolveFeatureShapeSource(this.#featureShapes, input)
    if (!source.ok) return source
    let temporary: OwnedBodyCombination | null = null
    try {
      reportProgress("feature-evaluation", 0.35)
      const { shape, outputs } = await bodyBundleForEvaluation(
        this.#featureShapes,
        input,
        feature,
        source,
        opencascade,
        sourceAsset,
      )
      if (!source.brepHit) temporary = { shape, outputs }
      const evaluation = evaluateFeatureGeometry(opencascade, shape, feature)
      this.#topologySnapshots.set(shape, evaluation.topologySnapshot)
      reportProgress("feature-tessellation", 0.7)
      const tessellation = tessellateFeatureGeometry(opencascade, shape, input.mesh)
      const bodies = outputs.map((output) => {
        const result = evaluateOwnedBody(opencascade, output, input.mesh)
        this.#topologySnapshots.set(output.shape, result.snapshot)
        return result.body
      })
      if (temporary) {
        this.#featureShapes.replace(
          input.documentId,
          input.featureId,
          input.contentHash,
          temporary.shape,
          temporary.outputs,
        )
        temporary = null
      }
      reportProgress("complete", 1)
      return {
        ok: true,
        result: {
          ...featureEvaluationResult(
            engine,
            evaluation,
            tessellation,
            source.brepHit,
            elapsed(startedAt),
          ),
          bodies,
        },
      }
    } catch {
      const cleanupSucceeded = disposeUncachedBodyBundle(temporary, this.#topologySnapshots)
      return featureFailure(
        "invalid-feature-geometry",
        cleanupSucceeded
          ? feature.kind === "split"
            ? "Split plane must cross the body and produce two connected positive-volume pieces."
            : "Compound geometry evaluation failed."
          : "Named body evaluation failed and temporary shape cleanup did not complete.",
      )
    }
  }

  #createUncachedFeature(
    opencascade: OpenCascadeInstance,
    feature: Exclude<ParsedFeature, { kind: "compound" | "split" | "pattern" | "imported" }>,
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) {
    if (feature.kind === "constrained-loft")
      return this.#createConstrainedLoft(opencascade, feature.parameters, dependencies, input)
    return this.#createUncachedStandardFeature(opencascade, feature, dependencies, input)
  }

  #createUncachedStandardFeature(
    opencascade: OpenCascadeInstance,
    feature: Exclude<
      ParsedFeature,
      { kind: "compound" | "split" | "pattern" | "imported" | "constrained-loft" }
    >,
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) {
    if (feature.kind === "union") {
      validateCombinationSources(opencascade, dependencies)
      return createOcctBodyUnion(opencascade, dependencies)
    }
    if (feature.kind === "placement") {
      return createPlacementFeatureShape(opencascade, feature.parameters, dependencies[0])
    }
    if (feature.kind === "mirror")
      return createMirrorFeatureShape(opencascade, feature.parameters, dependencies[0])
    if (feature.kind === "thread") {
      const target = dependencies[0]
      if (!target) throw new Error("Thread target body is unavailable.")
      return threadOcctShape(opencascade, target, feature.parameters)
    }
    if (feature.kind === "shell")
      return this.#createShellFeature(opencascade, feature, dependencies[0], input)

    if (feature.kind !== "selected-fillet" && feature.kind !== "selected-chamfer") {
      return createFeatureShape(opencascade, feature, dependencies)
    }
    return this.#createSelectedEdgeFeature(opencascade, feature, dependencies, input)
  }

  #takeLoftEndSupport(
    entry: LoftFeatureContentParametersV3["start"][number],
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) {
    const body = dependencies[entry.supportInputIndex],
      dependency = input.dependencies[entry.supportInputIndex],
      snapshot = body ? this.#topologySnapshots.get(body) : undefined
    if (!body || !snapshot || !dependency?.outputRole || !this.resolveShellOpenings)
      throw new Error("Exact named Loft end support topology is unavailable.")
    const face = takeResolvedBodyFace(
      body,
      snapshot,
      entry.support,
      { featureId: dependency.featureId, outputRole: dependency.outputRole },
      this.resolveShellOpenings,
    )
    return face
  }

  #createConstrainedLoft(
    occt: OpenCascadeInstance,
    parameters: LoftFeatureContentParametersV3,
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) {
    const supports: Face[] = []
    const resolve = (entries: LoftFeatureContentParametersV3["start"]): LoftEndSupport[] =>
      entries.map((entry) => {
        const face = this.#takeLoftEndSupport(entry, dependencies, input)
        supports.push(face)
        return { segmentTrack: entry.segmentTrack, continuity: entry.continuity, support: face }
      })
    try {
      return createOcctLoftPatchNetwork(occt, {
        ...parameters,
        start: resolve(parameters.start),
        end: resolve(parameters.end),
      })
    } catch (error) {
      throw new ConstrainedLoftError(
        error instanceof Error ? error.message : "Exact OCCT constrained Loft construction failed.",
      )
    } finally {
      for (const face of supports.reverse()) face.delete()
    }
  }

  #createShellFeature(
    opencascade: OpenCascadeInstance,
    feature: Extract<ParsedFeature, { kind: "shell" }>,
    target: Shape3D | undefined,
    input: FeatureEvaluationInput,
  ) {
    const { parameters } = feature
    if (!target) throw new ShellOpeningRepairError("unavailable")
    validateCombinationSources(opencascade, [target])
    if (parameters.openings.length === 0)
      return shellOcctShape(opencascade, target, [], parameters.thickness, parameters.direction)
    const keys = this.#resolveShellOpeningKeys(feature, target, input)
    return shellOcctShape(opencascade, target, keys, parameters.thickness, parameters.direction)
  }

  #resolveShellOpeningKeys(
    feature: Extract<ParsedFeature, { kind: "shell" }>,
    target: Shape3D,
    input: FeatureEvaluationInput,
  ) {
    const snapshot = this.#topologySnapshots.get(target)
    const dependency = input.dependencies[0]
    if (!snapshot || !dependency?.outputRole || !this.resolveShellOpenings)
      throw new ShellOpeningRepairError("unavailable")
    const resolved = this.resolveShellOpenings(
      feature.parameters.openings,
      snapshot.candidates,
      {
        featureId: dependency.featureId,
        outputRole: dependency.outputRole,
      },
      feature.openingResolution,
      { allowSemanticRebinding: !this.#modifierExtrusionShapes.has(target) },
    )
    if (!resolved.ok) throw new ShellOpeningRepairError(resolved.reason)
    return shellOpeningShapeKeys(resolved.candidateIds, snapshot)
  }

  #createSelectedEdgeFeature(
    opencascade: OpenCascadeInstance,
    feature: Extract<ParsedFeature, { kind: "selected-fillet" | "selected-chamfer" }>,
    dependencies: readonly Shape3D[],
    input: FeatureEvaluationInput,
  ) {
    const target = dependencies[0]
    const snapshot = target ? this.#topologySnapshots.get(target) : undefined
    if (!snapshot) throw new Error("Exact source topology is unavailable for selected edges.")
    return createSelectedEdgeTreatmentShape(
      opencascade,
      feature,
      target,
      snapshot,
      input.dependencies[0]?.featureId ?? "",
      this.resolveReferences,
    )
  }

  async sectionPlanarFace(input: PlanarFaceSectionInput): Promise<PlanarFaceSectionResult> {
    await this.initialize()
    const opencascade = this.#opencascade
    if (!opencascade) return sectionFailure("invalid-plane", "OpenCascade did not initialize.")
    const shape = this.#featureShapes.get(
      input.documentId,
      input.sourceFeatureId,
      input.sourceContentHash,
    )
    if (!shape)
      return sectionFailure("missing-body", "The exact source feature body is unavailable.")
    return sectionPlanarFace(opencascade, shape, input)
  }

  async inspectSourceImport(input: InspectSourceImportInput): Promise<SourceImportInspection> {
    const parsed = inspectSourceImportInputSchema.parse(input)
    await this.initialize()
    const occt = this.#opencascade
    if (!occt) throw new Error("OpenCascade did not initialize.")
    const inspected = await inspectOcctSourceImport(occt, parsed.source, parsed.bytes)
    let outcome: { ok: true; value: SourceImportInspection } | { ok: false; error: unknown }
    try {
      outcome = {
        ok: true,
        value: sourceImportInspectionSchema.parse({
          unitEvidence: inspected.unitEvidence,
          outputs: inspected.candidates.map(({ shape, signature }) => ({
            signature,
            mesh: tessellateFeatureGeometry(occt, shape, parsed.mesh).mesh,
          })),
        }),
      }
    } catch (error) {
      outcome = { ok: false, error }
    }
    const first = inspected.candidates[0]
    const cleanup =
      !first ||
      disposeBodyCombination({
        shape: first.shape,
        outputs: inspected.candidates.map(({ shape }, index) => ({
          role: `inspection.${index}`,
          shape,
        })),
      })
    if (!cleanup)
      throw new AggregateError(
        outcome.ok ? [] : [outcome.error],
        "Source inspection could not release every native body.",
      )
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  async inspectAssemblyInterference(
    left: readonly AssemblyNativeBody[],
    right: readonly AssemblyNativeBody[],
  ) {
    const occt = this.#opencascade
    if (!occt) throw new Error("OpenCascade did not initialize.")
    return measureOcctInterference(occt, this.#assemblySources(left), this.#assemblySources(right))
  }

  #assemblySources(sources: readonly AssemblyNativeBody[]) {
    return sources.map((source) => {
      const shape = this.#featureShapes.getOutput(
        source.documentId,
        source.featureId,
        source.contentHash,
        source.outputRole,
      )
      if (!shape) throw new Error("A pinned exact assembly body is unavailable.")
      return { shape, pose: source.pose }
    })
  }

  async exportAssemblyStep(sources: readonly AssemblyNativeBody[]) {
    const occt = this.#opencascade
    if (!occt) throw new Error("OpenCascade did not initialize.")
    return exportOcctAssemblyStep(occt, this.#assemblySources(sources))
  }

  async exportDocument(input: DocumentGeometryExportInput): Promise<DocumentGeometryExportResult> {
    const opencascade = this.#opencascade
    if (!opencascade) throw new Error("OpenCascade did not initialize.")
    if (input.features.length === 0) throw new Error("No exportable feature bodies were provided.")

    if (isTexturedStlExport(input)) {
      const result = await this.exportPrintMeshes(input)
      const file = encodeSurfaceTextureStl(
        result.meshes.map((mesh) => ({
          positions: Float32Array.from(mesh.vertices),
          normals: new Float32Array(mesh.vertices.length),
          indices: Uint32Array.from(mesh.triangles),
          triangleFaceIds: new Uint32Array(mesh.triangles.length / 3),
        })),
      )
      return { file, bodyCount: result.meshes.length }
    }

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
    validateTextureExportBodies(input)
    const sourceShapes = this.#featureShapes.resolve(input.documentId, input.features)
    if (!sourceShapes)
      throw new Error("One or more exact feature bodies are unavailable for export.")
    const budget = createTextureExportBudget(input)
    const meshes: Array<DocumentPrintMeshExportResult["meshes"][number]> = []
    for (const [index, shape] of sourceShapes.entries()) {
      try {
        const source = meshOcctShape(opencascade, shape, {
          tolerance: PRINT_MESH_CHORD_TOLERANCE_MM,
          angularTolerance: PRINT_MESH_ANGULAR_TOLERANCE_RAD,
        })
        const feature = input.features[index]
        if (!feature) throw new Error("Print mesh export lost its selected body identity.")
        const mesh = await texturePrintMesh(
          source,
          exportTextureLayers(input, feature),
          budget.currentQuality(),
        )
        budget.consume(mesh.triangles.length / 3)
        meshes.push({
          featureId: feature.featureId,
          ...(feature.outputRole ? { outputRole: feature.outputRole } : {}),
          ...mesh,
        })
      } finally {
        opencascade.BRepTools.Clean(shape.wrapped, true)
      }
    }
    return { meshes }
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
