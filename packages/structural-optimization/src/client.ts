import {
  structuralAlgorithmSummaryMatches,
  structuralFdmSummaryMatches,
  structuralRelativePerformanceMatches,
} from "@vibeshape/domain/lightweighting"
import { Vector3 } from "three"
import { z } from "zod"
import {
  type StructuralOptimizationInput,
  type StructuralOptimizationResult,
  type StructuralVoxelGrid,
  structuralOptimizationInputSchema,
  structuralSolverResponseSchema,
} from "./contract"
import { StructuralOptimizationError } from "./errors"
import { invalidInputMessage } from "./input-diagnostics"
import { encodeStructuralSnapshot } from "./mesh"

export { StructuralOptimizationError } from "./errors"

const progressSchema = z
  .object({ type: z.literal("progress"), stage: z.enum(["loading", "solving"]) })
  .strict()
const responseSchema = z
  .object({ type: z.literal("complete"), response: structuralSolverResponseSchema })
  .strict()

function metricsFeasible(
  input: StructuralOptimizationInput,
  metrics: StructuralOptimizationResult["baseline"],
) {
  const stressLimit = input.material.yieldStrengthMpa / input.safetyFactor
  return (
    metrics.cases.length === input.loadCases.length &&
    metrics.cases.every((item, index) => item.name === input.loadCases[index]?.name) &&
    [metrics, ...metrics.cases].every(
      (item) =>
        item.maxVonMisesMpa <= stressLimit * (1 + 1e-8) &&
        item.maxDisplacementMm <= input.maxDisplacementMm * (1 + 1e-8) &&
        item.safetyFactor >= input.safetyFactor * (1 - 1e-8),
    )
  )
}
function massTargetMatches(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const requested = input.objective
  const objective = result.objective
  if (requested?.kind !== "maximize-stiffness" || objective?.kind !== "maximize-stiffness")
    return false
  const targetCount = Math.ceil(result.initialCellCount * requested.retainedMassFraction)
  return (
    objective.retainedMassFraction === requested.retainedMassFraction &&
    objective.targetCellCount === targetCount &&
    result.finalCellCount >= targetCount &&
    Math.abs(objective.targetMassKg / result.baseline.massKg - objective.retainedMassFraction) <=
      1e-8 &&
    Math.abs(
      objective.achievedRetainedMassFraction - result.optimized.massKg / result.baseline.massKg,
    ) <= 1e-8
  )
}
function objectiveMatches(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  if (input.objective?.kind !== "maximize-stiffness")
    return (
      result.objective?.kind !== "maximize-stiffness" &&
      result.termination !== "target-mass-reached"
    )
  return (
    massTargetMatches(input, result) &&
    targetStatusMatches(result) &&
    [result.baseline, result.optimized].every((metrics) =>
      metrics.cases.every(({ complianceNmm }) => complianceNmm > 0),
    )
  )
}
function targetStatusMatches(result: StructuralOptimizationResult) {
  const objective = result.objective
  if (objective?.kind !== "maximize-stiffness") return false
  const reached = result.finalCellCount === objective.targetCellCount
  return (
    (objective.targetStatus === "reached") === reached &&
    (result.termination === "target-mass-reached") === reached
  )
}
function cellMetricsMatch(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const cellVolume = input.cellSizeMm ** 3
  const cellMass = cellVolume * input.material.densityKgM3 * 1e-9
  return [
    { metrics: result.baseline, count: result.initialCellCount },
    { metrics: result.optimized, count: result.finalCellCount },
  ].every(
    ({ metrics, count }) =>
      Math.abs(metrics.volumeMm3 / cellVolume - count) <= 1e-8 &&
      Math.abs(metrics.massKg / cellMass - count) <= 1e-8,
  )
}
function modelMetricsMatch(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  return (
    result.cellSizeMm === input.cellSizeMm &&
    result.iterations <= input.maxIterations &&
    result.finalCellCount <= result.initialCellCount &&
    (result.status === "improved") === result.finalCellCount < result.initialCellCount
  )
}
function meshWithinSourceBounds(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const { minimum, maximum } = sourceMeshBounds(input)
  const tolerance = input.cellSizeMm * 1e-6
  return result.mesh.vertices.every(
    (value, index) =>
      value >= (minimum[index % 3] ?? Infinity) - tolerance &&
      value <= (maximum[index % 3] ?? -Infinity) + tolerance,
  )
}
type GridPoint = StructuralVoxelGrid["cells"][number]

function sourceMeshBounds(input: StructuralOptimizationInput) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  input.mesh.vertices.forEach((value, index) => {
    const axis = index % 3
    minimum[axis] = Math.min(minimum[axis] ?? Infinity, value)
    maximum[axis] = Math.max(maximum[axis] ?? -Infinity, value)
  })
  return { minimum, maximum }
}

