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

type Candidate = Readonly<Record<string, unknown>> | null
/** Each saved schema's parameter shape, or null when that version cannot hold the intent. */
const legacyCandidates: Readonly<Record<number, (intent: RevolveAuthoringIntent) => Candidate>> = {
  1: (intent) => originAxisCandidate(intent),
  2: (intent) => originAxisCandidate(intent),
  3: (intent) => singleProfileCandidate(intent),
  4: (intent) => singleProfileCandidate(intent),
  5: (intent) => ({ ...common(intent), profiles: intent.profiles }),
  6: (intent) => (resultTarget(intent) ? { ...common(intent), profiles: intent.profiles } : null),
  7: (intent) =>
    intent.targetBody
      ? { ...common(intent), profiles: intent.profiles, targetBody: intent.targetBody }
      : null,
}

function common(intent: RevolveAuthoringIntent) {
  return { axis: intent.axis, angle: intent.angle, operation: intent.operation }
}
function resultTarget(intent: RevolveAuthoringIntent) {
  return intent.targetBody === null || intent.targetBody.outputRole === "result"
}
function singleProfileCandidate(intent: RevolveAuthoringIntent): Candidate {
  const [profile, ...rest] = intent.profiles.profiles
  return profile && rest.length === 0 && resultTarget(intent)
    ? { ...common(intent), profile }
    : null
}
function originAxisCandidate(intent: RevolveAuthoringIntent): Candidate {
  const candidate = singleProfileCandidate(intent)
  return candidate && intent.axis.kind === "origin-axis"
    ? { ...candidate, axis: intent.axis.axis }
    : null
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
    const candidate = legacyCandidates[saved.schemaVersion]?.(intent) ?? null
    const parameters = candidate && jsonParameters(candidate)
    if (parameters && readRevolveFeatureParameters({ type: saved, parameters }))
      return { type: saved, parameters }
  }
  return { type: revolveFeatureTypeV8.type, parameters: jsonParameters(v8.data) }
}
