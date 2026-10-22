import { useTranslations } from "@vibeshape/i18n"
import { type GeometryExportFormat, geometryExportFormatSchema } from "@vibeshape/protocol"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"

export type ExportDestination = "file" | "slicer"

const formatDescriptions = {
  "3mf": "threeMf.description",
  step: "step.description",
  stl: "stl.description",
} as const

export function DocumentExportFormatField({
  format,
  onFormatChange,
  meshOnly = false,
  disabled,
}: {
  format: GeometryExportFormat
  onFormatChange: (format: GeometryExportFormat) => void
  meshOnly?: boolean
  disabled: boolean
}) {
  const t = useTranslations("app.export")
  return (
    <NativeSelectField
      label={t("formatLabel")}
      value={format}
      disabled={disabled}
      onChange={(event) => {
        const parsed = geometryExportFormatSchema.safeParse(event.currentTarget.value)
        if (parsed.success && (!meshOnly || parsed.data !== "step")) onFormatChange(parsed.data)
      }}
    >
      <option value="3mf">{t("threeMf.title")}</option>
      {!meshOnly ? <option value="step">{t("step.title")}</option> : null}
      <option value="stl">{t("stl.title")}</option>
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
          meshOnly={meshOnly || destination === "slicer"}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          destination === "slicer" && !native
            ? "destination.desktopRequired"
            : formatDescriptions[format],
        )}
      </p>
    </>
  )
}
