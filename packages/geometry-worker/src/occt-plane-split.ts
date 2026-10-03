import { mirrorFeatureContentParametersSchema } from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Shape } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { placeOcctShape } from "./occt-placement"

export type PlaneSplitParameters = Readonly<{
  plane: "XY" | "XZ" | "YZ"
  offset: number
}>
export type OwnedPlaneSplit = Readonly<{ negative: Shape3D; positive: Shape3D }>
type Vector3 = [number, number, number]
type Bounds = Readonly<{ min: Vector3; max: Vector3 }>
type SolidMetrics = Readonly<{ valid: boolean; solidCount: number; volume: number }>
type NativeOperations = Readonly<{
  copy: (occt: OpenCascadeInstance, source: Shape3D) => Shape3D
  bounds: (occt: OpenCascadeInstance, shape: Shape3D) => Bounds
  inspect: (occt: OpenCascadeInstance, shape: Shape3D) => SolidMetrics
  box: (occt: OpenCascadeInstance, bounds: Bounds) => Shape3D
  common: (occt: OpenCascadeInstance, source: Shape3D, tool: Shape3D) => Shape3D
  confusion: (occt: OpenCascadeInstance) => number
}>

function nativeBounds(occt: OpenCascadeInstance, shape: Shape3D): Bounds {
  const box = new occt.Bnd_Box_1()
  try {
    // Analytical geometry plus native entity tolerances; display tessellation is never consulted.
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, true)
    if (box.IsVoid() || box.IsOpen()) throw new Error("Split source bounds are not finite.")
    const values = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, values)
    const [x0, y0, z0, x1, y1, z1] = values.map(({ current }) => current)
    if (
      x0 === undefined ||
      y0 === undefined ||
      z0 === undefined ||
      x1 === undefined ||
      y1 === undefined ||
      z1 === undefined
    )
      throw new Error("Split source bounds are unavailable.")
    return { min: [x0, y0, z0], max: [x1, y1, z1] }
  } finally {
    box.delete()
  }
}

function nativeBox(occt: OpenCascadeInstance, box: Bounds): Shape3D {
  const min = new occt.gp_Pnt_3(...box.min)
  try {
    const max = new occt.gp_Pnt_3(...box.max)
    try {
      const builder = new occt.BRepPrimAPI_MakeBox_4(min, max)
      try {
        return adoptOcctShape(builder.Solid(), castOcctShape)
      } finally {
        builder.delete()
      }
    } finally {
      max.delete()
    }
  } finally {
    min.delete()
  }
}

function adoptSoleSolid(occt: OpenCascadeInstance, raw: TopoDS_Shape): Shape3D {
  const explorer = new occt.TopExp_Explorer_2(
    raw,
    occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    if (!explorer.More()) throw new Error("The split plane misses or only touches the source.")
    const solid = explorer.Current()
    try {
      explorer.Next()
      if (explorer.More()) throw new Error("Each split side must contain exactly one solid.")
      return castOcctShape(solid)
    } finally {
      solid.delete()
    }
  } finally {
    explorer.delete()
  }
}

function nativeCommon(occt: OpenCascadeInstance, source: Shape3D, tool: Shape3D): Shape3D {
  const argumentsList = new occt.TopTools_ListOfShape_1()
  try {
    const tools = new occt.TopTools_ListOfShape_1()
    try {
      argumentsList.Append_1(source.wrapped).delete()
      tools.Append_1(tool.wrapped).delete()
      const builder = new occt.BRepAlgoAPI_Common_1()
      try {
        // Configure before Build; the two-shape constructor would already perform a boolean.
        builder.SetNonDestructive(true)
        builder.SetToFillHistory(false)
        builder.SetArguments(argumentsList)
        builder.SetTools(tools)
        const progress = new occt.Message_ProgressRange_1()
        try {
          builder.Build(progress)
          if (!builder.IsDone()) throw new Error("OCCT plane split did not complete.")
          const raw = builder.Shape()
          try {
            return adoptSoleSolid(occt, raw)
          } finally {
            raw.delete()
          }
        } finally {
          progress.delete()
        }
      } finally {
        builder.delete()
      }
    } finally {
      tools.delete()
    }
  } finally {
    argumentsList.delete()
  }
}

function requireSingleSolid(metrics: SolidMetrics) {
  if (
    !metrics.valid ||
    metrics.solidCount !== 1 ||
    !Number.isFinite(metrics.volume) ||
    metrics.volume <= 0
  )
    throw new Error("Plane split requires valid positive-volume single solids.")
}

function requireBounds(box: Bounds, tolerance: number) {
  for (const axis of [0, 1, 2] as const) {
    if (
      !Number.isFinite(box.min[axis]) ||
      !Number.isFinite(box.max[axis]) ||
      box.min[axis] >= box.max[axis] ||
      Math.max(Math.abs(box.min[axis]), Math.abs(box.max[axis])) > 100_000 + tolerance
    )
      throw new Error("Plane split requires finite source bounds within 100,000 mm.")
  }
}

