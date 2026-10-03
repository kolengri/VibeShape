/// <reference path="./upstream.d.ts" />
import DxfParser from "dxf-parser/dist/dxf-parser.js"
import { z } from "zod"
import { identityTransform, multiplyTransforms, scaledPoint2, validateTransform } from "./affine"
import {
  type ImportedCurve,
  type ImportedCurvePath,
  type ImportLengthUnit,
  type ImportLimits,
  importLabel,
  LENGTH_UNIT_MM,
  type ParsedGeometryImport,
  requireImport,
} from "./contracts"
import { preflightDxf } from "./dxf-preflight"

const finite = z.number().finite()
const point = z
  .object({ x: finite, y: finite, z: finite.optional(), bulge: finite.optional() })
  .passthrough()
const common = {
  layer: z.string().max(256).optional(),
  handle: z.union([z.string().max(256), z.number().int().nonnegative()]).optional(),
}
const polyline = {
  ...common,
  vertices: z.array(point).min(2).max(10_001),
  shape: z.boolean().optional(),
  elevation: finite.optional(),
  is3dPolyline: z.boolean().optional(),
  is3dPolygonMesh: z.boolean().optional(),
  isPolyfaceMesh: z.boolean().optional(),
  includesCurveFitVertices: z.boolean().optional(),
  includesSplineFitVertices: z.boolean().optional(),
}
const entitySchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("LINE"), ...common, vertices: z.array(point).length(2) })
    .passthrough(),
  z
    .object({
      type: z.literal("ARC"),
      ...common,
      center: point,
      radius: finite.positive(),
      startAngle: finite,
      endAngle: finite,
    })
    .passthrough(),
  z
    .object({ type: z.literal("CIRCLE"), ...common, center: point, radius: finite.positive() })
    .passthrough(),
  z
    .object({
      type: z.literal("ELLIPSE"),
      ...common,
      center: point,
      majorAxisEndPoint: point,
      axisRatio: finite.positive().max(1),
      startAngle: finite,
      endAngle: finite,
    })
    .passthrough(),
  z.object({ type: z.literal("LWPOLYLINE"), ...polyline }).passthrough(),
  z.object({ type: z.literal("POLYLINE"), ...polyline }).passthrough(),
  z
    .object({
      type: z.literal("INSERT"),
      ...common,
      name: z.string().min(1).max(256),
      position: point,
      xScale: finite.default(1),
      yScale: finite.default(1),
      zScale: finite.default(1),
      rotation: finite.default(0),
      rowCount: z.number().int().positive().default(1),
      columnCount: z.number().int().positive().default(1),
      rowSpacing: finite.default(0),
      columnSpacing: finite.default(0),
    })
    .passthrough(),
])
type Entity = z.infer<typeof entitySchema>
type Insert = Extract<Entity, { type: "INSERT" }>
const blockSchema = z
  .object({ name: z.string(), position: point, entities: z.array(entitySchema).optional() })
  .passthrough()
const drawingSchema = z
  .object({
    header: z.record(z.string(), z.unknown()).optional(),
    entities: z.array(entitySchema).max(40_256),
    blocks: z.record(z.string(), blockSchema).optional(),
  })
  .passthrough()
