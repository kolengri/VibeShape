import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import { edgeTopoRefSchema } from "@vibeshape/domain/topology"
import { variableExpressionSchema } from "@vibeshape/domain/variables"
import { z } from "zod"
import { automationDraftInspectionViewSchema } from "./draft-inspection"
import {
  automationDraftCommitViewSchema,
  automationDraftDiscardViewSchema,
  automationDraftPreviewSchema,
  automationDraftStateSchema,
} from "./drafts"
import { localCadInputs, localCadOperations } from "./local-cad-tools"
import {
  localDraftInspectionInputs,
  localDraftInspectionOperations,
} from "./local-draft-inspection"
import { localVariableInputs, localVariableOperations } from "./local-variable-tools"
import {
  cadInspectionDetailQuerySchema,
  cadInspectionDetailViewSchema,
  cadInspectionListQuerySchema,
  cadInspectionListViewSchema,
  documentSummaryViewSchema,
  modelBodyMeasurementArgumentsSchema,
  modelBodyMeasurementViewSchema,
  modelBodyTopologyArgumentsSchema,
  modelBodyTopologyViewSchema,
  modelEdgeQuerySchema,
  modelEdgeViewSchema,
  modelMeasurementViewSchema,
  variableListQuerySchema,
  variableListViewSchema,
} from "./queries"

export const localFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostic: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
        message: z.string().min(1).max(512),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict()
export type LocalFailure = z.infer<typeof localFailureSchema>
export function localFailure(code: string, message: string, retryable = false): LocalFailure {
  return localFailureSchema.parse({ ok: false, diagnostic: { code, message, retryable } })
}
function resultOf<Schema extends z.ZodType>(schema: Schema) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: schema }).strict(),
    localFailureSchema,
  ])
}
const draft = z.object({ draftId: draftIdSchema }).strict()
const feature = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  commandId: commandIdSchema,
  featureId: featureIdSchema,
  label: z.string().min(1).max(120).optional(),
}
const length = z.number().finite().positive().max(1_000_000)
const fillet = z
  .object({
    ...feature,
    targetFeatureId: featureIdSchema,
    radiusMm: length,
    radiusExpression: variableExpressionSchema.optional(),
    edges: z.array(edgeTopoRefSchema).min(1).max(256).optional(),
  })
  .strict()
const chamfer = z
  .object({
    ...feature,
    targetFeatureId: featureIdSchema,
    distanceMm: length,
    distanceExpression: variableExpressionSchema.optional(),
    edges: z.array(edgeTopoRefSchema).min(1).max(256).optional(),
  })
  .strict()
export const localToolInputs = {
  ...localDraftInspectionInputs,
  model_edges: modelEdgeQuerySchema.omit({ kind: true, schemaVersion: true, documentId: true }),
  model_body_measurements: modelBodyMeasurementArgumentsSchema,
  model_body_topology: modelBodyTopologyArgumentsSchema,
  ...localCadInputs,
  ...localVariableInputs,
  model_variables: variableListQuerySchema.omit({
    kind: true,
    schemaVersion: true,
    documentId: true,
  }),
  create_chamfer: chamfer,
  update_chamfer: chamfer,
  model_tree: cadInspectionListQuerySchema.omit({
    kind: true,
    schemaVersion: true,
    documentId: true,
  }),
  model_entity: cadInspectionDetailQuerySchema.omit({
    kind: true,
    schemaVersion: true,
    documentId: true,
  }),
  model_info: z.object({}).strict(),
  create_draft: z.object({ baseRevision: revisionSchema }).strict(),
  create_box: z.object({ ...feature, widthMm: length, depthMm: length, heightMm: length }).strict(),
  create_fillet: fillet,
  update_fillet: fillet,
  preview_draft: draft,
  commit_draft: draft,
  discard_draft: draft,
  export_model: z
    .object({ revision: revisionSchema, format: z.enum(["step", "stl", "3mf"]) })
    .strict(),
} as const
export const localModelInfoSchema = z
  .object({
    summary: documentSummaryViewSchema,
    measurements: modelMeasurementViewSchema.nullable(),
    measurementDiagnostic: localFailureSchema.shape.diagnostic.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.measurements === null ||
      (value.summary.documentId === value.measurements.documentId &&
        value.summary.revision === value.measurements.revision),
    "Model views must describe the same revision.",
  )
export const LOCAL_EXPORT_MAX_BYTES = 6 * 1024 * 1024
export const localExportSchema = z
  .object({
    documentId: documentSummaryViewSchema.shape.documentId,
    revision: revisionSchema,
    format: z.enum(["step", "stl", "3mf"]),
    filename: z.string().regex(/^[a-zA-Z0-9_-]{1,100}\.(step|stl|3mf)$/),
    mimeType: z.enum(["model/step", "model/stl", "model/3mf"]),
    base64: z
      .string()
      .max(8 * 1024 * 1024)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0, "Base64 requires complete groups."),
  })
  .strict()
