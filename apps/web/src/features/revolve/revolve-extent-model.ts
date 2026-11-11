import type { RevolveEndCondition, readRevolveFeatureParameters } from "@vibeshape/domain"
import {
  type ExtrusionTargetOption,
  extrusionBodyOptionKey,
} from "../extrusion/extrusion-body-options"

export type RevolveExtentKind = "one-sided" | "symmetric" | "two-sided"
export type RevolveEndKind = RevolveEndCondition["kind"]

/** Form state for Revolve v8 extents; every field round-trips through the saved parameters. */
export type RevolveExtentValues = Readonly<{
  extent: RevolveExtentKind
  reversed: boolean
  secondAngle: string
  endKind: RevolveEndKind
  endTarget: string
  endSourceHash: string
  endFace: string
}>

type SavedRevolve = NonNullable<ReturnType<typeof readRevolveFeatureParameters>>

export function defaultRevolveExtentValues(secondAngle: string): RevolveExtentValues {
  return {
    extent: "one-sided",
    reversed: false,
    secondAngle,
    endKind: "angle",
    endTarget: "",
    endSourceHash: "",
    endFace: "",
  }
}

function extentKind(parameters: SavedRevolve): RevolveExtentKind {
  if (parameters.symmetric) return "symmetric"
  return parameters.secondAngle ? "two-sided" : "one-sided"
}

export function revolveExtentValuesFromParameters(
  parameters: SavedRevolve,
  defaultSecondAngle: string,
): RevolveExtentValues {
  const end = parameters.endCondition
  const second = parameters.secondAngle
  return {
    extent: extentKind(parameters),
    reversed: parameters.reversed ?? false,
    secondAngle: second
      ? (second.source.expression ?? `${second.source.value} ${second.source.unit}`)
      : defaultSecondAngle,
    endKind: end?.kind ?? "angle",
    endTarget:
      end && end.kind !== "angle"
        ? extrusionBodyOptionKey({
            id: end.targetBody.featureId,
            outputRole: end.targetBody.outputRole,
          })
        : "",
    endSourceHash: end && end.kind !== "angle" ? end.sourceContentHash : "",
    endFace: end?.kind === "up-to-face" ? JSON.stringify(end.face) : "",
  }
}

/** Binds the end body to the exact rebuilt revision shown in the picker; stale choices fail. */
export function parseRevolveEnd(
  values: RevolveExtentValues,
  options: readonly ExtrusionTargetOption[],
):
  | Readonly<{ ok: true; value: RevolveEndCondition }>
  | Readonly<{ ok: false; field: "endTarget" | "endFace" }> {
  if (values.endKind === "angle") return { ok: true, value: { kind: "angle" } }
  const target = options.find((item) => extrusionBodyOptionKey(item) === values.endTarget)
  if (!target?.outputRole || !target.contentHash || target.contentHash !== values.endSourceHash)
    return { ok: false, field: "endTarget" }
  const base = {
    targetBody: { schemaVersion: 0, featureId: target.id, outputRole: target.outputRole },
    sourceContentHash: target.contentHash,
  } as const
  if (values.endKind === "up-to-body") return { ok: true, value: { kind: "up-to-body", ...base } }
  const face = target.faces?.find((item) => JSON.stringify(item.reference) === values.endFace)
  return face?.reference.kind === "face"
    ? {
        ok: true,
        value: {
          kind: "up-to-face",
          ...base,
          face: { ...face.reference, kind: "face" },
        },
      }
    : { ok: false, field: "endFace" }
}
