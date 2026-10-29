import { Box3, Quaternion, Vector3 } from "three"
import {
  type StructuralMesh,
  type StructuralOptimizationInput,
  structuralMeshSchema,
  structuralOptimizationInputSchema,
} from "./contract"

export type StructuralMaterial = StructuralOptimizationInput["material"]
export type PrintOptimizationOptions = {
  mesh: StructuralMesh
  bedTriangleIndices: readonly number[]
  preserveTriangleIndices: readonly number[]
  material: StructuralMaterial
  cellSizeMm: number
  minFeatureSizeMm: number
  layerHeightMm: number
  maxIterations: number
  minStiffnessFraction: number
  minStrengthFraction: number
  supportMode: "allowed" | "forbidden"
}

export type PrintOptimizationSetupErrorCode =
  | "invalid-bed"
  | "nonplanar-bed"
  | "bed-intersection"
  | "unresolved-scenarios"
  | "invalid-settings"

export class PrintOptimizationSetupError extends Error {
  constructor(
    readonly code: PrintOptimizationSetupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PrintOptimizationSetupError"
  }
}

type Vector = [number, number, number]
type BoxRegion = { min: Vector; max: Vector }

function point(mesh: StructuralMesh, index: number): Vector3 {
  return new Vector3().fromArray(mesh.vertices, index * 3)
}

function selectedTriangles(mesh: StructuralMesh, indices: readonly number[], bed: boolean) {
  if (
    (bed && indices.length === 0) ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= mesh.indices.length / 3,
    )
  )
    throw new PrintOptimizationSetupError(
      bed ? "invalid-bed" : "invalid-settings",
      bed
        ? "Select a nonempty planar exterior print face from the captured mesh."
        : "Preserved faces must reference unique triangles in the captured mesh.",
    )
  return indices.map((index) => {
    const offset = index * 3
    return [0, 1, 2].map((corner) => point(mesh, mesh.indices[offset + corner] ?? -1))
  })
}

function printFrame(mesh: StructuralMesh, bed: readonly number[], tolerance: number) {
  const triangles = selectedTriangles(mesh, bed, true)
  const origin = triangles[0]?.[0]?.clone()
  if (!origin) throw new PrintOptimizationSetupError("invalid-bed", "Select a print face.")
  const normals = triangles.map(([a, b, c]) => {
    if (!a || !b || !c) throw new PrintOptimizationSetupError("invalid-bed", "Invalid print face.")
    return b.clone().sub(a).cross(c.clone().sub(a))
  })
  if (normals.some((normal) => normal.length() <= tolerance * tolerance))
    throw new PrintOptimizationSetupError(
      "invalid-bed",
      "The print face contains degenerate triangles.",
    )
  const normal = new Vector3()
  for (const value of normals) normal.add(value)
  normal.normalize()
  if (
    normals.some((value) => value.clone().normalize().dot(normal) < 1 - 1e-8) ||
    triangles.some((triangle) =>
      triangle.some((value) => Math.abs(value.clone().sub(origin).dot(normal)) > tolerance),
    )
  )
    throw new PrintOptimizationSetupError(
      "nonplanar-bed",
      "Select one planar print face with consistent outward triangle winding.",
    )
  for (let index = 0; index < mesh.vertices.length / 3; index++) {
    if (point(mesh, index).sub(origin).dot(normal) > tolerance)
      throw new PrintOptimizationSetupError(
        "bed-intersection",
        "The selected face is internal or crosses the source solid. Select an exterior face that can rest flat on the bed.",
      )
  }
  return { origin, rotation: new Quaternion().setFromUnitVectors(normal, new Vector3(0, 0, -1)) }
}

function transformMesh(
  mesh: StructuralMesh,
  transform: (value: Vector3) => Vector3,
): StructuralMesh {
  const vertices: number[] = []
  for (let index = 0; index < mesh.vertices.length / 3; index++)
    vertices.push(...transform(point(mesh, index)).toArray())
  return { vertices, indices: [...mesh.indices] }
}

function bounds(mesh: StructuralMesh) {
  const box = new Box3()
  for (let index = 0; index < mesh.vertices.length / 3; index++)
    box.expandByPoint(point(mesh, index))
  return box
}

function boxRegion(box: Box3): BoxRegion {
  return { min: box.min.toArray(), max: box.max.toArray() }
}

function unitForce(axis: number, magnitude = 1): Vector {
  return new Vector3().setComponent(axis, magnitude).toArray()
}

/** Source-surface points clipped to the far slab avoid assuming occupied box corners. */
function farSurfaceBounds(mesh: StructuralMesh, axis: number, cut: number) {
  const box = new Box3()
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [0, 1, 2].map((corner) => point(mesh, mesh.indices[index + corner] ?? -1))
    for (const [corner, a] of triangle.entries()) {
      const b = triangle[(corner + 1) % 3]
      if (!b) continue
      const da = a.getComponent(axis) - cut
      const db = b.getComponent(axis) - cut
      if (da >= 0) box.expandByPoint(a)
      if ((da < 0 && db > 0) || (da > 0 && db < 0))
        box.expandByPoint(a.clone().lerp(b, da / (da - db)))
    }
  }
  return box
}

