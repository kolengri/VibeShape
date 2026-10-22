import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import {
  type AssemblyPoseCapture,
  asBuiltJointChanges,
  rigidGroupChanges,
} from "./assembly-as-built"
import { type AssemblyFormActions, AssemblyTaskForm, useAssemblyForm } from "./assembly-forms"

type Props = {
  assembly: AssemblyAuthority
  capture: AssemblyPoseCapture
  selectedId: string | null
  actions: AssemblyFormActions
}
function initialAnchor(assembly: AssemblyAuthority, selectedId: string | null) {
  const selected = assembly.instances.find(({ id }) => id === selectedId)
  return (
    (selected?.grounded ? selected.id : assembly.instances.find(({ grounded }) => grounded)?.id) ??
    selected?.id ??
    assembly.instances[0]?.id ??
    ""
  )
}
export function AssemblyAsBuiltJointForm({ assembly, capture, selectedId, actions }: Props) {
  const t = useTranslations("app.assembly")
  const parentId = initialAnchor(assembly, selectedId)
  const kinds: readonly AssemblyJointRecord["kind"][] =
    assembly.schemaVersion === 1
      ? ["fixed", "revolute", "prismatic"]
      : ["fixed", "revolute", "prismatic", "cylindrical", "ball"]
  const form = useAssemblyForm({
    defaultValues: {
      parentId,
      childId: assembly.instances.find(({ id }) => id !== parentId)?.id ?? "",
      kind: "fixed" as AssemblyJointRecord["kind"],
    },
    actions,
    invalidMessage: t("asBuiltInvalid"),
    build: (values) => asBuiltJointChanges(assembly, capture, values, browserAuthoredUuid),
  })
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <AssemblyTaskForm
          form={form}
          actions={actions}
          canApply={Boolean(
            values.parentId && values.childId && values.parentId !== values.childId,
          )}
        >
          <form.AppField
            name="parentId"
            listeners={{
              onChange: ({ value }) => {
                if (value === form.getFieldValue("childId"))
                  form.setFieldValue(
                    "childId",
                    assembly.instances.find(({ id }) => id !== value)?.id ?? "",
                  )
              },
            }}
          >
            {(field) => (
              <field.NativeSelectField
                label={t("parentInstance")}
                description={t("asBuiltDescription")}
                required
              >
                {assembly.instances.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </field.NativeSelectField>
            )}
          </form.AppField>
          <form.AppField name="childId">
            {(field) => (
              <field.NativeSelectField label={t("asBuiltChild")} required>
                {assembly.instances
                  .filter(({ id }) => id !== values.parentId)
                  .map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </field.NativeSelectField>
            )}
          </form.AppField>
          <form.AppField name="kind">
            {(field) => (
              <field.NativeSelectField label={t("jointKind")}>
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(kind)}
                  </option>
                ))}
              </field.NativeSelectField>
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">{t("capturedPlacement")}</p>
        </AssemblyTaskForm>
      )}
    </form.Subscribe>
  )
}
export function AssemblyRigidGroupForm({ assembly, capture, selectedId, actions }: Props) {
  const t = useTranslations("app.assembly")
  const anchorId = initialAnchor(assembly, selectedId)
  const form = useAssemblyForm({
    defaultValues: {
      anchorId,
      members: assembly.instances.map(({ id }) => ({
        id,
        selected: id === anchorId || id === selectedId,
      })),
    },
    actions,
    invalidMessage: t("rigidGroupMinimum"),
    build: ({ anchorId, members }) =>
      rigidGroupChanges(
        assembly,
        capture,
        anchorId,
        members.filter(({ selected }) => selected).map(({ id }) => id),
        browserAuthoredUuid,
      ),
  })
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <AssemblyTaskForm
          form={form}
          actions={actions}
          canApply={values.members.filter(({ selected }) => selected).length >= 2}
        >
          <form.AppField
            name="anchorId"
            listeners={{
              onChange: ({ value }) => {
                const index = form.getFieldValue("members").findIndex(({ id }) => id === value)
                if (index >= 0) form.setFieldValue(`members[${index}].selected`, true)
              },
            }}
          >
            {(field) => (
              <field.NativeSelectField
                label={t("rigidGroupAnchor")}
                description={t("rigidGroupDescription")}
                required
              >
                {assembly.instances.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </field.NativeSelectField>
            )}
          </form.AppField>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium">{t("rigidGroupMembers")}</legend>
            {assembly.instances.map((instance, index) => (
              <form.AppField key={instance.id} name={`members[${index}].selected`}>
                {(field) => (
                  <field.CheckboxField
                    label={instance.name}
                    disabled={instance.id === values.anchorId}
                  />
                )}
              </form.AppField>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">{t("capturedPlacement")}</p>
        </AssemblyTaskForm>
      )}
    </form.Subscribe>
  )
}
