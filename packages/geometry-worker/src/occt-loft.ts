import {
  circularArcParameters,
  type ExtrusionMultiProfileContentParameters,
  extrusionFrameSchema,
  extrusionProfileLoopSchema,
  MAX_ANALYTICAL_LOFT_SECTIONS,
} from "@vibeshape/protocol"
import { Edge, Face, type Shape3D, type SimplePoint, Wire } from "replicad"
import type {
  BRepBuilderAPI_MakeEdge,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import { ellipticalArcKernelParameters } from "./extrusion-curve-geometry"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"
import { makeOcctCubicBezierEdge } from "./occt-cubic-bezier"

import { createHoledLoft, type LoftHoleCorrespondence } from "./occt-loft-holes"
export type AnalyticalProfile = Readonly<
  Pick<ExtrusionMultiProfileContentParameters, "frame"> &
    ExtrusionMultiProfileContentParameters["profiles"][number]
>
type AnalyticalFrame = AnalyticalProfile["frame"]
type AnalyticalLoop = AnalyticalProfile["outer"]
type AnalyticalSegment = AnalyticalLoop["segments"][number]

const PROFILE_LINEAR_TOLERANCE = 1e-6

function analyticalPoint(frame: AnalyticalFrame, [x, y]: readonly [number, number]): SimplePoint {
  return frame.origin.map(
    (coordinate, axis) => coordinate + (frame.xAxis[axis] ?? 0) * x + (frame.yAxis[axis] ?? 0) * y,
  ) as SimplePoint
}

function pointDistance(left: readonly number[], right: readonly number[]) {
  return Math.hypot(...left.map((coordinate, axis) => coordinate - (right[axis] ?? 0)))
}

function validateProfileJoin(
  segment: Exclude<AnalyticalSegment, { type: "circle" | "ellipse" }>,
  next: AnalyticalSegment | undefined,
) {
  if (
    !next ||
    next.type === "circle" ||
    next.type === "ellipse" ||
    pointDistance(segment.end, next.start) > PROFILE_LINEAR_TOLERANCE ||
    pointDistance(segment.start, segment.end) <= PROFILE_LINEAR_TOLERANCE
  )
    throw new Error("Profile boundaries must be closed, connected and nondegenerate.")
}

function validateClosedLoop(loop: AnalyticalLoop) {
  if (new Set(loop.segments.map(({ entityId }) => entityId)).size !== loop.segments.length)
    throw new Error("A profile must use every selected analytical curve exactly once.")
  for (const [index, segment] of loop.segments.entries()) {
    if (segment.type === "circle" || segment.type === "ellipse") {
      if (loop.segments.length !== 1)
        throw new Error("A closed circle or ellipse must be its own profile boundary.")
      continue
    }
    validateProfileJoin(segment, loop.segments[(index + 1) % loop.segments.length])
  }
}

export function parseAnalyticalProfile(profile: AnalyticalProfile): AnalyticalProfile {
  const frame = extrusionFrameSchema.parse(profile.frame)
  const outer = extrusionProfileLoopSchema.parse(profile.outer)
  if (!Array.isArray(profile.holes) || profile.holes.length > 2_000)
    throw new Error("A profile exceeds the hole boundary budget.")
  const holes = profile.holes.map((hole) => extrusionProfileLoopSchema.parse(hole))
  const loops = [outer, ...holes]
  if (loops.reduce((total, loop) => total + loop.segments.length, 0) > 2_000)
    throw new Error("A profile exceeds the aggregate analytical curve budget.")
  const ids = loops.flatMap(({ sourceEntityIds }) => sourceEntityIds)
  if (new Set(ids).size !== ids.length)
    throw new Error("A profile curve cannot belong to more than one boundary.")
  for (const loop of loops) validateClosedLoop(loop)
  return { frame, outer, holes }
}

type OwnedBinding = { delete: () => void }
type OwnBinding = <Binding extends OwnedBinding>(binding: Binding) => Binding

function ownedAnalyticalEdge(build: (own: OwnBinding) => BRepBuilderAPI_MakeEdge): Edge {
  const bindings: OwnedBinding[] = []
  let result: Edge | null = null
  let failed = false
  let failure: unknown
  const own: OwnBinding = (binding) => {
    bindings.push(binding)
    return binding
  }
  try {
    const builder = own(build(own))
    if (!builder.IsDone()) throw new Error("OCCT analytical edge did not complete.")
    result = new Edge(builder.Edge())
  } catch (error) {
    failed = true
    failure = error
  } finally {
    for (const binding of bindings.reverse()) {
      try {
        binding.delete()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
  }
  if (failed) {
    result?.delete()
    throw failure
  }
  if (!result) throw new Error("OCCT analytical edge is unavailable.")
  return result
}

function analyticalAxis(
  opencascade: OpenCascadeInstance,
  own: OwnBinding,
  parameters: { center: SimplePoint; normal: SimplePoint; xDirection: SimplePoint },
) {
  return own(
    new opencascade.gp_Ax2_2(
      own(new opencascade.gp_Pnt_3(...parameters.center)),
      own(new opencascade.gp_Dir_4(...parameters.normal)),
      own(new opencascade.gp_Dir_4(...parameters.xDirection)),
    ),
  )
}

function analyticalEllipseEdge(
  opencascade: OpenCascadeInstance,
  frame: AnalyticalFrame,
  segment: Extract<AnalyticalSegment, { type: "ellipse" | "elliptical-arc" }>,
  reverse: boolean,
): Edge {
  const point = (coordinates: readonly [number, number]) => analyticalPoint(frame, coordinates)
  const normal = frame.normal.map((coordinate) =>
    reverse ? -coordinate : coordinate,
  ) as SimplePoint
  const center = point(segment.center)
  const primaryAxisPoint = point(segment.primaryAxisPoint)
  const secondaryAxisPoint = point(segment.secondaryAxisPoint)
  if (segment.type === "elliptical-arc") {
    const parameters = ellipticalArcKernelParameters({
      center,
      primaryAxisPoint,
      secondaryAxisPoint,
      normal: frame.normal,
      reverse,
      start: point(segment.start),
      end: point(segment.end),
    })
    return ownedAnalyticalEdge(
      (own) =>
        new opencascade.BRepBuilderAPI_MakeEdge_13(
          own(
            new opencascade.gp_Elips_2(
              analyticalAxis(opencascade, own, parameters),
              parameters.majorRadius,
              parameters.minorRadius,
            ),
          ),
          parameters.startParameter,
          parameters.endParameter,
        ),
    )
  }
  const primary = pointDistance(primaryAxisPoint, center)
  const secondary = pointDistance(secondaryAxisPoint, center)
  const majorPoint = primary >= secondary ? primaryAxisPoint : secondaryAxisPoint
  const major = Math.max(primary, secondary)
  const minor = Math.min(primary, secondary)
  const xDirection = majorPoint.map(
    (coordinate, index) => (coordinate - (center[index] ?? 0)) / major,
  ) as SimplePoint
  return ownedAnalyticalEdge(
    (own) =>
      new opencascade.BRepBuilderAPI_MakeEdge_12(
        own(
          new opencascade.gp_Elips_2(
            analyticalAxis(opencascade, own, { center, normal, xDirection }),
            major,
            minor,
          ),
        ),
      ),
  )
}

export function createAnalyticalEdge(
  opencascade: OpenCascadeInstance,
  frame: AnalyticalFrame,
  segment: AnalyticalSegment,
  reverse: boolean,
): Edge {
  if (segment.type === "ellipse" || segment.type === "elliptical-arc")
    return analyticalEllipseEdge(opencascade, frame, segment, reverse)
  const point = (coordinates: readonly [number, number]) => analyticalPoint(frame, coordinates)
  if (segment.type === "cubic-bezier")
    return makeOcctCubicBezierEdge(
      opencascade,
      {
        start: point(segment.start),
        control1: point(segment.control1),
        control2: point(segment.control2),
        end: point(segment.end),
      },
      reverse,
    )
  if (segment.type === "circle") {
    const normal = frame.normal.map((coordinate) =>
      reverse ? -coordinate : coordinate,
    ) as SimplePoint
    return ownedAnalyticalEdge(
      (own) =>
        new opencascade.BRepBuilderAPI_MakeEdge_8(
          own(
            new opencascade.gp_Circ_2(
              analyticalAxis(opencascade, own, {
                center: point(segment.center),
                normal,
                xDirection: frame.xAxis,
              }),
              segment.radius,
            ),
          ),
        ),
    )
  }
  const start = point(reverse ? segment.end : segment.start)
  const end = point(reverse ? segment.start : segment.end)
  if (segment.type === "line")
    return ownedAnalyticalEdge(
      (own) =>
        new opencascade.BRepBuilderAPI_MakeEdge_3(
          own(new opencascade.gp_Pnt_3(...start)),
          own(new opencascade.gp_Pnt_3(...end)),
        ),
    )
  const parameters = circularArcParameters(
    reverse ? { ...segment, start: segment.end, end: segment.start } : segment,
  )
  const center = point(parameters.center)
  const xDirection = start.map(
    (coordinate, index) => (coordinate - (center[index] ?? 0)) / parameters.radius,
  ) as SimplePoint
  const arcNormal = frame.normal.map((coordinate) => coordinate * parameters.sign) as SimplePoint
  return ownedAnalyticalEdge(
    (own) =>
      new opencascade.BRepBuilderAPI_MakeEdge_9(
        own(
          new opencascade.gp_Circ_2(
            analyticalAxis(opencascade, own, { center, normal: arcNormal, xDirection }),
            parameters.radius,
          ),
        ),
        0,
        parameters.sweep,
      ),
  )
}

/** Builds fresh analytical input; cached native source shapes never enter this ownership scope. */
export function createAnalyticalWire(
  opencascade: OpenCascadeInstance,
  frame: AnalyticalFrame,
  segments: readonly AnalyticalSegment[],
  reverse = false,
): Wire {
  const edges: Edge[] = []
  try {
    for (const segment of reverse ? [...segments].reverse() : segments)
      edges.push(createAnalyticalEdge(opencascade, frame, segment, reverse))
    const builder = new opencascade.BRepBuilderAPI_MakeWire_1()
    try {
      for (const edge of edges) builder.Add_1(edge.wrapped)
      const progress = new opencascade.Message_ProgressRange_1()
      try {
        builder.Build(progress)
        if (!builder.IsDone()) throw new Error("OCCT analytical wire did not complete.")
        return new Wire(builder.Wire())
      } finally {
        progress.delete()
      }
    } finally {
      builder.delete()
    }
  } finally {
    for (const edge of edges.reverse()) edge.delete()
  }
}

export function createAnalyticalFace(opencascade: OpenCascadeInstance, profile: AnalyticalProfile) {
  const wires: Wire[] = []
  try {
    wires.push(createAnalyticalWire(opencascade, profile.frame, profile.outer.segments))
    for (const hole of profile.holes)
      wires.push(createAnalyticalWire(opencascade, profile.frame, hole.segments, true))
    const outer = wires[0]
    if (!outer) throw new Error("A profile outer boundary is unavailable.")
    const builder = new opencascade.BRepBuilderAPI_MakeFace_15(outer.wrapped, true)
    try {
      for (const hole of wires.slice(1)) builder.Add(hole.wrapped)
      if (!builder.IsDone()) throw new Error("OCCT analytical profile face did not complete.")
      const face = new Face(builder.Face())
      try {
        const analyzer = new opencascade.BRepCheck_Analyzer(face.wrapped, true, false)
        try {
          if (!analyzer.IsValid_2()) throw new Error("The analytical profile face is invalid.")
        } finally {
          analyzer.delete()
        }
        return face
      } catch (error) {
        face.delete()
        throw error
      }
    } finally {
      builder.delete()
    }
  } finally {
    for (const wire of wires.reverse()) wire.delete()
  }
}

export function validateOcctProfileSolid(opencascade: OpenCascadeInstance, shape: Shape3D) {
  const analyzer = new opencascade.BRepCheck_Analyzer(shape.wrapped, true, false)
  try {
    if (!analyzer.IsValid_2()) throw new Error("OCCT profile feature produced an invalid shape.")
    const properties = new opencascade.GProp_GProps_1()
    try {
      opencascade.BRepGProp.VolumeProperties_1(shape.wrapped, properties, false, false, false)
      const volume = properties.Mass()
      if (!Number.isFinite(volume) || volume <= 0)
        throw new Error("OCCT profile feature requires positive finite volume.")
    } finally {
      properties.delete()
    }
    const explorer = new opencascade.TopExp_Explorer_2(
      shape.wrapped,
      Reflect.get(opencascade.TopAbs_ShapeEnum, "TopAbs_SOLID") as TopAbs_ShapeEnum,
      Reflect.get(opencascade.TopAbs_ShapeEnum, "TopAbs_SHAPE") as TopAbs_ShapeEnum,
    )
    try {
      let count = 0
      while (explorer.More()) {
        count += 1
        explorer.Next()
      }
      if (count !== 1) throw new Error("OCCT profile feature requires exactly one solid.")
    } finally {
      explorer.delete()
    }
  } finally {
    analyzer.delete()
  }
}

function sectionsAreCoplanar(previous: AnalyticalProfile, section: AnalyticalProfile) {
  const parallel = Math.abs(
    previous.frame.normal.reduce(
      (total, coordinate, axis) => total + coordinate * (section.frame.normal[axis] ?? 0),
      0,
    ),
  )
  const separation = Math.abs(
    previous.frame.normal.reduce(
      (total, coordinate, axis) =>
        total +
        coordinate * ((section.frame.origin[axis] ?? 0) - (previous.frame.origin[axis] ?? 0)),
      0,
    ),
  )
  return parallel > 1 - 1e-8 && separation <= PROFILE_LINEAR_TOLERANCE
}

function validateLoftCurveBudget(parsed: readonly AnalyticalProfile[], allowHoles: boolean) {
  if (!allowHoles && parsed.some(({ holes }) => holes.length > 0))
    throw new Error(
      "Loft v1 requires hole-free sections until authored hole correspondence exists.",
    )
  if (
    parsed.reduce(
      (total, section) =>
        total +
        [section.outer, ...section.holes].reduce((count, loop) => count + loop.segments.length, 0),
      0,
    ) > 2_000
  )
    throw new Error("Loft sections exceed the aggregate analytical curve budget.")
}

function validateLoftSections(
  sections: readonly AnalyticalProfile[],
  ruled: boolean,
  allowHoles = false,
) {
  if (
    sections.length < 2 ||
    sections.length > MAX_ANALYTICAL_LOFT_SECTIONS ||
    typeof ruled !== "boolean"
  )
    throw new Error(
      "Loft requires two to twenty-four ordered sections and an explicit ruled setting.",
    )
  const parsed = sections.map(parseAnalyticalProfile)
  validateLoftCurveBudget(parsed, allowHoles)
  for (const [index, section] of parsed.entries()) {
    const previous = parsed[index - 1]
    if (!previous) continue
    if (sectionsAreCoplanar(previous, section))
      throw new Error("Adjacent Loft sections must not lie in the same plane.")
  }
  return parsed
}

export function createOcctLoftOperations(
  castShape: OcctShapeCaster,
  makeWire = createAnalyticalWire,
  validateSolid = validateOcctProfileSolid,
  makeFace = createAnalyticalFace,
) {
  const operations = {
    loftShape(
      opencascade: OpenCascadeInstance,
      sections: readonly AnalyticalProfile[],
      parameters: Readonly<{ ruled: boolean; holeCorrespondence?: LoftHoleCorrespondence }>,
    ): Shape3D {
      const parsed = validateLoftSections(
        sections,
        parameters.ruled,
        parameters.holeCorrespondence !== undefined,
      )
      if (parameters.holeCorrespondence) {
        for (const section of parsed) makeFace(opencascade, section).delete()
        return createHoledLoft(
          opencascade,
          parsed,
          parameters.holeCorrespondence,
          (boundaries) =>
            operations.loftShape(opencascade, boundaries, { ruled: parameters.ruled }),
          (shape) => validateSolid(opencascade, shape),
        )
      }
      const wires: Wire[] = []
      try {
        for (const section of parsed) {
          const face = makeFace(opencascade, section)
          try {
            wires.push(makeWire(opencascade, section.frame, section.outer.segments))
          } finally {
            face.delete()
          }
        }
        const builder = new opencascade.BRepOffsetAPI_ThruSections(
          true,
          parameters.ruled,
          PROFILE_LINEAR_TOLERANCE,
        )
        try {
          builder.CheckCompatibility(true)
          for (const wire of wires) builder.AddWire(wire.wrapped)
          const progress = new opencascade.Message_ProgressRange_1()
          try {
            builder.Build(progress)
            if (!builder.IsDone()) throw new Error("OCCT Loft did not complete.")
            const shape = adoptOcctShape(builder.Shape(), castShape)
            try {
              validateSolid(opencascade, shape)
              return shape
            } catch (error) {
              shape.delete()
              throw error
            }
          } finally {
            progress.delete()
          }
        } finally {
          builder.delete()
        }
      } finally {
        for (const wire of wires.reverse()) wire.delete()
      }
    },
  }
  return operations
}

export const { loftShape: createOcctLoft } = createOcctLoftOperations(castOcctShape)