function expectedGridOrigin(input: StructuralOptimizationInput, minimum: number[]) {
  const phase = input.voxelGridOriginMm
  if (!phase) return minimum
  return minimum.map((value, axis) => {
    const reference = phase[axis] ?? 0
    const offset = (value - reference) / input.cellSizeMm
    const nearest = Math.round(offset)
    const index = Math.abs(offset - nearest) <= 1e-6 ? nearest : Math.floor(offset)
    return reference + index * input.cellSizeMm
  })
}

function gridCoordinate(value: number | undefined, origin: number, spacing: number) {
  if (value === undefined) return NaN
  const index = Math.round((value - origin) / spacing)
  return Math.abs(value - (origin + index * spacing)) <= spacing * 1e-6 ? index : NaN
}

function gridFacet(points: [GridPoint, GridPoint, GridPoint], occupied: Set<string>) {
  const [a, b, c] = points
  const origin = new Vector3(...a)
  const normal = new Vector3(...b)
    .sub(origin)
    .cross(new Vector3(...c).sub(origin))
    .toArray()
  const axis = ([0, 1, 2] as const).find((index) => Math.abs(normal[index]) === 1)
  if (axis === undefined || normal.some((value, index) => index !== axis && value !== 0))
    return undefined
  const minimum: GridPoint = [
    Math.min(a[0], b[0], c[0]),
    Math.min(a[1], b[1], c[1]),
    Math.min(a[2], b[2], c[2]),
  ]
  const maximum: GridPoint = [
    Math.max(a[0], b[0], c[0]),
    Math.max(a[1], b[1], c[1]),
    Math.max(a[2], b[2], c[2]),
  ]
  if (
    ([0, 1, 2] as const).some(
      (index) => maximum[index] - minimum[index] !== (index === axis ? 0 : 1),
    )
  )
    return undefined
  const lower: GridPoint = [...minimum]
  lower[axis] -= 1
  const lowerOccupied = occupied.has(lower.join(","))
  const upperOccupied = occupied.has(minimum.join(","))
  if (lowerOccupied === upperOccupied || normal[axis] !== (lowerOccupied ? 1 : -1)) return undefined
  const u = ([1, 2, 0] as const)[axis]
  const v = ([2, 0, 1] as const)[axis]
  const mask = points.reduce(
    (bits, point) => bits | (1 << (point[u] - minimum[u] + 2 * (point[v] - minimum[v]))),
    0,
  )
  return { key: `${axis}:${minimum.join(",")}`, mask }
}

function gridBoundaryFaceCount(cells: GridPoint[], occupied: Set<string>) {
  let faceCount = cells.length * 6
  for (const cell of cells)
    for (const axis of [0, 1, 2] as const) {
      const neighbor: GridPoint = [...cell]
      neighbor[axis] += 1
      if (occupied.has(neighbor.join(","))) faceCount -= 2
    }
  return faceCount
}

function gridMeshPoints(mesh: StructuralOptimizationResult["mesh"], grid: StructuralVoxelGrid) {
  const points: GridPoint[] = []
  for (let offset = 0; offset < mesh.vertices.length; offset += 3) {
    const point: GridPoint = [
      gridCoordinate(mesh.vertices[offset], grid.originMm[0], grid.cellSizeMm),
      gridCoordinate(mesh.vertices[offset + 1], grid.originMm[1], grid.cellSizeMm),
      gridCoordinate(mesh.vertices[offset + 2], grid.originMm[2], grid.cellSizeMm),
    ]
    if (!point.every(Number.isFinite)) return undefined
    points.push(point)
  }
  return points
}

function gridTriangle(
  points: GridPoint[],
  indices: number[],
  offset: number,
): [GridPoint, GridPoint, GridPoint] | undefined {
  const [a, b, c] = indices.slice(offset, offset + 3).map((index) => points[index])
  if (!a || !b || !c) return undefined
  return [a, b, c]
}

function recordGridFacet(faces: Map<string, number>, facet: { key: string; mask: number }) {
  const previous = faces.get(facet.key)
  if (previous === undefined) {
    faces.set(facet.key, facet.mask)
    return true
  }
  // Two unit triangles partition a square exactly when their shared edge is a diagonal.
  const common = previous & facet.mask
  if (common !== 6 && common !== 9) return false
  faces.set(facet.key, 0)
  return true
}

