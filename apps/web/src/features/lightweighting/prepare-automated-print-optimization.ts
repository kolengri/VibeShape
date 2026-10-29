import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type PrintOptimizationSettings,
  printOptimizationConfigurationSchema,
  resolvePrintOptimizationMaterial,
} from "@vibeshape/automation-api/print-optimization-tools"
import type { BodyFaceRef } from "@vibeshape/domain/body-topology-reference"
import {
  PrintOptimizationSetupError,
  preparePrintOptimization,
} from "@vibeshape/structural-optimization/print-optimization"
import type { LightweightingSource } from "./lightweighting-model"
import { faceTriangleIndices } from "./lightweighting-surface-selection"
import { defaultPrintOptimizationParameters } from "./print-optimization-model"

function resolvePrintFace(source: LightweightingSource, reference: BodyFaceRef) {
  if (reference.featureId !== source.featureId || reference.outputRole !== source.outputRole)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      "The selected face belongs to another body.",
    )
  const { featureId: _featureId, ...content } = reference
  const resolved = resolveShellOpeningCandidates(
    [content],
    source.body.topologyCandidates,
    source,
    "exact",
    { allowSemanticRebinding: false },
  )
  if (!resolved.ok)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      `The selected face is ${resolved.reason}; inspect the current body topology again.`,
    )
  const candidate = source.body.topologyCandidates.find(
    ({ candidateId }) => candidateId === resolved.candidateIds[0],
  )
  const faceId = candidate?.meshFaceId
  if (
    faceId === undefined ||
    source.body.topologyCandidates.filter(
      (face) => face.kind === "face" && face.meshFaceId === faceId,
    ).length !== 1 ||
    faceTriangleIndices(source, [faceId]).length === 0
  )
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      "The selected face has no unique current native tessellation binding.",
    )
  return faceId
}

/** Resolve agent references only against the captured active native face catalog. */
export function prepareAutomatedPrintOptimization(
  source: LightweightingSource,
  settings: PrintOptimizationSettings,
) {
  const defaults = defaultPrintOptimizationParameters(source)
  const cellSizeMm = settings.cellSizeMm ?? defaults.cellSizeMm
  const configuration = printOptimizationConfigurationSchema.parse({
    material: resolvePrintOptimizationMaterial(settings.material),
    cellSizeMm,
    minFeatureSizeMm: settings.minFeatureSizeMm ?? Math.max(0.8, cellSizeMm),
    layerHeightMm: settings.layerHeightMm ?? Math.min(0.2, cellSizeMm),
    maxIterations: settings.maxIterations ?? 24,
    minStiffnessFraction: settings.minStiffnessFraction,
    minStrengthFraction: settings.minStrengthFraction,
    supportMode: settings.supportMode,
  })
  const bedFaceId = resolvePrintFace(source, settings.bedFace)
  const preserveFaceIds = settings.preserveFaces.map((face) => resolvePrintFace(source, face))
  if (new Set(preserveFaceIds).size !== preserveFaceIds.length)
    throw new PrintOptimizationSetupError(
      "invalid-settings",
      "Preserved face references resolve to the same native face.",
    )
  const prepared = preparePrintOptimization({
    ...configuration,
    mesh: {
      vertices: Array.from(source.body.mesh.precisePositions ?? source.body.mesh.positions),
      indices: Array.from(source.body.mesh.indices),
    },
    bedTriangleIndices: faceTriangleIndices(source, [bedFaceId]),
    preserveTriangleIndices: faceTriangleIndices(source, preserveFaceIds),
  })
  return { ...prepared, configuration, preserveFaceIds }
}
