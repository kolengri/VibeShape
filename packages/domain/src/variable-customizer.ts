import {
  type ExpressionValue,
  evaluateVariableDefinitions,
  type VariableDefinition,
  variableDefinitionsSchema,
} from "./variables"

/** Slider and configuration values use canonical mm, radians, or dimensionless units. */
export function customizerExpression(value: ExpressionValue): string {
  if (!Number.isFinite(value.value)) throw new Error("A customizer value must be finite.")
  const unit = value.dimension === "length" ? " mm" : value.dimension === "angle" ? " rad" : ""
  return `${Number(value.value.toPrecision(14))}${unit}`
}

export function customizerConfigurationNames(variables: readonly VariableDefinition[]): string[] {
  return [
    ...new Set(
      variables.flatMap((variable) => Object.keys(variable.customizer?.configurations ?? {})),
    ),
  ].sort()
}

export function setCustomizerValue(
  variables: readonly VariableDefinition[],
  variableId: VariableDefinition["id"],
  value: number,
): VariableDefinition[] {
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
  const selected = evaluated.valuesById.get(variableId)
  const customizer = selected?.definition.customizer
  if (!selected || !customizer) throw new Error("The variable is not exposed in the customizer.")
  if (!Number.isFinite(value) || value < customizer.min || value > customizer.max) {
    throw new Error("The value is outside the customizer range.")
  }
  return variableDefinitionsSchema.parse(
    variables.map((variable) =>
      variable.id === variableId
        ? { ...variable, expression: customizerExpression({ ...selected.value, value }) }
        : variable,
    ),
  )
}

export function saveCustomizerConfiguration(
  variables: readonly VariableDefinition[],
  name: string,
): VariableDefinition[] {
  const normalized = name.trim()
  if (!normalized || normalized.length > 80)
    throw new Error("A configuration name must contain 1 to 80 characters.")
  if (!variables.some((variable) => variable.customizer))
    throw new Error("Expose a variable before saving a configuration.")
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
  return variableDefinitionsSchema.parse(
    variables.map((variable) => {
      if (!variable.customizer) return variable
      const current = evaluated.valuesById.get(variable.id)
      if (!current) throw new Error("The variable could not be evaluated.")
      return {
        ...variable,
        customizer: {
          ...variable.customizer,
          configurations: {
            ...variable.customizer.configurations,
            [normalized]: current.value.value,
          },
        },
      }
    }),
  )
}

export function applyCustomizerConfiguration(
  variables: readonly VariableDefinition[],
  name: string,
): VariableDefinition[] {
  const exposed = variables.filter((variable) => variable.customizer)
  if (
    !exposed.length ||
    exposed.some((variable) => variable.customizer?.configurations[name] === undefined)
  ) {
    throw new Error(
      "This configuration does not cover all exposed variables. Save it again before applying it.",
    )
  }
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
  return variableDefinitionsSchema.parse(
    variables.map((variable) => {
      if (!variable.customizer) return variable
      const current = evaluated.valuesById.get(variable.id)
      const value = variable.customizer.configurations[name]
      if (!current || value === undefined) throw new Error("The configuration is incomplete.")
      return { ...variable, expression: customizerExpression({ ...current.value, value }) }
    }),
  )
}

export function removeCustomizerConfiguration(
  variables: readonly VariableDefinition[],
  name: string,
): VariableDefinition[] {
  return variableDefinitionsSchema.parse(
    variables.map((variable) => {
      if (!variable.customizer) return variable
      const configurations = { ...variable.customizer.configurations }
      delete configurations[name]
      return { ...variable, customizer: { ...variable.customizer, configurations } }
    }),
  )
}
