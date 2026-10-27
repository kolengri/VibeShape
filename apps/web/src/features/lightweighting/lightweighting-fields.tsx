import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { Input } from "@vibeshape/ui/components/input"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useId } from "react"
import { LightweightingAlgorithmControls } from "./lightweighting-algorithm-controls"
import { LightweightingMaterialSelector } from "./lightweighting-material-selector"
import type {
  LightweightingFields,
  LoadCaseFields,
  SurfaceForceFields,
} from "./lightweighting-model"
import { LightweightingNumberField as NumberField } from "./lightweighting-number-field"
import { LightweightingSettingsDetails } from "./lightweighting-settings-details"

export type LightweightingPickTarget =
  | { kind: "support" }
  | { kind: "load"; caseId: number }
  | { kind: "preserve" }

function FacePicker({
  id,
  label,
  faces,
  active,
  onPick,
  onClear,
  disabled,
}: {
  id?: string
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
          id={id}
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

function LoadCaseName({
  load,
  fields,
  onChange,
}: {
  load: LoadCaseFields
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
}) {
  const t = useTranslations("app.lightweighting")
  return (
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
    <fieldset className="grid min-w-0 grid-cols-1 gap-2" aria-label={t("objective")}>
      <SelectField
        id="lightweighting-objective"
        description={t(
          fields.objective === "minimize-mass" ? "minimizeMassHelp" : "maximizeStiffnessHelp",
        )}
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
        <Field>
          <FieldLabel htmlFor="lightweighting-retained-mass">
            {t("retainedMassPercent", { value: Number(fields.retainedMassPercent) })}
          </FieldLabel>
          <input
            id="lightweighting-retained-mass"
            type="range"
            min={10}
            max={100}
            step={5}
            value={fields.retainedMassPercent}
            aria-describedby="lightweighting-objective-description"
            onChange={(event) => onChange({ ...fields, retainedMassPercent: event.target.value })}
            className="h-8 w-full min-w-0 cursor-pointer accent-primary"
          />
        </Field>
      )}
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
  compact = false,
}: {
  showObjective?: boolean
  compact?: boolean
  fields: LightweightingFields
  onChange: (fields: LightweightingFields) => void
  picking: LightweightingPickTarget | null
  onPick: (target: LightweightingPickTarget) => void
  pickingDisabled: boolean
}) {
  const t = useTranslations("app.lightweighting")
  const g = useTranslations("app.generativeDesign")
  const preservationLabelId = useId()
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
  const advanced = (
    <>
      <fieldset className="grid min-w-0 grid-cols-1 gap-2" aria-labelledby={preservationLabelId}>
        <legend className="mb-1 font-medium text-xs">
          <span className="inline-flex items-center gap-1">
            <span id={preservationLabelId}>{t("preservation")}</span>
            <FieldHelp label={t("preservation")}>{t("preservationDescription")}</FieldHelp>
          </span>
        </legend>
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
          description={t("surfaceDepthDescription")}
          value={surface?.depthMm ?? ""}
          min={0.01}
          onChange={(depthMm) => setSurface({ depthMm })}
        />
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-2">
        <legend className="mb-1 font-medium text-xs">{t("constraints")}</legend>
        <div className="grid grid-cols-1 gap-2">
          {numeric("safetyFactor", 1)}
          {numeric("maxDisplacementMm", 0)}
          {numeric("cellSizeMm", 0.01)}
          {numeric("maxIterations", 0, undefined, "1")}
        </div>
        <p className="text-xs text-muted-foreground">{t("discretizationDescription")}</p>
      </fieldset>
    </>
  )
  return (
    <>
      <LightweightingAlgorithmControls fields={fields} onChange={onChange} study={!showObjective} />
      {showObjective && fields.optimization.kind === "greedy" && (
        <ObjectiveControls fields={fields} onChange={onChange} />
      )}
      <fieldset className="grid min-w-0 grid-cols-1 gap-2">
        <legend className="mb-1 font-medium text-xs">{t("material")}</legend>
        <LightweightingMaterialSelector fields={fields} onChange={onChange} compact={compact}>
          <div className="grid grid-cols-1 gap-2">
            {numeric("youngModulusMpa", 0)}
            {numeric("poissonRatio", 0, 0.45)}
            {numeric("yieldStrengthMpa", 0)}
            {numeric("densityKgM3", 0)}
          </div>
        </LightweightingMaterialSelector>
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-2">
        <legend className="mb-1 font-medium text-xs">
          {compact ? g("fixedFaces") : t("support")}
        </legend>
        <p className="text-xs text-muted-foreground">{t("supportDescription")}</p>
        <FacePicker
          id="lightweighting-support-pick"
          label={t("pickSupport")}
          faces={surface?.supportFaces ?? []}
          active={picking?.kind === "support"}
          disabled={pickingDisabled}
          onPick={() => onPick({ kind: "support" })}
          onClear={() => setSurface({ supportFaces: [] })}
        />
      </fieldset>
      <fieldset className="grid min-w-0 grid-cols-1 gap-2">
        <legend className="mb-1 font-medium text-xs">
          {compact ? g("loadedFaces") : t("loadCases")}
        </legend>
        <p className="text-xs text-muted-foreground">{t("loadDescription")}</p>
        {fields.loadCases.map((load, index) => (
          <fieldset key={load.id} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium">
              {t("loadCase", { index: index + 1 })}
            </legend>
            {compact ? (
              <LightweightingSettingsDetails label={t("caseName")}>
                <LoadCaseName load={load} fields={fields} onChange={onChange} />
              </LightweightingSettingsDetails>
            ) : (
              <LoadCaseName load={load} fields={fields} onChange={onChange} />
            )}
            <FacePicker
              id={`lightweighting-load-pick-${load.id}`}
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
      {compact ? (
        <LightweightingSettingsDetails label={g("analysisSettings")}>
          {advanced}
        </LightweightingSettingsDetails>
      ) : (
        advanced
      )}
    </>
  )
}
