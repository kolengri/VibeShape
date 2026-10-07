import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import {
  type StructuralMaterialPresetId,
  structuralMaterialCatalog,
} from "@vibeshape/domain/lightweighting-materials"
import type { StructuralOptimizationInput } from "@vibeshape/structural-optimization/contract"
import type { DocumentControllerState } from "../../document/document-controller"
import type { ImportDocumentContext } from "../import/import-model"
import { faceForce, faceTriangleIndices } from "./lightweighting-surface-selection"

export type RegionFields = { min: [string, string, string]; max: [string, string, string] }
export type SurfaceForceFields = {
  magnitudeN: string
  direction: "normal" | "x" | "y" | "z"
  flipped: boolean
}
export type LightweightingSurfaceFields = {
  source: LightweightingSource | null
  supportFaces: number[]
  loadFaces: Record<number, number[]>
  preserveFaces: number[]
  depthMm: string
}
export type LoadCaseFields = {
  id: number
  name: string
  region: RegionFields
  force: [string, string, string]
  surfaceForce?: SurfaceForceFields
}
export type LightweightingFields = {
  objective: "minimize-mass" | "maximize-stiffness"
  retainedMassPercent: string
  materialPresetId: StructuralMaterialPresetId | "custom"
  youngModulusMpa: string
  poissonRatio: string
  yieldStrengthMpa: string
  densityKgM3: string
  safetyFactor: string
  maxDisplacementMm: string
  cellSizeMm: string
  maxIterations: string
  support: RegionFields
  loadCases: LoadCaseFields[]
  preserveRegions: { id: number; region: RegionFields }[]
  surfaceSelection?: LightweightingSurfaceFields
}
export type LightweightingSource = {
  context: ImportDocumentContext
  partId: string
  partName: string
  featureId: string
  outputRole: string
  contentHash: string
  body: ModelBodyGeometry
}

