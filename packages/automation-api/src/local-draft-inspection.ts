import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import {
  cadInspectionDetailQuerySchema,
  cadInspectionListQuerySchema,
  modelEdgeQuerySchema,
  variableListQuerySchema,
} from "./queries"

const omit = { kind: true, schemaVersion: true, documentId: true } as const
const draft = { draftId: draftIdSchema }
export const localDraftInspectionInputs = {
  draft_tree: cadInspectionListQuerySchema.omit(omit).extend(draft),
  draft_entity: cadInspectionDetailQuerySchema.omit(omit).extend(draft),
  draft_variables: variableListQuerySchema.omit(omit).extend(draft),
  draft_edges: modelEdgeQuerySchema.omit(omit).extend(draft),
} as const

export const localDraftInspectionOperations = [
  z
    .object({ tool: z.literal("draft_tree"), arguments: localDraftInspectionInputs.draft_tree })
    .strict(),
  z
    .object({ tool: z.literal("draft_entity"), arguments: localDraftInspectionInputs.draft_entity })
    .strict(),
  z
    .object({
      tool: z.literal("draft_variables"),
      arguments: localDraftInspectionInputs.draft_variables,
    })
    .strict(),
  z
    .object({ tool: z.literal("draft_edges"), arguments: localDraftInspectionInputs.draft_edges })
    .strict(),
] as const
