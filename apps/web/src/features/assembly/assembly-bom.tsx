import {
  type AssemblyBomAuthority,
  type AssemblyBomRow,
  createAssemblyBom,
  formatAssemblyBomCsv,
} from "@vibeshape/domain/assembly-bom"
import {
  type StructuralMaterialPresetId,
  structuralMaterialCatalog,
  structuralMaterialPresetIdSchema,
} from "@vibeshape/domain/lightweighting-materials"
import type { AppearancePresetId, PartAppearance } from "@vibeshape/domain/part-appearance"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { cn } from "@vibeshape/ui/lib/cn"
import { useMemo, useState } from "react"
import { downloadAssemblyMotion } from "./assembly-motion-export"

type MaterialAssignments = Readonly<Partial<Record<string, StructuralMaterialPresetId>>>
type BomProps = {
  assembly: AssemblyBomAuthority
  partAppearances: readonly PartAppearance[]
  inspection: AssemblyInspection | null
  pending: boolean
  /** Inspection failure reason; volumes, and therefore mass, are unknown while it is set. */
  diagnostic: string | null
  documentName: string
}

function bomRows(
  props: Pick<BomProps, "assembly" | "partAppearances" | "inspection">,
  materials: MaterialAssignments,
) {
  return createAssemblyBom({
    assembly: props.assembly,
    partAppearances: props.partAppearances,
    occurrences: (props.inspection?.occurrences ?? []).map(
      ({ instanceId, definitionId, sourceIndex, volume }) => ({
        instanceId,
        definitionId,
        sourceIndex,
        volumeMm3: volume,
      }),
    ),
    materials,
  })
}

function useBomLabels() {
  const t = useTranslations("app.assembly")
  const appearanceT = useTranslations("app.viewportContext")
  const materialT = useTranslations("app.lightweighting")
  const format = useFormatter()
  return {
    appearance: (ids: readonly AppearancePresetId[]) =>
      ids.length
        ? format.list(
            ids.map((id) => appearanceT(`materials.${id}`)),
            { type: "unit" },
          )
        : "",
    material: (id: StructuralMaterialPresetId | null) => (id ? materialT(`presets.${id}`) : ""),
    mass: (value: number | null) => (value === null ? t("bomUnknown") : t("bomMass", { value })),
    headers: {
      item: t("bomItem"),
      name: t("bomPart"),
      quantity: t("bomQuantity"),
      appearance: t("bomAppearance"),
      material: t("bomMaterial"),
      density: t("bomCsvDensity"),
      unitVolume: t("bomCsvUnitVolume"),
      unitMass: t("bomCsvUnitMass"),
      totalMass: t("bomCsvTotalMass"),
    },
  }
}
type BomLabels = ReturnType<typeof useBomLabels>

function MaterialSelect({
  row,
  onChange,
}: {
  row: AssemblyBomRow
  onChange: (definitionId: string, materialId: StructuralMaterialPresetId | null) => void
}) {
  const t = useTranslations("app.assembly")
  const materialT = useTranslations("app.lightweighting")
  return (
    <NativeSelect
      aria-label={t("bomMaterialFor", { name: row.name })}
      value={row.materialId ?? "none"}
      className="h-7 text-xs"
      onChange={(event) => {
        const parsed = structuralMaterialPresetIdSchema.safeParse(event.currentTarget.value)
        onChange(row.definitionId, parsed.success ? parsed.data : null)
      }}
    >
      <option value="none">{t("bomMaterialNone")}</option>
      {structuralMaterialCatalog.presets.map(({ id }) => (
        <option key={id} value={id}>
          {materialT(`presets.${id}`)}
        </option>
      ))}
    </NativeSelect>
  )
}

