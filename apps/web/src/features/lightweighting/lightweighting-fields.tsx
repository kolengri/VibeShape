import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import type { LightweightingFields, RegionFields } from "./lightweighting-model"

type NumberFieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: string
}
function NumberField({ id, label, value, onChange, min, max, step = "any" }: NumberFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        required
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  )
}
const axes = ["X", "Y", "Z"] as const
function RegionFieldsEditor({
  id,
  value,
  onChange,
}: {
  id: string
  value: RegionFields
  onChange: (value: RegionFields) => void
}) {
  const t = useTranslations("app.lightweighting")
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["min", "max"] as const).map((bound) => (
        <fieldset key={bound} className="grid grid-cols-3 gap-2">
          <legend className="mb-2 text-xs font-medium">{t(bound)}</legend>
          {axes.map((axis, index) => (
            <NumberField
              key={axis}
              id={`${id}-${bound}-${axis}`}
              label={t("coordinate", { bound: t(bound), axis })}
              value={value[bound][index] ?? ""}
              onChange={(next) => {
                const coordinates: RegionFields["min"] = [...value[bound]]
                coordinates[index] = next
                onChange({ ...value, [bound]: coordinates })
              }}
            />
          ))}
        </fieldset>
      ))}
    </div>
  )
}
export function LightweightingParameters({
  fields,
  onChange,
}: {
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
}) {
  const t = useTranslations("app.lightweighting")
  const numeric = (
    key:
      | "youngModulusMpa"
      | "poissonRatio"
      | "yieldStrengthMpa"
      | "densityKgM3"
      | "safetyFactor"
      | "maxDisplacementMm"
      | "cellSizeMm"
      | "maxIterations",
    min: number,
    max?: number,
    step?: string,
  ) => (
    <NumberField
      id={`lightweighting-${key}`}
      label={t(key)}
      value={fields[key]}
      min={min}
      {...(max === undefined ? {} : { max })}
      {...(step === undefined ? {} : { step })}
      onChange={(value) => onChange({ ...fields, [key]: value })}
    />
  )
  return (
    <>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">{t("material")}</legend>
        <p className="text-xs text-muted-foreground">{t("materialDescription")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {numeric("youngModulusMpa", 0)}
          {numeric("poissonRatio", 0, 0.45)}
          {numeric("yieldStrengthMpa", 0)}
          {numeric("densityKgM3", 0)}
        </div>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">{t("constraints")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {numeric("safetyFactor", 1)}
          {numeric("maxDisplacementMm", 0)}
          {numeric("cellSizeMm", 0)}
          {numeric("maxIterations", 0, 40, "1")}
        </div>
        <p className="text-xs text-muted-foreground">{t("discretizationDescription")}</p>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">{t("support")}</legend>
        <p className="text-xs text-muted-foreground">{t("supportDescription")}</p>
        <RegionFieldsEditor
          id="lightweighting-support"
          value={fields.support}
          onChange={(support) => onChange({ ...fields, support })}
        />
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="mb-2 font-medium">{t("loadCases")}</legend>
        <p className="text-xs text-muted-foreground">{t("loadDescription")}</p>
        {fields.loadCases.map((loadCase, index) => (
          <fieldset key={loadCase.id} className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("loadCase", { index: index + 1 })}
            </legend>
            <Field>
              <FieldLabel htmlFor={`lightweighting-case-${loadCase.id}`}>
                {t("caseName")}
              </FieldLabel>
              <Input
                id={`lightweighting-case-${loadCase.id}`}
                required
                value={loadCase.name}
                onChange={(event) =>
                  onChange({
                    ...fields,
                    loadCases: fields.loadCases.map((item) =>
                      item.id === loadCase.id ? { ...item, name: event.currentTarget.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <RegionFieldsEditor
              id={`lightweighting-load-${loadCase.id}`}
              value={loadCase.region}
              onChange={(region) =>
                onChange({
                  ...fields,
                  loadCases: fields.loadCases.map((item) =>
                    item.id === loadCase.id ? { ...item, region } : item,
                  ),
                })
              }
            />
            <div className="grid grid-cols-3 gap-2">
              {axes.map((axis, coordinate) => (
                <NumberField
                  key={axis}
                  id={`lightweighting-force-${loadCase.id}-${axis}`}
                  label={t("force", { axis })}
                  value={loadCase.force[coordinate] ?? ""}
                  onChange={(next) => {
                    const force: typeof loadCase.force = [...loadCase.force]
                    force[coordinate] = next
                    onChange({
                      ...fields,
                      loadCases: fields.loadCases.map((item) =>
                        item.id === loadCase.id ? { ...item, force } : item,
                      ),
                    })
                  }}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={fields.loadCases.length === 1}
              onClick={() =>
                onChange({
                  ...fields,
                  loadCases: fields.loadCases.filter((item) => item.id !== loadCase.id),
                })
              }
            >
              {t("removeCase", { index: index + 1 })}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={fields.loadCases.length >= 8}
          onClick={() => {
            const first = fields.loadCases[0]
            if (!first) return
            const id = Math.max(...fields.loadCases.map((item) => item.id)) + 1
            onChange({
              ...fields,
              loadCases: [
                ...fields.loadCases,
                {
                  id,
                  name: t("defaultCaseName", { index: fields.loadCases.length + 1 }),
                  region: { min: [...first.region.min], max: [...first.region.max] },
                  force: ["0", "0", "0"],
                },
              ],
            })
          }}
        >
          {t("addCase")}
        </Button>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-medium">{t("preservation")}</legend>
        <p className="text-xs text-muted-foreground">{t("preservationDescription")}</p>
        {fields.preserveRegions.map(({ id, region }, index) => (
          <fieldset key={id} className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("preserveRegion", { index: index + 1 })}
            </legend>
            <RegionFieldsEditor
              id={`lightweighting-preserve-${id}`}
              value={region}
              onChange={(region) =>
                onChange({
                  ...fields,
                  preserveRegions: fields.preserveRegions.map((item) =>
                    item.id === id ? { ...item, region } : item,
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...fields,
                  preserveRegions: fields.preserveRegions.filter((item) => item.id !== id),
                })
              }
            >
              {t("removePreserve", { index: index + 1 })}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={fields.preserveRegions.length >= 16}
          onClick={() => {
            const id = Math.max(-1, ...fields.preserveRegions.map((item) => item.id)) + 1
            onChange({
              ...fields,
              preserveRegions: [
                ...fields.preserveRegions,
                { id, region: { min: [...fields.support.min], max: [...fields.support.max] } },
              ],
            })
          }}
        >
          {t("addPreserve")}
        </Button>
      </fieldset>
    </>
  )
}