export function availableLightweightingParts(controller: DocumentControllerState) {
  const authority = controller.authoredSnapshot
  const report = controller.report
  if (!authority || authority.schemaVersion === 1 || !report) return []
  return (resolveAuthoredParts(authority, report) ?? []).filter(
    ({ status, body }) =>
      status === "available" &&
      body !== null &&
      body.representation !== "triangle-mesh" &&
      body.shape.valid &&
      body.shape.solidCount === 1 &&
      body.shape.volume > 0,
  )
}
export function lightweightingSource(
  controller: DocumentControllerState,
  partId: string,
): LightweightingSource | null {
  const authority = controller.authoredSnapshot
  const report = controller.report
  if (!authority || authority.schemaVersion === 1 || !report) return null
  const selected = availableLightweightingParts(controller).find(({ part }) => part.id === partId)
  if (!selected?.body) return null
  return {
    context: {
      documentId: report.snapshot.id,
      revision: report.snapshot.revision,
      authorityVersion: authority.schemaVersion,
      historyAfter: report.historyItems?.at(-1) ?? null,
    },
    partId,
    partName: selected.part.name,
    featureId: selected.body.featureId,
    outputRole: selected.body.outputRole ?? "result",
    contentHash: selected.body.contentHash,
    body: selected.body,
  }
}
export function sameLightweightingSource(
  current: LightweightingSource | null,
  captured: LightweightingSource,
) {
  return (
    current !== null &&
    current.context.documentId === captured.context.documentId &&
    current.context.revision === captured.context.revision &&
    current.partId === captured.partId &&
    current.featureId === captured.featureId &&
    current.outputRole === captured.outputRole &&
    current.contentHash === captured.contentHash
  )
}
function regionFields(min: readonly number[], max: readonly number[]): RegionFields {
  return {
    min: [String(min[0]), String(min[1]), String(min[2])],
    max: [String(max[0]), String(max[1]), String(max[2])],
  }
}
export function initialLightweightingFields(
  source: LightweightingSource | null,
  caseName: string,
  graphical = false,
): LightweightingFields {
  const bounds = source?.body.shape.bounds ?? { min: [0, 0, 0], max: [10, 10, 10] }
  const { min, max } = bounds
  const cell = Math.max(...max.map((value, index) => value - (min[index] ?? 0))) / 10
  const slab = Math.max(cell / 2, 0.000001)
  return {
    objective: "minimize-mass",
    retainedMassPercent: "50",
    materialPresetId: "custom",
    youngModulusMpa: "",
    poissonRatio: "",
    yieldStrengthMpa: "",
    densityKgM3: "",
    safetyFactor: "2",
    maxDisplacementMm: "1",
    cellSizeMm: String(Number(cell.toPrecision(4))),
    maxIterations: "12",
    support: regionFields(min, [min[0] + slab, max[1], max[2]]),
    loadCases: [
      {
        id: 0,
        name: caseName,
        region: regionFields([max[0] - slab, min[1], min[2]], max),
        force: ["0", "0", "0"],
        ...(graphical
          ? { surfaceForce: { magnitudeN: "", direction: "normal" as const, flipped: false } }
          : {}),
      },
    ],
    preserveRegions: [],
    ...(graphical
      ? {
          surfaceSelection: {
            source,
            supportFaces: [],
            loadFaces: {},
            preserveFaces: [],
            depthMm: String(Number(Math.max(cell, 0.01).toPrecision(4))),
          },
        }
      : {}),
  }
}
export function applyLightweightingMaterialPreset(fields: LightweightingFields, id: string) {
  if (id === "custom") return { ...fields, materialPresetId: "custom" as const }
  const preset = structuralMaterialCatalog.presets.find((item) => item.id === id)
  if (!preset) return fields
  const { material } = preset
  return {
    ...fields,
    materialPresetId: preset.id,
    youngModulusMpa: String(material.youngModulusMpa),
    poissonRatio: String(material.poissonRatio),
    yieldStrengthMpa: String(material.yieldStrengthMpa),
    densityKgM3: String(material.densityKgM3),
  }
}
function number(value: string) {
  return value.trim() === "" ? Number.NaN : Number(value)
}
function regionInput(region: RegionFields) {
  return {
    min: region.min.map(number) as [number, number, number],
    max: region.max.map(number) as [number, number, number],
  }
}
export function lightweightingInput(
  source: LightweightingSource,
  fields: LightweightingFields,
): StructuralOptimizationInput {
  const surface = fields.surfaceSelection
  const region = (faces: number[]) => ({
    kind: "surface" as const,
    triangleIndices: faceTriangleIndices(source, faces),
    depthMm: number(surface?.depthMm ?? ""),
  })
  return {
    schemaVersion: 1,
    mesh: {
      vertices: Array.from(source.body.mesh.positions),
      indices: Array.from(source.body.mesh.indices),
    },
    material: {
      youngModulusMpa: number(fields.youngModulusMpa),
      poissonRatio: number(fields.poissonRatio),
      yieldStrengthMpa: number(fields.yieldStrengthMpa),
      densityKgM3: number(fields.densityKgM3),
    },
    safetyFactor: number(fields.safetyFactor),
    maxDisplacementMm: number(fields.maxDisplacementMm),
    cellSizeMm: number(fields.cellSizeMm),
    maxIterations: number(fields.maxIterations),
    objective:
      fields.objective === "maximize-stiffness"
        ? {
            kind: "maximize-stiffness",
            retainedMassFraction: number(fields.retainedMassPercent) / 100,
          }
        : { kind: "minimize-mass" },
    supports: [surface ? region(surface.supportFaces) : regionInput(fields.support)],
    loadCases: fields.loadCases.map((load) => ({
      name: load.name.trim(),
      region: surface ? region(surface.loadFaces[load.id] ?? []) : regionInput(load.region),
      forceN:
        surface && load.surfaceForce
          ? faceForce(source, surface.loadFaces[load.id] ?? [], load.surfaceForce)
          : (load.force.map(number) as [number, number, number]),
    })),
    preserveRegions: surface
      ? surface.preserveFaces.length
        ? [region(surface.preserveFaces)]
        : []
      : fields.preserveRegions.map(({ region }) => regionInput(region)),
  }
}