function BomTable({
  rows,
  labels,
  onMaterialChange,
}: {
  rows: readonly AssemblyBomRow[]
  labels: BomLabels
  onMaterialChange: (definitionId: string, materialId: StructuralMaterialPresetId | null) => void
}) {
  const t = useTranslations("app.assembly")
  const head = "px-2 py-2 font-medium"
  return (
    <div className="max-h-96 overflow-auto rounded-md border bg-background">
      <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
        <caption className="sr-only">{t("bomCaption")}</caption>
        <thead className="sticky top-0 z-10 bg-panel-muted text-muted-foreground">
          <tr>
            <th scope="col" className={cn(head, "w-12 text-right")}>
              {labels.headers.item}
            </th>
            <th scope="col" className={head}>
              {labels.headers.name}
            </th>
            <th scope="col" className={cn(head, "w-14 text-right")}>
              {labels.headers.quantity}
            </th>
            <th scope="col" className={head}>
              {labels.headers.appearance}
            </th>
            <th scope="col" className={cn(head, "w-48")}>
              {labels.headers.material}
            </th>
            <th scope="col" className={cn(head, "w-24 text-right")}>
              {t("bomUnitMass")}
            </th>
            <th scope="col" className={cn(head, "w-24 text-right")}>
              {t("bomTotalMass")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.definitionId} className="border-t align-middle">
              <td className="px-2 py-1.5 text-right tabular-nums">{row.item}</td>
              <th scope="row" className="break-words px-2 py-1.5 font-normal">
                {row.name}
              </th>
              <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity}</td>
              <td className="px-2 py-1.5">
                {labels.appearance(row.appearancePresetIds) || t("bomUnknown")}
              </td>
              <td className="px-2 py-1.5">
                <MaterialSelect row={row} onChange={onMaterialChange} />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{labels.mass(row.unitMassG)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{labels.mass(row.totalMassG)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type BomContentProps = BomProps & {
  materials: MaterialAssignments
  onMaterialChange: (definitionId: string, materialId: StructuralMaterialPresetId | null) => void
}

/** Mounted only while the dialog is open, so idle Assembly panel renders derive no BOM rows. */
function AssemblyBomContent(props: BomContentProps) {
  const t = useTranslations("app.assembly")
  const labels = useBomLabels()
  const { assembly, partAppearances, inspection, materials } = props
  const rows = useMemo(
    () => bomRows({ assembly, partAppearances, inspection }, materials),
    [assembly, partAppearances, inspection, materials],
  )
  const measuring = props.pending && inspection === null
  return (
    <DialogContent className="max-w-4xl" closeLabel={t("bomClose")}>
      <DialogHeader>
        <DialogTitle>{t("bomTitle")}</DialogTitle>
        <DialogDescription>{t("bomDescription")}</DialogDescription>
      </DialogHeader>
      <DialogBody className="content-start gap-3">
        {measuring ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("bomMeasuring")}
          </p>
        ) : null}
        {/* A failed inspection leaves volumes unknown; say why instead of implying mesh sources. */}
        {props.diagnostic && !props.pending ? (
          <Alert>{t("bomVolumesUnavailable", { reason: props.diagnostic })}</Alert>
        ) : null}
        {rows.length ? (
          <BomTable rows={rows} labels={labels} onMaterialChange={props.onMaterialChange} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("bomEmpty")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("bomMassNote")}</p>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("bomClose")}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={rows.length === 0}
          onClick={() =>
            downloadAssemblyMotion(
              `${props.documentName} BOM`,
              "csv",
              formatAssemblyBomCsv(rows, labels),
            )
          }
        >
          {t("bomDownloadCsv")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

/**
 * Read-only bill of materials. Density comes only from an explicit catalog material choice;
 * appearance presets are display data and never imply mass.
 */
export function AssemblyBom(props: BomProps) {
  const t = useTranslations("app.assembly")
  const [open, setOpen] = useState(false)
  const [materials, setMaterials] = useState<MaterialAssignments>({})
  const setMaterial = (definitionId: string, materialId: StructuralMaterialPresetId | null) =>
    setMaterials((current) => {
      const { [definitionId]: _previous, ...rest } = current
      return materialId ? { ...rest, [definitionId]: materialId } : rest
    })
  return (
    <section className="grid gap-2 border-t pt-3" aria-labelledby="assembly-bom-heading">
      <h3 id="assembly-bom-heading" className="text-xs font-medium">
        {t("bom")}
      </h3>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="justify-self-start">
            {t("bomOpen")}
          </Button>
        </DialogTrigger>
        {open ? (
          <AssemblyBomContent {...props} materials={materials} onMaterialChange={setMaterial} />
        ) : null}
      </Dialog>
    </section>
  )
}
