import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  type ConnectMountsFormValues,
  type ModelMountPoint,
  type MountPointRow,
  mountPointRow,
} from "./connect-mounts-form-model"
import type { ConnectMountsDraft } from "./use-connect-mounts-draft"

type PointProps = {
  draft: ConnectMountsDraft
  index: number
  point: MountPointRow
  issues: Readonly<Record<string, string>>
  modelPoints: readonly ModelMountPoint[]
}

function ModelCenterPicker({ draft, index, point, modelPoints }: Omit<PointProps, "issues">) {
  const t = useTranslations("app.connectMounts")
  return (
    <LocalizedSearchableSelectField
      label={t("modelPointLabel", { number: index + 1 })}
      placeholder={t("modelPointPlaceholder")}
      value=""
      options={modelPoints.map(({ id, label }) => ({ value: id, label }))}
      onValueChange={(id) => {
        const source = modelPoints.find((source) => source.id === id)
        if (!source) return
        draft.state.clearSubmissionErrors()
        draft.form.setFieldValue(
          `points[${index}]`,
          mountPointRow(point.id, source.position, draft.state.displayUnits.length),
        )
      }}
    />
  )
}

function MountCoordinates({ draft, index, point, issues }: Omit<PointProps, "modelPoints">) {
  const t = useTranslations("app.connectMounts")
  const { form, state } = draft
  return (
    <div className="grid min-w-0 gap-2">
      {(["x", "y", "z"] as const).map((axis) => (
        <form.Field key={axis} name={`points[${index}].${axis}`}>
          {(field) => (
            <LengthExpressionField
              id={`connect-mounts-${point.id}-${axis}`}
              name={field.name}
              label={t("coordinateLabel", { number: index + 1, axis: axis.toUpperCase() })}
              description={t("lengthDescription")}
              value={field.state.value}
              error={issues[field.name]}
              suggestions={state.suggestions}
              onBlur={field.handleBlur}
              onValueChange={(value) => {
                state.clearSubmissionErrors()
                field.handleChange(value)
              }}
            />
          )}
        </form.Field>
      ))}
    </div>
  )
}

function MountRadii({ draft, issues }: Pick<PointProps, "draft" | "issues">) {
  const t = useTranslations("app.connectMounts")
  const { form, state } = draft
  return (["nodeRadius", "strutRadius"] as const).map((name) => (
    <form.Field key={name} name={name}>
      {(field) => (
        <LengthExpressionField
          id={`connect-mounts-${name}`}
          name={name}
          label={t(name)}
          description={t("radiusDescription")}
          value={field.state.value}
          error={issues[name]}
          suggestions={state.suggestions}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            state.clearSubmissionErrors()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  ))
}

function MountConnectionMode({ draft }: { draft: ConnectMountsDraft }) {
  const t = useTranslations("app.connectMounts")
  const { form, state } = draft
  return (
    <form.Field name="connectionMode">
      {(field) => (
        <ChoiceField
          name={field.name}
          label={t("connectionMode")}
          value={field.state.value}
          options={[
            { value: "tree", label: t("tree"), description: t("treeDescription") },
            { value: "complete", label: t("complete"), description: t("completeDescription") },
          ]}
          onValueChange={(value) => {
            if (value !== "tree" && value !== "complete") return
            state.clearSubmissionErrors()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  )
}

export function ConnectMountsFields({
  draft,
  values,
  issues,
  modelPoints,
}: Pick<PointProps, "draft" | "issues" | "modelPoints"> & { values: ConnectMountsFormValues }) {
  const t = useTranslations("app.connectMounts")
  const { form, state } = draft
  return (
    <>
      <form.Field name="points" mode="array">
        {(arrayField) => (
          <>
            {values.points.map((point, index) => (
              <fieldset key={point.id} className="grid min-w-0 gap-2 rounded-md border p-2">
                <legend className="px-1 text-sm font-medium">
                  {t("pointLabel", { number: index + 1 })}
                </legend>
                {modelPoints.length > 0 && (
                  <ModelCenterPicker
                    draft={draft}
                    index={index}
                    point={point}
                    modelPoints={modelPoints}
                  />
                )}
                <MountCoordinates draft={draft} index={index} point={point} issues={issues} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={values.points.length <= 2}
                  onClick={() => {
                    state.clearSubmissionErrors()
                    arrayField.removeValue(index)
                  }}
                >
                  {t("removePoint", { number: index + 1 })}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={values.points.length >= 16}
              onClick={() => {
                state.clearSubmissionErrors()
                arrayField.pushValue(
                  mountPointRow(crypto.randomUUID(), [0, 0, 0], state.displayUnits.length),
                )
              }}
            >
              {t("addPoint")}
            </Button>
          </>
        )}
      </form.Field>
      <MountRadii draft={draft} issues={issues} />
      <MountConnectionMode draft={draft} />
    </>
  )
}
