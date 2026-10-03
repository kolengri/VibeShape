import {
  type PrinterProfile,
  type PrintPreparationMesh,
  printerProfileSchema,
  printPreparationResultSchema,
} from "@vibeshape/protocol"
import { bounds, meshPoints, type Point, sub } from "./mesh-geometry"

/** Fit verdicts tolerate at most one millionth of a millimeter; reported bounds remain exact. */
export const PRINT_VOLUME_EPSILON_MM = 1e-6

export interface PrintVolumeBounds {
  min: Point
  max: Point
}

export interface PrintVolumeOverrun {
  axis: "x" | "y" | "z"
  side: "min" | "max"
  millimeters: number
}

export interface PrintVolumeFit {
  fits: boolean
  bounds: PrintVolumeBounds
  dimensions: Point
  /** XYZ distances beyond each usable bound. Positive is outside; negative is inside. */
  signedOutside: PrintVolumeBounds
  overruns: PrintVolumeOverrun[]
}

export interface PrintVolumeMeshFit extends PrintVolumeFit {
  index: number
  name: string
}

export interface PrintVolumeResult extends PrintVolumeFit {
  limits: PrintVolumeBounds
  meshes: PrintVolumeMeshFit[]
}

const meshesSchema = printPreparationResultSchema.shape.meshes.superRefine((meshes, context) => {
  if (meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0) > 312_000) {
    context.addIssue({
      code: "custom",
      message:
        "Print volume analysis is limited to 104,000 triangles in total, including supports.",
    })
  }
})

function fitBounds(box: PrintVolumeBounds, limits: PrintVolumeBounds): PrintVolumeFit {
  const signedOutside = {
    min: sub(limits.min, box.min),
    max: sub(box.max, limits.max),
  }
  const overruns: PrintVolumeOverrun[] = []
  for (const axis of [0, 1, 2] as const) {
    for (const side of ["min", "max"] as const) {
      const millimeters = signedOutside[side][axis]
      if (millimeters > PRINT_VOLUME_EPSILON_MM) {
        overruns.push({ axis: (["x", "y", "z"] as const)[axis], side, millimeters })
      }
    }
  }
  return {
    fits: overruns.length === 0,
    bounds: box,
    dimensions: sub(box.max, box.min),
    signedOutside,
    overruns,
  }
}

/**
 * Advisory tessellation fit in the current placement, without centering or searching orientations.
 * A failure does not establish that every other orientation would also fail.
 */
export function checkPrintVolume(
  raw: PrintPreparationMesh[],
  profile: PrinterProfile,
): PrintVolumeResult {
  const printer = printerProfileSchema.parse(profile)
  const meshes = meshesSchema.parse(raw)
  const limits: PrintVolumeBounds = {
    min: [-printer.width / 2 + printer.margin, -printer.depth / 2 + printer.margin, 0],
    max: [printer.width / 2 - printer.margin, printer.depth / 2 - printer.margin, printer.height],
  }
  const results = meshes.map((mesh, index) => ({
    index,
    name: mesh.name,
    ...fitBounds(bounds(meshPoints(mesh)), limits),
  }))
  const combined = bounds(results.flatMap((result) => [result.bounds.min, result.bounds.max]))
  return { ...fitBounds(combined, limits), limits, meshes: results }
}
