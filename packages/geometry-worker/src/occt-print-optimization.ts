import {
  type PrintOptimizationReconstruction,
  type PrintOptimizationReconstructionInput,
  printOptimizationReconstructionInputSchema,
  printOptimizationReconstructionSchema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type {
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Face,
  TopoDS_Shape,
} from "replicad-opencascadejs"
import { removeCollapsedNativePrintTriangles } from "./native-print-mesh"
import { copyOcctRigidShape } from "./occt-assembly-pose"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { exportOcctStep } from "./occt-exchange"
import { meshOcctShape } from "./occt-mesh"
import { createOcctBox } from "./occt-shapes"

type Point = [number, number, number]
type Bounds = { min: Point; max: Point }
type CellBox = { min: Point; max: Point }
type Deletable = { delete(): void }
const tolerance = 1e-6

function bounds(occt: OpenCascadeInstance, shape: TopoDS_Shape): Bounds {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape, box, false, true)
    if (box.IsVoid() || box.IsOpen())
      throw new Error("Print reconstruction requires finite exact bounds.")
    const values = Array.from({ length: 6 }, () => ({ current: Number.NaN }))
    Reflect.apply(box.Get, box, values)
    const coordinates = values.map(({ current }) => current)
    if (coordinates.some((value) => !Number.isFinite(value)))
      throw new Error("Invalid exact source bounds.")
    return { min: coordinates.slice(0, 3) as Point, max: coordinates.slice(3, 6) as Point }
  } finally {
    box.delete()
  }
}

function rotate(
  [x, y, z]: Point,
  [qx, qy, qz, qw]: readonly [number, number, number, number],
): Point {
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x)
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ]
}

function transformedBounds(source: Bounds, transform: (point: Point) => Point): Bounds {
  const corners: Point[] = []
  for (const x of [source.min[0], source.max[0]])
    for (const y of [source.min[1], source.max[1]])
      for (const z of [source.min[2], source.max[2]]) corners.push(transform([x, y, z]))
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis] ?? 0))) as Point,
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis] ?? 0))) as Point,
  }
}

function separation(left: Bounds, right: Bounds) {
  return Math.hypot(
    ...left.min.map((value, axis) =>
      Math.max(0, value - (right.max[axis] ?? 0), (right.min[axis] ?? 0) - (left.max[axis] ?? 0)),
    ),
  )
}

function collectSourceFaces(occt: OpenCascadeInstance, source: Shape3D) {
  const faces: TopoDS_Face[] = []
  const explorer = new occt.TopExp_Explorer_2(
    source.wrapped,
    occt.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    while (explorer.More()) {
      const raw = explorer.Current()
      try {
        faces.push(occt.TopoDS.Face_1(raw))
      } finally {
        raw.delete()
      }
      explorer.Next()
    }
    return faces
  } catch (error) {
    for (const face of faces) face.delete()
    throw error
  } finally {
    explorer.delete()
  }
}

/** The selected wrappers are borrowed from the request-owned source face collection. */
function selectedFaces(faces: readonly TopoDS_Face[], ids: readonly number[]) {
  const requested = new Set(ids)
  const matches = new Map<number, TopoDS_Face>()
  for (const face of faces) {
    const key = face.HashCode(2_147_483_647)
    if (!requested.has(key)) continue
    const previous = matches.get(key)
    if (previous && !previous.IsSame(face))
      throw new Error("A preserved native face identity is ambiguous.")
    matches.set(key, face)
  }
  if (matches.size !== requested.size)
    throw new Error("A preserved face is stale or unavailable in the active exact source.")
  return [...matches.values()]
}

function distanceToFace(occt: OpenCascadeInstance, tool: TopoDS_Shape, face: TopoDS_Face) {
  const distance = new occt.BRepExtrema_DistShapeShape_1()
  const progress = new occt.Message_ProgressRange_1()
  try {
    distance.SetDeflection(1e-9)
    distance.LoadS1(tool)
    distance.LoadS2(face)
    distance.Perform(progress)
    if (!distance.IsDone() || !Number.isFinite(distance.Value()))
      throw new Error("Exact preserved-face distance did not complete.")
    return distance.Value()
  } finally {
    progress.delete()
    distance.delete()
  }
}

function worldTool(
  occt: OpenCascadeInstance,
  box: Bounds,
  frame: PrintOptimizationReconstructionInput["sourceToPrintFrame"],
) {
  const size = box.max.map((value, axis) => value - (box.min[axis] ?? 0)) as Point
  const source = createOcctBox(occt, size, false, [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    box.min[2],
  ])
  try {
    const [x, y, z, w] = frame.rotation
    return copyOcctRigidShape(occt, {
      shape: source,
      pose: { translation: frame.originMm, quaternion: [-x, -y, -z, w] },
    })
  } finally {
    source.delete()
  }
}

