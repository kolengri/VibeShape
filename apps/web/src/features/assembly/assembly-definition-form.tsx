import { assemblyDefinitionSchema } from "@vibeshape/domain/assembly"
import type { PinnedAssemblyDefinition } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { SelectOption } from "@vibeshape/ui/components/select-field"
import { AssemblyNameField, AssemblyPoseFields, formPose, poseFieldValues } from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm, useAssemblyForm } from "./assembly-forms"
import { type AssemblyPartSource, createAssemblyDefinitionChanges } from "./assembly-model"

type Props = {
  mode: "create" | "metadata" | "relink"
  definition?: PinnedAssemblyDefinition
  sources: readonly AssemblyPartSource[]
  selectedPartId: string | null
  actions: AssemblyFormActions
}
function initialSourceId(sources: readonly AssemblyPartSource[], selectedPartId: string | null) {
  return selectedPartId ?? sources[0]?.source.partId ?? ""
}
function SourceDefinitionForm({
  definition,
  sources,
  selectedPartId,
  actions,
}: Omit<Props, "mode">) {
  const t = useTranslations("app.assembly")
  const sourceId = initialSourceId(sources, selectedPartId)
  const selected = sources.find(({ source }) => source.partId === sourceId)
  const form = useAssemblyForm({
    defaultValues: { name: definition?.name ?? selected?.name ?? t("defaultDefinition"), sourceId },
    actions,
    build: ({ name, sourceId }) => {
      const selected = sources.find(({ source }) => source.partId === sourceId)
      if (!selected) throw new Error("Select an available source Part.")
      return definition
        ? [
            {
              kind: "definition.relink",
              definition: assemblyDefinitionSchema.parse({
                schemaVersion: 1,
                id: definition.id,
                name,
                sources: [selected.source],
                sourceFrame: definition.sourceFrame,
              }),
            },
          ]
        : createAssemblyDefinitionChanges(selected, name, t("defaultInstance", { name }))
    },
  })
  return (
    <AssemblyTaskForm form={form} actions={actions}>
      <AssemblyNameField form={form} fields={{ name: "name" }} />
      <form.AppField
        name="sourceId"
        validators={{
          onChange: ({ value }) =>
            sources.some(({ source }) => source.partId === value)
              ? undefined
              : t("invalidParameters"),
        }}
      >
        {(field) => (
          <field.SelectField
            label={t("sourcePart")}
            description={definition ? undefined : t("frozenExplanation")}
            required
          >
            {sources.map(({ name, source }) => (
              <SelectOption key={source.partId} value={source.partId}>
                {name}
              </SelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      {definition && (
        <>
          <p className="text-xs text-muted-foreground">{t("relinkExplanation")}</p>
          <p className="text-xs text-muted-foreground">
            {t("pinRevision", { revision: definition.pinRevision })}
          </p>
        </>
      )}
    </AssemblyTaskForm>
  )
}
function DefinitionMetadataForm({
  definition,
  actions,
}: {
  definition: PinnedAssemblyDefinition
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const form = useAssemblyForm({
    defaultValues: { name: definition.name, source: poseFieldValues(definition.sourceFrame) },
    actions,
    build: (values) => [
      {
        kind: "definition.update",
        definitionId: definition.id,
        name: values.name,
        sourceFrame: formPose(values.source, definition.sourceFrame),
      },
    ],
  })
  return (
    <AssemblyTaskForm form={form} actions={actions}>
      <AssemblyNameField form={form} fields={{ name: "name" }} />
      <AssemblyPoseFields
        form={form}
        fields="source"
        label={t("sourceFrame")}
        description={t("frozenExplanation")}
      />
      <p className="text-xs text-muted-foreground">
        {t("pinRevision", { revision: definition.pinRevision })}
      </p>
    </AssemblyTaskForm>
  )
}
export function AssemblyDefinitionForm(props: Props) {
  if (props.mode === "create")
    return (
      <SourceDefinitionForm
        key="create"
        sources={props.sources}
        selectedPartId={props.selectedPartId}
        actions={props.actions}
      />
    )
  if (!props.definition) return null
  return props.mode === "metadata" ? (
    <DefinitionMetadataForm definition={props.definition} actions={props.actions} />
  ) : (
    <SourceDefinitionForm key="relink" {...props} />
  )
}
