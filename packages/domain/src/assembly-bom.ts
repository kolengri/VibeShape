import type { AssemblySource } from "./assembly"
import {
  type StructuralMaterialPresetId,
  structuralMaterialCatalog,
} from "./lightweighting-materials"
import {
  type AppearanceMaterial,
  type AppearancePresetId,
  type PartAppearance,
  resolvePartAppearanceMaterial,
} from "./part-appearance"

/** Exact solid volume of one frozen source occurrence; omitted for triangle meshes. */
export type AssemblyBomOccurrenceVolume = Readonly<{
  instanceId: string
  definitionId: string
  sourceIndex: number
  volumeMm3?: number | undefined
}>

/** The authority fields a BOM reads; frozen model closures are irrelevant to counting. */
export type AssemblyBomAuthority = Readonly<{
  definitions: readonly Readonly<{
    id: string
    name: string
    sources: readonly AssemblySource[]
  }>[]
  instances: readonly Readonly<{ definitionId: string }>[]
}>
type BomDefinition = AssemblyBomAuthority["definitions"][number]

export type AssemblyBomRow = Readonly<{
  /** One-based item number in definition order. */
  item: number
  definitionId: string
  name: string
  /** Occurrences of this definition; assembly instances are flat, so each counts once. */
  quantity: number
  /** Distinct display presets of the definition's live source parts, sorted. */
  appearancePresetIds: readonly AppearancePresetId[]
  materialId: StructuralMaterialPresetId | null
  densityKgM3: number | null
  /** Exact solid volume of one occurrence; null when any source lacks exact volume evidence. */
  unitVolumeMm3: number | null
  unitMassG: number | null
  totalMassG: number | null
}>

export type AssemblyBomInput = Readonly<{
  assembly: AssemblyBomAuthority
  partAppearances?: readonly PartAppearance[] | undefined
  /** Current exact inspection evidence; volumes are pose-invariant under rigid placement. */
  occurrences: readonly AssemblyBomOccurrenceVolume[]
  /** Explicit density sources. Display appearance never implies a physical material. */
  materials?: Readonly<Partial<Record<string, StructuralMaterialPresetId>>> | undefined
}>

const densities = new Map(
  structuralMaterialCatalog.presets.map((preset) => [preset.id, preset.material.densityKgM3]),
)

/** mm^3 * kg/m^3 -> g: 1 mm^3 = 1e-9 m^3 and 1 kg = 1e3 g. */
export function solidMassGrams(volumeMm3: number, densityKgM3: number) {
  return volumeMm3 * densityKgM3 * 1e-6
}

function definitionUnitVolume(
  sourceCount: number,
  occurrences: readonly AssemblyBomOccurrenceVolume[],
): number | null {
  const byInstance = new Map<string, Map<number, number | undefined>>()
  for (const occurrence of occurrences) {
    const sources = byInstance.get(occurrence.instanceId) ?? new Map()
    sources.set(occurrence.sourceIndex, occurrence.volumeMm3)
    byInstance.set(occurrence.instanceId, sources)
  }
  for (const sources of byInstance.values()) {
    if (sources.size !== sourceCount) continue
    const volumes = [...sources.values()]
    if (volumes.some((volume) => volume === undefined || !Number.isFinite(volume))) return null
    return volumes.reduce<number>((total, volume) => total + (volume ?? 0), 0)
  }
  return null
}

function definitionPartIds(definition: BomDefinition) {
  return definition.sources.flatMap((source) => (source.kind === "part" ? [source.partId] : []))
}

function appearancePresets(
  definition: BomDefinition,
  appearances: ReadonlyMap<string, PartAppearance["appearance"]>,
) {
  const presets = new Set<AppearancePresetId>()
  for (const partId of definitionPartIds(definition)) {
    const presetId = appearances.get(partId)?.presetId
    if (presetId) presets.add(presetId)
  }
  return [...presets].sort()
}

/**
 * Derives a bill of materials with one row per used frozen definition. Mass exists only when an
 * explicit catalog density and exact volume evidence for every source are both available.
 */