function releaseShapes(shapes: readonly Shape3D[]): unknown[] {
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

type SplitPlan = Readonly<{
  axis: 0 | 1 | 2
  offset: number
  tolerance: number
  sourceVolume: number
  negativeBox: Bounds
  positiveBox: Bounds
}>

function parsePlaneParameters(parameters: PlaneSplitParameters): PlaneSplitParameters {
  const { plane } = mirrorFeatureContentParametersSchema.parse({ plane: parameters?.plane })
  const offset = parameters?.offset
  if (!Number.isFinite(offset) || Math.abs(offset) > 100_000)
    throw new RangeError("Split plane offset must be finite and within 100,000 mm.")
  return { plane, offset }
}

function planSplit(
  operations: NativeOperations,
  occt: OpenCascadeInstance,
  source: Shape3D,
  parameters: PlaneSplitParameters,
): SplitPlan {
  const { plane, offset } = parsePlaneParameters(parameters)
  const confusion = operations.confusion(occt)
  if (!Number.isFinite(confusion) || confusion <= 0)
    throw new Error("OCCT tolerance is unavailable.")
  const tolerance = confusion * 10
  const sourceMetrics = operations.inspect(occt, source)
  requireSingleSolid(sourceMetrics)
  const sourceBounds = operations.bounds(occt, source)
  requireBounds(sourceBounds, tolerance)
  const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0
  if (offset <= sourceBounds.min[axis] || offset >= sourceBounds.max[axis])
    throw new Error("The split plane must pass through the source interior.")
  // The clip tools cover native bounds, with only scale/tolerance-derived padding.
  const magnitude = Math.max(...sourceBounds.min.map(Math.abs), ...sourceBounds.max.map(Math.abs))
  const padding = Math.max(tolerance, magnitude * Number.EPSILON * 128)
  const negativeBox: Bounds = {
    min: sourceBounds.min.map((v) => v - padding) as Vector3,
    max: sourceBounds.max.map((v) => v + padding) as Vector3,
  }
  const positiveBox: Bounds = { min: [...negativeBox.min], max: [...negativeBox.max] }
  negativeBox.max[axis] = offset
  positiveBox.min[axis] = offset
  return { axis, offset, tolerance, sourceVolume: sourceMetrics.volume, negativeBox, positiveBox }
}

function validateSplit(
  operations: NativeOperations,
  occt: OpenCascadeInstance,
  bundle: OwnedPlaneSplit,
  plan: SplitPlan,
) {
  const negativeMetrics = operations.inspect(occt, bundle.negative)
  const positiveMetrics = operations.inspect(occt, bundle.positive)
  requireSingleSolid(negativeMetrics)
  requireSingleSolid(positiveMetrics)
  const negativeBounds = operations.bounds(occt, bundle.negative)
  const positiveBounds = operations.bounds(occt, bundle.positive)
  requireBounds(negativeBounds, plan.tolerance)
  requireBounds(positiveBounds, plan.tolerance)
  if (
    Math.abs(negativeBounds.max[plan.axis] - plan.offset) > plan.tolerance ||
    Math.abs(positiveBounds.min[plan.axis] - plan.offset) > plan.tolerance
  )
    throw new Error("Split outputs do not meet their requested plane sides.")
  const volumeError = Math.abs(negativeMetrics.volume + positiveMetrics.volume - plan.sourceVolume)
  if (volumeError > plan.sourceVolume * 1e-8)
    throw new Error("Split outputs do not conserve the source volume.")
}

type SplitOutcome = { ok: true; bundle: OwnedPlaneSplit } | { ok: false; error: unknown }

function releaseSplit(
  temporaries: readonly Shape3D[],
  results: readonly Shape3D[],
  outcome: SplitOutcome,
): OwnedPlaneSplit {
  const releaseFailures = releaseShapes(temporaries)
  if (!outcome.ok || releaseFailures.length) releaseFailures.push(...releaseShapes(results))
  if (releaseFailures.length) {
    throw new AggregateError(
      outcome.ok ? releaseFailures : [outcome.error, ...releaseFailures],
      "Plane split could not release every owned native shape.",
    )
  }
  if (!outcome.ok) throw outcome.error
  return outcome.bundle
}

export function createOcctPlaneSplitOperations(overrides: Partial<NativeOperations> = {}) {
  const operations: NativeOperations = {
    copy: (occt, source) =>
      placeOcctShape(occt, source, { translation: [0, 0, 0], rotation: [0, 0, 0] }),
    bounds: nativeBounds,
    inspect: inspectOcctBody,
    box: nativeBox,
    common: nativeCommon,
    confusion: (occt) => occt.Precision.Confusion(),
    ...overrides,
  }
  return {
    /** Exact bounded origin-plane split. The caller owns both returned solids or neither. */
    splitShape(
      occt: OpenCascadeInstance,
      source: Shape3D,
      parameters: PlaneSplitParameters,
    ): OwnedPlaneSplit {
      const plan = planSplit(operations, occt, source, parameters)
      const temporaries: Shape3D[] = []
      const results: Shape3D[] = []
      let outcome: SplitOutcome
      try {
        const copy = operations.copy(occt, source)
        temporaries.push(copy)
        const negativeBox = operations.box(occt, plan.negativeBox)
        temporaries.push(negativeBox)
        const negative = operations.common(occt, copy, negativeBox)
        results.push(negative)
        const positiveBox = operations.box(occt, plan.positiveBox)
        temporaries.push(positiveBox)
        const positive = operations.common(occt, copy, positiveBox)
        results.push(positive)
        const bundle = { negative, positive }
        validateSplit(operations, occt, bundle, plan)
        outcome = { ok: true, bundle }
      } catch (error) {
        outcome = { ok: false, error }
      }
      return releaseSplit(temporaries, results, outcome)
    },
  }
}

export const { splitShape: splitOcctShape } = createOcctPlaneSplitOperations()
