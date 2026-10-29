import {
  type StructuralOptimizationSummary,
  structuralOptimizationSummarySchema,
  structuralRelativePerformanceMatches,
} from "@vibeshape/domain/lightweighting"
import {
  type PrintOptimizationReconstruction,
  type PrintOptimizationReconstructionInput,
  printOptimizationReconstructionInputSchema,
  printOptimizationReconstructionSchema,
  type SourceImportInspection,
  sourceImportInspectionSchema,
} from "@vibeshape/protocol"
import {
  optimizeStructuralModel,
  StructuralOptimizationError,
} from "@vibeshape/structural-optimization/client"
import type {
  StructuralMesh,
  StructuralOptimizationInput,
  StructuralOptimizationResult,
} from "@vibeshape/structural-optimization/contract"
import { portableDocumentStem } from "../../document/document-export"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"
import { type PreparedImportSource, readImportSource } from "../import/import-model"
import type { LightweightingSource } from "./lightweighting-model"

export type ExactPrintOptimizationEvidence = {
  sourceVolumeMm3: number
  volumeMm3: number
  preservedFaceCount: number
  verification: StructuralOptimizationSummary
}

export type PrepareExactPrintSnapshotOptions = {
  geometry: ExactPrintGeometryPort
  source: LightweightingSource
  input: StructuralOptimizationInput
  result: StructuralOptimizationResult
  preserveFaceIds: readonly number[]
  frame: { originMm: [number, number, number]; rotation: [number, number, number, number] }
  toPrintMesh: (mesh: StructuralMesh) => StructuralMesh
  signal: AbortSignal
  current: () => boolean
  onProgress: (stage: "reconstructing" | "verifying" | "inspecting") => void
}

export type ExactPrintGeometryPort = {
  reconstructPrintOptimization: (input: PrintOptimizationReconstructionInput) => Promise<unknown>
  inspectGeometrySource: (input: unknown) => Promise<unknown>
}

function sameVolume(first: number, second: number) {
  return Math.abs(first - second) <= Math.max(1e-8, Math.abs(second) * 1e-7)
}

function capturedReconstructionRequest({
  source,
  input,
  result,
  preserveFaceIds,
  frame,
}: PrepareExactPrintSnapshotOptions) {
  if (!result.voxelGrid || result.voxelGrid.cellSizeMm !== input.cellSizeMm)
    throw new Error("The optimized solid has no aligned retained-cell lattice.")
  const regions = [
    ...input.supports,
    ...input.loadCases.flatMap((load) => [
      load.region,
      ...(load.additionalLoads ?? []).map(({ region }) => region),
    ]),
  ]
  return printOptimizationReconstructionInputSchema.parse({
    source: {
      documentId: source.context.documentId,
      featureId: source.featureId,
      contentHash: source.contentHash,
      outputRole: source.outputRole,
    },
    preserveFaceIds: [...new Set(preserveFaceIds)],
    voxelGrid: result.voxelGrid,
    sourceToPrintFrame: frame,
    protectedBoxes: regions.map((region) => {
      if ("kind" in region) throw new Error("Automatic print interfaces require box regions.")
      return { minMm: region.min, maxMm: region.max }
    }),
    preserveDepthMm: 2 * input.cellSizeMm,
  })
}

function validateExactReconstruction(
  reconstructed: unknown,
  request: PrintOptimizationReconstructionInput,
  sourceVolumeMm3: number,
) {
  const exact = printOptimizationReconstructionSchema.parse(reconstructed)
  if (
    Object.entries(request.source).some(
      ([key, value]) => exact.source[key as keyof typeof exact.source] !== value,
    ) ||
    exact.preservedFaceCount !== request.preserveFaceIds.length ||
    !sameVolume(exact.sourceVolumeMm3, sourceVolumeMm3)
  )
    throw new Error("The exact reconstruction does not match the captured source and faces.")
  return exact
}

async function reconstructExactSource(
  options: PrepareExactPrintSnapshotOptions,
  active: () => boolean,
) {
  if (!active()) return null
  const request = capturedReconstructionRequest(options)
  options.onProgress("reconstructing")
  if (!active()) return null
  const reconstructed = await options.geometry.reconstructPrintOptimization(request)
  if (!active()) return null
  return {
    request,
    exact: validateExactReconstruction(reconstructed, request, options.source.body.shape.volume),
  }
}

