import { assemblyLibraryItemSchema } from "@vibeshape/domain/assembly-library"
import {
  commandIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import { modelDiagnosticsEvidenceSchema } from "@vibeshape/domain/model-diagnostics"
import { edgeTopoRefSchema } from "@vibeshape/domain/topology"
import { variableExpressionSchema } from "@vibeshape/domain/variables"
import { z } from "zod"
import {
  assemblyCommitViewSchema,
  assemblyConstraintDiagnosticSchema,
  assemblyDiscardViewSchema,
  assemblyDraftPreviewSchema,
  assemblyDraftStateSchema,
  assemblyInspectionViewSchema,
  assemblyModelViewSchema,
  assemblyOperations,
  assemblyToolInputs,
  assemblyToolNames,
} from "./assembly-tools"
import {
  authoredFoldersViewSchema,
  authoredHistoryListArgumentsSchema,
  authoredHistoryViewSchema,
  authoredListArgumentsSchema,
  authoredPartsViewSchema,
  metadataChangeArgumentsSchema,
  metadataCommitViewSchema,
} from "./authored-metadata"
import {
  binaryExportChunkSchema,
  binaryExportDescriptorSchema,
  binaryExportDiscardSchema,
  localBinaryExportInputs,
  localBinaryExportOperations,
} from "./binary-exports"
import { automationDraftInspectionViewSchema } from "./draft-inspection"
import {
  automationDraftCommitViewSchema,
  automationDraftDiscardViewSchema,
  automationDraftPreviewSchema,
  automationDraftStateSchema,
} from "./drafts"
import {
  libraryItemsViewSchema,
  libraryOperations,
  libraryToolInputs,
  libraryVersionViewSchema,
} from "./library-tools"
import { localCadInputs, localCadOperations } from "./local-cad-tools"
import {
  localDraftInspectionInputs,
  localDraftInspectionOperations,
} from "./local-draft-inspection"
import {
  lifecycleToolNames,
  localLifecycleInputs,
  localLifecycleOperations,
} from "./local-lifecycle-tools"
import {
  localPrimitiveInputs,
  localPrimitiveOperations,
  primitiveToolNames,
} from "./local-primitive-tools"
import { localSketchTextInputs, localSketchTextOperations } from "./local-sketch-text-tools"
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
  modelMeasurementQuerySchema,
  modelMeasurementViewSchema,
  variableListQuerySchema,
  variableListViewSchema,
} from "./queries"
import { sketchSolutionArgumentsSchema, sketchSolutionViewSchema } from "./sketch-solution-queries"

export const localFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostic: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
        message: z.string().min(1).max(512),
        retryable: z.boolean(),
        assembly: assemblyConstraintDiagnosticSchema.optional(),
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
  model_sketch_solution: sketchSolutionArgumentsSchema,
  ...localBinaryExportInputs,
  model_measurements: modelMeasurementQuerySchema.omit({
    kind: true,
    schemaVersion: true,
    documentId: true,
  }),
  ...assemblyToolInputs,
  ...libraryToolInputs,
  model_history: authoredHistoryListArgumentsSchema,
  model_parts: authoredListArgumentsSchema,
  model_folders: authoredListArgumentsSchema,
  change_metadata: metadataChangeArgumentsSchema,
  ...localDraftInspectionInputs,
  model_edges: modelEdgeQuerySchema.omit({ kind: true, schemaVersion: true, documentId: true }),
  model_body_measurements: modelBodyMeasurementArgumentsSchema,
  model_body_topology: modelBodyTopologyArgumentsSchema,
  ...localCadInputs,
  ...localPrimitiveInputs,
  ...localLifecycleInputs,
  ...localSketchTextInputs,
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
    diagnostics: modelDiagnosticsEvidenceSchema.nullable().optional(),
    measurementDiagnostic: localFailureSchema.shape.diagnostic.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      !value.diagnostics ||
      (value.diagnostics.documentId === value.summary.documentId &&
        value.diagnostics.revision === value.summary.revision &&
        (!value.measurements || value.diagnostics.generation === value.measurements.generation)),
    "Diagnostics must describe the same model revision and rebuild.",
  )
  .refine(
    (value) =>
      value.measurements === null ||
      (value.summary.documentId === value.measurements.documentId &&
        value.summary.revision === value.measurements.revision),
    "Model views must describe the same revision.",
  )