function gridSurfaceMatches(result: StructuralOptimizationResult, grid: StructuralVoxelGrid) {
  const occupied = new Set(grid.cells.map((cell) => cell.join(",")))
  const faceCount = gridBoundaryFaceCount(grid.cells, occupied)
  const points = gridMeshPoints(result.mesh, grid)
  if (!points) return false
  const faces = new Map<string, number>()
  for (let offset = 0; offset < result.mesh.indices.length; offset += 3) {
    const triangle = gridTriangle(points, result.mesh.indices, offset)
    if (!triangle) return false
    const facet = gridFacet(triangle, occupied)
    if (!facet) return false
    if (!recordGridFacet(faces, facet)) return false
  }
  return faces.size === faceCount && [...faces.values()].every((mask) => mask === 0)
}

function voxelGridMatches(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const grid = result.voxelGrid
  if (input.includeVoxelGrid !== true) return grid === undefined
  if (!grid || grid.cellSizeMm !== input.cellSizeMm || grid.cells.length !== result.finalCellCount)
    return false
  const { minimum, maximum } = sourceMeshBounds(input)
  const origin = expectedGridOrigin(input, minimum)
  if (!grid.originMm.every((value, axis) => value === origin[axis])) return false
  const tolerance = input.cellSizeMm * 1e-6
  const cellsWithinSource = grid.cells.every((cell) =>
    cell.every((index, axis) => {
      const start = (grid.originMm[axis] ?? NaN) + index * grid.cellSizeMm
      return (
        start >= (minimum[axis] ?? Infinity) - tolerance &&
        start + grid.cellSizeMm <= (maximum[axis] ?? -Infinity) + tolerance
      )
    }),
  )
  return cellsWithinSource && gridSurfaceMatches(result, grid)
}
function resultMatchesRequest(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  return [
    modelMetricsMatch(input, result),
    cellMetricsMatch(input, result),
    meshWithinSourceBounds(input, result),
    voxelGridMatches(input, result),
    objectiveMatches(input, result),
    structuralRelativePerformanceMatches(result, input),
    structuralFdmSummaryMatches(result.fdm, input.fdm, input.cellSizeMm),
    structuralAlgorithmSummaryMatches(
      result.algorithm,
      input.algorithm,
      input.cellSizeMm,
      result.initialCellCount,
      result.finalCellCount,
      {
        iterations: result.iterations,
        evaluations: result.evaluations,
        maxIterations: input.maxIterations,
      },
    ),
  ].every(Boolean)
}
function validateFeasibility(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  for (const metrics of [result.baseline, result.optimized]) {
    if (!metricsFeasible(input, metrics))
      throw new StructuralOptimizationError(
        "invalid-result",
        "The solver returned an infeasible result.",
      )
  }
  if (!resultMatchesRequest(input, result))
    throw new StructuralOptimizationError(
      "invalid-result",
      "The solver returned inconsistent model metrics.",
    )
  encodeStructuralSnapshot(result.mesh, input.cellSizeMm)
}

export function optimizeStructuralModel(
  input: StructuralOptimizationInput,
  options: {
    signal?: AbortSignal
    runtimeBaseUrl?: string
    onProgress?: (stage: "loading" | "solving") => void
  } = {},
): Promise<StructuralOptimizationResult> {
  const parsed = structuralOptimizationInputSchema.safeParse(input)
  if (!parsed.success)
    return Promise.reject(
      new StructuralOptimizationError(
        "invalid-input",
        invalidInputMessage("Analysis inputs are invalid.", parsed.error),
      ),
    )
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("Analysis canceled.", "AbortError"))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    } catch {
      reject(
        new StructuralOptimizationError(
          "runtime-unavailable",
          "The analysis worker could not start.",
        ),
      )
      return
    }
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      operation()
    }
    const abort = () => finish(() => reject(new DOMException("Analysis canceled.", "AbortError")))
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = () =>
      finish(() =>
        reject(
          new StructuralOptimizationError("runtime-unavailable", "The analysis worker failed."),
        ),
      )
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      const progress = progressSchema.safeParse(event.data)
      if (progress.success) {
        try {
          options.onProgress?.(progress.data.stage)
        } catch (error) {
          finish(() => reject(error))
        }
        return
      }
      finish(() => {
        try {
          const { response } = responseSchema.parse(event.data)
          if (!response.ok) {
            reject(new StructuralOptimizationError(response.error.code, response.error.message))
            return
          }
          validateFeasibility(parsed.data, response.result)
          resolve(response.result)
        } catch (error) {
          reject(
            error instanceof StructuralOptimizationError
              ? error
              : new StructuralOptimizationError(
                  "invalid-result",
                  "The solver returned an invalid mesh or response.",
                ),
          )
        }
      })
    }
    worker.onmessageerror = () =>
      finish(() =>
        reject(
          new StructuralOptimizationError(
            "invalid-result",
            "The analysis response could not be decoded.",
          ),
        ),
      )
    try {
      worker.postMessage({
        input: parsed.data,
        runtimeBaseUrl:
          options.runtimeBaseUrl ?? new URL("structural-runtime/", document.baseURI).href,
      })
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