async function verifyExactPrintSolid(
  { input, result, toPrintMesh, signal, onProgress }: PrepareExactPrintSnapshotOptions,
  exact: PrintOptimizationReconstruction,
  voxelGridOriginMm: [number, number, number],
  active: () => boolean,
) {
  onProgress("verifying")
  if (!active()) return null
  // Source triangle identities cannot address the reconstructed verification mesh.
  const { algorithm, objective, relativePerformance, ...fixedSettings } = input
  const verified = await optimizeStructuralModel(
    {
      ...fixedSettings,
      mesh: toPrintMesh({
        vertices: Array.from(exact.verificationMesh.positions),
        indices: Array.from(exact.verificationMesh.indices),
      }),
      boundaryReferenceMesh: input.mesh,
      preserveRegions: [],
      maxIterations: 0,
      includeVoxelGrid: false,
      voxelGridOriginMm,
    },
    {
      signal,
      runtimeBaseUrl: new URL(
        `${import.meta.env.BASE_URL ?? "/"}structural-runtime/`,
        window.location.href,
      ).href,
    },
  )
  if (!active()) return null
  const { mesh, voxelGrid, ...summary } = verified
  const verification = structuralOptimizationSummarySchema.parse(summary)
  if (
    !relativePerformance ||
    verification.optimized.cases.length !== input.loadCases.length ||
    result.baseline.cases.length !== input.loadCases.length ||
    verification.optimized.cases.some(
      (item, index) => item.name !== input.loadCases[index]?.name,
    ) ||
    !structuralRelativePerformanceMatches(
      { ...verification, baseline: result.baseline, relativePerformance },
      input,
    )
  )
    throw new Error("The exact solid failed the original source performance constraints.")
  return verification
}

async function inspectExactPrintStep(
  { source, onProgress, geometry }: PrepareExactPrintSnapshotOptions,
  exact: PrintOptimizationReconstruction,
  active: () => boolean,
) {
  onProgress("inspecting")
  if (!active()) return null
  const prepared = await readImportSource(
    new File(
      [Uint8Array.from(exact.stepBytes).buffer],
      `${portableDocumentStem(source.partName)}-print-optimized.step`,
      { type: "model/step" },
    ),
    "millimeter",
  )
  if (!active()) return null
  if (prepared.representation !== "exact-solid")
    throw new Error("The exact reconstruction requires a STEP source.")
  const inspected = await geometry.inspectGeometrySource({
    source: prepared.source,
    bytes: prepared.bytes,
    mesh: PRODUCT_MESH_POLICY,
  })
  if (!active()) return null
  const inspection = sourceImportInspectionSchema.parse(inspected)
  if (
    inspection.outputs.length !== 1 ||
    !sameVolume(inspection.outputs[0]?.signature.volume ?? 0, exact.volumeMm3)
  )
    throw new Error("The STEP snapshot does not reproduce the reconstructed exact solid.")
  return { prepared, inspection }
}

/** Prepares an independently inspected STEP snapshot without publishing document changes. */
export async function prepareExactPrintSnapshot(
  options: PrepareExactPrintSnapshotOptions,
): Promise<{
  prepared: Extract<PreparedImportSource, { representation: "exact-solid" }>
  inspection: SourceImportInspection
  exact: ExactPrintOptimizationEvidence
} | null> {
  const active = () => !options.signal.aborted && options.current()
  let stage: "reconstructing" | "verifying" | "inspecting" = "reconstructing"
  try {
    const reconstruction = await reconstructExactSource(options, active)
    if (!active() || !reconstruction) return null
    const { request, exact } = reconstruction
    stage = "verifying"
    const verification = await verifyExactPrintSolid(
      options,
      exact,
      request.voxelGrid.originMm,
      active,
    )
    if (!active() || !verification) return null
    stage = "inspecting"
    const inspected = await inspectExactPrintStep(options, exact, active)
    if (!active() || !inspected) return null
    return {
      ...inspected,
      exact: {
        sourceVolumeMm3: exact.sourceVolumeMm3,
        volumeMm3: exact.volumeMm3,
        preservedFaceCount: exact.preservedFaceCount,
        verification,
      },
    }
  } catch (error) {
    if (!active()) return null
    if (error instanceof StructuralOptimizationError) throw error
    throw new StructuralOptimizationError(
      stage === "verifying" ? "final-verification-failed" : "exact-reconstruction-failed",
      error instanceof Error ? error.message : "The exact print snapshot could not be prepared.",
    )
  }
}
