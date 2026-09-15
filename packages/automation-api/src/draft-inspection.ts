import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { modelEdgeEvidenceSchema } from "@vibeshape/domain/model-edges"
import { z } from "zod"
import { automationDraftStateSchema } from "./drafts"
import {
  cadInspectionDetailQuerySchema,
  cadInspectionDetailViewSchema,
  cadInspectionListQuerySchema,
  cadInspectionListViewSchema,
  modelEdgeQuerySchema,
  modelEdgeViewSchema,
  variableListQuerySchema,
  variableListViewSchema,
} from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

export const automationDraftInspectionQuerySchema = z.discriminatedUnion("kind", [
  cadInspectionListQuerySchema,
  cadInspectionDetailQuerySchema,
  variableListQuerySchema,
  modelEdgeQuerySchema,
])

export const automationDraftInspectionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    query: automationDraftInspectionQuerySchema,
  })
  .strict()

export const automationDraftInspectionViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    draft: automationDraftStateSchema,
    view: z.discriminatedUnion("kind", [
      cadInspectionListViewSchema,
      cadInspectionDetailViewSchema,
      variableListViewSchema,
      modelEdgeViewSchema,
    ]),
  })
  .strict()
  .refine(
    ({ draft, view }) => draft.documentId === view.documentId && draft.revision === view.revision,
    "Inspection must describe the exact draft document and revision.",
  )

// The host retains one detached catalog, never its worker or mesh.
export const automationDraftEdgeEvidenceSchema = modelEdgeEvidenceSchema.refine(
  (evidence) => serializedQueryBytes(evidence, 4 * 1024 * 1024) <= 4 * 1024 * 1024,
  "Draft edge evidence exceeds the 4 MiB catalog limit.",
)

export type AutomationDraftInspectionQuery = z.infer<typeof automationDraftInspectionQuerySchema>
export type AutomationDraftInspectionRequest = z.infer<
  typeof automationDraftInspectionRequestSchema
>
export type AutomationDraftInspectionView = z.infer<typeof automationDraftInspectionViewSchema>
