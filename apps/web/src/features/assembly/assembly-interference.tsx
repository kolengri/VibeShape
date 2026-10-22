import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import type { AssemblyInstanceRecord as AssemblyInstance } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import { allAssemblyInterferencePairs } from "./assembly-model"

type Pair = { leftInstanceId: string; rightInstanceId: string }
function selectedPair(
  instances: readonly AssemblyInstance[],
  selectedId: string | null,
  otherId: string,
) {
  const selected = instances.find(({ id }) => id === selectedId)
  const other = instances.find(({ id }) => id === otherId && id !== selectedId)
  if (!selected || !other) return null
  return { leftInstanceId: selected.id, rightInstanceId: other.id }
}
const resultCopy = {
  clear: "interferenceClear",
  interference: "interferenceFound",
  "unsupported-mesh": "meshInterferenceUnsupported",
} as const
function InterferenceResults({
  assembly,
  inspection,
}: {
  assembly: AssemblyAuthority
  inspection: AssemblyInspection | null
}) {
  const t = useTranslations("app.assembly")
  const name = (id: string) => assembly.instances.find((instance) => instance.id === id)?.name ?? id
  return (
    <div role="status" className="grid gap-2">
      {inspection?.interference.map((pair) => (
        <p key={`${pair.leftInstanceId}:${pair.rightInstanceId}`} className="text-xs">
          {t(resultCopy[pair.status], {
            left: name(pair.leftInstanceId),
            right: name(pair.rightInstanceId),
            volume: pair.volume,
          })}
        </p>
      ))}
    </div>
  )
}
function allInspectionAvailable(count: number) {
  return count >= 2 && count <= 32
}
export function AssemblyInterference({
  assembly,
  inspection,
  selectedId,
  pending,
  onInspect,
}: {
  assembly: AssemblyAuthority
  inspection: AssemblyInspection | null
  selectedId: string | null
  pending: boolean
  onInspect: (pairs: readonly Pair[]) => Promise<void>
}) {
  const t = useTranslations("app.assembly")
  const [otherId, setOtherId] = useState("")
  const pair = selectedPair(assembly.instances, selectedId, otherId)
  const compareId = pair ? pair.rightInstanceId : ""
  const allAvailable = allInspectionAvailable(assembly.instances.length)
  return (
    <section className="grid gap-3 border-t pt-3" aria-label={t("interference")}>
      <h3 className="text-xs font-medium">{t("interference")}</h3>
      <SelectField
        label={t("compareWith")}
        value={compareId}
        onValueChange={setOtherId}
        disabled={pending}
      >
        {assembly.instances
          .filter(({ id }) => id !== selectedId)
          .map(({ id, name }) => (
            <SelectOption key={id} value={id}>
              {name}
            </SelectOption>
          ))}
      </SelectField>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !pair}
          aria-busy={pending}
          onClick={() => (pair ? onInspect([pair]) : undefined)}
        >
          {t("inspectPair")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !allAvailable}
          aria-busy={pending}
          onClick={() => onInspect(allAssemblyInterferencePairs(assembly.instances))}
        >
          {t("inspectAll")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("inspectionScope")}</p>
      <InterferenceResults assembly={assembly} inspection={inspection} />
    </section>
  )
}
