import {
  assemblyDefinitionIdSchema,
  assemblyDefinitionSchema,
  assemblyInstanceIdSchema,
  assemblyJointIdSchema,
  assemblyRigidPoseSchema,
} from "@vibeshape/domain/assembly"
import { assemblyLibraryBindingSchema } from "@vibeshape/domain/assembly-library"
import {
  assemblyInstanceRecordSchema,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import {
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import { authoredItemNameSchema } from "@vibeshape/domain/parts"
import { sourceAssetDigestSchema } from "@vibeshape/domain/source-assets"
import { topoRefSchema } from "@vibeshape/domain/topology"
import { z } from "zod"

export const assemblyDraftArguments = {
  draftId: draftIdSchema,
  baseRevision: revisionSchema,
  draftVersion: z.number().int().nonnegative().safe(),
} as const
export const assemblyDraftOperationSchema = z.object(assemblyDraftArguments).strict()
const pair = z
  .object({ leftInstanceId: assemblyInstanceIdSchema, rightInstanceId: assemblyInstanceIdSchema })
  .strict()
  .refine((value) => value.leftInstanceId !== value.rightInstanceId)
export const assemblyInspectionArgumentsSchema = z
  .object({
    revision: revisionSchema,
    interferencePairs: z.array(pair).max(1024).default([]),
    topology: z
      .object({
        instanceId: assemblyInstanceIdSchema,
        sourceIndex: z.number().int().min(0).max(255),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    ({ interferencePairs }) =>
      new Set(
        interferencePairs.map(({ leftInstanceId, rightInstanceId }) =>
          [leftInstanceId, rightInstanceId].sort().join(":"),
        ),
      ).size === interferencePairs.length,
    "Interference pairs must be unique and unordered.",
  )

export const assemblyToolInputs = {
  model_assembly: z.object({ revision: revisionSchema }).strict(),
  inspect_assembly: assemblyInspectionArgumentsSchema,
  create_assembly_draft: z.object({ baseRevision: revisionSchema }).strict(),
  upgrade_assembly: assemblyDraftOperationSchema,
  create_assembly_definition: z
    .object({ ...assemblyDraftArguments, definition: assemblyDefinitionSchema })
    .strict(),
  update_assembly_definition: z
    .object({
      ...assemblyDraftArguments,
      definitionId: assemblyDefinitionIdSchema,
      name: authoredItemNameSchema.optional(),
      sourceFrame: assemblyRigidPoseSchema.optional(),
    })
    .strict()
    .refine((value) => value.name !== undefined || value.sourceFrame !== undefined),
  relink_assembly_definition: z
    .object({ ...assemblyDraftArguments, definition: assemblyDefinitionSchema })
    .strict(),
  remove_assembly_definition: z
    .object({
      ...assemblyDraftArguments,
      definitionId: assemblyDefinitionIdSchema,
      cascade: z.boolean().default(false),
    })
    .strict(),
  create_assembly_instance: z
    .object({ ...assemblyDraftArguments, instance: assemblyInstanceRecordSchema })
    .strict(),
  update_assembly_instance: z
    .object({ ...assemblyDraftArguments, instance: assemblyInstanceRecordSchema })
    .strict(),
  remove_assembly_instance: z
    .object({
      ...assemblyDraftArguments,
      instanceId: assemblyInstanceIdSchema,
      cascade: z.boolean().default(false),
    })
    .strict(),
  create_assembly_joint: z
    .object({ ...assemblyDraftArguments, joint: assemblyJointRecordSchema })
    .strict(),
  update_assembly_joint: z
    .object({ ...assemblyDraftArguments, joint: assemblyJointRecordSchema })
    .strict(),
  remove_assembly_joint: z
    .object({ ...assemblyDraftArguments, jointId: assemblyJointIdSchema })
    .strict(),
  preview_assembly_draft: assemblyDraftOperationSchema,
  commit_assembly_draft: assemblyDraftOperationSchema,
  discard_assembly_draft: assemblyDraftOperationSchema,
} as const

export const assemblyDefinitionViewSchema = assemblyDefinitionSchema
  .safeExtend({
    pinRevision: z.number().int().positive().safe(),
    libraryBinding: assemblyLibraryBindingSchema.optional(),
  })
  .strict()
export const assemblyModelViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    assemblyVersion: z.union([z.literal(1), z.literal(2)]),
    definitions: z.array(assemblyDefinitionViewSchema).max(256),
    instances: z.array(assemblyInstanceRecordSchema).max(256),
    joints: z.array(assemblyJointRecordSchema).max(1024),
  })
  .strict()
export const assemblyDraftStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    draftVersion: z.number().int().nonnegative().safe(),
    changeCount: z.number().int().min(0).max(256),
    expiresAt: timestampSchema,
  })
  .strict()
const bounds = z
  .object({
    min: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    max: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  })
  .strict()
export const assemblyKinematicsViewSchema = z
  .object({
    status: z.enum(["fully-constrained", "under-constrained"]),
    degreesOfFreedom: z
      .number()
      .int()
      .min(0)
      .max(2048 * 256),
    maximumResidual: z.number().finite().min(0).max(1e-7),
    redundant: z.boolean(),
    redundantJointIds: z.array(assemblyJointIdSchema).max(1024),
  })
  .strict()
export const assemblyConstraintDiagnosticSchema = z
  .object({
    code: z.enum([
      "invalid-assembly",
      "unanchored-component",
      "topology-missing",
      "topology-ambiguous",
      "topology-stale",
      "unsupported-topology",
      "conflicting-mates",
      "did-not-converge",
      "solver-budget",
      "drive-limit",
      "world-bounds",
      "invalid-solver-result",
      "mate-solver-unavailable",
    ]),
    jointIds: z.array(assemblyJointIdSchema).max(1024),
  })
  .strict()
export const assemblyInspectionViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    kinematics: assemblyKinematicsViewSchema.optional(),
    occurrences: z
      .array(
        z
          .object({
            instanceId: assemblyInstanceIdSchema,
            definitionId: assemblyDefinitionIdSchema,
            pinRevision: z.number().int().positive().safe(),
            sourceIndex: z.number().int().min(0).max(255),
            selectedBody: bodyReferenceSchema,
            contentHash: sourceAssetDigestSchema,
            representation: z.enum(["exact-solid", "triangle-mesh"]),
            geometryFrame: assemblyRigidPoseSchema,
            bounds,
          })
          .strict(),
      )
      .max(4096),
    interference: z
      .array(
        pair.safeExtend({
          status: z.enum(["clear", "interference", "unsupported-mesh"]),
          volume: z.number().finite().nonnegative(),
          solidCount: z.number().int().nonnegative(),
        }),
      )
      .max(1024),
    topology: z
      .object({
        instanceId: assemblyInstanceIdSchema,
        sourceIndex: z.number().int().min(0).max(255),
        pinRevision: z.number().int().positive().safe(),
        body: bodyReferenceSchema,
        total: z.number().int().min(0).max(10_000),
        nextOffset: z.number().int().min(0).max(10_000).nullable(),
        references: z
          .array(
            z
              .object({
                reference: topoRefSchema,
                geometry: z.enum([
                  "planar-face",
                  "cylindrical-face",
                  "spherical-face",
                  "circular-edge",
                  "vertex",
                ]),
                resolution: z.enum(["resolved", "ambiguous", "missing"]),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .optional(),
  })
  .strict()
export const assemblyDraftPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    draft: assemblyDraftStateSchema,
    assembly: assemblyModelViewSchema,
    inspection: assemblyInspectionViewSchema,
  })
  .strict()
  .refine(
    ({ draft, assembly, inspection }) =>
      draft.documentId === assembly.documentId &&
      draft.documentId === inspection.documentId &&
      draft.baseRevision === assembly.revision &&
      draft.baseRevision === inspection.revision,
    "Assembly preview evidence must belong to the owned base revision.",
  )
export const assemblyCommitViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: draftIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    changeCount: z.number().int().min(1).max(256),
  })
  .strict()
  .refine((value) => value.revision > value.baseRevision)