function layerRectangles(range: Bounds, z: number, canRemove: (cell: Point) => boolean) {
  const rectangles: CellBox[] = []
  let previousRow = new Map<string, CellBox>()
  for (let y = range.min[1]; y < range.max[1]; y++) {
    const row = new Map<string, CellBox>()
    let runStart: number | null = null
    const finishRun = (end: number) => {
      if (runStart === null) return
      const key = `${runStart}:${end}`
      const existing = previousRow.get(key)
      const rectangle = existing ?? {
        min: [runStart, y, z] as Point,
        max: [end, y + 1, z + 1] as Point,
      }
      rectangle.max[1] = y + 1
      row.set(key, rectangle)
      if (!existing) rectangles.push(rectangle)
      runStart = null
    }
    for (let x = range.min[0]; x < range.max[0]; x++) {
      if (canRemove([x, y, z])) {
        if (runStart === null) runStart = x
      } else finishRun(x)
    }
    finishRun(range.max[0])
    previousRow = row
  }
  return rectangles
}

/** Stream row runs and merge complete rectangles; scratch memory never stores every removal cell. */
function coalesce(range: Bounds, canRemove: (cell: Point) => boolean) {
  const boxes: CellBox[] = []
  let previousLayer = new Map<string, CellBox>()
  for (let z = range.min[2]; z < range.max[2]; z++) {
    const layer = new Map<string, CellBox>()
    for (const rectangle of layerRectangles(range, z, canRemove)) {
      const key = `${rectangle.min[0]}:${rectangle.max[0]}:${rectangle.min[1]}:${rectangle.max[1]}`
      const existing = previousLayer.get(key)
      const box = existing ?? rectangle
      box.max[2] = z + 1
      layer.set(key, box)
      if (!existing) boxes.push(box)
    }
    previousLayer = layer
  }
  return boxes
}

function gridRange(
  source: Bounds,
  grid: PrintOptimizationReconstructionInput["voxelGrid"],
): Bounds {
  const min = source.min.map((value, axis) =>
    Math.floor((value - (grid.originMm[axis] ?? 0)) / grid.cellSizeMm),
  ) as Point
  const max = source.max.map((value, axis) =>
    Math.ceil((value - (grid.originMm[axis] ?? 0)) / grid.cellSizeMm),
  ) as Point
  if (
    [...min, ...max].some((value) => !Number.isSafeInteger(value)) ||
    min.some((value, axis) => value >= (max[axis] ?? value))
  )
    throw new Error("Exact source lattice coordinates cannot be represented safely.")
  return { min, max }
}

function physicalBox(
  box: CellBox,
  grid: PrintOptimizationReconstructionInput["voxelGrid"],
): Bounds {
  const point = (cell: Point) =>
    cell.map((value, axis) => (grid.originMm[axis] ?? 0) + value * grid.cellSizeMm) as Point
  return { min: point(box.min), max: point(box.max) }
}

type FaceDistanceContext = {
  occt: OpenCascadeInstance
  faces: readonly TopoDS_Face[]
  faceBounds: readonly Bounds[]
  frame: PrintOptimizationReconstructionInput["sourceToPrintFrame"]
}

function outsideFaces(context: FaceDistanceContext, box: Bounds, depthMm: number) {
  const nearby = context.faces.filter((_, index) => {
    const face = context.faceBounds[index]
    return face && separation(box, face) <= depthMm + tolerance
  })
  if (!nearby.length) return true
  const tool = worldTool(context.occt, box, context.frame)
  try {
    return nearby.every((face) => distanceToFace(context.occt, tool, face) > depthMm + tolerance)
  } finally {
    tool.delete()
  }
}

function patchIntersection(
  cell: Bounds,
  patch: PrintOptimizationReconstructionInput["protectedBoxes"][number],
): Bounds | null {
  const min = cell.min.map((value, axis) => Math.max(value, patch.minMm[axis] ?? value)) as Point
  const max = cell.max.map((value, axis) => Math.min(value, patch.maxMm[axis] ?? value)) as Point
  if (min.some((value, axis) => value > (max[axis] ?? value) + tolerance)) return null
  // Closed contact must become a valid solid tool without losing a boundary on a cell/patch plane.
  for (const axis of [0, 1, 2] as const) {
    if (max[axis] - min[axis] > 2 * tolerance) continue
    const middle = (min[axis] + max[axis]) / 2
    min[axis] = middle - tolerance
    max[axis] = middle + tolerance
  }
  return { min, max }
}

function outsideBoundaryPatches(
  context: FaceDistanceContext,
  box: Bounds,
  patches: PrintOptimizationReconstructionInput["protectedBoxes"],
) {
  return patches.every((patch) => {
    const intersection = patchIntersection(box, patch)
    return !intersection || outsideFaces(context, intersection, 0)
  })
}

