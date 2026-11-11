import type { RevolveFeatureContentParametersV8 } from "@vibeshape/protocol"
import type { Face, Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { terminateExtrusionAtBody, terminateExtrusionAtFace } from "./occt-extrusion-end"
import { fuseOcctShapes } from "./occt-shapes"

type Point = readonly [number, number, number]

/** A Revolve v8 evaluation failure whose message is safe to show as a feature diagnostic. */
export class RevolveExtentError extends Error {}

/**
 * Dynamic endpoints sweep one profile at most this far before the endpoint must have closed it.
 * The one-degree gap keeps the overrun cap geometrically distinct from the start cap.
 */
export const REVOLVE_ENDPOINT_SWEEP_RADIANS = Math.PI * 2 - Math.PI / 180

export type RevolveSweep = Readonly<{
  /** Signed rotation of the profile about the directed axis before sweeping. */
  startRadians: number
  /** Positive sweep about the directed axis. */
  sweepRadians: number
  /** +1 sweeps about `axisDirection`, -1 about its opposite. */
  directionSign: 1 | -1
}>

/** Resolves authored first, second, symmetric, and reversed intent into one directed sweep. */
export function revolveSweep(
  parameters: Pick<
    RevolveFeatureContentParametersV8,
    "angleRadians" | "secondAngleRadians" | "symmetric" | "reversed" | "endCondition"
  >,
): RevolveSweep {
  const directionSign = parameters.reversed ? -1 : 1
  if (parameters.endCondition.kind !== "angle")
    return { startRadians: 0, sweepRadians: REVOLVE_ENDPOINT_SWEEP_RADIANS, directionSign }
  if (parameters.symmetric)
    return {
      startRadians: -parameters.angleRadians / 2,
      sweepRadians: parameters.angleRadians,
      directionSign,
    }
  const second = parameters.secondAngleRadians ?? 0
  return {
    startRadians: -second,
    sweepRadians: Math.min(Math.PI * 2, parameters.angleRadians + second),
    directionSign,
  }
}

function rotate(vector: Point, axis: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2]
  const cross: Point = [
    axis[1] * vector[2] - axis[2] * vector[1],
    axis[2] * vector[0] - axis[0] * vector[2],
    axis[0] * vector[1] - axis[1] * vector[0],
  ]
  return [0, 1, 2].map(
    (index) =>
      (vector[index] ?? 0) * cos + (cross[index] ?? 0) * sin + (axis[index] ?? 0) * dot * (1 - cos),
  ) as unknown as Point
}

/** Planes of the sketch-plane start cap and the overrun cap of a dynamic-endpoint sweep. */
export function revolveEndpointCaps(
  parameters: Pick<RevolveFeatureContentParametersV8, "axisOrigin" | "axisDirection" | "frame">,
  sweep: RevolveSweep,
) {
  const axis = parameters.axisDirection.map((value) => value * sweep.directionSign) as [
    number,
    number,
    number,
  ]
  return {
    origin: parameters.axisOrigin,
    startNormal: parameters.frame.normal,
    endNormal: rotate(parameters.frame.normal, axis, REVOLVE_ENDPOINT_SWEEP_RADIANS),
  }
}

/** Keeps the unique swept component between the profile and the first contact with the endpoint. */
export function terminateRevolveTool(
  occt: OpenCascadeInstance,
  tool: Shape3D,
  target: Shape3D,
  caps: ReturnType<typeof revolveEndpointCaps>,
  face: Face | null,
) {
  try {
    return face
      ? terminateExtrusionAtFace(
          occt,
          tool,
          target,
          face,
          caps.origin,
          caps.origin,
          caps.startNormal,
          caps.endNormal,
        )
      : terminateExtrusionAtBody(
          occt,
          tool,
          target,
          caps.origin,
          caps.origin,
          caps.startNormal,
          caps.endNormal,
        )
  } catch (error) {
    throw new RevolveExtentError(
      face
        ? "The selected face must be the first contact and close every revolve profile within 359 degrees."
        : "The selected body must completely block every revolve profile within 359 degrees.",
      { cause: error },
    )
  }
}

export type RevolveProfileOutputs = Readonly<{
  /** The connected aggregate when every profile merged into one solid. */
  merged: Shape3D | null
  /** One owned solid per profile when no profile solids merged. */
  separate: readonly Readonly<{ role: string; shape: Shape3D }>[]
}>

function disposeAll(shapes: readonly Shape3D[]) {
  for (const shape of shapes) {
    try {
      shape.delete()
    } catch {
      /* best-effort cleanup after a failed evaluation */
    }
  }
}

/**
 * New multi-profile Revolve publishes either one merged solid or one named solid per profile.
 * Partial merges have no stable per-profile identity and fail closed. Ownership of every input tool
 * transfers to this function.
 */
export function partitionRevolveProfileSolids(
  occt: OpenCascadeInstance,
  tools: readonly Shape3D[],
  roles: readonly string[],
): RevolveProfileOutputs {
  let merged: Shape3D | null = null
  try {
    if (tools.length < 2 || tools.length !== roles.length)
      throw new RevolveExtentError("Each revolve profile requires one output role.")
    for (const tool of tools) {
      const next: Shape3D = merged ? fuseOcctShapes(occt, merged, tool) : tool.clone()
      merged?.delete()
      merged = next
    }
    if (!merged) throw new RevolveExtentError("Revolve profiles are unavailable.")
    const solidCount = inspectOcctBody(occt, merged).solidCount
    if (solidCount === 1) {
      disposeAll(tools)
      return { merged, separate: [] }
    }
    if (solidCount !== tools.length)
      throw new RevolveExtentError(
        "Selected profiles must revolve into one connected solid or one separate solid per profile.",
      )
    if (new Set(roles).size !== roles.length)
      throw new RevolveExtentError("Separate revolve profiles must have distinct output roles.")
    merged.delete()
    merged = null
    return {
      merged: null,
      separate: tools.map((shape, index) => ({ role: roles[index] ?? "", shape })),
    }
  } catch (error) {
    if (merged) disposeAll([merged])
    disposeAll(tools)
    throw error
  }
}

/** Fuses owned profile tools into one owned tool; every input is released on success and failure. */
export function fuseOwnedRevolveTools(occt: OpenCascadeInstance, tools: readonly Shape3D[]) {
  const [first, ...rest] = tools
  if (!first) throw new RevolveExtentError("Revolve profiles are unavailable.")
  let combined: Shape3D = first
  for (const [index, tool] of rest.entries()) {
    try {
      const next = fuseOcctShapes(occt, combined, tool)
      combined.delete()
      tool.delete()
      combined = next
    } catch (error) {
      disposeAll([combined, ...rest.slice(index)])
      throw error
    }
  }
  return combined
}
