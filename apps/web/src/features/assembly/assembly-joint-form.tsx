import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyInstanceRecord as AssemblyInstance,
  type AssemblyJointRecord as AssemblyJoint,
  assemblyJointRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { withFieldGroup } from "@vibeshape/ui/integrations/tanstack-form"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import {
  AssemblyNameField,
  AssemblyNumberField,
  AssemblyPoseFields,
  formNumber,
  formPose,
  numberFieldValidators,
  poseFieldValues,
} from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm, useAssemblyForm } from "./assembly-forms"
import {
  AssemblyFrameBindingFields,
  frameBindingValues,
  readAssemblyFrameBinding,
} from "./assembly-frame-binding-fields"
import {
  attachAssemblyChildChanges,
  identityAssemblyPose,
  newAssemblyInstance,
} from "./assembly-model"

const units = {
  revolute: { scale: Math.PI / 180, bound: 360, label: "driveDegrees" },
  prismatic: { scale: 1, bound: 100_000, label: "driveMm" },
} as const
const cylindricalCoordinates = [
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
    bound: 100_000,
    driven: "translationDriven",
    limits: "translationLimits",
    driveLabel: "driveMm",
    lockLabel: "lockTranslation",
  },
] as const
function coordinateValues(value: number, min: number, max: number, scale: number) {
  return {
    value: String(value / scale),
    minimum: String(min / scale),
    maximum: String(max / scale),
  }
}
function axisValues(axis: readonly number[]) {
  return { X: String(axis[0]), Y: String(axis[1]), Z: String(axis[2]) }
}
function defaultDriveValues(kind: AssemblyJoint["kind"]) {
  const unit = kind === "revolute" ? units.revolute : units.prismatic
  return {
    axis: axisValues([0, 0, 1]),
    coordinate: coordinateValues(0, -unit.bound * unit.scale, unit.bound * unit.scale, unit.scale),
    driven: true,
    angle: coordinateValues(0, -Math.PI * 2, Math.PI * 2, Math.PI / 180),
    translation: coordinateValues(0, -100_000, 100_000, 1),
    rotationDriven: false,
    translationDriven: false,
  }
}
function driveValues(kind: AssemblyJoint["kind"], joint?: AssemblyJoint) {
  const defaults = defaultDriveValues(kind)
  if (!joint || joint.kind !== kind) return defaults
  switch (joint.kind) {
    case "revolute":
    case "prismatic":
      return {
        ...defaults,
        axis: axisValues(joint.axis),
        coordinate: coordinateValues(
          joint.value,
          joint.limits.min,
          joint.limits.max,
          units[joint.kind].scale,
        ),
        driven: joint.schemaVersion === 2 ? joint.driven : true,
      }
    case "cylindrical":
      return {
        ...defaults,
        axis: axisValues(joint.axis),
        angle: coordinateValues(
          joint.angle,
          joint.angleLimits.min,
          joint.angleLimits.max,
          Math.PI / 180,
        ),
        translation: coordinateValues(
          joint.translation,
          joint.translationLimits.min,
          joint.translationLimits.max,
          1,
        ),
        rotationDriven: joint.rotationDriven,
        translationDriven: joint.translationDriven,
      }
    default:
      return defaults
  }
}
function jointFormValues(
  assembly: AssemblyAuthority,
  joint: AssemblyJoint | undefined,
  selectedId: string | null,
  name: string,
) {
  const definition = assembly.definitions[0]
  const defaults = {
    kind: "fixed" as AssemblyJoint["kind"],
    parentId: selectedId ?? "",
    childId: "",
    definitionId: definition ? definition.id : "",
    creating: true,
    name,
    parent: poseFieldValues(),
    child: poseFieldValues(),
    parentBinding: frameBindingValues(),
    childBinding: frameBindingValues(),
    drive: defaultDriveValues("fixed"),
  }
  if (!joint) return defaults
  const bindings =
    joint.schemaVersion === 2 ? joint : { parentBinding: undefined, childBinding: undefined }
  return {
    ...defaults,
    kind: joint.kind,
    parentId: joint.parentInstanceId,
    childId: joint.childInstanceId,
    creating: false,
    parent: poseFieldValues(joint.parentFrame),
    child: poseFieldValues(joint.childFrame),
    parentBinding: frameBindingValues(bindings.parentBinding),
    childBinding: frameBindingValues(bindings.childBinding),
    drive: driveValues(joint.kind, joint),
  }
}
type JointValues = ReturnType<typeof jointFormValues>
function jointDrive(values: JointValues) {
  const { kind, drive } = values
  if (kind === "fixed" || kind === "ball") return {}
  const axis = [formNumber(drive.axis.X), formNumber(drive.axis.Y), formNumber(drive.axis.Z)]
  if (kind === "cylindrical")
    return {
      axis,
      angle: (formNumber(drive.angle.value) * Math.PI) / 180,
      angleLimits: {
        min: (formNumber(drive.angle.minimum) * Math.PI) / 180,
        max: (formNumber(drive.angle.maximum) * Math.PI) / 180,
      },
      rotationDriven: drive.rotationDriven,
      translation: formNumber(drive.translation.value),
      translationLimits: {
        min: formNumber(drive.translation.minimum),
        max: formNumber(drive.translation.maximum),
      },
      translationDriven: drive.translationDriven,
    }
  const scale = units[kind].scale
  return {
    axis,
    value: formNumber(drive.coordinate.value) * scale,
    limits: {
      min: formNumber(drive.coordinate.minimum) * scale,
      max: formNumber(drive.coordinate.maximum) * scale,
    },
  }
}
function jointChild(assembly: AssemblyAuthority, values: JointValues): AssemblyInstance {
  if (values.creating) {
    const definition = assembly.definitions.find(({ id }) => id === values.definitionId)
    if (!definition) throw new Error("Select the child definition.")
    return newAssemblyInstance(
      definition,
      values.name,
      identityAssemblyPose,
      undefined,
      assembly.schemaVersion,
    )
  }
  const child = assembly.instances.find(({ id }) => id === values.childId)
  if (!child) throw new Error("Select the child occurrence.")
  return child
}
function jointBindingChanges(values: JointValues) {
  const parentBinding = readAssemblyFrameBinding(values.parentBinding)
  const childBinding = values.creating ? undefined : readAssemblyFrameBinding(values.childBinding)
  return {
    ...(parentBinding ? { parentBinding } : {}),
    ...(childBinding ? { childBinding } : {}),
  }
}
function jointDrivePolicy(values: JointValues, schemaVersion: AssemblyAuthority["schemaVersion"]) {
  if (schemaVersion === 1) return {}
  switch (values.kind) {
    case "revolute":
    case "prismatic":
      return { driven: values.drive.driven }
    default:
      return {}
  }
}
function jointIdentityFrames(values: JointValues, previous?: AssemblyJoint) {
  if (!previous)
    return {
      id: browserAuthoredUuid(),
      parentFrame: formPose(values.parent),
      childFrame: formPose(values.child),
    }
  return {
    id: previous.id,
    parentFrame: formPose(values.parent, previous.parentFrame),
    childFrame: formPose(values.child, previous.childFrame),
  }
}
function jointChanges(
  assembly: AssemblyAuthority,
  values: JointValues,
  previous?: AssemblyJoint,
): readonly AssemblyMutation[] {
  const child = jointChild(assembly, values)
  const bindings = jointBindingChanges(values)
  const joint = assemblyJointRecordSchema.parse({
    schemaVersion: assembly.schemaVersion,
    kind: values.kind,
    parentInstanceId: values.parentId,
    childInstanceId: child.id,
    ...jointIdentityFrames(values, previous),
    ...jointDrive(values),
    ...jointDrivePolicy(values, assembly.schemaVersion),
    ...bindings,
  })
  return previous
    ? [{ kind: "joint.update", joint }]
    : attachAssemblyChildChanges(child, joint, values.creating)
}
const JointDriveFields = withFieldGroup({
  defaultValues: driveValues("fixed"),
  props: { kind: "fixed" as AssemblyJoint["kind"], general: false },
  render: function JointDriveFields({ group, kind, general }) {
    const t = useTranslations("app.assembly")
    if (kind === "fixed" || kind === "ball") return null
    return (
      <>
        {general && kind !== "cylindrical" && (
          <group.AppField name="driven">
            {(field) => <field.CheckboxField label={t("lockDrive")} />}
          </group.AppField>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-xs font-medium">{t("jointAxis")}</legend>
          <div className="grid gap-2">
            {(["X", "Y", "Z"] as const).map((axis) => (
              <group.AppField
                key={axis}
                name={`axis.${axis}`}
                validators={numberFieldValidators(t("invalidParameters"))}
              >
                {() => <AssemblyNumberField label={axis} />}
              </group.AppField>
            ))}
          </div>
        </fieldset>
        {kind === "cylindrical"
          ? cylindricalCoordinates.map((config) => (
              <fieldset key={config.kind} className="grid gap-2">
                <group.AppField name={config.driven}>
                  {(field) => <field.CheckboxField label={t(config.lockLabel)} />}
                </group.AppField>
                {(["value", "minimum", "maximum"] as const).map((fieldName) => (
                  <group.AppField
                    key={fieldName}
                    name={`${config.kind}.${fieldName}`}
                    validators={numberFieldValidators(
                      t("invalidParameters"),
                      -config.bound,
                      config.bound,
                    )}
                  >
                    {() => (
                      <AssemblyNumberField
                        label={t(fieldName === "value" ? config.driveLabel : fieldName)}
                        min={-config.bound}
                        max={config.bound}
                      />
                    )}
                  </group.AppField>
                ))}
              </fieldset>
            ))
          : (["value", "minimum", "maximum"] as const).map((fieldName) => (
              <group.AppField
                key={fieldName}
                name={`coordinate.${fieldName}`}
                validators={numberFieldValidators(
                  t("invalidParameters"),
                  -units[kind].bound,
                  units[kind].bound,
                )}
              >
                {() => (
                  <AssemblyNumberField
                    label={t(fieldName === "value" ? units[kind].label : fieldName)}
                    description={fieldName === "value" ? t("driveLimitsExplanation") : undefined}
                    min={-units[kind].bound}
                    max={units[kind].bound}
                  />
                )}
              </group.AppField>
            ))}
      </>
    )
  },
})
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
  const form = useAssemblyForm({
    defaultValues: jointFormValues(assembly, joint, selectedId, t("defaultChild")),
    actions,
    build: (values) => jointChanges(assembly, values, joint),
  })
  const instanceOptions = (exclude: string, children = false) =>
    assembly.instances
      .filter(
        (instance) =>
          instance.id !== exclude &&
          (!children || assembly.schemaVersion === 2 || instance.grounded),
      )
      .map(({ id, name, definitionId }, index) => ({
        value: id,
        label: name,
        description: t("choiceSource", {
          number: index + 1,
          source:
            assembly.definitions.find((definition) => definition.id === definitionId)?.name ?? name,
        }),
        keywords: [id],
      }))
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <AssemblyTaskForm form={form} actions={actions}>
          <form.AppField
            name="kind"
            listeners={{
              onChange: ({ value }) => form.setFieldValue("drive", driveValues(value, joint)),
            }}
          >
            {(field) => (
              <field.SelectField label={t("jointKind")}>
                {(assembly.schemaVersion === 2
                  ? (["fixed", "revolute", "prismatic", "cylindrical", "ball"] as const)
                  : (["fixed", "revolute", "prismatic"] as const)
                ).map((kind) => (
                  <SelectOption key={kind} value={kind}>
                    {t(kind)}
                  </SelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField
            name="parentId"
            listeners={{
              onChange: () => form.setFieldValue("parentBinding", frameBindingValues()),
            }}
          >
            {(field) => (
              <LocalizedSearchableSelectField
                label={t("parentInstance")}
                placeholder={t("parentInstance")}
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                required
                options={instanceOptions(values.childId)}
              />
            )}
          </form.AppField>
          {joint ? (
            <p className="text-sm">
              {t("jointChild", {
                name: assembly.instances.find(({ id }) => id === joint.childInstanceId)?.name ?? "",
              })}
            </p>
          ) : (
            <>
              <form.AppField
                name="creating"
                listeners={{
                  onChange: ({ value }) => {
                    if (value) form.setFieldValue("childBinding", frameBindingValues())
                  },
                }}
              >
                {(field) => <field.CheckboxField label={t("createChild")} />}
              </form.AppField>
              {values.creating ? (
                <>
                  <form.AppField name="definitionId">
                    {(field) => (
                      <LocalizedSearchableSelectField
                        label={t("childDefinition")}
                        placeholder={t("childDefinition")}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        required
                        options={assembly.definitions.map(({ id, name, pinnedModels }, index) => ({
                          value: id,
                          label: name,
                          description: t("choiceSource", {
                            number: index + 1,
                            source:
                              [...new Set(pinnedModels.map(({ snapshot }) => snapshot.name))].join(
                                ", ",
                              ) || name,
                          }),
                          keywords: [id],
                        }))}
                      />
                    )}
                  </form.AppField>
                  <AssemblyNameField form={form} fields={{ name: "name" }} />
                </>
              ) : (
                <form.AppField
                  name="childId"
                  listeners={{
                    onChange: () => form.setFieldValue("childBinding", frameBindingValues()),
                  }}
                >
                  {(field) => (
                    <LocalizedSearchableSelectField
                      label={t(
                        assembly.schemaVersion === 2 ? "existingOccurrence" : "childInstance",
                      )}
                      placeholder={t(
                        assembly.schemaVersion === 2 ? "existingOccurrence" : "childInstance",
                      )}
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      onBlur={field.handleBlur}
                      required
                      options={instanceOptions(values.parentId, true)}
                    />
                  )}
                </form.AppField>
              )}
            </>
          )}
          {assembly.schemaVersion === 2 && (
            <AssemblyFrameBindingFields
              form={form}
              fields="parentBinding"
              prefix="parent"
              assembly={assembly}
              inspection={inspection}
              instanceId={values.parentId}
            />
          )}
          <AssemblyPoseFields form={form} fields="parent" label={t("parentFrame")} />
          {assembly.schemaVersion === 2 && !values.creating && (
            <AssemblyFrameBindingFields
              form={form}
              fields="childBinding"
              prefix="child"
              assembly={assembly}
              inspection={inspection}
              instanceId={values.childId}
            />
          )}
          <AssemblyPoseFields form={form} fields="child" label={t("childFrame")} />
          <JointDriveFields
            key={values.kind}
            form={form}
            fields="drive"
            kind={values.kind}
            general={assembly.schemaVersion === 2}
          />
        </AssemblyTaskForm>
      )}
    </form.Subscribe>
  )
}
