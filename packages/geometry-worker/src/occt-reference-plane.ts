import {
  type SplitFeatureContentParametersV2,
  splitFeatureContentParametersV2Schema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import {
  createOcctPlaneSplitOperations,
  type OwnedPlaneSplit,
  type splitOcctShape,
} from "./occt-plane-split"

type Vector = readonly [number, number, number]
type PlaneFrame = Readonly<{ origin: Vector; x: Vector; y: Vector; normal: Vector }>
function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function planeFrame(origin: Vector, normal: Vector): PlaneFrame {
  const reference: Vector = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const projection = dot(reference, normal)
  const projected = reference.map((v, i) => v - projection * (normal[i] ?? 0)) as [
    number,
    number,
    number,
  ]
  const length = Math.hypot(...projected)
  const x = projected.map((v) => v / length) as [number, number, number]
  const y: Vector = [
    normal[1] * x[2] - normal[2] * x[1],
    normal[2] * x[0] - normal[0] * x[2],
    normal[0] * x[1] - normal[1] * x[0],
  ]
  return { origin, x, y, normal }
}
function transformPlaneCopy(
  occt: OpenCascadeInstance,
  source: Shape3D,
  frame: PlaneFrame,
  inverse: boolean,
): Shape3D {
  const { origin: o, x, y, normal: n } = frame
  const transform = new occt.gp_Trsf_1()
  try {
    if (inverse)
      transform.SetValues(
        x[0],
        x[1],
        x[2],
        -dot(x, o),
        y[0],
        y[1],
        y[2],
        -dot(y, o),
        n[0],
        n[1],
        n[2],
        -dot(n, o),
      )
    else transform.SetValues(x[0], y[0], n[0], o[0], x[1], y[1], n[1], o[1], x[2], y[2], n[2], o[2])
    const builder = new occt.BRepBuilderAPI_Transform_2(source.wrapped, transform, true)
    try {
      if (!builder.IsDone()) throw new Error("Reference-plane transform did not complete.")
      return adoptOcctShape(builder.Shape(), castOcctShape)
    } finally {
      builder.delete()
    }
  } finally {
    transform.delete()
  }
}
type Operations = Readonly<{ transform: typeof transformPlaneCopy; split: typeof splitOcctShape }>
export function createOcctReferencePlaneSplitOperations(overrides: Partial<Operations> = {}) {
  // World-bounded solids can have larger coordinates in a rotated temporary frame.
  const localSplit = createOcctPlaneSplitOperations({}, 300_000).splitShape
  const operations: Operations = {
    transform: transformPlaneCopy,
    split: localSplit,
    ...overrides,
  }
  return {
    splitShape(
      occt: OpenCascadeInstance,
      source: Shape3D,
      input: SplitFeatureContentParametersV2,
    ): OwnedPlaneSplit {
      const parameters = splitFeatureContentParametersV2Schema.parse(input)
      const projection = dot(parameters.planeOrigin, parameters.planeNormal)
      const origin = parameters.planeNormal.map((value) => value * projection) as [
        number,
        number,
        number,
      ]
      const frame = planeFrame(origin, parameters.planeNormal)
      const temporaries: Shape3D[] = []
      const outputs: Shape3D[] = []
      let failure: { error: unknown } | undefined
      try {
        const local = operations.transform(occt, source, frame, true)
        if (local === source) throw new Error("Reference-plane transform must copy its source.")
        temporaries.push(local)
        const split = operations.split(occt, local, { plane: "XY", offset: parameters.offset })
        adoptSplitTemporaries(source, local, split, temporaries)
        for (const side of [split.negative, split.positive]) {
          const output = operations.transform(occt, side, frame, false)
          if (output === source || temporaries.includes(output) || outputs.includes(output))
            throw new Error("Reference-plane outputs require separate ownership.")
          outputs.push(output)
        }
      } catch (error) {
        failure = { error }
      }
      return releaseReferencePlaneSplit(temporaries, outputs, failure)
    },
  }
}
export const { splitShape: splitOcctShapeByReferencePlane } =
  createOcctReferencePlaneSplitOperations()

function adoptSplitTemporaries(
  source: Shape3D,
  local: Shape3D,
  split: OwnedPlaneSplit,
  temporaries: Shape3D[],
) {
  const sides = [split.negative, split.positive]
  for (const side of new Set(sides)) if (side !== source && side !== local) temporaries.push(side)
  if (split.negative === split.positive || sides.includes(source) || sides.includes(local))
    throw new Error("Reference-plane split requires separately owned local outputs.")
}
function disposeShapes(shapes: readonly Shape3D[]): unknown[] {
  const failures: unknown[] = []
  for (const shape of [...new Set(shapes)].reverse()) {
    try {
      shape.delete()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}
function releaseReferencePlaneSplit(
  temporaries: readonly Shape3D[],
  outputs: Shape3D[],
  failure: { error: unknown } | undefined,
): OwnedPlaneSplit {
  const cleanupFailures = disposeShapes(temporaries)
  if (failure || cleanupFailures.length) {
    cleanupFailures.push(...disposeShapes(outputs))
    if (cleanupFailures.length)
      throw new AggregateError(
        [...(failure ? [failure.error] : []), ...cleanupFailures],
        "Reference-plane split cleanup failed.",
      )
    throw failure?.error
  }
  const [negative, positive] = outputs
  if (!negative || !positive) throw new Error("Reference-plane split did not produce both sides.")
  return { negative, positive }
}