function standardizedCases(mesh: StructuralMesh, cell: number, tolerance: number) {
  const box = bounds(mesh)
  const size = box.getSize(new Vector3())
  const axes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a))
  const axis = axes[0] ?? 0
  const transverse = axes.slice(1)
  if (
    size.getComponent(axis) <= 6 * cell + tolerance ||
    transverse.some((value) => size.getComponent(value) < 2 * cell - tolerance)
  )
    throw new PrintOptimizationSetupError(
      "unresolved-scenarios",
      "The source is too thin for separated two-cell support and load patches. Reduce the cell size or select a thicker solid.",
    )
  const support = box.clone()
  support.max.setComponent(axis, box.min.getComponent(axis) + 2 * cell)
  const far = box.clone()
  far.min.setComponent(axis, box.max.getComponent(axis) - 2 * cell)
  const surface = farSurfaceBounds(mesh, axis, far.min.getComponent(axis))
  const surfaceSize = surface.getSize(new Vector3())
  const separationAxis = transverse.reduce((a, b) =>
    surfaceSize.getComponent(a) >= surfaceSize.getComponent(b) ? a : b,
  )
  if (
    surface.isEmpty() ||
    surfaceSize.getComponent(separationAxis) < 4 * cell - tolerance ||
    transverse.some((value) => surfaceSize.getComponent(value) < 2 * cell - tolerance)
  )
    throw new PrintOptimizationSetupError(
      "unresolved-scenarios",
      "The far end has no resolved pair of torsion patches. Reduce the cell size so its surface spans at least four cells across.",
    )
  const lowPatch = far.clone()
  const highPatch = far.clone()
  lowPatch.min.setComponent(separationAxis, surface.min.getComponent(separationAxis) - tolerance)
  lowPatch.max.setComponent(separationAxis, surface.min.getComponent(separationAxis) + 2 * cell)
  highPatch.min.setComponent(separationAxis, surface.max.getComponent(separationAxis) - 2 * cell)
  highPatch.max.setComponent(separationAxis, surface.max.getComponent(separationAxis) + tolerance)
  const tangential = new Vector3()
    .setComponent(axis, 1)
    .cross(new Vector3().setComponent(separationAxis, 1))
  return {
    supports: [boxRegion(support)],
    loadCases: [
      { name: "Axial tension", region: boxRegion(far), forceN: unitForce(axis) },
      ...transverse.map((value, index) => ({
        name: `Bending ${index + 1}`,
        region: boxRegion(far),
        forceN: unitForce(value),
      })),
      {
        name: "Torsion",
        region: boxRegion(lowPatch),
        forceN: tangential.clone().multiplyScalar(-0.5).toArray(),
        additionalLoads: [
          { region: boxRegion(highPatch), forceN: tangential.multiplyScalar(0.5).toArray() },
        ],
      },
    ],
  }
}

/** Capture one print frame and normalized comparison study without mutating the source. */
export function preparePrintOptimization(options: PrintOptimizationOptions): {
  input: StructuralOptimizationInput
  restoreMesh: (mesh: StructuralMesh) => StructuralMesh
  toPrintMesh: (mesh: StructuralMesh) => StructuralMesh
  frame: { originMm: [number, number, number]; rotation: [number, number, number, number] }
} {
  const parsedMesh = structuralMeshSchema.safeParse(options.mesh)
  if (!parsedMesh.success)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      "Capture a valid complete triangle mesh before optimizing.",
    )
  const source = parsedMesh.data
  const cell = options.cellSizeMm
  if (!Number.isFinite(cell) || cell < 0.01 || cell > 100_000)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      "Cell size must be between 0.01 and 100,000 mm.",
    )
  selectedTriangles(source, options.preserveTriangleIndices, false)
  const tolerance = Math.max(1e-9, bounds(source).getSize(new Vector3()).length() * 1e-8)
  const { origin, rotation } = printFrame(source, options.bedTriangleIndices, tolerance)
  const mesh = transformMesh(source, (value) => value.sub(origin).applyQuaternion(rotation))
  const scenarios = standardizedCases(mesh, cell, tolerance)
  const parsed = structuralOptimizationInputSchema.safeParse({
    schemaVersion: 1,
    mesh,
    ...scenarios,
    material: options.material,
    objective: { kind: "minimize-mass" },
    algorithm: { kind: "simp", volumeFraction: 0.1, filterRadiusMm: 1.5 * cell, penalty: 3 },
    fdm: {
      buildDirection: "+z",
      supportMode: options.supportMode,
      minFeatureSizeMm: options.minFeatureSizeMm,
      layerHeightMm: options.layerHeightMm,
      maxOverhangAngleDeg: 45,
    },
    relativePerformance: {
      minStiffnessFraction: options.minStiffnessFraction,
      minStrengthFraction: options.minStrengthFraction,
    },
    safetyFactor: 1,
    maxDisplacementMm: 100_000,
    cellSizeMm: cell,
    // A print-frame lattice avoids an arbitrary source-bound residue at nominal cell widths.
    voxelGridOriginMm: [0, 0, 0],
    preserveRegions: options.preserveTriangleIndices.length
      ? [
          {
            kind: "surface",
            triangleIndices: [...options.preserveTriangleIndices],
            depthMm: 2 * cell,
          },
        ]
      : [],
    maxIterations: options.maxIterations,
  })
  if (!parsed.success)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      `Invalid print optimization settings: ${parsed.error.issues[0]?.message ?? "check the selected settings"}`,
    )
  const inverse = rotation.clone().invert()
  return {
    frame: { originMm: origin.toArray(), rotation: rotation.toArray() },
    input: parsed.data,
    toPrintMesh: (result) =>
      transformMesh(result, (value) => value.sub(origin).applyQuaternion(rotation)),
    restoreMesh: (result) =>
      transformMesh(result, (value) => value.applyQuaternion(inverse).add(origin)),
  }
}
