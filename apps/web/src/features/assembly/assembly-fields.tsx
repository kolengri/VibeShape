import { type AssemblyRigidPose, assemblyRigidPoseSchema } from "@vibeshape/domain/assembly"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { useId } from "react"
import { assemblyEulerDegrees, assemblyPoseFromEuler, identityAssemblyPose } from "./assembly-model"

export function AssemblyNumberField({
  label,
  name,
  value = 0,
  min = -100_000,
  max = 100_000,
}: {
  label: string
  name: string
  value?: number | undefined
  min?: number
  max?: number
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step="any"
        required
      />
    </Field>
  )
}
export function AssemblyNameField({ value }: { value: string }) {
  const t = useTranslations("app.assembly")
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("name")}</FieldLabel>
      <Input id={id} name="name" defaultValue={value} maxLength={120} required />
    </Field>
  )
}
export function AssemblyPoseFields({
  prefix,
  label,
  pose = identityAssemblyPose,
}: {
  prefix: string
  label: string
  pose?: AssemblyRigidPose | undefined
}) {
  const t = useTranslations("app.assembly")
  const rotation = assemblyEulerDegrees(pose)
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis, index) => (
          <AssemblyNumberField
            key={axis}
            name={`${prefix}.${axis}`}
            label={t("translationAxis", { axis: axis.toUpperCase() })}
            value={pose.translation[index]}
          />
        ))}
        {(["x", "y", "z"] as const).map((axis, index) => (
          <AssemblyNumberField
            key={axis}
            name={`${prefix}.r${axis}`}
            label={t("rotationAxis", { axis: axis.toUpperCase() })}
            value={rotation[index]}
            min={-360}
            max={360}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("rotationOrder")}</p>
    </fieldset>
  )
}
export function formNumber(data: FormData, name: string) {
  const value = data.get(name)
  if (typeof value !== "string" || !value.trim()) throw new Error("A numeric field is required.")
  return Number(value)
}
export function formPose(data: FormData, prefix: string, original?: AssemblyRigidPose) {
  const translation = [
    formNumber(data, `${prefix}.x`),
    formNumber(data, `${prefix}.y`),
    formNumber(data, `${prefix}.z`),
  ] as const
  const rotation = [
    formNumber(data, `${prefix}.rx`),
    formNumber(data, `${prefix}.ry`),
    formNumber(data, `${prefix}.rz`),
  ] as const
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
