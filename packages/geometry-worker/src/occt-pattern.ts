import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { placeOcctShape } from "./occt-placement"

type Axis = "X" | "Y" | "Z"
type Vector3 = readonly [number, number, number]
type Bounds = Readonly<{ min: Vector3; max: Vector3 }>
type Metrics = Readonly<{ valid: boolean; solidCount: number; volume: number }>
export type PatternKernelParameters = Readonly<{ count: number; axis: Axis | Vector3 }> &
  (
    | Readonly<{ kind: "linear"; spacing: number }>
    | Readonly<{ kind: "circular"; angle: number; center: Vector3 }>
  )
export type OwnedBodyPattern = readonly Readonly<{ role: string; shape: Shape3D }>[]
type NativeOperations = Readonly<{
  copy: (occt: OpenCascadeInstance, source: Shape3D, translation: Vector3) => Shape3D
  rotate: (
    occt: OpenCascadeInstance,
    source: Shape3D,
    center: Vector3,
    axis: Axis | Vector3,
    angle: number,
  ) => Shape3D
  bounds: (occt: OpenCascadeInstance, shape: Shape3D) => Bounds
  inspect: (occt: OpenCascadeInstance, shape: Shape3D) => Metrics
}>
const axisVectors: Record<Axis, [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
}

