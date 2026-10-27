import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { Input } from "@vibeshape/ui/components/input"
import { useId } from "react"
import { FdmSupportDemand } from "./fdm-analysis-details"
import { GenerativeFdmControls } from "./generative-fdm-controls"
import { LightweightingSettingsDetails } from "./lightweighting-settings-details"
import type { useGenerativeDesignTask } from "./use-generative-design-task"

type StudyState = ReturnType<typeof useGenerativeDesignTask>

export function GenerativeDesignControls({ state }: { state: StudyState }) {
  const t = useTranslations("app.generativeDesign")
  const id = useId()
  const fields = state.studyFields
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2">
      <legend className="mb-1 font-medium text-xs">{t("searchSpace")}</legend>
      <fieldset className="flex flex-wrap gap-2" aria-labelledby={`${id}-weight-target`}>
        <legend className="mb-1 text-xs font-medium">
          <span className="inline-flex items-center gap-1">
            <span id={`${id}-weight-target`}>{t("weightTarget")}</span>
            <FieldHelp label={t("weightTarget")}>{t("targetHelp")}</FieldHelp>
          </span>
        </legend>
        {[85, 70, 50].map((percent) => (
          <Button
            key={percent}
            type="button"
            size="sm"
            variant={
              fields.retainedMassPercents.trim() === String(percent) ? "secondary" : "outline"
            }
            aria-pressed={fields.retainedMassPercents.trim() === String(percent)}
            className="h-auto max-w-full whitespace-normal"
            onClick={() =>
              state.changeStudyFields({ ...fields, retainedMassPercents: String(percent) })
            }
          >
            {t("removeMass", { percent: 100 - percent })}
          </Button>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {t("selectedTargets", { targets: fields.retainedMassPercents })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("scenarioCount", { count: state.scenarioCount })}
      </p>
      <LightweightingSettingsDetails label={t("advancedStudy")}>
        <Field>
          <FieldLabel htmlFor="generative-mass-targets">{t("massTargets")}</FieldLabel>
          <Input
            id="generative-mass-targets"
            value={fields.retainedMassPercents}
            aria-describedby="generative-mass-help"
            onChange={(event) =>
              state.changeStudyFields({
                ...fields,
                retainedMassPercents: event.currentTarget.value,
              })
            }
          />
          <p id="generative-mass-help" className="text-xs text-muted-foreground">
            {t("massTargetsHelp")}
          </p>
        </Field>
        <fieldset className="flex flex-wrap gap-2" aria-labelledby={`${id}-materials`}>
          <legend className="mb-1 text-xs font-medium">
            <span className="inline-flex items-center gap-1">
              <span id={`${id}-materials`}>{t("additionalMaterials")}</span>
              <FieldHelp label={t("additionalMaterials")}>{t("materialsHelp")}</FieldHelp>
            </span>
          </legend>
          {state.materialOptions.map((preset) => {
            const selected = fields.additionalMaterialIds.includes(preset.id)
            return (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={selected ? "secondary" : "outline"}
                aria-pressed={selected}
                className="h-auto max-w-full whitespace-normal text-start"
                disabled={!selected && fields.additionalMaterialIds.length >= 2}
                onClick={() =>
                  state.changeStudyFields({
                    ...fields,
                    additionalMaterialIds: selected
                      ? fields.additionalMaterialIds.filter((id) => id !== preset.id)
                      : [...fields.additionalMaterialIds, preset.id],
                  })
                }
              >
                {preset.referenceName}
              </Button>
            )
          })}
        </fieldset>
        <GenerativeObstacleControls state={state} />
      </LightweightingSettingsDetails>
      <GenerativeFdmControls state={state} />
    </fieldset>
  )
}

function GenerativeObstacleControls({ state }: { state: StudyState }) {
  const t = useTranslations("app.generativeDesign")
  const id = useId()
  const fields = state.studyFields
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-2" aria-labelledby={id}>
      <legend className="mb-1 font-medium text-xs">
        <span className="inline-flex items-center gap-1">
          <span id={id}>{t("obstacles")}</span>
          <FieldHelp label={t("obstacles")}>{t("obstaclesHelp")}</FieldHelp>
        </span>
      </legend>
      {fields.obstacles.map((obstacle, index) => (
        <fieldset
          key={obstacle.id}
          className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-3"
        >
          <legend className="px-1 text-xs font-medium">
            {t("obstacle", { index: index + 1 })}
          </legend>
          {(["min", "max"] as const).map((bound) => (
            <div key={bound} className="grid grid-cols-1 gap-2">
              {(["X", "Y", "Z"] as const).map((axis, axisIndex) => (
                <Field key={axis}>
                  <FieldLabel htmlFor={`generative-obstacle-${obstacle.id}-${bound}-${axis}`}>
                    {t(bound, { axis })}
                  </FieldLabel>
                  <Input
                    id={`generative-obstacle-${obstacle.id}-${bound}-${axis}`}
                    type="number"
                    step="any"
                    required
                    value={obstacle.region[bound][axisIndex]}
                    onChange={(event) =>
                      state.changeStudyFields({
                        ...fields,
                        obstacles: fields.obstacles.map((item) => {
                          if (item.id !== obstacle.id) return item
                          const coordinates = [...item.region[bound]] as [string, string, string]
                          coordinates[axisIndex] = event.currentTarget.value
                          return { ...item, region: { ...item.region, [bound]: coordinates } }
                        }),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto max-w-full whitespace-normal"
            onClick={() =>
              state.changeStudyFields({
                ...fields,
                obstacles: fields.obstacles.filter((item) => item.id !== obstacle.id),
              })
            }
          >
            {t("removeObstacle", { index: index + 1 })}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-auto max-w-full whitespace-normal"
        onClick={() =>
          state.changeStudyFields({
            ...fields,
            obstacles: [
              ...fields.obstacles,
              {
                id: Math.max(0, ...fields.obstacles.map((item) => item.id)) + 1,
                region: { min: ["", "", ""], max: ["", "", ""] },
              },
            ],
          })
        }
      >
        {t("addObstacle")}
      </Button>
    </fieldset>
  )
}

export function GenerativeDesignResults({ state }: { state: StudyState }) {
  const t = useTranslations("app.generativeDesign")
  if (!state.study) return null
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-label={t("candidates")}>
      <div className="flex items-center gap-1">
        <h3 className="font-medium text-xs">{t("candidates")}</h3>
        <FieldHelp label={t("candidates")}>{t("comparisonHelp")}</FieldHelp>
      </div>
      {state.study.candidates.map((candidate, index) => (
        <article key={candidate.id} className="grid gap-2 rounded-md border p-3">
          <h4 className="text-xs font-medium">
            {t("candidate", { index: index + 1, material: candidate.materialName })}
          </h4>
          <dl className="grid grid-cols-1 gap-2 text-xs @xs:grid-cols-2">
            <dt>{t("targetMass")}</dt>
            <dd>{(candidate.retainedMassFraction * 100).toFixed(0)}%</dd>
            <dt>{t("mass")}</dt>
            <dd>{(candidate.result.optimized.massKg * 1000).toFixed(2)} g</dd>
            <dt>{t("compliance")}</dt>
            <dd>
              {Math.max(
                ...candidate.result.optimized.cases.map((item) => item.complianceNmm),
              ).toPrecision(4)}{" "}
              N·mm
            </dd>
          </dl>
          {candidate.result.fdm && <FdmSupportDemand summary={candidate.result.fdm} />}
          <p className="text-xs text-muted-foreground">
            {t(candidate.pareto ? "pareto" : "dominated")}
          </p>
          {candidate.result.objective?.kind === "maximize-stiffness" &&
            candidate.result.objective.targetStatus === "not-reached" && (
              <p className="text-xs text-muted-foreground">{t("targetNotReached")}</p>
            )}
          {candidate.duplicateOf && (
            <p className="text-xs text-muted-foreground">{t("duplicate")}</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={state.ready?.result === candidate.result}
            disabled={state.activity !== "idle"}
            onClick={() => void state.selectCandidate(candidate.id)}
          >
            {t("previewCandidate", { index: index + 1 })}
          </Button>
        </article>
      ))}
      {state.study.failures.map((failure) => (
        <Alert key={failure.id}>
          {t("candidateFailed", {
            material: failure.materialName,
            target: failure.retainedMassFraction * 100,
            code: failure.code,
          })}
        </Alert>
      ))}
      {state.study.candidates.length === 0 && <Alert>{t("noCandidates")}</Alert>}
    </section>
  )
}
