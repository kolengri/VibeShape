import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useId, useState } from "react"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import {
  type AssemblyPoseCapture,
  asBuiltJointChanges,
  rigidGroupChanges,
} from "./assembly-as-built"
import { type AssemblyFormActions, AssemblyTaskForm } from "./assembly-forms"

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
function InstanceChoice({
  assembly,
  label,
  value,
  onChange,
  exclude,
}: {
  assembly: AssemblyAuthority
  label: string
  value: string
  onChange: (value: string) => void
  exclude?: string
}) {
  return (
    <NativeSelectField
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      required
    >
      {assembly.instances
        .filter(({ id }) => id !== exclude)
        .map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
    </NativeSelectField>
  )
}
export function AssemblyAsBuiltJointForm({ assembly, capture, selectedId, actions }: Props) {
  const t = useTranslations("app.assembly")
  const [parentId, setParentId] = useState(() => initialAnchor(assembly, selectedId))
  const [childId, setChildId] = useState(
    () => assembly.instances.find(({ id }) => id !== parentId)?.id ?? "",
  )
  const [kind, setKind] = useState<AssemblyJointRecord["kind"]>("fixed")
  const kinds: readonly AssemblyJointRecord["kind"][] =
    assembly.schemaVersion === 1
      ? ["fixed", "revolute", "prismatic"]
      : ["fixed", "revolute", "prismatic", "cylindrical", "ball"]
  return (
    <AssemblyTaskForm
      actions={actions}
      canApply={Boolean(parentId && childId && parentId !== childId)}
      invalidMessage={t("asBuiltInvalid")}
      build={() =>
        asBuiltJointChanges(assembly, capture, { parentId, childId, kind }, browserAuthoredUuid)
      }
    >
      <p className="text-sm text-muted-foreground">{t("asBuiltDescription")}</p>
      <InstanceChoice
        assembly={assembly}
        label={t("parentInstance")}
        value={parentId}
        onChange={(value) => {
          setParentId(value)
          if (value === childId)
            setChildId(assembly.instances.find(({ id }) => id !== value)?.id ?? "")
        }}
      />
      <InstanceChoice
        assembly={assembly}
        label={t("asBuiltChild")}
        value={childId}
        onChange={setChildId}
        exclude={parentId}
      />
      <NativeSelectField
        label={t("jointKind")}
        value={kind}
        onChange={(event) => {
          const value = kinds.find((value) => value === event.currentTarget.value)
          if (value) setKind(value)
        }}
      >
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {t(kind)}
          </option>
        ))}
      </NativeSelectField>
      <p className="text-xs text-muted-foreground">{t("capturedPlacement")}</p>
    </AssemblyTaskForm>
  )
}
export function AssemblyRigidGroupForm({ assembly, capture, selectedId, actions }: Props) {
  const t = useTranslations("app.assembly")
  const [anchorId, setAnchorId] = useState(() => initialAnchor(assembly, selectedId))
  const [members, setMembers] = useState(
    () => new Set([anchorId, ...(selectedId ? [selectedId] : [])]),
  )
  const id = useId()
  return (
    <AssemblyTaskForm
      actions={actions}
      canApply={members.size >= 2}
      invalidMessage={t("rigidGroupMinimum")}
      build={() =>
        rigidGroupChanges(assembly, capture, anchorId, [...members], browserAuthoredUuid)
      }
    >
      <p className="text-sm text-muted-foreground">{t("rigidGroupDescription")}</p>
      <InstanceChoice
        assembly={assembly}
        label={t("rigidGroupAnchor")}
        value={anchorId}
        onChange={(value) => {
          setAnchorId(value)
          setMembers((previous) => new Set([...previous, value]))
        }}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t("rigidGroupMembers")}</legend>
        {assembly.instances.map((instance) => (
          <Field key={instance.id} orientation="horizontal">
            <input
              id={`${id}-${instance.id}`}
              type="checkbox"
              className="size-4 accent-primary"
              checked={members.has(instance.id)}
              disabled={instance.id === anchorId}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setMembers((previous) => {
                  const next = new Set(previous)
                  if (checked) next.add(instance.id)
                  else next.delete(instance.id)
                  return next
                })
              }}
            />
            <FieldLabel htmlFor={`${id}-${instance.id}`}>{instance.name}</FieldLabel>
          </Field>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t("capturedPlacement")}</p>
    </AssemblyTaskForm>
  )
}