function cut(occt: OpenCascadeInstance, source: Shape3D, tools: readonly TopoDS_Shape[]) {
  const owned: Deletable[] = []
  const own = <T extends Deletable>(value: T): T => {
    owned.push(value)
    return value
  }
  try {
    const argumentsList = own(new occt.TopTools_ListOfShape_1())
    const toolList = own(new occt.TopTools_ListOfShape_1())
    own(argumentsList.Append_1(source.wrapped))
    for (const tool of tools) own(toolList.Append_1(tool))
    const builder = own(new occt.BRepAlgoAPI_Cut_1())
    builder.SetArguments(argumentsList)
    builder.SetTools(toolList)
    builder.SetNonDestructive(true)
    builder.SetToFillHistory(false)
    builder.Build(own(new occt.Message_ProgressRange_1()))
    if (!builder.IsDone() || builder.HasErrors())
      throw new Error("Exact print reconstruction Boolean did not complete.")
    return adoptOcctShape(builder.Shape(), castOcctShape)
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}

function provePreservedFaces(
  occt: OpenCascadeInstance,
  result: Shape3D,
  faces: readonly TopoDS_Face[],
) {
  const found = new Set<number>()
  const explorer = new occt.TopExp_Explorer_2(
    result.wrapped,
    occt.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    while (explorer.More()) {
      const candidate = explorer.Current()
      try {
        for (const [index, face] of faces.entries()) if (candidate.IsSame(face)) found.add(index)
      } finally {
        candidate.delete()
      }
      explorer.Next()
    }
    if (found.size !== faces.length)
      throw new Error("Exact reconstruction changed a preserved original face.")
    return found.size
  } finally {
    explorer.delete()
  }
}

/** Disposable exact source-minus-cell reconstruction. Never owns or mutates the cached source. */
export function reconstructOcctPrintOptimization(
  occt: OpenCascadeInstance,
  source: Shape3D,
  input: PrintOptimizationReconstructionInput,
): PrintOptimizationReconstruction {
  const request = printOptimizationReconstructionInputSchema.parse(input)
  const original = inspectOcctBody(occt, source)
  if (!original.valid || original.solidCount !== 1 || !(original.volume > 0))
    throw new Error("Print reconstruction requires one valid exact source solid.")
  const sourceFaces = collectSourceFaces(occt, source)
  const tools: TopoDS_Shape[] = []
  let result: Shape3D | null = null,
    exportShape: Shape3D | null = null
  try {
    const faces = selectedFaces(sourceFaces, request.preserveFaceIds)
    const { originMm, rotation } = request.sourceToPrintFrame
    const toPrint = (point: Point) =>
      rotate(point.map((value, axis) => value - (originMm[axis] ?? 0)) as Point, rotation)
    const sourceBounds = transformedBounds(bounds(occt, source.wrapped), toPrint)
    const sourceBoundary: FaceDistanceContext = {
      occt,
      faces: sourceFaces,
      faceBounds: sourceFaces.map((face) => transformedBounds(bounds(occt, face), toPrint)),
      frame: request.sourceToPrintFrame,
    }
    const preservedSkin: FaceDistanceContext = {
      ...sourceBoundary,
      faces,
      faceBounds: faces.map((face) => transformedBounds(bounds(occt, face), toPrint)),
    }
    const grid = request.voxelGrid
    const range = gridRange(sourceBounds, grid)
    const retained = new Set(grid.cells.map((cell) => cell.join(":")))
    const removal = coalesce(range, ([x, y, z]) => {
      if (retained.has(`${x}:${y}:${z}`)) return false
      const box = physicalBox({ min: [x, y, z], max: [x + 1, y + 1, z + 1] }, grid)
      if (!outsideBoundaryPatches(sourceBoundary, box, request.protectedBoxes)) return false
      return outsideFaces(preservedSkin, box, request.preserveDepthMm)
    })
    if (!removal.length) throw new Error("Exact print reconstruction does not remove material.")
    for (const box of removal)
      tools.push(worldTool(occt, physicalBox(box, grid), request.sourceToPrintFrame))
    result = cut(occt, source, tools)
    const metrics = inspectOcctBody(occt, result)
    if (!metrics.valid || metrics.solidCount !== 1 || !(metrics.volume > 0))
      throw new Error(
        "Exact print reconstruction must remain one valid positive-volume solid without detached material.",
      )
    if (!(metrics.volume < original.volume - Math.max(1e-8, original.volume * 1e-10)))
      throw new Error("Exact print reconstruction does not remove material.")
    const preservedFaceCount = provePreservedFaces(occt, result, faces)
    // A deep rigid copy owns triangulations, including the faces shared with the immutable source.
    exportShape = adoptOcctShape(
      copyOcctRigidShape(occt, {
        shape: result,
        pose: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      }),
      castOcctShape,
    )
    const stepBytes = exportOcctStep(occt, exportShape.wrapped)
    const mesh = removeCollapsedNativePrintTriangles(
      meshOcctShape(occt, exportShape, {
        tolerance: Math.min(0.01, grid.cellSizeMm / 50),
        angularTolerance: 0.05,
      }),
    )
    return printOptimizationReconstructionSchema.parse({
      source: request.source,
      stepBytes,
      verificationMesh: {
        positions: Float64Array.from(mesh.vertices),
        indices: Uint32Array.from(mesh.triangles),
      },
      sourceVolumeMm3: original.volume,
      volumeMm3: metrics.volume,
      preservedFaceCount,
    })
  } finally {
    exportShape?.delete()
    result?.delete()
    for (const tool of tools.reverse()) tool.delete()
    for (const face of sourceFaces.reverse()) face.delete()
  }
}
