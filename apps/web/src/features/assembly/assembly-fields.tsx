import { type AssemblyRigidPose, assemblyRigidPoseSchema } from "@vibeshape/domain/assembly"
import { useTranslations } from "@vibeshape/i18n"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { TanStackTextField, withFieldGroup } from "@vibeshape/ui/integrations/tanstack-form"
import { type ReactNode, useId } from "react"
import { assemblyEulerDegrees, assemblyPoseFromEuler, identityAssemblyPose } from "./assembly-model"

export function AssemblyNumberField({
  label,
  min = -100_000,
  max = 100_000,
  description,
}: {
  label: string
  min?: number
  max?: number
  description?: ReactNode
}) {
  return (
    <TanStackTextField
      label={label}
      description={description}
      type="number"
      min={min}
      max={max}
      step="any"
      required
    />
  )
}

export function numberFieldValidators(message: string, min = -100_000, max = 100_000) {
  return {
    onChange: ({ value }: { value: string }) => {
      const number = Number(value)
      return value.trim() && Number.isFinite(number) && number >= min && number <= max
        ? undefined
        : message
    },
  }
}

export function poseFieldValues(pose: AssemblyRigidPose = identityAssemblyPose) {
  const rotation = assemblyEulerDegrees(pose)
  return {
    x: String(pose.translation[0]),
    y: String(pose.translation[1]),
    z: String(pose.translation[2]),
    rx: String(rotation[0]),
    ry: String(rotation[1]),
    rz: String(rotation[2]),
  }
}
export type AssemblyPoseValues = ReturnType<typeof poseFieldValues>

export const AssemblyPoseFields = withFieldGroup({
  defaultValues: poseFieldValues(),
  props: {} as { label: string; description?: ReactNode },
  render: function AssemblyPoseFields({ group, label, description }) {
    const t = useTranslations("app.assembly")
    const descriptionId = useId()
    const labelId = useId()
    return (
      <fieldset
        className="grid min-w-0 gap-2"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      >
        <legend className="mb-1 text-xs font-medium">
          <span className="inline-flex items-center gap-1">
            <span id={labelId}>{label}</span>
            <FieldHelp label={label} descriptionId={descriptionId}>
              {description}
              <span className="block">{t("rotationOrder")}</span>
            </FieldHelp>
          </span>
        </legend>
        <div className="grid gap-2">
          {(["x", "y", "z", "rx", "ry", "rz"] as const).map((axis) => {
            const rotation = axis.startsWith("r")
            const bound = rotation ? 360 : 100_000
            return (
              <group.AppField
                key={axis}
                name={axis}
                validators={numberFieldValidators(t("invalidParameters"), -bound, bound)}
              >
                {() => (
                  <AssemblyNumberField
                    label={t(rotation ? "rotationAxis" : "translationAxis", {
                      axis: axis.slice(-1).toUpperCase(),
                    })}
                    min={-bound}
                    max={bound}
                  />
                )}
              </group.AppField>
            )
          })}
        </div>
      </fieldset>
    )
  },
})

export function formNumber(value: string) {
  if (!value.trim()) throw new Error("A numeric field is required.")
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error("A finite numeric field is required.")
  return number
}
export function formPose(values: AssemblyPoseValues, original?: AssemblyRigidPose) {
  const translation = [formNumber(values.x), formNumber(values.y), formNumber(values.z)] as const
  const rotation = [formNumber(values.rx), formNumber(values.ry), formNumber(values.rz)] as const
  if (original && unchangedPoseFields(original, translation, rotation))
    return assemblyRigidPoseSchema.parse(original)
  return assemblyPoseFromEuler(translation, rotation)
}
function unchangedPoseFields(
  original: AssemblyRigidPose,
  translation: readonly number[],
  rotation: readonly number[],
) {
  const angles = assemblyEulerDegrees(original)
  return (
    translation.every((value, index) => value === original.translation[index]) &&
    rotation.every((value, index) => value === angles[index])
  )
}

function nameFieldValidators(message: string) {
  return {
    onChange: ({ value }: { value: string }) =>
      value.trim() && value.length <= 120 ? undefined : message,
  }
}

export const AssemblyNameField = withFieldGroup({
  defaultValues: { name: "" },
  render: function AssemblyNameField({ group }) {
    const t = useTranslations("app.assembly")
    return (
      <group.AppField name="name" validators={nameFieldValidators(t("invalidParameters"))}>
        {(field) => <field.TextField label={t("name")} maxLength={120} required />}
      </group.AppField>
    )
  },
})
