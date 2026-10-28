import { MeshBasicMaterial } from "three"
import { MarchingCubes, triTable } from "three/addons/objects/MarchingCubes.js"
import { z } from "zod"
import type { QuickLightweightingInput } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import { signedQuickMeshVolume } from "./quick-mesh"

const sampleArray = z.union([
  z.array(z.number().finite()),
  z.instanceof(Float64Array).refine((values) => values.every(Number.isFinite)),
])
export const quickGridMetadataSchema = z
  .object({
    resolution: z.number().int().min(4),
    sourceVolumeCells: z.number().finite().positive(),
    thresholdMin: z.number().finite().positive().max(3),
    thresholdMax: z.number().finite().positive().max(3),
  })
  .strict()
export const quickGridSchema = quickGridMetadataSchema
  .extend({ envelope: sampleArray, lattice: sampleArray })
  .refine(
    ({ resolution, envelope, lattice, thresholdMin, thresholdMax }) =>
      envelope.length === resolution ** 3 &&
      lattice.length === envelope.length &&
      thresholdMin < thresholdMax,
  )

type Grid = z.infer<typeof quickGridSchema>
export type QuickIsosurfaceCandidate = { vertices: number[]; indices: number[]; threshold: number }

function triangleCapacity(field: Float32Array, resolution: number) {
  const plane = resolution ** 2
  const corners = [
    [0, 1],
    [1, 2],
    [resolution, 8],
    [resolution + 1, 4],
    [plane, 16],
    [plane + 1, 32],
    [plane + resolution, 128],
    [plane + resolution + 1, 64],
  ] as const
  let triangles = 0
  // Match Three's interior-cell traversal and corner ordering. Count the same
  // Float32 field that it polygonizes, including values rounded to signed zero.
  const span = resolution - 3
  for (let cell = 0; cell < span ** 3; cell++) {
    const x = (cell % span) + 1
    const y = (Math.floor(cell / span) % span) + 1
    const z = Math.floor(cell / span ** 2) + 1
    const start = z * plane + y * resolution + x
    let cube = 0
    for (const [offset, bit] of corners) {
      if ((field[start + offset] ?? 0) < 0) cube |= bit
    }
    for (let entry = cube * 16; triTable[entry] !== -1; entry += 3) triangles++
  }
  return triangles
}

function surface(
  field: Float32Array,
  material: MeshBasicMaterial,
  grid: Grid,
  threshold: number,
  mode: QuickLightweightingInput["mode"],
) {
  for (let index = 0; index < grid.envelope.length; index++) {
    const envelope = grid.envelope[index] ?? Number.NaN
    const lattice = grid.lattice[index] ?? Number.NaN
    field[index] = Math.min(
      envelope,
      mode === "preserve-exterior" ? lattice - threshold : threshold - lattice,
    )
  }
  const capacity = triangleCapacity(field, grid.resolution)
  if (capacity === 0) return { candidate: null, volume: 0 }
  const cubes = new MarchingCubes(grid.resolution, material, false, false, capacity)
  try {
    cubes.field = field
    cubes.isolation = 0
    cubes.update()
    if (cubes.count !== capacity * 3)
      throw new QuickLightweightingError(
        "invalid-result",
        "The isosurface extraction is incomplete.",
      )
    const vertices = Array.from(
      cubes.positionArray,
      (value) => ((value + 1) * grid.resolution) / 2 - 3,
    )
    const candidate = {
      vertices,
      indices: Array.from({ length: cubes.count }, (_, index) => index),
      threshold,
    }
    return {
      candidate,
      volume: Math.abs(signedQuickMeshVolume(candidate)),
    }
  } finally {
    cubes.geometry.dispose()
  }
}

/** Extract library isosurfaces and tune the geometric volume, without evaluating stiffness. */
type VolumeFit = { best: QuickIsosurfaceCandidate | null; difference: number }

function considerFit(
  fit: VolumeFit,
  candidate: QuickIsosurfaceCandidate | null,
  removed: number,
  target: number,
) {
  const error = Math.abs(removed - target)
  if (candidate && error < fit.difference && removed > 0 && removed < 100) {
    fit.best = candidate
    fit.difference = error
  }
}

function fitVolume(input: QuickLightweightingInput, grid: Grid, material: MeshBasicMaterial) {
  const fit: VolumeFit = { best: null, difference: Number.POSITIVE_INFINITY }
  const field = new Float32Array(grid.envelope.length)
  let lower = grid.thresholdMin
  let upper = grid.thresholdMax
  // Endpoints establish the attainable range; six bisections then fit actual
  // triangle volume, rather than presenting a voxel occupancy estimate as mass.
  const thresholds = [lower, upper]
  for (let step = 0; step < 8; step++) {
    const threshold = thresholds[step] ?? (lower + upper) / 2
    const { candidate, volume } = surface(field, material, grid, threshold, input.mode)
    const fraction = volume / grid.sourceVolumeCells
    const removed = 100 * (input.mode === "preserve-exterior" ? fraction : 1 - fraction)
    considerFit(fit, candidate, removed, input.removalPercent)
    if (step < 2) continue
    if (removed > input.removalPercent) lower = threshold
    else upper = threshold
    if (fit.difference < 0.25) break
  }
  return fit.best
}

export function generateQuickIsosurface(
  input: QuickLightweightingInput,
  rawGrid: unknown,
): QuickIsosurfaceCandidate {
  const grid = quickGridSchema.parse(rawGrid)
  const material = new MeshBasicMaterial()
  try {
    const best = fitVolume(input, grid, material)
    if (!best)
      throw new QuickLightweightingError(
        "no-removable-material",
        "The current skin and detail leave no positive-volume lightweighting result.",
      )
    return best
  } finally {
    material.dispose()
  }
}
