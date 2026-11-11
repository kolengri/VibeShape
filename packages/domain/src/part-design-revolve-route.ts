import type { BodyReference } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import {
  type RevolveEndCondition,
  type RevolveFeatureParametersV8,
  readRevolveFeatureParameters,
  revolveFeatureParametersV8Schema,
  revolveFeatureTypeV8,
} from "./part-design"
import type { SketchProfileSet } from "./sketch-profile-selector"

/** Complete authored Revolve intent, independent of the schema version that will store it. */
export type RevolveAuthoringIntent = Readonly<{
  profiles: SketchProfileSet
  axis: RevolveFeatureParametersV8["axis"]
  angle: RevolveFeatureParametersV8["angle"]
  symmetric: boolean
  reversed: boolean
  secondAngle: RevolveFeatureParametersV8["secondAngle"]
  operation: RevolveFeatureParametersV8["operation"]
  targetBody: BodyReference | null
  endCondition: RevolveEndCondition
}>

export type RevolveAuthoringRoute = Readonly<{
  type: FeatureRecord["type"]
  parameters: FeatureRecord["parameters"]
}>

/** Schema-validated parameters are plain JSON; branded identifiers erase to strings. */
const jsonParameters = (value: object) => value as FeatureRecord["parameters"]

/** Options that only Revolve v8 can represent. */
export function revolveIntentRequiresV8(intent: RevolveAuthoringIntent) {
  return (
    intent.symmetric ||
    intent.reversed ||
    intent.secondAngle !== null ||
    intent.endCondition.kind !== "angle"
  )
}

function legacyRevolveCandidate(intent: RevolveAuthoringIntent, schemaVersion: number) {
  const [profile, ...rest] = intent.profiles.profiles
  const single = rest.length === 0 ? profile : undefined
  const common = { axis: intent.axis, angle: intent.angle, operation: intent.operation }
  const resultTarget = intent.targetBody === null || intent.targetBody.outputRole === "result"
  if (schemaVersion <= 4) {
    if (!single || !resultTarget) return null
    if (schemaVersion > 2) return { ...common, profile: single }
    return intent.axis.kind === "origin-axis"
      ? { ...common, profile: single, axis: intent.axis.axis }
      : null
  }
  if (schemaVersion === 5) return { ...common, profiles: intent.profiles }
  if (schemaVersion === 6) return resultTarget ? { ...common, profiles: intent.profiles } : null
  if (schemaVersion === 7 && intent.targetBody)
    return { ...common, profiles: intent.profiles, targetBody: intent.targetBody }
  return null
}

/**
 * The single owner of the Revolve schema route. New features author v8. An edit keeps its saved
 * schema version while that version can still represent the intent, and moves to v8 only when a
 * v8-only option is chosen or the saved version cannot express the edited intent.
 */
export function routeRevolveAuthoring(
  intent: RevolveAuthoringIntent,
  saved: FeatureRecord["type"] | null,
): RevolveAuthoringRoute | null {
  const v8 = revolveFeatureParametersV8Schema.safeParse(intent)
  if (!v8.success) return null
  if (saved && !revolveIntentRequiresV8(intent)) {
    const candidate = legacyRevolveCandidate(intent, saved.schemaVersion)
    const parameters = candidate && jsonParameters(candidate)
    if (parameters && readRevolveFeatureParameters({ type: saved, parameters }))
      return { type: saved, parameters }
  }
  return { type: revolveFeatureTypeV8.type, parameters: jsonParameters(v8.data) }
}