export { BINARY_EXPORT_MAX_BYTES as LOCAL_EXPORT_MAX_BYTES } from "./binary-exports"
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
  update_box: resultOf(automationDraftStateSchema),
  create_cylinder: resultOf(automationDraftStateSchema),
  update_cylinder: resultOf(automationDraftStateSchema),
  create_cone: resultOf(automationDraftStateSchema),
  update_cone: resultOf(automationDraftStateSchema),
  create_sphere: resultOf(automationDraftStateSchema),
  update_sphere: resultOf(automationDraftStateSchema),
  create_torus: resultOf(automationDraftStateSchema),
  update_torus: resultOf(automationDraftStateSchema),
  create_pyramid: resultOf(automationDraftStateSchema),
  update_pyramid: resultOf(automationDraftStateSchema),
  remove_feature: resultOf(automationDraftStateSchema),
  remove_sketch: resultOf(automationDraftStateSchema),
  set_feature_suppressed: resultOf(automationDraftStateSchema),
  rename_project: resultOf(automationDraftStateSchema),
  create_placement: resultOf(automationDraftStateSchema),
  update_placement: resultOf(automationDraftStateSchema),
  create_sketch_text: resultOf(automationDraftStateSchema),
  update_sketch_text: resultOf(automationDraftStateSchema),
  detach_sketch_text: resultOf(automationDraftStateSchema),
  model_sketch_solution: resultOf(sketchSolutionViewSchema),
  draft_sketch_solution: resultOf(automationDraftInspectionViewSchema),
  prepare_model_export: resultOf(binaryExportDescriptorSchema),
  prepare_project_backup: resultOf(binaryExportDescriptorSchema),
  read_export_chunk: resultOf(binaryExportChunkSchema),
  discard_export: resultOf(binaryExportDiscardSchema),
  model_measurements: resultOf(modelMeasurementViewSchema),
  draft_measurements: resultOf(automationDraftInspectionViewSchema),
  model_assembly: resultOf(assemblyModelViewSchema),
  inspect_assembly: resultOf(assemblyInspectionViewSchema),
  create_assembly_draft: resultOf(assemblyDraftStateSchema),
  upgrade_assembly: resultOf(assemblyDraftStateSchema),
  create_assembly_definition: resultOf(assemblyDraftStateSchema),
  update_assembly_definition: resultOf(assemblyDraftStateSchema),
  relink_assembly_definition: resultOf(assemblyDraftStateSchema),
  remove_assembly_definition: resultOf(assemblyDraftStateSchema),
  create_assembly_instance: resultOf(assemblyDraftStateSchema),
  update_assembly_instance: resultOf(assemblyDraftStateSchema),
  remove_assembly_instance: resultOf(assemblyDraftStateSchema),
  create_assembly_joint: resultOf(assemblyDraftStateSchema),
  update_assembly_joint: resultOf(assemblyDraftStateSchema),
  remove_assembly_joint: resultOf(assemblyDraftStateSchema),
  preview_assembly_draft: resultOf(assemblyDraftPreviewSchema),
  commit_assembly_draft: resultOf(assemblyCommitViewSchema),
  discard_assembly_draft: resultOf(assemblyDiscardViewSchema),
  library_items: resultOf(libraryItemsViewSchema),
  library_version: resultOf(libraryVersionViewSchema),
  save_library_definition: resultOf(libraryVersionViewSchema),
  update_library_metadata: resultOf(assemblyLibraryItemSchema),
  insert_library_version: resultOf(assemblyDraftStateSchema),
  relink_library_definition: resultOf(assemblyDraftStateSchema),
  detach_library_definition: resultOf(assemblyDraftStateSchema),

  model_history: resultOf(authoredHistoryViewSchema),
  model_parts: resultOf(authoredPartsViewSchema),
  model_folders: resultOf(authoredFoldersViewSchema),
  change_metadata: resultOf(metadataCommitViewSchema),
  draft_tree: resultOf(automationDraftInspectionViewSchema),
  draft_entity: resultOf(automationDraftInspectionViewSchema),
  draft_variables: resultOf(automationDraftInspectionViewSchema),
  draft_edges: resultOf(automationDraftInspectionViewSchema),
  draft_body_measurements: resultOf(automationDraftInspectionViewSchema),
  draft_body_topology: resultOf(automationDraftInspectionViewSchema),
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
  create_face_extent_extrude: resultOf(automationDraftStateSchema),
  update_face_extent_extrude: resultOf(automationDraftStateSchema),
  create_body_revolve: resultOf(automationDraftStateSchema),
  update_body_revolve: resultOf(automationDraftStateSchema),
  create_body_subtract: resultOf(automationDraftStateSchema),
  update_body_subtract: resultOf(automationDraftStateSchema),
  create_revolve: resultOf(automationDraftStateSchema),
  update_revolve: resultOf(automationDraftStateSchema),
  create_hole: resultOf(automationDraftStateSchema),
  update_hole: resultOf(automationDraftStateSchema),
  create_reference_mirror: resultOf(automationDraftStateSchema),
  update_reference_mirror: resultOf(automationDraftStateSchema),
  create_reference_split: resultOf(automationDraftStateSchema),
  update_reference_split: resultOf(automationDraftStateSchema),
  create_reference_body_pattern: resultOf(automationDraftStateSchema),
  update_reference_body_pattern: resultOf(automationDraftStateSchema),
  create_mirror: resultOf(automationDraftStateSchema),
  create_shell: resultOf(automationDraftStateSchema),
  update_mirror: resultOf(automationDraftStateSchema),
  update_shell: resultOf(automationDraftStateSchema),
  create_thread: resultOf(automationDraftStateSchema),
  update_thread: resultOf(automationDraftStateSchema),
  create_body_pattern: resultOf(automationDraftStateSchema),
  update_body_pattern: resultOf(automationDraftStateSchema),
  create_split: resultOf(automationDraftStateSchema),
  update_split: resultOf(automationDraftStateSchema),
  create_loft: resultOf(automationDraftStateSchema),
  update_loft: resultOf(automationDraftStateSchema),
  create_sweep: resultOf(automationDraftStateSchema),
  update_sweep: resultOf(automationDraftStateSchema),
  create_datum_plane: resultOf(automationDraftStateSchema),
  update_datum_plane: resultOf(automationDraftStateSchema),
  create_boolean: resultOf(automationDraftStateSchema),
  update_boolean: resultOf(automationDraftStateSchema),
  create_union: resultOf(automationDraftStateSchema),
  update_union: resultOf(automationDraftStateSchema),
  create_compound: resultOf(automationDraftStateSchema),
  update_compound: resultOf(automationDraftStateSchema),
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
  ...primitiveToolNames,
  ...lifecycleToolNames,
  "create_placement",
  "update_placement",
  "create_sketch_text",
  "update_sketch_text",
  "detach_sketch_text",
  "model_sketch_solution",
  "draft_sketch_solution",
  "prepare_model_export",
  "prepare_project_backup",
  "read_export_chunk",
  "discard_export",
  "model_measurements",
  "draft_measurements",
  ...assemblyToolNames,
  "library_items",
  "library_version",
  "save_library_definition",
  "update_library_metadata",
  "insert_library_version",
  "relink_library_definition",
  "detach_library_definition",
  "model_history",
  "model_parts",
  "model_folders",
  "change_metadata",
  "draft_tree",
  "draft_entity",
  "draft_variables",
  "draft_edges",
  "draft_body_measurements",
  "draft_body_topology",
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
  "create_face_extent_extrude",
  "update_face_extent_extrude",
  "create_body_revolve",
  "update_body_revolve",
  "create_body_subtract",
  "update_body_subtract",
  "create_revolve",
  "update_revolve",
  "create_hole",
  "update_hole",
  "create_reference_mirror",
  "update_reference_mirror",
  "create_reference_split",
  "update_reference_split",
  "create_reference_body_pattern",
  "update_reference_body_pattern",
  "create_mirror",
  "create_shell",
  "update_mirror",
  "update_shell",
  "create_thread",
  "update_thread",
  "create_body_pattern",
  "update_body_pattern",
  "create_split",
  "update_split",
  "create_loft",
  "update_loft",
  "create_sweep",
  "update_sweep",
  "create_datum_plane",
  "update_datum_plane",
  "create_boolean",
  "update_boolean",
  "create_union",
  "update_union",
  "create_compound",
  "update_compound",
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
  ...localBinaryExportOperations,
  z
    .object({
      tool: z.literal("model_sketch_solution"),
      arguments: localToolInputs.model_sketch_solution,
    })
    .strict(),
  z
    .object({
      tool: z.literal("model_measurements"),
      arguments: localToolInputs.model_measurements,
    })
    .strict(),
  ...assemblyOperations,
  ...libraryOperations,
  z.object({ tool: z.literal("model_history"), arguments: localToolInputs.model_history }).strict(),
  z.object({ tool: z.literal("model_parts"), arguments: localToolInputs.model_parts }).strict(),
  z.object({ tool: z.literal("model_folders"), arguments: localToolInputs.model_folders }).strict(),
  z
    .object({ tool: z.literal("change_metadata"), arguments: localToolInputs.change_metadata })
    .strict(),
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
  ...localPrimitiveOperations,
  ...localLifecycleOperations,
  ...localSketchTextOperations,
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
  { arguments: { commandId: string; draftId: string } }
