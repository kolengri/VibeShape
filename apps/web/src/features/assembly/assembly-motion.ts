import {
  angleToRadians,
  type DocumentDisplayUnits,
  lengthToMillimeters,
  millimetersToLength,
  radiansToAngle,
} from "@vibeshape/domain"
import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyJointRecord,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"

export type AssemblyMotionCoordinate = {
  kind: "angle" | "translation"
  value: number
  min: number
  max: number
  driven: boolean
}

export function assemblyMotionCoordinates(joint: AssemblyJointRecord): AssemblyMotionCoordinate[] {
  switch (joint.kind) {
    case "fixed":
    case "ball":
      return []
    case "revolute":
    case "prismatic":
      return [
        {
          kind: joint.kind === "revolute" ? "angle" : "translation",
          value: joint.value,
          ...joint.limits,
          driven: joint.schemaVersion === 1 || joint.driven,
        },
      ]
    case "cylindrical":
      return [
        { kind: "angle", value: joint.angle, ...joint.angleLimits, driven: joint.rotationDriven },
        {
          kind: "translation",
          value: joint.translation,
          ...joint.translationLimits,
          driven: joint.translationDriven,
        },
      ]
  }
}

/** The chosen coordinate becomes a solver constraint; all other authored mate data is preserved. */
export function assemblyMotionChanges(
  joint: AssemblyJointRecord,
  coordinate: AssemblyMotionCoordinate,
  value: number,
): readonly AssemblyMutation[] {
  if (!Number.isFinite(value) || value < coordinate.min || value > coordinate.max)
    throw new Error("The motion coordinate must remain within its authored limits.")
  let updated: AssemblyJointRecord
  if (joint.kind === "revolute" || joint.kind === "prismatic") {
    if (coordinate.kind !== (joint.kind === "revolute" ? "angle" : "translation"))
      throw new Error("The selected motion coordinate does not belong to this joint.")
    updated = assemblyJointRecordSchema.parse({
      ...joint,
      value,
      ...(joint.schemaVersion === 2 ? { driven: true } : {}),
    })
  } else if (joint.kind === "cylindrical") {
    updated = assemblyJointRecordSchema.parse({
      ...joint,
      ...(coordinate.kind === "angle"
        ? { angle: value, rotationDriven: true }
        : { translation: value, translationDriven: true }),
    })
  } else throw new Error("This joint has no supported drive coordinate.")
  return [{ kind: "joint.update", joint: updated }]
}

export function assemblyMotionUnits(
  coordinate: AssemblyMotionCoordinate,
  units: DocumentDisplayUnits,
) {
  const conversion =
    coordinate.kind === "angle"
      ? {
          unit: units.angle,
          display: (value: number) => radiansToAngle(value, units.angle),
          canonical: (value: number) => angleToRadians(value, units.angle),
        }
      : {
          unit: units.length,
          display: (value: number) => millimetersToLength(value, units.length),
          canonical: (value: number) => lengthToMillimeters(value, units.length),
        }
  const display = (value: number) => Number(conversion.display(value).toPrecision(12))
  return {
    ...conversion,
    display,
    // Preserve exact authored endpoints when a displayed value makes a floating-point round trip.
    canonical: (value: number) =>
      [coordinate.value, coordinate.min, coordinate.max].find(
        (original) => display(original) === value,
      ) ?? conversion.canonical(value),
  }
}

/** One finite sweep, with exact endpoints and no implied time or collision simulation. */
export function assemblyMotionSamples(
  coordinate: AssemblyMotionCoordinate,
  start: number,
  end: number,
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < coordinate.min ||
    end > coordinate.max ||
    start >= end
  )
    throw new Error("Motion requires an increasing range within the authored limits.")
  return Array.from({ length: 13 }, (_, index) =>
    index === 12 ? end : start + ((end - start) * index) / 12,
  )
}
