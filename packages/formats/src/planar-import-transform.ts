import {
  assertPlanarImportBudget,
  PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM,
  type PlanarImportPoint,
  type PreparedPlanarCurve,
  type PreparedPlanarImport,
  planarImportConicExtrema,
  preparedPlanarImportSchema,
} from "@vibeshape/domain/planar-import-authoring"
import { z } from "zod"
import {
  type GeometryImportDiagnostic,
  GeometryImportError,
  type ImportedCurve,
  type ImportedCurvePath,
  type ParsedGeometryImport,
  parsedGeometryImportSchema,
  requireImport,
} from "./import/contracts"
import { elevateQuadratic, outlineBounds } from "./text-outline/geometry"

type Bounds = { min: PlanarImportPoint; max: PlanarImportPoint }
export type PlanarImportPreparationResult =
  | { ok: true; prepared: PreparedPlanarImport; bounds: Bounds }
  | { ok: false; diagnostic: GeometryImportDiagnostic }
const TURN = Math.PI * 2

function transformedPoint(matrix: readonly number[], point: PlanarImportPoint): PlanarImportPoint {
  return [
    (matrix[0] ?? 0) * point[0] + (matrix[4] ?? 0) * point[1] + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * point[0] + (matrix[5] ?? 0) * point[1] + (matrix[13] ?? 0),
  ]
}
function transformedVector(
  matrix: readonly number[],
  vector: PlanarImportPoint,
): PlanarImportPoint {
  return [
    (matrix[0] ?? 0) * vector[0] + (matrix[4] ?? 0) * vector[1],
    (matrix[1] ?? 0) * vector[0] + (matrix[5] ?? 0) * vector[1],
  ]
}
function dot(a: PlanarImportPoint, b: PlanarImportPoint) {
  return a[0] * b[0] + a[1] * b[1]
}
function determinant(a: PlanarImportPoint, b: PlanarImportPoint) {
  return a[0] * b[1] - a[1] * b[0]
}
function times(point: PlanarImportPoint, scale: number): PlanarImportPoint {
  return [point[0] * scale, point[1] * scale]
}