>
export type LocalPrimitiveCommandOperation = Extract<
  LocalOperation,
  { tool: (typeof primitiveToolNames)[number] }
>
export type LocalLifecycleCommandOperation = Extract<
  LocalOperation,
  { tool: (typeof lifecycleToolNames)[number] }
>
export function isLocalPrimitiveCommand(
  operation: LocalOperation,
): operation is LocalPrimitiveCommandOperation {
  return operation.tool in localPrimitiveInputs
}
export function isLocalLifecycleCommand(
  operation: LocalOperation,
): operation is LocalLifecycleCommandOperation {
  return operation.tool in localLifecycleInputs
}

export function isLocalDraftCommand(
  operation: LocalOperation,
): operation is LocalDraftCommandOperation {
  return "commandId" in operation.arguments && "draftId" in operation.arguments
}

export type LocalInspectionOperation = Extract<
  LocalOperation,
  {
    tool:
      | "model_sketch_solution"
      | "model_measurements"
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
  {
    tool:
      | "draft_sketch_solution"
      | "draft_measurements"
      | "draft_tree"
      | "draft_entity"
      | "draft_variables"
      | "draft_edges"
      | "draft_body_measurements"
      | "draft_body_topology"
  }
>

export function isLocalDraftInspection(
  operation: LocalOperation,
): operation is LocalDraftInspectionOperation {
  return (
    operation.tool === "draft_sketch_solution" ||
    operation.tool === "draft_measurements" ||
    operation.tool === "draft_tree" ||
    operation.tool === "draft_entity" ||
    operation.tool === "draft_variables" ||
    operation.tool === "draft_edges" ||
    operation.tool === "draft_body_measurements" ||
    operation.tool === "draft_body_topology"
  )
}

export function isLocalInspection(
  operation: LocalOperation,
): operation is LocalInspectionOperation {
  return (
    operation.tool === "model_sketch_solution" ||
    operation.tool === "model_measurements" ||
    operation.tool === "model_tree" ||
    operation.tool === "model_entity" ||
    operation.tool === "model_variables" ||
    operation.tool === "model_edges" ||
    operation.tool === "model_body_measurements" ||
    operation.tool === "model_body_topology"
  )
}

export type LocalMetadataReadOperation = Extract<
  LocalOperation,
  { tool: "model_parts" | "model_folders" | "model_history" }
>
export function isLocalMetadataRead(
  operation: LocalOperation,
): operation is LocalMetadataReadOperation {
  return (
    operation.tool === "model_parts" ||
    operation.tool === "model_folders" ||
    operation.tool === "model_history"
  )
}
export function isLocalMetadataTool(tool: LocalToolName) {
  return (
    tool === "model_parts" ||
    tool === "model_folders" ||
    tool === "model_history" ||
    tool === "change_metadata"
  )
}