export const assemblyDiscardViewSchema = z
  .object({ schemaVersion: z.literal(1), draftId: draftIdSchema, discarded: z.boolean() })
  .strict()

export const assemblyToolNames = Object.keys(
  assemblyToolInputs,
) as (keyof typeof assemblyToolInputs)[]
export const assemblyOperations = [
  z
    .object({ tool: z.literal("model_assembly"), arguments: assemblyToolInputs.model_assembly })
    .strict(),
  z
    .object({ tool: z.literal("inspect_assembly"), arguments: assemblyToolInputs.inspect_assembly })
    .strict(),
  z
    .object({
      tool: z.literal("create_assembly_draft"),
      arguments: assemblyToolInputs.create_assembly_draft,
    })
    .strict(),
  z
    .object({ tool: z.literal("upgrade_assembly"), arguments: assemblyToolInputs.upgrade_assembly })
    .strict(),
  z
    .object({
      tool: z.literal("create_assembly_definition"),
      arguments: assemblyToolInputs.create_assembly_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_assembly_definition"),
      arguments: assemblyToolInputs.update_assembly_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("relink_assembly_definition"),
      arguments: assemblyToolInputs.relink_assembly_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("remove_assembly_definition"),
      arguments: assemblyToolInputs.remove_assembly_definition,
    })
    .strict(),
  z
    .object({
      tool: z.literal("create_assembly_instance"),
      arguments: assemblyToolInputs.create_assembly_instance,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_assembly_instance"),
      arguments: assemblyToolInputs.update_assembly_instance,
    })
    .strict(),
  z
    .object({
      tool: z.literal("remove_assembly_instance"),
      arguments: assemblyToolInputs.remove_assembly_instance,
    })
    .strict(),
  z
    .object({
      tool: z.literal("create_assembly_joint"),
      arguments: assemblyToolInputs.create_assembly_joint,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_assembly_joint"),
      arguments: assemblyToolInputs.update_assembly_joint,
    })
    .strict(),
  z
    .object({
      tool: z.literal("remove_assembly_joint"),
      arguments: assemblyToolInputs.remove_assembly_joint,
    })
    .strict(),
  z
    .object({
      tool: z.literal("preview_assembly_draft"),
      arguments: assemblyToolInputs.preview_assembly_draft,
    })
    .strict(),
  z
    .object({
      tool: z.literal("commit_assembly_draft"),
      arguments: assemblyToolInputs.commit_assembly_draft,
    })
    .strict(),
  z
    .object({
      tool: z.literal("discard_assembly_draft"),
      arguments: assemblyToolInputs.discard_assembly_draft,
    })
    .strict(),
] as const
export const assemblyOperationSchema = z.discriminatedUnion("tool", assemblyOperations)
export type AssemblyOperation = z.infer<typeof assemblyOperationSchema>
export type AssemblyDraftState = z.infer<typeof assemblyDraftStateSchema>
export type AssemblyDraftPreview = z.infer<typeof assemblyDraftPreviewSchema>
export type AssemblyInspectionView = z.infer<typeof assemblyInspectionViewSchema>