export function createAssemblyBom(input: AssemblyBomInput): readonly AssemblyBomRow[] {
  const appearances = new Map(
    (input.partAppearances ?? []).map(({ partId, appearance }) => [partId, appearance]),
  )
  const rows: AssemblyBomRow[] = []
  for (const definition of input.assembly.definitions) {
    const quantity = input.assembly.instances.filter(
      ({ definitionId }) => definitionId === definition.id,
    ).length
    if (quantity === 0) continue
    const materialId = input.materials?.[definition.id] ?? null
    const densityKgM3 = materialId ? (densities.get(materialId) ?? null) : null
    const unitVolumeMm3 = definitionUnitVolume(
      definition.sources.length,
      input.occurrences.filter(({ definitionId }) => definitionId === definition.id),
    )
    const unitMassG =
      unitVolumeMm3 !== null && densityKgM3 !== null
        ? solidMassGrams(unitVolumeMm3, densityKgM3)
        : null
    rows.push({
      item: rows.length + 1,
      definitionId: definition.id,
      name: definition.name,
      quantity,
      appearancePresetIds: appearancePresets(definition, appearances),
      materialId,
      densityKgM3,
      unitVolumeMm3,
      unitMassG,
      totalMassG: unitMassG === null ? null : unitMassG * quantity,
    })
  }
  return rows
}

/** Live part appearance for frozen part sources; assembly definitions do not freeze display data. */
export function assemblySourceAppearances(
  assembly: AssemblyBomAuthority,
  partAppearances: readonly PartAppearance[],
): readonly Readonly<{
  definitionId: string
  sourceIndex: number
  appearance: AppearanceMaterial
}>[] {
  const appearances = new Map(partAppearances.map(({ partId, appearance }) => [partId, appearance]))
  return assembly.definitions.flatMap((definition) =>
    definition.sources.flatMap((source, sourceIndex) => {
      const appearance =
        source.kind === "part"
          ? resolvePartAppearanceMaterial(appearances.get(source.partId))
          : null
      return appearance ? [{ definitionId: definition.id, sourceIndex, appearance }] : []
    }),
  )
}

/** Quotes one RFC 4180 field when it contains a delimiter, quote, CR or LF. */
export function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** Serializes records as RFC 4180 CSV with CRLF record separators and a trailing CRLF. */
export function formatCsv(records: readonly (readonly string[])[]) {
  return records.map((record) => `${record.map(csvField).join(",")}\r\n`).join("")
}

function csvNumber(value: number | null, digits: number) {
  if (value === null) return ""
  const rounded = Number(value.toFixed(digits))
  return String(rounded === 0 ? 0 : rounded)
}

export type AssemblyBomCsvLabels = Readonly<{
  headers: Readonly<{
    item: string
    name: string
    quantity: string
    appearance: string
    material: string
    density: string
    unitVolume: string
    unitMass: string
    totalMass: string
  }>
  appearance: (presetIds: readonly AppearancePresetId[]) => string
  material: (materialId: StructuralMaterialPresetId | null) => string
}>

/**
 * Machine-readable BOM: numbers use a dot decimal separator and fixed SI-derived units
 * (kg/m^3, mm^3, g); unknown values stay empty rather than estimated.
 */
export function formatAssemblyBomCsv(
  rows: readonly AssemblyBomRow[],
  labels: AssemblyBomCsvLabels,
) {
  const { headers } = labels
  return formatCsv([
    [
      headers.item,
      headers.name,
      headers.quantity,
      headers.appearance,
      headers.material,
      headers.density,
      headers.unitVolume,
      headers.unitMass,
      headers.totalMass,
    ],
    ...rows.map((row) => [
      String(row.item),
      row.name,
      String(row.quantity),
      labels.appearance(row.appearancePresetIds),
      labels.material(row.materialId),
      csvNumber(row.densityKgM3, 3),
      csvNumber(row.unitVolumeMm3, 3),
      csvNumber(row.unitMassG, 3),
      csvNumber(row.totalMassG, 3),
    ]),
  ])
}