function conicAxes(first: PlanarImportPoint, second: PlanarImportPoint) {
  const scale = Math.max(Math.hypot(...first), Math.hypot(...second))
  requireImport(
    Number.isFinite(scale) && scale > PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM,
    "invalid-geometry",
    "A transformed conic has negligible or nonfinite extent.",
  )
  const a = times(first, 1 / scale)
  const b = times(second, 1 / scale)
  const det = determinant(a, b)
  const xx = a[0] ** 2 + b[0] ** 2
  const xy = a[0] * a[1] + b[0] * b[1]
  const yy = a[1] ** 2 + b[1] ** 2
  const angle = Math.atan2(2 * xy, xx - yy) / 2
  const direction: PlanarImportPoint = [Math.cos(angle), Math.sin(angle)]
  const majorNormalized = Math.sqrt((xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2)
  const major = scale * majorNormalized
  // The determinant product avoids subtracting nearly equal covariance eigenvalues.
  const minor = (scale * Math.abs(det)) / majorNormalized
  requireImport(
    Number.isFinite(major) &&
      Number.isFinite(minor) &&
      minor > PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM &&
      minor / major > 1e-12,
    "invalid-geometry",
    "A transformed conic is singular or too ill-conditioned for the sketch topology tolerance.",
  )
  const orientation = det < 0 ? -1 : 1
  const secondaryDirection: PlanarImportPoint = [
    -direction[1] * orientation,
    direction[0] * orientation,
  ]
  const primaryAxis = times(direction, major)
  const secondaryAxis = times(secondaryDirection, minor)
  // Recover the parameter rotation from the dominant row; dividing by the minor radius amplifies cancellation.
  const phase = Math.atan2(-dot(direction, second), dot(direction, first))
  const reconstructedFirst: PlanarImportPoint = [
    primaryAxis[0] * Math.cos(phase) + secondaryAxis[0] * Math.sin(phase),
    primaryAxis[1] * Math.cos(phase) + secondaryAxis[1] * Math.sin(phase),
  ]
  const reconstructedSecond: PlanarImportPoint = [
    -primaryAxis[0] * Math.sin(phase) + secondaryAxis[0] * Math.cos(phase),
    -primaryAxis[1] * Math.sin(phase) + secondaryAxis[1] * Math.cos(phase),
  ]
  requireImport(
    Math.hypot(
      reconstructedFirst[0] - first[0],
      reconstructedFirst[1] - first[1],
      reconstructedSecond[0] - second[0],
      reconstructedSecond[1] - second[1],
    ) <=
      PLANAR_IMPORT_TOPOLOGY_TOLERANCE_MM / 10,
    "invalid-geometry",
    "Conic axis reconstruction exceeds the sketch topology accuracy budget.",
  )
  return { primaryAxis, secondaryAxis, phase }
}

type TransformedCurve = { curve: PreparedPlanarCurve; sourceDirection: 1 | -1 }
function preparedEllipseConic(
  curve: Extract<ImportedCurve, { center: unknown }>,
  center: PlanarImportPoint,
  axes: ReturnType<typeof conicAxes>,
): TransformedCurve {
  if (!("sweep" in curve) || Math.abs(curve.sweep) === TURN) {
    return {
      curve: {
        type: "ellipse",
        center,
        primaryAxis: axes.primaryAxis,
        secondaryAxis: axes.secondaryAxis,
      },
      sourceDirection: "sweep" in curve && curve.sweep < 0 ? -1 : 1,
    }
  }
  const negative = curve.sweep < 0
  return {
    curve: {
      type: "elliptical-arc",
      center,
      primaryAxis: axes.primaryAxis,
      secondaryAxis: negative ? times(axes.secondaryAxis, -1) : axes.secondaryAxis,
      startAngle: (curve.startAngle + axes.phase) * (negative ? -1 : 1),
      sweep: Math.abs(curve.sweep),
    },
    sourceDirection: 1,
  }
}

function transformedCircularConic(
  curve: Extract<ImportedCurve, { radius: number }>,
  center: PlanarImportPoint,
  first: PlanarImportPoint,
  second: PlanarImportPoint,
): TransformedCurve {
  const radius = Math.hypot(...first)
  const reflected = determinant(first, second) < 0
  const sourceDirection: 1 | -1 =
    determinant(first, second) * ("sweep" in curve ? curve.sweep : 1) < 0 ? -1 : 1
  if (!("sweep" in curve) || Math.abs(curve.sweep) === TURN)
    return { curve: { type: "circle", center, radius }, sourceDirection }
  const start = Math.atan2(first[1], first[0]) + (reflected ? -curve.startAngle : curve.startAngle)
  return {
    curve: {
      type: "arc",
      center,
      radius,
      startAngle: sourceDirection === 1 ? start : start - Math.abs(curve.sweep),
      sweep: Math.abs(curve.sweep),
    },
    sourceDirection,
  }
}

function transformedConic(
  curve: Extract<ImportedCurve, { center: unknown }>,
  matrix: readonly number[],
): { curve: PreparedPlanarCurve; sourceDirection: 1 | -1 } {
  const center = transformedPoint(matrix, curve.center)
  const first = transformedVector(matrix, "radius" in curve ? [curve.radius, 0] : curve.xAxis)
  const second = transformedVector(matrix, "radius" in curve ? [0, curve.radius] : curve.yAxis)
  if ("radius" in curve && dot(first, second) === 0 && dot(first, first) === dot(second, second)) {
    return transformedCircularConic(curve, center, first, second)
  }
  return preparedEllipseConic(curve, center, conicAxes(first, second))
}

function transformedCurve(curve: ImportedCurve, matrix: readonly number[]): TransformedCurve {
  if ("center" in curve) return transformedConic(curve, matrix)
  const start = transformedPoint(matrix, curve.start)
  const end = transformedPoint(matrix, curve.end)
  if (curve.type === "line") return { curve: { type: "line", start, end }, sourceDirection: 1 }
  if (curve.type === "quadratic-bezier") {
    const elevated = elevateQuadratic(start, transformedPoint(matrix, curve.control), end)
    if (elevated.kind !== "cubic-bezier")
      throw new GeometryImportError(
        "invalid-geometry",
        "Quadratic elevation did not return a cubic curve.",
      )
    return {
      curve: {
        type: "cubic-bezier",
        start,
        control1: elevated.control1,
        control2: elevated.control2,
        end,
      },
      sourceDirection: 1,
    }
  }
  return {
    curve: {
      type: "cubic-bezier",
      start,
      control1: transformedPoint(matrix, curve.control1),
      control2: transformedPoint(matrix, curve.control2),
      end,
    },
    sourceDirection: 1,
  }
}

function transformedPath(
  path: ImportedCurvePath,
  sourceOrdinal: number,
): PreparedPlanarImport["paths"][number] {
  const matrix = path.transform
  requireImport(
    matrix[2] === 0 && matrix[6] === 0 && matrix[14] === 0,
    "unsupported-geometry",
    "An imported path transform must preserve the source XY plane without projection.",
    path.id,
  )
  return {
    sourceOrdinal,
    inspectionId: path.id,
    ...(path.label ? { label: path.label } : {}),
    ...(path.layer ? { layer: path.layer } : {}),
    closed: path.closed,
    segments: path.segments.map((curve, ordinal) =>
      transformSourceSegment(curve, matrix, path.id, ordinal),
    ),
  }
}

function transformSourceSegment(
  curve: ImportedCurve,
  matrix: readonly number[],
  pathId: string,
  sourceOrdinal: number,
) {
  try {
    return { sourceOrdinal, ...transformedCurve(curve, matrix) }
  } catch (error) {
    if (error instanceof GeometryImportError)
      throw new GeometryImportError(
        error.code,
        error.message,
        error.source ?? `${pathId}/segment:${sourceOrdinal}`,
      )
    throw error
  }
}

function conicBounds(
  curve: Exclude<PreparedPlanarCurve, { type: "line" | "cubic-bezier" }>,
): Bounds {
  const points = planarImportConicExtrema(curve)
  return {
    min: [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
    ],
    max: [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
    ],
  }
}
function curveBounds(curve: PreparedPlanarCurve): Bounds {
  if (curve.type === "line")
    return outlineBounds([{ kind: "line", start: curve.start, end: curve.end }])
  if (curve.type === "cubic-bezier")
    return outlineBounds([
      {
        kind: "cubic-bezier",
        start: curve.start,
        control1: curve.control1,
        control2: curve.control2,
        end: curve.end,
      },
    ])
  return conicBounds(curve)
}
function importBounds(prepared: PreparedPlanarImport): Bounds {
  const min: PlanarImportPoint = [Infinity, Infinity]
  const max: PlanarImportPoint = [-Infinity, -Infinity]
  for (const path of prepared.paths)
    for (const segment of path.segments) {
      const bounds = curveBounds(segment.curve)
      for (const axis of [0, 1] as const) {
        min[axis] = Math.min(min[axis], bounds.min[axis])
        max[axis] = Math.max(max[axis], bounds.max[axis])
      }
    }
  requireImport(
    [...min, ...max].every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000),
    "invalid-geometry",
    "Transformed path bounds exceed the finite millimeter world limits.",
  )
  return { min, max }
}

