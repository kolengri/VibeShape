import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { LightweightingMaterialSelector } from "./lightweighting-material-selector"
import type {
  LightweightingFields,
  LoadCaseFields,
  SurfaceForceFields,
} from "./lightweighting-model"

export type LightweightingPickTarget =
  | { kind: "support" }
  | { kind: "load"; caseId: number }
  | { kind: "preserve" }

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = "any",
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id} className="max-w-full">
        {label}
      </FieldLabel>
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

function FacePicker({
  label,
  faces,
  active,
  onPick,
  onClear,
  disabled,
}: {
  label: string
  faces: readonly number[]
  active: boolean
  onPick: () => void
  onClear: () => void
  disabled: boolean
}) {
  const t = useTranslations("app.lightweighting")
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={active ? "secondary" : "outline"}
          size="sm"
          aria-label={label}
          className="h-auto max-w-full whitespace-normal"
          aria-pressed={active}
          onClick={onPick}
          disabled={disabled}
        >
          {active ? t("finishPicking") : label}
        </Button>
        {faces.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {t("clearFaces")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("pickedFaces", { count: faces.length })}</p>
      {active && (
        <p role="status" className="text-xs">
          {t("facePickerHelp")}
        </p>
      )}
    </div>
  )
}

function LoadForceControls({
  load,
  index,
  onChange,
}: {
  load: LoadCaseFields
  index: number
  onChange: (next: Partial<SurfaceForceFields>) => void
}) {
  const t = useTranslations("app.lightweighting")
  const force = load.surfaceForce
  if (!force) return null
  return (
    <>
      <NumberField
        id={`lightweighting-force-${load.id}`}
        label={t("forceMagnitude", { index: index + 1 })}
        value={force.magnitudeN}
        min={0}
        onChange={(magnitudeN) => onChange({ magnitudeN })}
      />
      <SelectField
        id={`lightweighting-direction-${load.id}`}
        label={t("forceDirection", { index: index + 1 })}
        value={force.direction}
        onValueChange={(direction) => {
          if (direction === "normal" || direction === "x" || direction === "y" || direction === "z")
            onChange({ direction })
        }}
      >
        <SelectOption value="normal">{t("directionNormal")}</SelectOption>
        <SelectOption value="x">{t("directionX")}</SelectOption>
        <SelectOption value="y">{t("directionY")}</SelectOption>
        <SelectOption value="z">{t("directionZ")}</SelectOption>
      </SelectField>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={force.flipped}
        className="h-auto max-w-full whitespace-normal"
        onClick={() => onChange({ flipped: !force.flipped })}
      >
        {t("flipForce", { index: index + 1 })}
      </Button>
    </>
  )
}

const materialFieldKeys = new Set([
  "youngModulusMpa",
  "poissonRatio",
  "yieldStrengthMpa",
  "densityKgM3",
])

function ObjectiveControls({
  fields,
  onChange,
}: {
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
}) {
  const t = useTranslations("app.lightweighting")
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3">
      <legend className="mb-2 font-medium">{t("objective")}</legend>
      <SelectField
        id="lightweighting-objective"
        label={t("objective")}
        value={fields.objective}
        onValueChange={(objective) => {
          if (objective === "minimize-mass" || objective === "maximize-stiffness")
            onChange({ ...fields, objective })
        }}
      >
        <SelectOption value="minimize-mass">{t("minimizeMass")}</SelectOption>
        <SelectOption value="maximize-stiffness">{t("maximizeStiffness")}</SelectOption>
      </SelectField>
      {fields.objective === "maximize-stiffness" && (
        <div className="grid gap-2">
          <label htmlFor="lightweighting-retained-mass" className="text-sm font-medium">
            {t("retainedMassPercent", { value: Number(fields.retainedMassPercent) })}
          </label>
          <input
            id="lightweighting-retained-mass"
            type="range"
            min={10}
            max={100}
            step={5}
            value={fields.retainedMassPercent}
            aria-describedby="lightweighting-objective-help"
            onChange={(event) => onChange({ ...fields, retainedMassPercent: event.target.value })}
            className="h-6 w-full cursor-pointer accent-primary"
          />
        </div>
      )}
      <p id="lightweighting-objective-help" className="text-xs text-muted-foreground">
        {t(fields.objective === "minimize-mass" ? "minimizeMassHelp" : "maximizeStiffnessHelp")}
      </p>
    </fieldset>
  )
}

