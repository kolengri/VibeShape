import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyInstanceRecord as AssemblyInstance,
  assemblyInstanceRecordSchema as assemblyInstanceSchema,
} from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { AssemblyNameField, AssemblyPoseFields, formPose } from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm } from "./assembly-forms"
import { newAssemblyInstance } from "./assembly-model"

function updatedInstance(data: FormData, instance: AssemblyInstance) {
  const fields = { ...instance, name: String(data.get("name")) }
  if (!instance.grounded)
    return assemblyInstanceSchema.parse(
      instance.schemaVersion === 2
        ? {
            ...fields,
            initialFrame: formPose(data, "initial", instance.initialFrame),
          }
        : fields,
    )
  return assemblyInstanceSchema.parse({
    ...fields,
    worldFrame: formPose(data, "world", instance.worldFrame),
  })
}
function InstancePoseFields({ instance }: { instance: AssemblyInstance }) {
  const t = useTranslations("app.assembly")
  return instance.grounded ? (
    <AssemblyPoseFields prefix="world" label={t("worldFrame")} pose={instance.worldFrame} />
  ) : instance.schemaVersion === 2 ? (
    <>
      <p className="text-xs text-muted-foreground">{t("generalFreePoseExplanation")}</p>
      <AssemblyPoseFields prefix="initial" label={t("initialFrame")} pose={instance.initialFrame} />
    </>
  ) : (
    <p className="text-xs text-muted-foreground">{t("attachedPoseExplanation")}</p>
  )
}
function ExistingInstanceForm({
  instance,
  actions,
}: {
  instance: AssemblyInstance
  actions: AssemblyFormActions
}) {
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) => [{ kind: "instance.update", instance: updatedInstance(data, instance) }]}
    >
      <AssemblyNameField value={instance.name} />
      <InstancePoseFields instance={instance} />
    </AssemblyTaskForm>
  )
}
function firstDefinitionId(assembly: AssemblyAuthority) {
  const first = assembly.definitions[0]
  return first ? first.id : ""
}
function NewInstanceForm({
  assembly,
  actions,
}: {
  assembly: AssemblyAuthority
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const [definitionId, setDefinitionId] = useState<string>(firstDefinitionId(assembly))
  const definition = assembly.definitions.find(({ id }) => id === definitionId)
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) => {
        if (!definition) throw new Error("Select an assembly definition.")
        return [
          {
            kind: "instance.create",
            instance: newAssemblyInstance(
              definition,
              String(data.get("name")),
              formPose(data, "world"),
              undefined,
              assembly.schemaVersion,
            ),
          },
        ]
      }}
    >
      <AssemblyNameField
        value={t("defaultInstance", { name: definition?.name ?? t("defaultDefinition") })}
      />
      <LocalizedSearchableSelectField
        label={t("definition")}
        placeholder={t("definition")}
        value={definitionId}
        onValueChange={setDefinitionId}
        required
        options={assembly.definitions.map(({ id, name, pinnedModels }, index) => ({
          value: id,
          label: name,
          description: t("choiceSource", {
            number: index + 1,
            source:
              [...new Set(pinnedModels.map(({ snapshot }) => snapshot.name))].join(", ") || name,
          }),
          keywords: [id],
        }))}
      />
      <AssemblyPoseFields prefix="world" label={t("worldFrame")} />
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
