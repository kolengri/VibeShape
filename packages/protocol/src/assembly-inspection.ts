import { z } from "zod"
import {
  featureEvaluationEngineResultSchema,
  featureMeshPolicySchema,
  topologyCandidatesSchema,
} from "./geometry-worker"
import { sourceAssetMaterializationsSchema } from "./import-content"

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const coordinate = z.number().finite().min(-100000).max(100000)
export const assemblyRigidPoseWireSchema = z
  .object({
    translation: z.tuple([coordinate, coordinate, coordinate]),
    quaternion: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .refine((values) => Math.abs(Math.hypot(...values) - 1) <= 1e-12),
  })
  .strict()
const pair = z
  .object({ leftInstanceId: uuid, rightInstanceId: uuid })
  .strict()
  .refine((value) => value.leftInstanceId !== value.rightInstanceId)
export const inspectAssemblyInputSchema = z
  .object({
    // The strict V4 domain schema validates this bounded serialized authority before geometry access.
    authorityJson: z
      .string()
      .min(1)
      .max(16 * 1024 * 1024),
    sourceAssets: sourceAssetMaterializationsSchema,
    mesh: featureMeshPolicySchema,
    interferencePairs: z.array(pair).max(1024),
  })
  .strict()
  .superRefine(({ interferencePairs }, context) => {
    const identities = interferencePairs.map(({ leftInstanceId, rightInstanceId }) =>
      [leftInstanceId, rightInstanceId].sort().join(":"),
    )
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: "custom",
        message: "Interference pairs must be unique and unordered.",
      })
  })
export type InspectAssemblyInput = z.infer<typeof inspectAssemblyInputSchema>
const occurrence = z
  .object({
    instanceId: uuid,
    definitionId: uuid,
    pinRevision: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative().max(255),
    selectedBody: z
      .object({
        schemaVersion: z.literal(0),
        featureId: uuid,
        outputRole: z.string().min(1).max(128),
      })
      .strict(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    representation: z.enum(["exact-solid", "triangle-mesh"]),
    geometryFrame: assemblyRigidPoseWireSchema,
    topologyCandidates: topologyCandidatesSchema.optional(),
    mesh: featureEvaluationEngineResultSchema.shape.mesh,
    bounds: featureEvaluationEngineResultSchema.shape.shape.shape.bounds,
  })
  .strict()
export const assemblyKinematicsSummarySchema = z
  .object({
    status: z.enum(["fully-constrained", "under-constrained"]),
    degreesOfFreedom: z
      .number()
      .int()
      .nonnegative()
      .max(2048 * 256),
    maximumResidual: z.number().finite().nonnegative().max(1e-7),
    redundant: z.boolean(),
    redundantJointIds: z.array(uuid).max(1024),
  })
  .strict()
export const assemblyConstraintFailureSchema = z
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
    jointIds: z.array(uuid).max(1024),
  })
  .strict()
export const assemblyInspectionSchema = z
  .object({
    occurrences: z.array(occurrence).max(4096),
    kinematics: assemblyKinematicsSummarySchema.optional(),
    interference: z
      .array(
        pair.safeExtend({
          status: z.enum(["clear", "interference", "unsupported-mesh"]),
          volume: z.number().finite().nonnegative(),
          solidCount: z.number().int().nonnegative(),
        }),
      )
      .max(1024),
  })
  .strict()
  .superRefine(({ occurrences, interference }, context) => {
    const identities = occurrences.map(
      ({ instanceId, sourceIndex }) => `${instanceId}:${sourceIndex}`,
    )
    const instances = new Set(occurrences.map(({ instanceId }) => instanceId))
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: "custom",
        message: "Assembly occurrences repeat identity.",
      })
    if (
      interference.some(
        (value) =>
          !instances.has(value.leftInstanceId) ||
          !instances.has(value.rightInstanceId) ||
          (value.status === "interference"
            ? value.volume <= 0 || value.solidCount === 0
            : value.volume !== 0 || value.solidCount !== 0),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Interference evidence must match current occurrences and its material status.",
      })
  })
export type AssemblyInspection = z.infer<typeof assemblyInspectionSchema>