function prepareGeometry(geometry: ParsedGeometryImport) {
  requireImport(
    geometry.kind === "sketch-curves",
    "unsupported-geometry",
    "Only SVG/DXF planar curves can author a sketch.",
  )
  const prepared = preparedPlanarImportSchema.parse({
    schemaVersion: 0,
    format: geometry.format,
    units: geometry.units,
    paths: geometry.paths.map(transformedPath),
  })
  return { prepared, bounds: importBounds(prepared) }
}

/** Applies source analytical transforms exactly once; input coordinates already use millimeters. */
export function preparePlanarImport(value: unknown): PlanarImportPreparationResult {
  try {
    const kind = z
      .object({ kind: z.literal("sketch-curves") })
      .passthrough()
      .safeParse(value)
    requireImport(
      kind.success,
      "unsupported-geometry",
      "Only SVG/DXF planar curves can author a sketch.",
    )
    assertPlanarImportBudget(value)
    return { ok: true, ...prepareGeometry(parsedGeometryImportSchema.parse(value)) }
  } catch (error) {
    if (error instanceof GeometryImportError)
      return {
        ok: false,
        diagnostic: {
          code: error.code,
          message: error.message.slice(0, 4_096),
          ...(error.source ? { source: error.source } : {}),
        },
      }
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" ")
        : error instanceof Error
          ? error.message
          : "The imported planar geometry is invalid."
    return {
      ok: false,
      diagnostic: {
        code: "invalid-geometry",
        message: message.slice(0, 4_096) || "The imported planar geometry is invalid.",
      },
    }
  }
}
