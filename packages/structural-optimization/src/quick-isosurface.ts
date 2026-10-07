import { MeshBasicMaterial } from "three"
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js"
import { z } from "zod"
import type { QuickLightweightingInput } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import { signedQuickMeshVolume } from "./quick-mesh"

const sampleArray = z.array(z.number().finite()).min(1_000).max(175_616)
export const quickGridSchema = z
  .object({
    resolution: z.number().int().min(10).max(56),
    envelope: sampleArray,
    lattice: sampleArray,
    sourceVolumeCells: z.number().finite().positive(),
    thresholdMin: z.number().finite().positive().max(3),
    thresholdMax: z.number().finite().positive().max(3),
  })
  .strict()
  .refine(
    ({ resolution, envelope, lattice, thresholdMin, thresholdMax }) =>
      envelope.length === resolution ** 3 &&
      lattice.length === envelope.length &&
      thresholdMin < thresholdMax,
  )

type Grid = z.infer<typeof quickGridSchema>
export type QuickIsosurfaceCandidate = { vertices: number[]; indices: number[]; threshold: number }

function surface(
  cubes: MarchingCubes,
  grid: Grid,
  threshold: number,
  mode: QuickLightweightingInput["mode"],
) {
  cubes.reset()
  cubes.isolation = 0
  for (let index = 0; index < grid.envelope.length; index++) {
    const envelope = grid.envelope[index] ?? Number.NaN
    const lattice = grid.lattice[index] ?? Number.NaN
    cubes.field[index] = Math.min(
      envelope,
      mode === "preserve-exterior" ? lattice - threshold : threshold - lattice,
    )
  }
  cubes.update()
  if (cubes.count > 360_000) return { candidate: null, volume: null }
  if (cubes.count === 0) return { candidate: null, volume: 0 }
  const vertices = Array.from(
    cubes.positionArray.slice(0, cubes.count * 3),
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
  if (candidate && error < fit.difference && removed >= 0.5 && removed < 100) {
    fit.best = candidate
    fit.difference = error
  }
}

function fitVolume(input: QuickLightweightingInput, grid: Grid, cubes: MarchingCubes) {
  const fit: VolumeFit = { best: null, difference: Number.POSITIVE_INFINITY }
  let lower = grid.thresholdMin
  let upper = grid.thresholdMax
  // Endpoints establish the attainable range; six bisections then fit actual
  // triangle volume, rather than presenting a voxel occupancy estimate as mass.
  const thresholds = [lower, upper]
  for (let step = 0; step < 8; step++) {
    const threshold = thresholds[step] ?? (lower + upper) / 2
    const { candidate, volume } = surface(cubes, grid, threshold, input.mode)
    // A high-removal endpoint may exceed the mesh budget even when the
    // requested result fits. Continue toward thicker, simpler lattice sheets.
    if (volume === null) {
      lower = threshold
      continue
    }
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
  const cubes = new MarchingCubes(grid.resolution, material, false, false, 120_000)
  try {
    const best = fitVolume(input, grid, cubes)
    if (!best)
      throw new QuickLightweightingError(
        "no-removable-material",
        "The current skin and detail leave no meaningful lightweighting result.",
      )
    return best
  } finally {
    cubes.geometry.dispose()
    material.dispose()
  }
}
