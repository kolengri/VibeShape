import { assemblyDefinitionSchema } from "@vibeshape/domain/assembly"
import type {
  AssemblyMutation,
  PinnedAssemblyDefinition,
} from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import { AssemblyNameField, AssemblyPoseFields, formPose } from "./assembly-fields"
import { type AssemblyFormActions, AssemblyTaskForm } from "./assembly-forms"
import { type AssemblyPartSource, createAssemblyDefinitionChanges } from "./assembly-model"

type Props = {
  mode: "create" | "metadata" | "relink"
  definition?: PinnedAssemblyDefinition
  sources: readonly AssemblyPartSource[]
  selectedPartId: string | null
  actions: AssemblyFormActions
}
function SourceField({
  sources,
  value,
  onChange,
  description,
}: {
  sources: readonly AssemblyPartSource[]
  value: string
  onChange: (value: string) => void
  description?: string
}) {
  const t = useTranslations("app.assembly")
  return (
    <SelectField
      label={t("sourcePart")}
      description={description}
      value={value}
      onValueChange={onChange}
      required
    >
      {sources.map(({ name, source }) => (
        <SelectOption key={source.partId} value={source.partId}>
          {name}
        </SelectOption>
      ))}
    </SelectField>
  )
}
function initialSourceId(sources: readonly AssemblyPartSource[], selectedPartId: string | null) {
  if (selectedPartId) return selectedPartId
  const first = sources[0]
  return first ? first.source.partId : ""
}
function CreateDefinitionForm({
  sources,
  selectedPartId,
  actions,
}: Omit<Props, "mode" | "definition">) {
  const t = useTranslations("app.assembly")
  const [sourceId, setSourceId] = useState(initialSourceId(sources, selectedPartId))
  const selected = sources.find(({ source }) => source.partId === sourceId)
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) => {
        if (!selected) throw new Error("Select an available source Part.")
        const name = String(data.get("name"))
        return createAssemblyDefinitionChanges(selected, name, t("defaultInstance", { name }))
      }}
    >
      <AssemblyNameField value={selected?.name ?? t("defaultDefinition")} />
      <SourceField
        sources={sources}
        value={sourceId}
        onChange={setSourceId}
        description={t("frozenExplanation")}
      />
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
  return (
    <AssemblyTaskForm
      actions={actions}
      build={(data) => [
        {
          kind: "definition.update",
          definitionId: definition.id,
          name: String(data.get("name")),
          sourceFrame: formPose(data, "source", definition.sourceFrame),
        },
      ]}
    >
      <AssemblyNameField value={definition.name} />
      <AssemblyPoseFields
        prefix="source"
        label={t("sourceFrame")}
        pose={definition.sourceFrame}
        description={t("frozenExplanation")}
      />
      <p className="text-xs text-muted-foreground">
        {t("pinRevision", { revision: definition.pinRevision })}
      </p>
    </AssemblyTaskForm>
  )
}
function RelinkDefinitionForm({
  definition,
  sources,
  selectedPartId,
  actions,
}: Omit<Props, "mode" | "definition"> & { definition: PinnedAssemblyDefinition }) {
  const t = useTranslations("app.assembly")
  const [sourceId, setSourceId] = useState(initialSourceId(sources, selectedPartId))
  const build = (data: FormData): readonly AssemblyMutation[] => {
    const selected = sources.find(({ source }) => source.partId === sourceId)
    if (!selected) throw new Error("Select an available source Part.")
    return [
      {
        kind: "definition.relink",
        definition: assemblyDefinitionSchema.parse({
          schemaVersion: 1,
          id: definition.id,
          name: String(data.get("name")),
          sources: [selected.source],
          sourceFrame: definition.sourceFrame,
        }),
      },
    ]
  }
  return (
    <AssemblyTaskForm actions={actions} build={build}>
      <AssemblyNameField value={definition.name} />
      <SourceField sources={sources} value={sourceId} onChange={setSourceId} />
      <p className="text-xs text-muted-foreground">{t("relinkExplanation")}</p>
      <p className="text-xs text-muted-foreground">
        {t("pinRevision", { revision: definition.pinRevision })}
      </p>
    </AssemblyTaskForm>
  )
}
export function AssemblyDefinitionForm(props: Props) {
  if (props.mode === "create") return <CreateDefinitionForm {...props} />
  const definition = props.definition
  if (!definition) return null
  return props.mode === "metadata" ? (
    <DefinitionMetadataForm definition={definition} actions={props.actions} />
  ) : (
    <RelinkDefinitionForm {...props} definition={definition} />
  )
}
