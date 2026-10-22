import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyInstanceRecord as AssemblyInstance,
  assemblyInstanceRecordSchema,
} from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { AssemblyNameField, AssemblyPoseFields, formPose, poseFieldValues } from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm, useAssemblyForm } from "./assembly-forms"
import { newAssemblyInstance } from "./assembly-model"

function ExistingInstanceForm({
  instance,
  actions,
}: {
  instance: AssemblyInstance
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const pose = instance.grounded
    ? instance.worldFrame
    : instance.schemaVersion === 2
      ? instance.initialFrame
      : undefined
  const form = useAssemblyForm({
    defaultValues: { name: instance.name, pose: poseFieldValues(pose) },
    actions,
    build: (values) => [
      {
        kind: "instance.update",
        instance: assemblyInstanceRecordSchema.parse({
          ...instance,
          name: values.name,
          ...(instance.grounded
            ? { worldFrame: formPose(values.pose, instance.worldFrame) }
            : instance.schemaVersion === 2
              ? { initialFrame: formPose(values.pose, instance.initialFrame) }
              : {}),
        }),
      },
    ],
  })
  return (
    <AssemblyTaskForm form={form} actions={actions}>
      <AssemblyNameField form={form} fields={{ name: "name" }} />
      {pose ? (
        <AssemblyPoseFields
          form={form}
          fields="pose"
          label={t(instance.grounded ? "worldFrame" : "initialFrame")}
          description={instance.grounded ? undefined : t("generalFreePoseExplanation")}
        />
      ) : (
        <div className="flex items-center gap-1 text-sm font-medium">
          {t("worldFrame")}
          <FieldHelp label={t("worldFrame")}>{t("attachedPoseExplanation")}</FieldHelp>
        </div>
      )}
    </AssemblyTaskForm>
  )
}
function NewInstanceForm({
  assembly,
  actions,
}: {
  assembly: AssemblyAuthority
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const initialDefinition = assembly.definitions[0]
  const form = useAssemblyForm({
    defaultValues: {
      name: t("defaultInstance", { name: initialDefinition?.name ?? t("defaultDefinition") }),
      definitionId: initialDefinition?.id ?? "",
      world: poseFieldValues(),
    },
    actions,
    build: (values) => {
      const definition = assembly.definitions.find(({ id }) => id === values.definitionId)
      if (!definition) throw new Error("Select an assembly definition.")
      return [
        {
          kind: "instance.create",
          instance: newAssemblyInstance(
            definition,
            values.name,
            formPose(values.world),
            undefined,
            assembly.schemaVersion,
          ),
        },
      ]
    },
  })
  return (
    <AssemblyTaskForm form={form} actions={actions}>
      <AssemblyNameField form={form} fields={{ name: "name" }} />
      <form.AppField name="definitionId">
        {(field) => (
          <LocalizedSearchableSelectField
            label={t("definition")}
            placeholder={t("definition")}
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
                  [...new Set(pinnedModels.map(({ snapshot }) => snapshot.name))].join(", ") ||
                  name,
              }),
              keywords: [id],
            }))}
          />
        )}
      </form.AppField>
      <AssemblyPoseFields form={form} fields="world" label={t("worldFrame")} />
    </AssemblyTaskForm>
  )
}
export function AssemblyInstanceForm({
  assembly,
  instance,
  actions,
}: {
  assembly: AssemblyAuthority
  instance?: AssemblyInstance
  actions: AssemblyFormActions
}) {
  return instance ? (
    <ExistingInstanceForm instance={instance} actions={actions} />
  ) : (
    <NewInstanceForm assembly={assembly} actions={actions} />
  )
}
