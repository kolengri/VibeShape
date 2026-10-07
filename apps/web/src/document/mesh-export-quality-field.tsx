import { useTranslations } from "@vibeshape/i18n"
import { type MeshExportQuality, meshExportQualityPresets } from "@vibeshape/protocol"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"

export type MeshExportQualityChoice = "default" | keyof typeof meshExportQualityPresets
export function meshExportQuality(choice: MeshExportQualityChoice): MeshExportQuality | undefined {
  return choice === "default" ? undefined : meshExportQualityPresets[choice]
}
export function MeshExportQualityField({
  value,
  onChange,
  disabled,
}: {
  value: MeshExportQualityChoice
  onChange: (value: MeshExportQualityChoice) => void
  disabled: boolean
}) {
  const t = useTranslations("app.export.meshQuality")
  const quality = meshExportQuality(value)
  return (
    <div className="grid gap-2">
      <SelectField
        label={t("label")}
        value={value}
        disabled={disabled}
        onValueChange={(choice) => {
          if (choice === "default" || choice === "coarse" || choice === "fine") onChange(choice)
        }}
      >
        {(["default", "coarse", "fine"] as const).map((choice) => (
          <SelectOption key={choice} value={choice}>
            {t(choice)}
          </SelectOption>
        ))}
      </SelectField>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      {quality && (
        <p className="text-xs text-muted-foreground">
          {t("tolerance", {
            chord: quality.chordTolerance,
            angle: quality.angularTolerance,
          })}
        </p>
      )}
    </div>
  )
}
