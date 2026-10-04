import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyFrameBinding,
  type AssemblyInstanceRecord as AssemblyInstance,
  type AssemblyJointRecord as AssemblyJoint,
  assemblyJointRecordSchema as assemblyJointSchema,
} from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
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
  AssemblyFrameBindingFields,
  readAssemblyFrameBinding,
} from "./assembly-frame-binding-fields"
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
  if (kind === "fixed" || kind === "ball") return {}
  if (kind === "cylindrical")
    return {
      axis: [formNumber(data, "axis.X"), formNumber(data, "axis.Y"), formNumber(data, "axis.Z")],
      angle: (formNumber(data, "angle") * Math.PI) / 180,
      angleLimits: {
        min: (formNumber(data, "angle.minimum") * Math.PI) / 180,
        max: (formNumber(data, "angle.maximum") * Math.PI) / 180,
      },
      rotationDriven: data.get("rotationDriven") === "on",
      translation: formNumber(data, "translation"),
      translationLimits: {
        min: formNumber(data, "translation.minimum"),
        max: formNumber(data, "translation.maximum"),
      },
      translationDriven: data.get("translationDriven") === "on",
    }
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
    return newAssemblyInstance(
      definition,
      String(data.get("name")),
      identityAssemblyPose,
      undefined,
      assembly.schemaVersion,
    )
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
  schemaVersion: 1 | 2,
  bindings: { parent?: AssemblyFrameBinding; child?: AssemblyFrameBinding },
) {
  return assemblyJointSchema.parse({
    schemaVersion,
    id: previous ? previous.id : browserAuthoredUuid(),
    kind: options.kind,
    parentInstanceId: options.parentId,
    childInstanceId: child.id,
    parentFrame: formPose(data, "parent", previous?.parentFrame),
    childFrame: formPose(data, "child", previous?.childFrame),
    ...jointDrive(data, options.kind),
    ...(schemaVersion === 2 && (options.kind === "revolute" || options.kind === "prismatic")
      ? { driven: data.get("driven") === "on" }
      : {}),
    ...(bindings.parent
      ? { parentBinding: readAssemblyFrameBinding(data, "parent", bindings.parent) }
      : {}),
    ...(bindings.child
      ? { childBinding: readAssemblyFrameBinding(data, "child", bindings.child) }
      : {}),
  })
}
function jointChanges(
  assembly: AssemblyAuthority,
  data: FormData,
  options: JointOptions,
  previous: AssemblyJoint | undefined,
  bindings: { parent?: AssemblyFrameBinding; child?: AssemblyFrameBinding },
): readonly AssemblyMutation[] {
  const child = jointChild(assembly, data, options)
  const joint = captureJoint(data, options, child, previous, assembly.schemaVersion, bindings)
  return previous
    ? [{ kind: "joint.update", joint }]
    : attachAssemblyChildChanges(child, joint, options.creating)
}
function driveDefaults(kind: "revolute" | "prismatic", joint: AssemblyJoint | undefined) {
  if (joint && (joint.kind === "revolute" || joint.kind === "prismatic")) return joint
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
  if (kind === "cylindrical")
    return <CylindricalJointFields joint={joint?.kind === "cylindrical" ? joint : undefined} />
  return kind === "fixed" || kind === "ball" ? null : (
    <DrivenJointFields kind={kind} joint={joint} />
  )
}
function CylindricalJointFields({
  joint,
}: {
  joint: Extract<AssemblyJoint, { kind: "cylindrical" }> | undefined
}) {
  const t = useTranslations("app.assembly")
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("jointAxis")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {(["X", "Y", "Z"] as const).map((axis, index) => (
            <AssemblyNumberField
              key={axis}
              name={`axis.${axis}`}
              label={axis}
              value={joint?.axis[index] ?? (index === 2 ? 1 : 0)}
            />
          ))}
        </div>
      </fieldset>
      {cylindricalCoordinateFields.map((config) => (
        <CylindricalCoordinateField key={config.kind} config={config} joint={joint} />
      ))}
    </>
  )
}
const cylindricalCoordinateFields = [
  {
    kind: "angle",
    scale: Math.PI / 180,
    bound: 360,
    driven: "rotationDriven",
    limits: "angleLimits",
    driveLabel: "driveDegrees",
    lockLabel: "lockRotation",
  },
  {
    kind: "translation",
    scale: 1,
    bound: 100000,
    driven: "translationDriven",
    limits: "translationLimits",
    driveLabel: "driveMm",
    lockLabel: "lockTranslation",
  },
] as const
function CylindricalCoordinateField({
  config,
  joint,
}: {
  config: (typeof cylindricalCoordinateFields)[number]
  joint: Extract<AssemblyJoint, { kind: "cylindrical" }> | undefined
}) {
  const t = useTranslations("app.assembly"),
    { kind, scale, bound, driven } = config
  const limits = joint?.[config.limits] ?? { min: -bound * scale, max: bound * scale }
  return (
    <fieldset className="grid gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          name={driven}
          type="checkbox"
          defaultChecked={joint?.[driven] ?? false}
          className="size-4 accent-primary"
        />
        {t(config.lockLabel)}
      </label>
      <AssemblyNumberField
        name={kind}
        label={t(config.driveLabel)}
        value={(joint?.[kind] ?? 0) / scale}
        min={-bound}
        max={bound}
      />
      <div className="grid grid-cols-2 gap-2">
        <AssemblyNumberField
          name={`${kind}.minimum`}
          label={t("minimum")}
          value={limits.min / scale}
          min={-bound}
          max={bound}
        />
        <AssemblyNumberField
          name={`${kind}.maximum`}
          label={t("maximum")}
          value={limits.max / scale}
          min={-bound}
          max={bound}
        />
      </div>
    </fieldset>
  )
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
      label={t(assembly.schemaVersion === 2 ? "existingOccurrence" : "childInstance")}
      value={options.childId}
      onValueChange={(childId) => update({ childId })}
      required
    >
      {assembly.instances
        .filter(
          (instance) =>
            (assembly.schemaVersion === 2 || instance.grounded) && instance.id !== options.parentId,
        )
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
  inspection,
}: {
  assembly: AssemblyAuthority
  joint?: AssemblyJoint
  selectedId: string | null
  actions: AssemblyFormActions
  inspection?: AssemblyInspection | null | undefined
}) {
  const t = useTranslations("app.assembly")
  const [options, setOptions] = useState(() => initialOptions(assembly, joint, selectedId))
  const frames = jointFrames(joint)
  const [parentBinding, setParentBinding] = useState<AssemblyFrameBinding | undefined>(() =>
    joint?.schemaVersion === 2 ? joint.parentBinding : undefined,
  )
  const [childBinding, setChildBinding] = useState<AssemblyFrameBinding | undefined>(() =>
    joint?.schemaVersion === 2 ? joint.childBinding : undefined,
  )
  const update = (fields: Partial<JointOptions>) => {
    if (fields.parentId !== undefined && fields.parentId !== options.parentId)
      setParentBinding(undefined)
    if (
      (fields.childId !== undefined && fields.childId !== options.childId) ||
      fields.creating === true
    )
      setChildBinding(undefined)
    setOptions((previous) => ({ ...previous, ...fields }))
  }
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) =>
        jointChanges(assembly, data, options, joint, {
          ...(parentBinding ? { parent: parentBinding } : {}),
          ...(childBinding ? { child: childBinding } : {}),
        })
      }
    >
      <SelectField
        label={t("jointKind")}
        value={options.kind}
        onValueChange={(value) => {
          if (
            value === "fixed" ||
            value === "revolute" ||
            value === "prismatic" ||
            value === "cylindrical" ||
            value === "ball"
          )
            update({ kind: value })
        }}
      >
        {(assembly.schemaVersion === 2
          ? (["fixed", "revolute", "prismatic", "cylindrical", "ball"] as const)
          : (["fixed", "revolute", "prismatic"] as const)
        ).map((value) => (
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
      {assembly.schemaVersion === 2 && (
        <AssemblyFrameBindingFields
          prefix="parent"
          assembly={assembly}
          inspection={inspection}
          instanceId={options.parentId}
          binding={parentBinding}
          onChange={setParentBinding}
        />
      )}
      <AssemblyPoseFields prefix="parent" label={t("parentFrame")} pose={frames.parentFrame} />
      {assembly.schemaVersion === 2 && !options.creating && (
        <AssemblyFrameBindingFields
          prefix="child"
          assembly={assembly}
          inspection={inspection}
          instanceId={options.childId}
          binding={childBinding}
          onChange={setChildBinding}
        />
      )}
      <AssemblyPoseFields prefix="child" label={t("childFrame")} pose={frames.childFrame} />
      {assembly.schemaVersion === 2 &&
        (options.kind === "revolute" || options.kind === "prismatic") && (
          <label className="flex items-center gap-2 text-sm">
            <input
              name="driven"
              type="checkbox"
              defaultChecked={
                joint?.schemaVersion === 2 &&
                (joint.kind === "revolute" || joint.kind === "prismatic")
                  ? joint.driven
                  : true
              }
              className="size-4 accent-primary"
            />
            {t("lockDrive")}
          </label>
        )}
      <JointDriveFields
        key={options.kind}
        kind={options.kind}
        joint={matchingJoint(joint, options.kind)}
      />
    </AssemblyTaskForm>
  )
}
