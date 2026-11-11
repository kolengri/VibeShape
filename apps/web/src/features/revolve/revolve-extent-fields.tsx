import { useTranslations } from "@vibeshape/i18n"
import { extrusionBodyOptionKey } from "../extrusion/extrusion-body-options"
import {
  extrusionEndBodyPickCandidates,
  extrusionEndFacePickCandidates,
  extrusionEndFaceSelection,
} from "../extrusion/extrusion-reference-picking"
import type { RevolveFormController, RevolveFormValues } from "./revolve-form"

type Props = Readonly<{ controller: RevolveFormController }>

/** One-sided, symmetric, and two-sided angular extents; dynamic endpoints are one-sided. */
export function RevolveExtentFields({ controller }: Props) {
  const t = useTranslations("app.shell.taskPanel.revolve")
  const { form } = controller
  return (
    <form.Subscribe
      selector={(state) => ({ extent: state.values.extent, endKind: state.values.endKind })}
    >
      {({ extent, endKind }) => (
        <div className="grid gap-3">
          {endKind === "angle" ? (
            <form.AppField name="extent">
              {(field) => (
                <field.NativeSelectField
                  id="revolve-extent"
                  label={t("extent")}
                  disabled={controller.disabled}
                  onValueChange={(value) => {
                    controller.clearSubmissionErrors()
                    if (value === "symmetric") form.setFieldValue("reversed", false)
                  }}
                >
                  <option value="one-sided">{t("extentOneSided")}</option>
                  <option value="symmetric">{t("extentSymmetric")}</option>
                  <option value="two-sided">{t("extentTwoSided")}</option>
                </field.NativeSelectField>
              )}
            </form.AppField>
          ) : null}
          {extent === "two-sided" && endKind === "angle" ? (
            <form.AppField name="secondAngle">
              {(field) => (
                <field.VariableExpressionField
                  id="revolve-second-angle"
                  label={t("secondAngle")}
                  description={controller.copy.expressionDescription}
                  disabled={controller.disabled}
                  suggestions={controller.suggestions}
                  onValueChange={() => {
                    controller.clearSubmissionErrors()
                  }}
                />
              )}
            </form.AppField>
          ) : null}
          <form.AppField name="reversed">
            {(field) => (
              <field.CheckboxField
                label={t("reversed")}
                disabled={controller.disabled || (extent === "symmetric" && endKind === "angle")}
                onValueChange={() => {
                  controller.clearSubmissionErrors()
                }}
              />
            )}
          </form.AppField>
        </div>
      )}
    </form.Subscribe>
  )
}

/** Angle, up-to-body, or up-to-face endpoint bound to one exact rebuilt body revision. */
export function RevolveEndFields({ controller }: Props) {
  const t = useTranslations("app.shell.taskPanel.revolve")
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="grid gap-3">
          <form.AppField name="endKind">
            {(field) => (
              <field.NativeSelectField
                id="revolve-end-condition"
                label={t("endCondition")}
                disabled={controller.disabled}
                onValueChange={(value) => {
                  controller.clearSubmissionErrors()
                  if (value !== "angle") form.setFieldValue("extent", "one-sided")
                }}
              >
                <option value="angle">{t("endAngle")}</option>
                <option value="up-to-body">{t("endUpToBody")}</option>
                <option value="up-to-face">{t("endUpToFace")}</option>
              </field.NativeSelectField>
            )}
          </form.AppField>
          <RevolveEndReferenceFields controller={controller} values={values} />
        </div>
      )}
    </form.Subscribe>
  )
}

function RevolveEndReferenceFields({
  controller,
  values,
}: Props & Readonly<{ values: RevolveFormValues }>) {
  const t = useTranslations("app.shell.taskPanel.revolve")
  const { form } = controller
  if (values.endKind === "angle") return null
  const options = controller.endOptions
  const target = options.find((option) => extrusionBodyOptionKey(option) === values.endTarget)
  return (
    <>
      <form.AppField name="endTarget">
        {(field) => (
          <field.ReferencePickField
            id="revolve-end-body"
            label={t("endBody")}
            placeholder={t("chooseBody")}
            description={t("endDescription")}
            disabled={controller.disabled}
            required
            options={options
              .filter((option) => option.outputRole && option.contentHash)
              .map((option) => ({ value: extrusionBodyOptionKey(option), label: option.label }))}
            candidates={extrusionEndBodyPickCandidates(options)}
            onValueChange={(value) => {
              controller.clearSubmissionErrors()
              const option = options.find((item) => extrusionBodyOptionKey(item) === value)
              form.setFieldValue("endSourceHash", option?.contentHash ?? "")
              form.setFieldValue("endFace", "")
            }}
          />
        )}
      </form.AppField>
      {values.endKind === "up-to-face" ? (
        <form.AppField name="endFace">
          {(field) => (
            <field.ReferencePickField
              id="revolve-end-face"
              label={t("endFace")}
              placeholder={t("chooseFace")}
              disabled={controller.disabled}
              required
              options={
                target?.faces?.map((face) => ({
                  value: JSON.stringify(face.reference),
                  label: face.label,
                })) ?? []
              }
              candidates={extrusionEndFacePickCandidates(options)}
              onValueChange={(value) => {
                controller.clearSubmissionErrors()
                const selection = value ? extrusionEndFaceSelection(options, value) : undefined
                if (!selection) {
                  form.setFieldValue("endFace", "")
                  return
                }
                form.setFieldValue("endTarget", selection.endTarget)
                form.setFieldValue("endSourceHash", selection.endSourceHash)
                form.setFieldValue("endFace", selection.endFace)
              }}
            />
          )}
        </form.AppField>
      ) : null}
    </>
  )
}
