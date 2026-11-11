import { useTranslations } from "@vibeshape/i18n"
import { type GeometryExportFormat, geometryExportFormatSchema } from "@vibeshape/protocol"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"

export type ExportDestination = "file" | "slicer"

/** ICU title keys under `app.export`, one per protocol export format. */
export const exportFormatTitleKeys = {
  "3mf": "threeMf.title",
  step: "step.title",
  stl: "stl.title",
  glb: "glb.title",
  obj: "obj.title",
} as const satisfies Record<GeometryExportFormat, string>

const formatDescriptions = {
  "3mf": "threeMf.description",
  step: "step.description",
  stl: "stl.description",
  glb: "glb.description",
  obj: "obj.description",
} as const satisfies Record<GeometryExportFormat, string>

/** Slicer handoff accepts only print meshes; file export also offers visual mesh formats. */
function formatAvailable(format: GeometryExportFormat, meshOnly: boolean, slicer: boolean) {
  if (slicer) return format === "3mf" || format === "stl"
  return !meshOnly || format !== "step"
}

export function DocumentExportFormatField({
  format,
  onFormatChange,
  meshOnly = false,
  slicer = false,
  disabled,
}: {
  format: GeometryExportFormat
  onFormatChange: (format: GeometryExportFormat) => void
  meshOnly?: boolean
  slicer?: boolean
  disabled: boolean
}) {
  const t = useTranslations("app.export")
  return (
    <NativeSelectField
      label={t("formatLabel")}
      description={t(formatDescriptions[format])}
      value={format}
      disabled={disabled}
      onChange={(event) => {
        const parsed = geometryExportFormatSchema.safeParse(event.currentTarget.value)
        if (parsed.success && formatAvailable(parsed.data, meshOnly, slicer))
          onFormatChange(parsed.data)
      }}
    >
      <option value="3mf">{t("threeMf.title")}</option>
      {formatAvailable("step", meshOnly, slicer) ? (
        <option value="step">{t("step.title")}</option>
      ) : null}
      <option value="stl">{t("stl.title")}</option>
      {formatAvailable("glb", meshOnly, slicer) ? (
        <option value="glb">{t("glb.title")}</option>
      ) : null}
      {formatAvailable("obj", meshOnly, slicer) ? (
        <option value="obj">{t("obj.title")}</option>
      ) : null}
    </NativeSelectField>
  )
}

export function DocumentExportOptions({
  meshOnly = false,
  destination,
  onDestinationChange,
  format,
  onFormatChange,
  disabled,
  native,
}: {
  meshOnly?: boolean | undefined
  destination: ExportDestination
  onDestinationChange: (destination: ExportDestination) => void
  format: GeometryExportFormat
  onFormatChange: (format: GeometryExportFormat) => void
  disabled: boolean
  native: boolean
}) {
  const t = useTranslations("app.export")
  return (
    <>
      <div className="grid items-start gap-2">
        <NativeSelectField
          label={t("destination.label")}
          value={destination}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (value === "file" || value === "slicer") onDestinationChange(value)
          }}
        >
          <option value="file">{t("destination.file")}</option>
          <option value="slicer">{t("destination.slicer")}</option>
        </NativeSelectField>
        <DocumentExportFormatField
          format={format}
          onFormatChange={onFormatChange}
          disabled={disabled}
          meshOnly={meshOnly}
          slicer={destination === "slicer"}
        />
      </div>
      {destination === "slicer" && !native ? (
        <p className="text-xs text-muted-foreground">{t("destination.desktopRequired")}</p>
      ) : null}
    </>
  )
}
