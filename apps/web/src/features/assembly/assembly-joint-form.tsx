import {
  type AssemblyInstance,
  type AssemblyJoint,
  assemblyJointSchema,
} from "@vibeshape/domain/assembly"
import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useId, useState } from "react"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import {
  AssemblyNameField,
  AssemblyNumberField,
  AssemblyPoseFields,
  formNumber,
  formPose,
} from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm } from "./assembly-forms"
import {
  attachAssemblyChildChanges,
  identityAssemblyPose,
  newAssemblyInstance,
} from "./assembly-model"

type JointOptions = {
  kind: AssemblyJoint["kind"]
  parentId: string
  childId: string
  definitionId: string
  creating: boolean
}
const units = {
  revolute: { scale: Math.PI / 180, bound: 360, label: "driveDegrees" },
  prismatic: { scale: 1, bound: 100_000, label: "driveMm" },
} as const
function initialOptions(
  assembly: AssemblyAuthority,
  joint: AssemblyJoint | undefined,
  selectedId: string | null,
): JointOptions {
  if (joint)
    return {
      kind: joint.kind,
      parentId: joint.parentInstanceId,
      childId: joint.childInstanceId,
      definitionId: "",
      creating: false,
    }
  const parent = selectedId ?? ""
  const definition = assembly.definitions[0]
  return {
    kind: "fixed",
    parentId: parent,
    childId: "",
    definitionId: definition ? definition.id : "",
    creating: true,
  }
}
function jointDrive(data: FormData, kind: AssemblyJoint["kind"]) {
  if (kind === "fixed") return {}
  const scale = units[kind].scale
  return {
    axis: [formNumber(data, "axis.X"), formNumber(data, "axis.Y"), formNumber(data, "axis.Z")],
    value: formNumber(data, "drive") * scale,
    limits: { min: formNumber(data, "minimum") * scale, max: formNumber(data, "maximum") * scale },
  }
}
function jointChild(
  assembly: AssemblyAuthority,
  data: FormData,
  options: JointOptions,
): AssemblyInstance {
  if (options.creating) {
    const definition = assembly.definitions.find(({ id }) => id === options.definitionId)
    if (!definition) throw new Error("Select the child definition.")
    return newAssemblyInstance(definition, String(data.get("name")), identityAssemblyPose)
  }
  const child = assembly.instances.find(({ id }) => id === options.childId)
  if (!child) throw new Error("Select the child occurrence.")
  return child
}
function captureJoint(
  data: FormData,
  options: JointOptions,
  child: AssemblyInstance,
  previous: AssemblyJoint | undefined,
) {
  return assemblyJointSchema.parse({
    schemaVersion: 1,
    id: previous ? previous.id : browserAuthoredUuid(),
    kind: options.kind,
    parentInstanceId: options.parentId,
    childInstanceId: child.id,
    parentFrame: formPose(data, "parent", previous?.parentFrame),
    childFrame: formPose(data, "child", previous?.childFrame),
    ...jointDrive(data, options.kind),
  })
}
function jointChanges(
  assembly: AssemblyAuthority,
  data: FormData,
  options: JointOptions,
  previous: AssemblyJoint | undefined,
): readonly AssemblyMutation[] {
  const child = jointChild(assembly, data, options)
  const joint = captureJoint(data, options, child, previous)
  return previous
    ? [{ kind: "joint.update", joint }]
    : attachAssemblyChildChanges(child, joint, options.creating)
}
function driveDefaults(kind: "revolute" | "prismatic", joint: AssemblyJoint | undefined) {
  if (joint && joint.kind !== "fixed") return joint
  const { scale, bound } = units[kind]
  return { axis: [0, 0, 1], value: 0, limits: { min: -bound * scale, max: bound * scale } }
}
function DrivenJointFields({
  kind,
  joint,
}: {
  kind: "revolute" | "prismatic"
  joint: AssemblyJoint | undefined
}) {
  const t = useTranslations("app.assembly")
  const { scale, bound, label } = units[kind]
  const driven = driveDefaults(kind, joint)
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t("jointAxis")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {(["X", "Y", "Z"] as const).map((axis, index) => (
            <AssemblyNumberField
              key={axis}
              name={`axis.${axis}`}
              label={axis}
              value={driven.axis[index]}
            />
          ))}
        </div>
      </fieldset>
      <AssemblyNumberField
        name="drive"
        label={t(label)}
        value={driven.value / scale}
        min={-bound}
        max={bound}
      />
      <div className="grid grid-cols-2 gap-2">
        <AssemblyNumberField
          name="minimum"
          label={t("minimum")}
          value={driven.limits.min / scale}
          min={-bound}
          max={bound}
        />
        <AssemblyNumberField
          name="maximum"
          label={t("maximum")}
          value={driven.limits.max / scale}
          min={-bound}
          max={bound}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("driveLimitsExplanation")}</p>
    </>
  )
}
function JointDriveFields({
  kind,
  joint,
}: {
  kind: AssemblyJoint["kind"]
  joint: AssemblyJoint | undefined
}) {
  return kind === "fixed" ? null : <DrivenJointFields kind={kind} joint={joint} />
}
type ChildProps = {
  assembly: AssemblyAuthority
  options: JointOptions
  update: (fields: Partial<JointOptions>) => void
}
function NewChildFields({ assembly, options, update }: ChildProps) {
  const t = useTranslations("app.assembly")
  return (
    <>
      <SelectField
        label={t("childDefinition")}
        value={options.definitionId}
        onValueChange={(definitionId) => update({ definitionId })}
        required
      >
        {assembly.definitions.map(({ id, name }) => (
          <SelectOption key={id} value={id}>
            {name}
          </SelectOption>
        ))}
      </SelectField>
      <AssemblyNameField value={t("defaultChild")} />
    </>
  )
}
function ExistingChildField({ assembly, options, update }: ChildProps) {
  const t = useTranslations("app.assembly")
  return (
    <SelectField
      label={t("childInstance")}
      value={options.childId}
      onValueChange={(childId) => update({ childId })}
      required
    >
      {assembly.instances
        .filter((instance) => instance.grounded && instance.id !== options.parentId)
        .map(({ id, name }) => (
          <SelectOption key={id} value={id}>
            {name}
          </SelectOption>
        ))}
    </SelectField>
  )
}
function ChildCreationFields(props: ChildProps) {
  const t = useTranslations("app.assembly")
  const id = useId()
  return (
    <>
      <Field orientation="horizontal">
        <input
          id={id}
          type="checkbox"
          checked={props.options.creating}
          className="size-4 accent-primary"
          onChange={(event) => props.update({ creating: event.currentTarget.checked })}
        />
        <FieldLabel htmlFor={id}>{t("createChild")}</FieldLabel>
      </Field>
      {props.options.creating ? <NewChildFields {...props} /> : <ExistingChildField {...props} />}
    </>
  )
}
function JointChildFields({ joint, ...props }: ChildProps & { joint: AssemblyJoint | undefined }) {
  const t = useTranslations("app.assembly")
  if (!joint) return <ChildCreationFields {...props} />
  const child = props.assembly.instances.find(({ id }) => id === joint.childInstanceId)
  return <p className="text-sm">{t("jointChild", { name: child ? child.name : "" })}</p>
}
function jointFrames(joint: AssemblyJoint | undefined) {
  return joint ?? { parentFrame: identityAssemblyPose, childFrame: identityAssemblyPose }
}
function matchingJoint(joint: AssemblyJoint | undefined, kind: AssemblyJoint["kind"]) {
  if (joint && joint.kind === kind) return joint
  return undefined
}
export function AssemblyJointForm({
  assembly,
  joint,
  selectedId,
  actions,
}: {
  assembly: AssemblyAuthority
  joint?: AssemblyJoint
  selectedId: string | null
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const [options, setOptions] = useState(() => initialOptions(assembly, joint, selectedId))
  const frames = jointFrames(joint)
  const update = (fields: Partial<JointOptions>) =>
    setOptions((previous) => ({ ...previous, ...fields }))
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) => jointChanges(assembly, data, options, joint)}
    >
      <SelectField
        label={t("jointKind")}
        value={options.kind}
        onValueChange={(value) => {
          if (value === "fixed" || value === "revolute" || value === "prismatic")
            update({ kind: value })
        }}
      >
        {(["fixed", "revolute", "prismatic"] as const).map((value) => (
          <SelectOption key={value} value={value}>
            {t(value)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("parentInstance")}
        value={options.parentId}
        onValueChange={(parentId) => update({ parentId })}
        required
      >
        {assembly.instances
          .filter(({ id }) => id !== options.childId)
          .map(({ id, name }) => (
            <SelectOption key={id} value={id}>
              {name}
            </SelectOption>
          ))}
      </SelectField>
      <JointChildFields joint={joint} assembly={assembly} options={options} update={update} />
      <AssemblyPoseFields prefix="parent" label={t("parentFrame")} pose={frames.parentFrame} />
      <AssemblyPoseFields prefix="child" label={t("childFrame")} pose={frames.childFrame} />
      <JointDriveFields
        key={options.kind}
        kind={options.kind}
        joint={matchingJoint(joint, options.kind)}
      />
    </AssemblyTaskForm>
  )
}
