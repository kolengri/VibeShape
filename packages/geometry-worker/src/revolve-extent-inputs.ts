import type { RevolveFeatureContentParametersV8 } from "@vibeshape/protocol"
import type { FeatureEvaluationInput } from "./engine"

function inputRoles(input: FeatureEvaluationInput) {
  return input.content.schemaVersion === 1
    ? input.content.feature.inputRoles
    : input.dependencies.map(() => null)
}

/** A modifying revolve consumes the exact named body in input 0. */
function targetRoleIsValid(
  input: FeatureEvaluationInput,
  parameters: RevolveFeatureContentParametersV8,
  roles: readonly (string | null)[],
) {
  if (parameters.operation === "new") return true
  return roles[0] != null && roles[0] === input.dependencies[0]?.outputRole
}

/** A dynamic endpoint must still name the body revision and role it was prepared against. */
function endBindingIsValid(
  input: FeatureEvaluationInput,
  end: RevolveFeatureContentParametersV8["endCondition"],
  roles: readonly (string | null)[],
) {
  if (end.kind === "angle") return true
  const dependency = input.dependencies[end.inputIndex]
  return (
    dependency?.contentHash === end.sourceContentHash &&
    dependency.outputRole === end.outputRole &&
    roles[end.inputIndex] === end.outputRole
  )
}

function expectedDependencyIds(
  input: FeatureEvaluationInput,
  parameters: RevolveFeatureContentParametersV8,
) {
  const end = parameters.endCondition
  const owners = [
    parameters.operation === "new" ? undefined : input.dependencies[0]?.featureId,
    parameters.supportFeatureId,
    parameters.axis.kind === "model-edge" ? parameters.axis.reference.featureId : undefined,
    end.kind === "angle" ? undefined : input.dependencies[end.inputIndex]?.featureId,
  ]
  return owners.flatMap((id, index) => (id && owners.indexOf(id) === index ? [id] : []))
}

/** Inputs are the named target, then distinct sketch-support, axis, and endpoint owners. */
export function revolveExtentInputsAreValid(
  input: FeatureEvaluationInput,
  parameters: RevolveFeatureContentParametersV8,
) {
  const roles = inputRoles(input)
  if (input.content.feature.inputs.length !== input.dependencies.length) return false
  if (!targetRoleIsValid(input, parameters, roles)) return false
  if (!endBindingIsValid(input, parameters.endCondition, roles)) return false
  const expected = expectedDependencyIds(input, parameters)
  return (
    expected.length === input.dependencies.length &&
    input.dependencies.every(({ featureId }, index) => featureId === expected[index])
  )
}