export const localToolOutputs = {
  draft_tree: resultOf(automationDraftInspectionViewSchema),
  draft_entity: resultOf(automationDraftInspectionViewSchema),
  draft_variables: resultOf(automationDraftInspectionViewSchema),
  draft_edges: resultOf(automationDraftInspectionViewSchema),
  model_edges: resultOf(modelEdgeViewSchema),
  model_body_measurements: resultOf(modelBodyMeasurementViewSchema),
  model_body_topology: resultOf(modelBodyTopologyViewSchema),
  model_variables: resultOf(variableListViewSchema),
  create_variable: resultOf(automationDraftStateSchema),
  set_variable_expression: resultOf(automationDraftStateSchema),
  rename_variable: resultOf(automationDraftStateSchema),
  remove_variable: resultOf(automationDraftStateSchema),
  replace_variable_table: resultOf(automationDraftStateSchema),
  create_chamfer: resultOf(automationDraftStateSchema),
  update_chamfer: resultOf(automationDraftStateSchema),

  model_tree: resultOf(cadInspectionListViewSchema),
  model_entity: resultOf(cadInspectionDetailViewSchema),
  create_sketch: resultOf(automationDraftStateSchema),
  update_sketch: resultOf(automationDraftStateSchema),
  create_extrude: resultOf(automationDraftStateSchema),
  update_extrude: resultOf(automationDraftStateSchema),
  create_revolve: resultOf(automationDraftStateSchema),
  update_revolve: resultOf(automationDraftStateSchema),
  create_hole: resultOf(automationDraftStateSchema),
  update_hole: resultOf(automationDraftStateSchema),
  model_info: resultOf(localModelInfoSchema),
  create_draft: resultOf(automationDraftStateSchema),
  create_box: resultOf(automationDraftStateSchema),
  create_fillet: resultOf(automationDraftStateSchema),
  update_fillet: resultOf(automationDraftStateSchema),
  preview_draft: resultOf(automationDraftPreviewSchema),
  commit_draft: resultOf(automationDraftCommitViewSchema),
  discard_draft: resultOf(automationDraftDiscardViewSchema),
  export_model: resultOf(localExportSchema),
} as const
export const localToolNameSchema = z.enum([
  "draft_tree",
  "draft_entity",
  "draft_variables",
  "draft_edges",
  "model_edges",
  "model_body_measurements",
  "model_body_topology",
  "model_variables",
  "create_variable",
  "set_variable_expression",
  "rename_variable",
  "remove_variable",
  "replace_variable_table",
  "create_chamfer",
  "update_chamfer",

  "model_tree",
  "model_entity",
  "create_sketch",
  "update_sketch",
  "create_extrude",
  "update_extrude",
  "create_revolve",
  "update_revolve",
  "create_hole",
  "update_hole",
  "model_info",
  "create_draft",
  "create_box",
  "create_fillet",
  "update_fillet",
  "preview_draft",
  "commit_draft",
  "discard_draft",
  "export_model",
])
export type LocalToolName = z.infer<typeof localToolNameSchema>
export const localOperationSchema = z.discriminatedUnion("tool", [
  ...localDraftInspectionOperations,
  z
    .object({
      tool: z.literal("model_body_topology"),
      arguments: localToolInputs.model_body_topology,
    })
    .strict(),
  z.object({ tool: z.literal("model_edges"), arguments: localToolInputs.model_edges }).strict(),
  z
    .object({
      tool: z.literal("model_body_measurements"),
      arguments: localToolInputs.model_body_measurements,
    })
    .strict(),
  ...localCadOperations,
  ...localVariableOperations,
  z
    .object({ tool: z.literal("model_variables"), arguments: localToolInputs.model_variables })
    .strict(),
  z
    .object({ tool: z.literal("create_chamfer"), arguments: localToolInputs.create_chamfer })
    .strict(),
  z
    .object({ tool: z.literal("update_chamfer"), arguments: localToolInputs.update_chamfer })
    .strict(),

  z.object({ tool: z.literal("model_tree"), arguments: localToolInputs.model_tree }).strict(),
  z.object({ tool: z.literal("model_entity"), arguments: localToolInputs.model_entity }).strict(),
  z.object({ tool: z.literal("model_info"), arguments: localToolInputs.model_info }).strict(),
  z.object({ tool: z.literal("create_draft"), arguments: localToolInputs.create_draft }).strict(),
  z.object({ tool: z.literal("create_box"), arguments: localToolInputs.create_box }).strict(),
  z.object({ tool: z.literal("create_fillet"), arguments: localToolInputs.create_fillet }).strict(),
  z.object({ tool: z.literal("update_fillet"), arguments: localToolInputs.update_fillet }).strict(),
  z.object({ tool: z.literal("preview_draft"), arguments: localToolInputs.preview_draft }).strict(),
  z.object({ tool: z.literal("commit_draft"), arguments: localToolInputs.commit_draft }).strict(),
  z.object({ tool: z.literal("discard_draft"), arguments: localToolInputs.discard_draft }).strict(),
  z.object({ tool: z.literal("export_model"), arguments: localToolInputs.export_model }).strict(),
])
export type LocalOperation = z.infer<typeof localOperationSchema>
export type LocalToolResult = z.infer<(typeof localToolOutputs)[LocalToolName]>

