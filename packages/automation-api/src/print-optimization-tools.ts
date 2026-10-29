import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  type StructuralOptimizationSettings,
  structuralMaterialSchema,
  structuralOptimizationSummarySchema,
  structuralRelativePerformanceMatches,
} from "@vibeshape/domain/lightweighting"
import { structuralMaterialCatalog } from "@vibeshape/domain/lightweighting-materials"
import { z } from "zod"
import { importUploadCommitSchema } from "./imports"
import {
  lightweightingResultContextMatches,
  lightweightingSourceIdentitySchema,
} from "./lightweighting-tools"

const materialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("preset"),
      presetId: z.enum(["pla", "petg", "abs", "asa", "pc-blend", "nylon"]),
    })
    .strict(),
  z.object({ kind: z.literal("custom"), properties: structuralMaterialSchema }).strict(),
])
const cellSizeSchema = z.number().finite().min(0.01).max(100_000)
const minFeatureSizeSchema = z.number().finite().min(0.01).max(100_000)
const layerHeightSchema = z.number().finite().min(0.001).max(100_000)
const iterationsSchema = z.number().int().nonnegative()
const fractionSchema = z.number().finite().positive().max(1)

export const printOptimizationSettingsSchema = z
  .object({
    bedFace: bodyFaceRefSchema,
    preserveFaces: z.array(bodyFaceRefSchema).default([]),
    material: materialSchema,
    cellSizeMm: cellSizeSchema.optional(),
    minFeatureSizeMm: minFeatureSizeSchema.optional(),
    layerHeightMm: layerHeightSchema.optional(),
    maxIterations: iterationsSchema.optional(),
    minStiffnessFraction: fractionSchema.default(0.9),
    minStrengthFraction: fractionSchema.default(0.9),
    supportMode: z.enum(["allowed", "forbidden"]).default("allowed"),
  })
  .strict()
  .refine(
    ({ preserveFaces }) => new Set(preserveFaces.map(canonicalJson)).size === preserveFaces.length,
    {
      path: ["preserveFaces"],
      message: "Preserved face references must be unique.",
    },
  )
  .refine(
    ({ cellSizeMm, layerHeightMm }) =>
      cellSizeMm === undefined || layerHeightMm === undefined || layerHeightMm <= cellSizeMm,
    {
      path: ["layerHeightMm"],
      message: "Layer height must not exceed the voxel cell size.",
    },
  )
export type PrintOptimizationSettings = z.infer<typeof printOptimizationSettingsSchema>

export function resolvePrintOptimizationMaterial(material: PrintOptimizationSettings["material"]) {
  if (material.kind === "custom") return structuralMaterialSchema.parse(material.properties)
  const preset = structuralMaterialCatalog.presets.find(({ id }) => id === material.presetId)
  if (!preset) throw new Error("The print material preset is unavailable.")
  return structuralMaterialSchema.parse(preset.material)
}

export const printOptimizationConfigurationSchema = z
  .object({
    material: structuralMaterialSchema,
    cellSizeMm: cellSizeSchema,
    minFeatureSizeMm: minFeatureSizeSchema,
    layerHeightMm: layerHeightSchema,
    maxIterations: iterationsSchema,
    minStiffnessFraction: fractionSchema,
    minStrengthFraction: fractionSchema,
    supportMode: z.enum(["allowed", "forbidden"]),
  })
  .strict()
  .refine(({ layerHeightMm, cellSizeMm }) => layerHeightMm <= cellSizeMm, {
    path: ["layerHeightMm"],
    message: "Layer height must not exceed the voxel cell size.",
  })
export type PrintOptimizationConfiguration = z.infer<typeof printOptimizationConfigurationSchema>

