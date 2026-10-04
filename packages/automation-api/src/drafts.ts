import { commandActorSchema } from "@vibeshape/domain/commands"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  sketchIdSchema,
  technicalIdentifierSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import { modelDiagnosticsEvidenceSchema } from "@vibeshape/domain/model-diagnostics"
import { z } from "zod"
import { documentSummaryViewSchema, modelMeasurementViewSchema } from "./queries"

export const createAutomationDraftRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
  })
  .strict()

export const automationDraftOperationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
  })
  .strict()

/** Trusted browser preparation reads; never advertised as a raw MCP snapshot tool. */
export const automationDraftSketchReadRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    revision: revisionSchema,
    sketchId: sketchIdSchema,
  })
  .strict()

export const automationCommandEnvelopeSchema = z
  .object({
    kind: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .passthrough()

export const applyAutomationDraftCommandRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    command: automationCommandEnvelopeSchema,
  })
  .strict()

export const automationDraftStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    commandCount: z.number().int().nonnegative().safe(),
    expiresAt: timestampSchema,
  })
  .strict()

export const automationDraftPreviewSchema = z
  .object({
    schemaVersion: z.literal(2),
    draft: automationDraftStateSchema,
    summary: documentSummaryViewSchema,
    geometry: z
      .object({
        status: z.enum(["valid", "invalid"]),
        measurements: modelMeasurementViewSchema,
        diagnostics: modelDiagnosticsEvidenceSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((preview, context) => {
    const diagnostics = preview.geometry.diagnostics
    if (
      diagnostics &&
      (diagnostics.documentId !== preview.draft.documentId ||
        diagnostics.revision !== preview.draft.revision ||
        diagnostics.generation !== preview.geometry.measurements.generation)
    )
      context.addIssue({
        code: "custom",
        path: ["geometry", "diagnostics"],
        message: "Diagnostics must describe the same exact draft rebuild.",
      })
    for (const [name, view] of [
      ["summary", preview.summary],
      ["geometry", preview.geometry.measurements],
    ] as const) {
      if (view.documentId !== preview.draft.documentId || view.revision !== preview.draft.revision)
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Preview views must match the draft document and revision.",
        })
    }
  })

export const automationDraftCommitViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    commandCount: z.number().int().positive().safe(),
  })
  .strict()

export const automationDraftDiscardViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    discarded: z.boolean(),
  })
  .strict()

export type CreateAutomationDraftRequest = Readonly<
  z.infer<typeof createAutomationDraftRequestSchema>
>
export type AutomationDraftOperationRequest = Readonly<
  z.infer<typeof automationDraftOperationRequestSchema>
>
export type ApplyAutomationDraftCommandRequest = Readonly<
  z.infer<typeof applyAutomationDraftCommandRequestSchema>
>
export type AutomationCommandEnvelope = Readonly<z.infer<typeof automationCommandEnvelopeSchema>>
export type AutomationDraftState = Readonly<z.infer<typeof automationDraftStateSchema>>
export type AutomationDraftPreview = Readonly<z.infer<typeof automationDraftPreviewSchema>>
export type AutomationDraftCommitView = Readonly<z.infer<typeof automationDraftCommitViewSchema>>
export type AutomationDraftDiscardView = Readonly<z.infer<typeof automationDraftDiscardViewSchema>>
