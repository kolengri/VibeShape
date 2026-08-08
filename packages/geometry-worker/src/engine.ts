import type {
  GeometryEngineMetadata,
  GeometryProgressStage,
  KernelSpikeEngineResult,
  KernelSpikeParameters,
  TopologyCandidate,
  TopologySpikeEngineResult,
  TopologySpikeParameters,
} from "@vibeshape/protocol"
import { isAnyObject } from "is-what"
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import opencascadeWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url"
import {
  GEOMETRY_ADAPTER_VERSION,
  OPENCASCADE_SOURCE_REVISION,
  REPLICAD_OPENCASCADE_VERSION,
  REPLICAD_VERSION,
} from "./build-info"
import {
  createMemoryProfile,
  getWasmHeapBytes,
  type OpenCascadeMemoryModule,
} from "./memory-profile"
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
} from "./occt-shapes"
import { OwnedShapeRegistry } from "./shape-registry"
import {
  captureReplicadTopologyCandidates,
  captureReplicadTopologySnapshot,
  type TopologyCandidateContext,
  type TopologyCaptureSnapshot,
} from "./topology-signatures"

type ProgressReporter = (stage: GeometryProgressStage, fraction: number) => void

type OpenCascadeModule = OpenCascadeInstance & OpenCascadeMemoryModule

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
  parameters: KernelSpikeParameters,
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
  disposeDocument(documentId: string): number
}

export class ReplicadGeometryEngine implements GeometryKernelEngine {
  readonly #ownedShapes = new OwnedShapeRegistry()
  #metadata: GeometryEngineMetadata | null = null
  #opencascade: OpenCascadeModule | null = null
  #initialization: Promise<GeometryEngineMetadata> | null = null

  isInitialized() {
    return this.#metadata !== null && this.#opencascade !== null
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
    }

    return this.#metadata
  }

  getHealth() {
    return {
      initialized: this.isInitialized(),
      ownedShapeCount: this.#ownedShapes.size,
      wasmHeapBytes: getWasmHeapBytes(this.#opencascade),
    }
  }

  disposeDocument(_documentId: string) {
    this.#ownedShapes.disposeAll()
    return this.#ownedShapes.size
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