const finite = z.number().finite()
export const printOptimizationSummarySchema = z
  .object({
    proposal: structuralOptimizationSummarySchema,
    exact: z
      .object({
        sourceVolumeMm3: finite.positive(),
        volumeMm3: finite.positive(),
        preservedFaceCount: z.number().int().nonnegative(),
        verification: structuralOptimizationSummarySchema,
      })
      .strict()
      .refine(
        ({ sourceVolumeMm3, volumeMm3 }) => volumeMm3 < sourceVolumeMm3,
        "The exact optimized solid must remove material.",
      )
      .nullable(),
    configuration: printOptimizationConfigurationSchema,
    scenarioBasis: z.literal("normalized-longest-span-end-clamped"),
    sourceToPrintFrame: z
      .object({
        originMm: z.tuple([finite, finite, finite]),
        rotation: z
          .tuple([finite, finite, finite, finite])
          .refine(
            (rotation) =>
              Math.abs(rotation.reduce((sum, value) => sum + value * value, 0) - 1) <= 1e-8,
            "The print frame rotation must be a unit quaternion.",
          ),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ proposal, exact }) => (proposal.status === "improved") === (exact !== null),
    "An improved proposal must include exact reconstruction and verification evidence.",
  )
export type PrintOptimizationSummary = z.infer<typeof printOptimizationSummarySchema>

const argumentsSchema = z
  .object({
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    settings: printOptimizationSettingsSchema,
  })
  .strict()
  .refine(
    ({ source, settings }) =>
      [settings.bedFace, ...settings.preserveFaces].every(
        (face) => face.featureId === source.featureId && face.outputRole === source.outputRole,
      ),
    { path: ["settings"], message: "Print faces must belong to the requested source body output." },
  )
export const printOptimizationToolInputs = {
  analyze_print_optimization: argumentsSchema,
  request_print_optimization: argumentsSchema.safeExtend({
    label: z.string().trim().min(1).max(120),
  }),
} as const
export const printOptimizationToolNames = [
  "analyze_print_optimization",
  "request_print_optimization",
] as const
export const printOptimizationOperations = [
  z
    .object({
      tool: z.literal("analyze_print_optimization"),
      arguments: printOptimizationToolInputs.analyze_print_optimization,
    })
    .strict(),
  z
    .object({
      tool: z.literal("request_print_optimization"),
      arguments: printOptimizationToolInputs.request_print_optimization,
    })
    .strict(),
] as const
export const printOptimizationOperationSchema = z.discriminatedUnion(
  "tool",
  printOptimizationOperations,
)
export type PrintOptimizationOperation = z.infer<typeof printOptimizationOperationSchema>
export const printOptimizationAnalysisSchema = z
  .object({
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    source: lightweightingSourceIdentitySchema,
    summary: printOptimizationSummarySchema,
  })
  .strict()
export const printOptimizationRequestSchema = printOptimizationAnalysisSchema
  .extend({ snapshot: importUploadCommitSchema.nullable() })
  .refine(
    ({ summary, snapshot }) => (summary.proposal.status === "improved") === (snapshot !== null),
    "An improved request must identify its applied exact snapshot.",
  )
export type PrintOptimizationAnalysis = z.infer<typeof printOptimizationAnalysisSchema>
export type PrintOptimizationRequest = z.infer<typeof printOptimizationRequestSchema>

function configurationMatches(
  settings: PrintOptimizationSettings,
  configuration: PrintOptimizationConfiguration,
) {
  return [
    canonicalJson(configuration.material) ===
      canonicalJson(resolvePrintOptimizationMaterial(settings.material)),
    settings.cellSizeMm === undefined || configuration.cellSizeMm === settings.cellSizeMm,
    configuration.minFeatureSizeMm ===
      (settings.minFeatureSizeMm ?? Math.max(0.8, configuration.cellSizeMm)),
    configuration.layerHeightMm ===
      (settings.layerHeightMm ?? Math.min(0.2, configuration.cellSizeMm)),
    configuration.maxIterations === (settings.maxIterations ?? 24),
    configuration.minStiffnessFraction === settings.minStiffnessFraction,
    configuration.minStrengthFraction === settings.minStrengthFraction,
    configuration.supportMode === settings.supportMode,
  ].every(Boolean)
}

/** Synthetic selectors bind the public metrics; private geometry supplies the actual study regions. */
function studySettings(
  configuration: PrintOptimizationConfiguration,
): StructuralOptimizationSettings {
  const region = {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  }
  return {
    material: configuration.material,
    cellSizeMm: configuration.cellSizeMm,
    maxIterations: configuration.maxIterations,
    safetyFactor: 1,
    maxDisplacementMm: 100_000,
    supports: [region],
    preserveRegions: [],
    loadCases: ["Axial tension", "Bending 1", "Bending 2", "Torsion"].map((name) => ({
      name,
      region,
      forceN: [1, 0, 0],
    })),
    objective: { kind: "minimize-mass" },
    algorithm: {
      kind: "simp",
      volumeFraction: 0.1,
      filterRadiusMm: 1.5 * configuration.cellSizeMm,
      penalty: 3,
    },
    relativePerformance: {
      minStiffnessFraction: configuration.minStiffnessFraction,
      minStrengthFraction: configuration.minStrengthFraction,
    },
    fdm: {
      buildDirection: "+z",
      maxOverhangAngleDeg: 45,
      supportMode: configuration.supportMode,
      minFeatureSizeMm: configuration.minFeatureSizeMm,
      layerHeightMm: configuration.layerHeightMm,
    },
  }
}

function studySummaryMatches(
  input: PrintOptimizationOperation["arguments"],
  value: PrintOptimizationAnalysis,
  summary: PrintOptimizationSummary["proposal"],
  settings: StructuralOptimizationSettings,
  documentId?: string,
) {
  // The analyzed operation has no label, including when the original operation requested a snapshot.
  const analyzed = { baseRevision: input.baseRevision, source: input.source }
  return (
    lightweightingResultContextMatches(
      { tool: "analyze_lightweighting", arguments: { ...analyzed, settings } },
      {
        ok: true,
        value: {
          documentId: value.documentId,
          baseRevision: value.baseRevision,
          source: value.source,
          summary,
        },
      },
      documentId,
    ) === true
  )
}

function exactProofMatches(
  input: PrintOptimizationOperation["arguments"],
  value: PrintOptimizationAnalysis,
  settings: StructuralOptimizationSettings,
  documentId?: string,
) {
  const { proposal, exact } = value.summary
  if (!exact) return true
  const {
    algorithm: _algorithm,
    objective: _objective,
    relativePerformance: _relative,
    ...fixed
  } = settings
  const verification = exact.verification
  return [
    exact.preservedFaceCount === input.settings.preserveFaces.length,
    verification.status === "no-improvement",
    verification.iterations === 0,
    verification.evaluations === 2,
    canonicalJson(verification.baseline) === canonicalJson(verification.optimized),
    studySummaryMatches(input, value, verification, { ...fixed, maxIterations: 0 }, documentId),
    structuralRelativePerformanceMatches(
      {
        ...verification,
        baseline: proposal.baseline,
        relativePerformance: settings.relativePerformance,
      },
      settings,
    ),
  ].every(Boolean)
}

function outputContextMatches(
  input: PrintOptimizationOperation["arguments"],
  value: PrintOptimizationAnalysis,
  documentId?: string,
) {
  const { proposal, configuration } = value.summary
  if (!configurationMatches(input.settings, configuration)) return false
  const settings = studySettings(configuration)
  if (!studySummaryMatches(input, value, proposal, settings, documentId)) return false
  return exactProofMatches(input, value, settings, documentId)
}

function snapshotContextMatches(operation: PrintOptimizationOperation, value: unknown) {
  if (operation.tool !== "request_print_optimization") return true
  const request = printOptimizationRequestSchema.parse(value)
  if (!request.snapshot) return true
  return [
    request.snapshot.documentId === request.documentId,
    request.snapshot.baseRevision === request.baseRevision,
    request.snapshot.revision > request.baseRevision,
  ].every(Boolean)
}

export function printOptimizationResultContextMatches(
  operation: { tool: string; arguments: unknown },
  result: { ok: boolean; value?: unknown },
  documentId?: string,
) {
  if (!printOptimizationToolNames.some((name) => name === operation.tool) || !result.ok) return null
  const parsed = printOptimizationOperationSchema.safeParse(operation)
  if (!parsed.success) return false
  const output =
    parsed.data.tool === "analyze_print_optimization"
      ? printOptimizationAnalysisSchema.safeParse(result.value)
      : printOptimizationRequestSchema.safeParse(result.value)
  if (!output.success) return false
  return (
    outputContextMatches(parsed.data.arguments, output.data, documentId) &&
    snapshotContextMatches(parsed.data, output.data)
  )
}