export type LocalDraftCommandOperation = Extract<
  LocalOperation,
  { arguments: { commandId: string } }
>

export function isLocalDraftCommand(
  operation: LocalOperation,
): operation is LocalDraftCommandOperation {
  return "commandId" in operation.arguments
}

export type LocalInspectionOperation = Extract<
  LocalOperation,
  {
    tool:
      | "model_tree"
      | "model_entity"
      | "model_variables"
      | "model_edges"
      | "model_body_measurements"
      | "model_body_topology"
  }
>

export type LocalDraftInspectionOperation = Extract<
  LocalOperation,
  { tool: "draft_tree" | "draft_entity" | "draft_variables" | "draft_edges" }
>

export function isLocalDraftInspection(
  operation: LocalOperation,
): operation is LocalDraftInspectionOperation {
  return (
    operation.tool === "draft_tree" ||
    operation.tool === "draft_entity" ||
    operation.tool === "draft_variables" ||
    operation.tool === "draft_edges"
  )
}

export function isLocalInspection(
  operation: LocalOperation,
): operation is LocalInspectionOperation {
  return (
    operation.tool === "model_tree" ||
    operation.tool === "model_entity" ||
    operation.tool === "model_variables" ||
    operation.tool === "model_edges" ||
    operation.tool === "model_body_measurements" ||
    operation.tool === "model_body_topology"
  )
}