export function LightweightingParameters({
  fields,
  onChange,
  picking,
  onPick,
  pickingDisabled,
  showObjective = true,
}: {
  showObjective?: boolean
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
  picking: LightweightingPickTarget | null
  onPick: (target: LightweightingPickTarget) => void
  pickingDisabled: boolean
}) {
  const t = useTranslations("app.lightweighting")
  const surface = fields.surfaceSelection
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
      onChange={(value) =>
        onChange({
          ...fields,
          [key]: value,
          materialPresetId: materialFieldKeys.has(key) ? "custom" : fields.materialPresetId,
        })
      }
    />
  )
  const setSurface = (next: Partial<NonNullable<LightweightingFields["surfaceSelection"]>>) => {
    if (surface) onChange({ ...fields, surfaceSelection: { ...surface, ...next } })
  }
  const updateForce = (caseId: number, next: Partial<SurfaceForceFields>) =>
    onChange({
      ...fields,
      loadCases: fields.loadCases.map((item) =>
        item.id === caseId && item.surfaceForce
          ? { ...item, surfaceForce: { ...item.surfaceForce, ...next } }
          : item,
      ),
    })
  return (
    <>
      {showObjective && <ObjectiveControls fields={fields} onChange={onChange} />}
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-2 font-medium">{t("material")}</legend>
        <LightweightingMaterialSelector fields={fields} onChange={onChange} />
        <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
          {numeric("youngModulusMpa", 0)}
          {numeric("poissonRatio", 0, 0.45)}
          {numeric("yieldStrengthMpa", 0)}
          {numeric("densityKgM3", 0)}
        </div>
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-2 font-medium">{t("support")}</legend>
        <p className="text-xs text-muted-foreground">{t("supportDescription")}</p>
        <FacePicker
          label={t("pickSupport")}
          faces={surface?.supportFaces ?? []}
          active={picking?.kind === "support"}
          disabled={pickingDisabled}
          onPick={() => onPick({ kind: "support" })}
          onClear={() => setSurface({ supportFaces: [] })}
        />
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-2 font-medium">{t("loadCases")}</legend>
        <p className="text-xs text-muted-foreground">{t("loadDescription")}</p>
        {fields.loadCases.map((load, index) => (
          <fieldset key={load.id} className="grid min-w-0 grid-cols-1 gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("loadCase", { index: index + 1 })}
            </legend>
            <Field>
              <FieldLabel htmlFor={`lightweighting-case-${load.id}`}>{t("caseName")}</FieldLabel>
              <Input
                id={`lightweighting-case-${load.id}`}
                value={load.name}
                required
                onChange={(event) =>
                  onChange({
                    ...fields,
                    loadCases: fields.loadCases.map((item) =>
                      item.id === load.id ? { ...item, name: event.currentTarget.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <FacePicker
              label={t("pickLoad", { index: index + 1 })}
              faces={surface?.loadFaces[load.id] ?? []}
              active={picking?.kind === "load" && picking.caseId === load.id}
              disabled={pickingDisabled}
              onPick={() => onPick({ kind: "load", caseId: load.id })}
              onClear={() => setSurface({ loadFaces: { ...surface?.loadFaces, [load.id]: [] } })}
            />
            <LoadForceControls
              load={load}
              index={index}
              onChange={(next) => updateForce(load.id, next)}
            />
            {fields.loadCases.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (picking?.kind === "load" && picking.caseId === load.id) onPick(picking)
                  onChange({
                    ...fields,
                    loadCases: fields.loadCases.filter((item) => item.id !== load.id),
                  })
                }}
              >
                {t("removeCase", { index: index + 1 })}
              </Button>
            )}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
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
                  region: first.region,
                  force: ["0", "0", "0"],
                  surfaceForce: { magnitudeN: "", direction: "normal", flipped: false },
                },
              ],
            })
          }}
        >
          {t("addCase")}
        </Button>
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-2 font-medium">{t("preservation")}</legend>
        <p className="text-xs text-muted-foreground">{t("preservationDescription")}</p>
        <FacePicker
          label={t("pickPreserve")}
          faces={surface?.preserveFaces ?? []}
          active={picking?.kind === "preserve"}
          disabled={pickingDisabled}
          onPick={() => onPick({ kind: "preserve" })}
          onClear={() => setSurface({ preserveFaces: [] })}
        />
        <NumberField
          id="lightweighting-depth"
          label={t("surfaceDepth")}
          value={surface?.depthMm ?? ""}
          min={0.01}
          onChange={(depthMm) => setSurface({ depthMm })}
        />
        <p className="text-xs text-muted-foreground">{t("surfaceDepthDescription")}</p>
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-2 font-medium">{t("constraints")}</legend>
        <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
          {numeric("safetyFactor", 1)}
          {numeric("maxDisplacementMm", 0)}
          {numeric("cellSizeMm", 0.01)}
          {numeric("maxIterations", 0, 40, "1")}
        </div>
        <p className="text-xs text-muted-foreground">{t("discretizationDescription")}</p>
      </fieldset>
    </>
  )
}