function axisVector(axis: Axis | Vector3): Vector3 {
  if (typeof axis === "string") {
    if (!Object.hasOwn(axisVectors, axis)) throw new Error("Pattern axis is invalid.")
    return axisVectors[axis]
  }
  if (
    !Array.isArray(axis) ||
    axis.length !== 3 ||
    !axis.every(Number.isFinite) ||
    Math.abs(Math.hypot(...axis) - 1) > 1e-8
  )
    throw new Error("Pattern axis must be a unit vector.")
  return axis
}
function nativeBounds(occt: OpenCascadeInstance, shape: Shape3D): Bounds {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    if (box.IsVoid() || box.IsOpen()) throw new Error("Pattern body bounds are not finite.")
    const coordinates = [
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
      { current: 0 },
    ] as const
    Reflect.apply(box.Get, box, coordinates)
    return {
      min: [coordinates[0].current, coordinates[1].current, coordinates[2].current],
      max: [coordinates[3].current, coordinates[4].current, coordinates[5].current],
    }
  } finally {
    box.delete()
  }
}
function rotateCopy(
  occt: OpenCascadeInstance,
  source: Shape3D,
  center: Vector3,
  axis: Axis | Vector3,
  angle: number,
): Shape3D {
  const point = new occt.gp_Pnt_3(...center)
  try {
    const direction = new occt.gp_Dir_4(...axisVector(axis))
    try {
      const rotationAxis = new occt.gp_Ax1_2(point, direction)
      try {
        const transform = new occt.gp_Trsf_1()
        try {
          transform.SetRotation_1(rotationAxis, angle)
          const builder = new occt.BRepBuilderAPI_Transform_2(source.wrapped, transform, true)
          try {
            if (!builder.IsDone()) throw new Error("OCCT pattern rotation did not complete.")
            return adoptOcctShape(builder.Shape(), castOcctShape)
          } finally {
            builder.delete()
          }
        } finally {
          transform.delete()
        }
      } finally {
        rotationAxis.delete()
      }
    } finally {
      direction.delete()
    }
  } finally {
    point.delete()
  }
}
function validateLinearParameters(
  parameters: Extract<PatternKernelParameters, { kind: "linear" }>,
) {
  if (
    !Number.isFinite(parameters.spacing) ||
    parameters.spacing === 0 ||
    Math.abs((parameters.count - 1) * parameters.spacing) > 100_000
  )
    throw new Error("Linear pattern displacement is invalid.")
}
function withinWorkspace(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 100_000
}
function validateCircularParameters(
  parameters: Extract<PatternKernelParameters, { kind: "circular" }>,
) {
  if (
    !Number.isFinite(parameters.angle) ||
    parameters.angle === 0 ||
    Math.abs(parameters.angle) > 2 * Math.PI
  )
    throw new Error("Circular pattern angle is invalid.")
  if (
    !Array.isArray(parameters.center) ||
    parameters.center.length !== 3 ||
    !parameters.center.every(withinWorkspace)
  )
    throw new Error("Circular pattern center is invalid.")
}
function validateParameters(parameters: PatternKernelParameters) {
  if (!Number.isInteger(parameters.count) || parameters.count < 2 || parameters.count > 256)
    throw new Error("Pattern count must be an integer between 2 and 256.")
  axisVector(parameters.axis)
  if (parameters.kind === "linear") return validateLinearParameters(parameters)
  if (parameters.kind === "circular") return validateCircularParameters(parameters)
  throw new Error("Pattern kind is invalid.")
}
function validateBounds(bounds: Bounds) {
  if (![...bounds.min, ...bounds.max].every(withinWorkspace))
    throw new Error("Pattern body exceeds the 100,000 mm workspace.")
}
function validateMetrics(metrics: Metrics) {
  if (
    !metrics.valid ||
    metrics.solidCount !== 1 ||
    !Number.isFinite(metrics.volume) ||
    metrics.volume <= 0
  )
    throw new Error("Each pattern body must be one valid positive-volume solid.")
}
function displacement(
  parameters: Extract<PatternKernelParameters, { kind: "linear" }>,
  index: number,
): Vector3 {
  return axisVector(parameters.axis).map((component) => component * parameters.spacing * index) as [
    number,
    number,
    number,
  ]
}
function preflight(
  operations: NativeOperations,
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: PatternKernelParameters,
) {
  validateParameters(parameters)
  const bounds = operations.bounds(occt, source)
  validateBounds(bounds)
  const metrics = operations.inspect(occt, source)
  validateMetrics(metrics)
  if (parameters.kind === "linear") {
    const delta = displacement(parameters, parameters.count - 1)
    validateBounds({
      min: bounds.min.map((value, index) => value + (delta[index] ?? 0)) as [
        number,
        number,
        number,
      ],
      max: bounds.max.map((value, index) => value + (delta[index] ?? 0)) as [
        number,
        number,
        number,
      ],
    })
  }
  return metrics
}
function createInstance(
  operations: NativeOperations,
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: PatternKernelParameters,
  index: number,
) {
  if (parameters.kind === "linear")
    return operations.copy(occt, source, displacement(parameters, index))
  if (index === 0) return operations.copy(occt, source, [0, 0, 0])
  // Only exact canonical +/-2π is a full circle. Partial spans include their authored endpoint.
  const divisor =
    Math.abs(parameters.angle) === 2 * Math.PI ? parameters.count : parameters.count - 1
  const angle = index === divisor ? parameters.angle : (parameters.angle * index) / divisor
  return operations.rotate(occt, source, parameters.center, parameters.axis, angle)
}
function validateInstance(
  operations: NativeOperations,
  occt: OpenCascadeInstance,
  source: Shape3D,
  shape: Shape3D,
  sourceMetrics: Metrics,
  previous: OwnedBodyPattern,
) {
  // IsPartner detects shared native geometry even when placements differ.
  if (shape.wrapped.IsPartner(source.wrapped))
    throw new Error("Pattern instances must own independent copied geometry.")
  if (previous.some((output) => shape.wrapped.IsPartner(output.shape.wrapped)))
    throw new Error("Pattern instances must own distinct native copies.")
  validateBounds(operations.bounds(occt, shape))
  const metrics = operations.inspect(occt, shape)
  validateMetrics(metrics)
  if (Math.abs(metrics.volume - sourceMetrics.volume) > sourceMetrics.volume * 1e-8)
    throw new Error("Pattern transformation must preserve source volume.")
}
function releaseFailedPattern(outputs: OwnedBodyPattern): boolean {
  let released = true
  for (const { shape } of [...outputs].reverse()) {
    try {
      shape.delete()
    } catch {
      released = false
    }
  }
  return released
}
export function createOcctPatternOperations(overrides: Partial<NativeOperations> = {}) {
  const operations: NativeOperations = {
    copy: (occt, source, translation) =>
      placeOcctShape(occt, source, { translation: [...translation], rotation: [0, 0, 0] }),
    rotate: rotateCopy,
    bounds: nativeBounds,
    inspect: inspectOcctBody,
    ...overrides,
  }
  return {
    /** The caller owns every copied instance, including seed 0, or receives no result. */
    patternShape(
      occt: OpenCascadeInstance,
      source: Shape3D,
      parameters: PatternKernelParameters,
    ): OwnedBodyPattern {
      const metrics = preflight(operations, occt, source, parameters)
      const outputs: { role: string; shape: Shape3D }[] = []
      try {
        for (let index = 0; index < parameters.count; index += 1) {
          const shape = createInstance(operations, occt, source, parameters, index)
          if (shape === source || outputs.some((output) => output.shape === shape))
            throw new Error("Pattern copies must have separate ownership.")
          outputs.push({ role: `pattern.instance.${index}`, shape })
          validateInstance(operations, occt, source, shape, metrics, outputs.slice(0, -1))
        }
        return outputs
      } catch (error) {
        if (!releaseFailedPattern(outputs))
          throw new Error("Pattern failed and could not release every owned copy.", {
            cause: error,
          })
        throw error
      }
    },
  }
}
export const { patternShape: patternOcctShape } = createOcctPatternOperations()
