import {
  commandIdSchema,
  draftIdSchema,
  revisionSchema,
  variableIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  variableDefinitionSchema,
  variableDefinitionsSchema,
  variableExpressionSchema,
  variableNameSchema,
} from "@vibeshape/domain/variables"
import { z } from "zod"

const draftCommand = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  commandId: commandIdSchema,
}

export const localVariableInputs = {
  create_variable: z.object({ ...draftCommand, variable: variableDefinitionSchema }).strict(),
  set_variable_expression: z
    .object({
      ...draftCommand,
      variableId: variableIdSchema,
      expression: variableExpressionSchema,
    })
    .strict(),
  rename_variable: z
    .object({ ...draftCommand, variableId: variableIdSchema, name: variableNameSchema })
    .strict(),
  remove_variable: z.object({ ...draftCommand, variableId: variableIdSchema }).strict(),
  replace_variable_table: z
    .object({ ...draftCommand, variables: variableDefinitionsSchema })
    .strict(),
} as const

export const localVariableOperations = [
  z
    .object({ tool: z.literal("create_variable"), arguments: localVariableInputs.create_variable })
    .strict(),
  z
    .object({
      tool: z.literal("set_variable_expression"),
      arguments: localVariableInputs.set_variable_expression,
    })
    .strict(),
  z
    .object({ tool: z.literal("rename_variable"), arguments: localVariableInputs.rename_variable })
    .strict(),
  z
    .object({ tool: z.literal("remove_variable"), arguments: localVariableInputs.remove_variable })
    .strict(),
  z
    .object({
      tool: z.literal("replace_variable_table"),
      arguments: localVariableInputs.replace_variable_table,
    })
    .strict(),
] as const