const DXF_UNITS: Readonly<Record<number, ImportLengthUnit>> = {
  1: "in",
  2: "ft",
  4: "mm",
  5: "cm",
  6: "m",
  13: "um",
}
function positiveSweep(start: number, end: number) {
  const turn = Math.PI * 2
  requireImport(
    Math.abs(end - start) <= turn + 1e-10,
    "invalid-geometry",
    "DXF arcs cannot exceed one turn.",
  )
  const sweep = (((end - start) % turn) + turn) % turn
  return sweep === 0 ? turn : sweep
}
function bulgeCurve(start: [number, number], end: [number, number], bulge: number): ImportedCurve {
  if (bulge === 0) return { type: "line", start, end }
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const chord = Math.hypot(dx, dy)
  requireImport(chord > 0, "invalid-geometry", "A DXF bulge has coincident endpoints.")
  const offset = (1 - bulge * bulge) / (4 * bulge)
  const center: [number, number] = [
    (start[0] + end[0]) / 2 - dy * offset,
    (start[1] + end[1]) / 2 + dx * offset,
  ]
  return {
    type: "arc",
    center,
    radius: (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge)),
    startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]),
    sweep: 4 * Math.atan(bulge),
  }
}
type Polyline = Extract<Entity, { type: "LINE" | "POLYLINE" | "LWPOLYLINE" }>
function polylineSegments(vertices: Polyline["vertices"], closed: boolean, scale: number) {
  const segments: ImportedCurve[] = []
  for (let index = 0; index < vertices.length - (closed ? 0 : 1); index++) {
    const a = vertices[index]
    const b = vertices[(index + 1) % vertices.length]
    requireImport(
      a !== undefined && b !== undefined,
      "invalid-geometry",
      "DXF polyline vertex is missing.",
    )
    segments.push(
      bulgeCurve(scaledPoint2(a.x, a.y, scale), scaledPoint2(b.x, b.y, scale), a.bulge ?? 0),
    )
  }
  return segments
}
function polylineCurves(entity: Polyline, scale: number) {
  if (entity.type !== "LINE")
    requireImport(
      ![
        entity.is3dPolyline,
        entity.is3dPolygonMesh,
        entity.isPolyfaceMesh,
        entity.includesCurveFitVertices,
        entity.includesSplineFitVertices,
      ].some(Boolean),
      "unsupported-geometry",
      "DXF fitted and spatial polylines are unsupported.",
    )
  const z = entity.type === "LWPOLYLINE" ? (entity.elevation ?? 0) : (entity.vertices[0]?.z ?? 0)
  requireImport(
    entity.vertices.every((vertex) => (vertex.z ?? z) === z),
    "unsupported-geometry",
    "DXF curves must lie in one XY plane.",
  )
  const closed = entity.type !== "LINE" && Boolean(entity.shape)
  return { segments: polylineSegments(entity.vertices, closed, scale), closed, z: z * scale }
}
function entityCurves(entity: Exclude<Entity, Insert>, scale: number) {
  if (entity.type === "LINE" || entity.type === "POLYLINE" || entity.type === "LWPOLYLINE")
    return polylineCurves(entity, scale)
  const center = scaledPoint2(entity.center.x, entity.center.y, scale)
  if (entity.type === "CIRCLE")
    return {
      segments: [{ type: "circle" as const, center, radius: entity.radius * scale }],
      closed: true,
      z: (entity.center.z ?? 0) * scale,
    }
  if (entity.type === "ARC")
    return {
      segments: [
        {
          type: "arc" as const,
          center,
          radius: entity.radius * scale,
          startAngle: entity.startAngle,
          sweep: positiveSweep(entity.startAngle, entity.endAngle),
        },
      ],
      closed: false,
      z: (entity.center.z ?? 0) * scale,
    }
  return ellipseCurves(entity, scale)
}
function ellipseCurves(entity: Extract<Entity, { type: "ELLIPSE" }>, scale: number) {
  const center = scaledPoint2(entity.center.x, entity.center.y, scale)
  requireImport(
    (entity.majorAxisEndPoint.z ?? 0) === 0,
    "unsupported-geometry",
    "DXF spatial ellipses are unsupported.",
  )
  const xAxis = scaledPoint2(entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y, scale)
  const yAxis: [number, number] = [-xAxis[1] * entity.axisRatio, xAxis[0] * entity.axisRatio]
  const sweep = positiveSweep(entity.startAngle, entity.endAngle)
  const closed = Math.abs(sweep - Math.PI * 2) < 1e-10
  const segments: ImportedCurve[] = closed
    ? [{ type: "ellipse", center, xAxis, yAxis }]
    : [{ type: "elliptical-arc", center, xAxis, yAxis, startAngle: entity.startAngle, sweep }]
  return { segments, closed, z: (entity.center.z ?? 0) * scale }
}
function insertTransform(
  insert: Insert,
  base: z.infer<typeof point>,
  scale: number,
  row: number,
  column: number,
) {
  const angle = (insert.rotation * Math.PI) / 180
  const sx = insert.xScale
  const sy = insert.yScale
  const pose = [
    Math.cos(angle) * sx,
    Math.sin(angle) * sx,
    0,
    0,
    -Math.sin(angle) * sy,
    Math.cos(angle) * sy,
    0,
    0,
    0,
    0,
    insert.zScale,
    0,
    insert.position.x * scale,
    insert.position.y * scale,
    (insert.position.z ?? 0) * scale,
    1,
  ]
  const offset = identityTransform()
  // Array spacing is in the insert's rotated axes, independently of its scale.
  pose[12] =
    (pose[12] ?? 0) +
    (Math.cos(angle) * column * insert.columnSpacing - Math.sin(angle) * row * insert.rowSpacing) *
      scale
  pose[13] =
    (pose[13] ?? 0) +
    (Math.sin(angle) * column * insert.columnSpacing + Math.cos(angle) * row * insert.rowSpacing) *
      scale
  offset[12] = -base.x * scale
  offset[13] = -base.y * scale
  offset[14] = -(base.z ?? 0) * scale
  const transform = multiplyTransforms(pose, offset)
  validateTransform(transform)
  return transform
}
export function parseDxfGeometry(
  bytes: Uint8Array,
  selectedUnits: ImportLengthUnit | undefined,
  limits: ImportLimits,
): ParsedGeometryImport {
  const text = preflightDxf(bytes, limits)
  const drawing = drawingSchema.parse(new DxfParser().parseSync(text))
  const declared = drawing.header?.$INSUNITS
  const declaredCode = declared === undefined ? 0 : z.number().int().nonnegative().parse(declared)
  const units = selectedUnits ?? DXF_UNITS[declaredCode]
  requireImport(
    units !== undefined,
    "units-required",
    "DXF requires an explicit length unit when $INSUNITS is absent, unitless or unsupported.",
  )
  const scale = LENGTH_UNIT_MM[units]
  const paths: ImportedCurvePath[] = []
  let segments = 0
  let instances = 0
  const blocks = drawing.blocks ?? {}
  requireImport(
    Object.keys(blocks).length <= limits.bodies,
    "resource-limit",
    "DXF exceeds its block budget.",
  )
  const complete = new Map<string, number>()
  const validateBlock = (name: string, ancestors: ReadonlySet<string>): number => {
    requireImport(!ancestors.has(name), "invalid-geometry", "DXF blocks contain a cycle.", name)
    requireImport(
      ancestors.size < limits.blockDepth,
      "resource-limit",
      "DXF blocks exceed their recursion budget.",
    )
    const block = blocks[name]
    requireImport(
      Boolean(block),
      "invalid-geometry",
      "DXF INSERT references a missing block.",
      name,
    )
    const cachedDepth = complete.get(name)
    if (cachedDepth !== undefined) {
      requireImport(
        ancestors.size + cachedDepth <= limits.blockDepth,
        "resource-limit",
        "DXF blocks exceed their recursion budget.",
      )
      return cachedDepth
    }
    let depth = 1
    for (const child of block?.entities ?? [])
      if (child.type === "INSERT")
        depth = Math.max(depth, 1 + validateBlock(child.name, new Set([...ancestors, name])))
    complete.set(name, depth)
    return depth
  }
  for (const name of Object.keys(blocks)) validateBlock(name, new Set())
  const appendSourcePath = (
    entity: Exclude<Entity, Insert>,
    result: ReturnType<typeof entityCurves>,
    parent: number[],
    layer: string | undefined,
  ) => {
    const elevation = identityTransform()
    elevation[14] = result.z
    const label = importLabel(entity.handle === undefined ? undefined : String(entity.handle))
    paths.push({
      id: `dxf-path-${paths.length + 1}`,
      ...(label ? { label } : {}),
      ...(layer ? { layer } : {}),
      transform: multiplyTransforms(parent, elevation),
      segments: result.segments,
      closed: result.closed,
    })
  }
  const visit = (entity: Entity, parent: number[], inheritedLayer?: string) => {
    const layer =
      importLabel(entity.layer === "0" ? inheritedLayer : entity.layer) ?? inheritedLayer
    if (entity.type === "INSERT") {
      const block = blocks[entity.name]
      requireImport(
        block !== undefined,
        "invalid-geometry",
        "DXF INSERT references a missing block.",
        entity.name,
      )
      const rows = entity.rowCount
      const columns = entity.columnCount
      instances += rows * columns
      requireImport(
        instances <= limits.bodies,
        "resource-limit",
        "DXF block expansion exceeds its instance budget.",
      )
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const transform = multiplyTransforms(
            parent,
            insertTransform(entity, block.position, scale, row, column),
          )
          for (const child of block.entities ?? []) visit(child, transform, layer)
        }
      return
    }
    const result = entityCurves(entity, scale)
    segments += result.segments.length
    requireImport(
      segments <= limits.pathSegments,
      "resource-limit",
      "DXF exceeds its analytical segment budget.",
    )
    appendSourcePath(entity, result, parent, layer)
  }
  for (const entity of drawing.entities) visit(entity, identityTransform())
  return {
    kind: "sketch-curves",
    format: "dxf",
    units: {
      coordinateUnit: "mm",
      sourceUnit: units,
      millimetersPerUnit: scale,
      policy: selectedUnits ? "selected" : "declared",
    },
    paths,
    warnings: [],
  }
}
