import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyFrameBinding,
  assemblyFrameBindingSchema,
} from "@vibeshape/domain/assembly-mates"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { topoRefSchema } from "@vibeshape/domain/topology"
import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection, TopologyCandidate } from "@vibeshape/protocol"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { AssemblyNumberField, formNumber } from "./assembly-fields"

function frameRecipe(candidate: TopologyCandidate): AssemblyFrameBinding["geometry"] | null {
  const kind = candidate.referenceGeometry?.kind
  if (kind === "plane-face") return "planar-face"
  if (kind === "cylinder-face") return "cylindrical-face"
  if (kind === "sphere-face") return "spherical-face"
  if (kind === "circle-edge" || kind === "arc-edge") return "circular-edge"
  return kind === "vertex" ? "vertex" : null
}
function candidateAxis(candidate: TopologyCandidate): [number, number, number] {
  const geometry = candidate.referenceGeometry
  if (!geometry) return [0, 0, 1]
  switch (geometry.kind) {
    case "cylinder-face":
      return geometry.axis
    case "plane-face":
    case "circle-edge":
    case "arc-edge":
      return geometry.normal
    default:
      return [0, 0, 1]
  }
}
function defaultX(candidate: TopologyCandidate): [number, number, number] {
  const axis = candidateAxis(candidate)
  const index =
    [0, 1, 2].sort((a, b) => Math.abs(axis[a] ?? 0) - Math.abs(axis[b] ?? 0) || a - b)[0] ?? 0
  const direction: [number, number, number] = [0, 0, 0]
  direction[index] = 1
  return direction
}
function currentOccurrence(
  assembly: AssemblyAuthority,
  occurrence: AssemblyInspection["occurrences"][number],
) {
  const instance = assembly.instances.find(({ id }) => id === occurrence.instanceId)
  const definition = assembly.definitions.find(({ id }) => id === instance?.definitionId)
  const pinned = definition?.pinnedModels.find(
    ({ sourceIndex }) => sourceIndex === occurrence.sourceIndex,
  )
  return (
    definition?.id === occurrence.definitionId &&
    definition.pinRevision === occurrence.pinRevision &&
    pinned !== undefined &&
    canonicalJson(pinned.selectedBody) === canonicalJson(occurrence.selectedBody)
  )
}
function bindingOptions(
  assembly: AssemblyAuthority,
  inspection: AssemblyInspection | null | undefined,
  instanceId: string,
) {
  return (
    inspection?.occurrences
      .filter(
        (o) =>
          o.instanceId === instanceId &&
          o.representation === "exact-solid" &&
          currentOccurrence(assembly, o),
      )
      .flatMap((occurrence) =>
        (occurrence.topologyCandidates ?? []).flatMap((candidate) => {
          const geometry = frameRecipe(candidate)
          return geometry
            ? [
                {
                  key: `${occurrence.sourceIndex}:${candidate.candidateId}`,
                  occurrence,
                  candidate,
                  geometry,
                },
              ]
            : []
        }),
      ) ?? []
  )
}
type BindingOption = ReturnType<typeof bindingOptions>[number]
function bindingSourceMatches(binding: AssemblyFrameBinding, option: BindingOption) {
  return (
    option.occurrence.sourceIndex === binding.sourceIndex &&
    option.occurrence.pinRevision === binding.pinRevision &&
    canonicalJson(option.occurrence.selectedBody) === canonicalJson(binding.body) &&
    binding.reference.featureId === option.occurrence.selectedBody.featureId
  )
}
function bindingCandidateMatches(binding: AssemblyFrameBinding, option: BindingOption) {
  return (
    binding.reference.kind === option.candidate.kind &&
    binding.geometry === option.geometry &&
    canonicalJson(option.candidate.signature) === canonicalJson(binding.reference.signature)
  )
}
export function readAssemblyFrameBinding(
  data: FormData,
  prefix: string,
  binding: AssemblyFrameBinding | undefined,
) {
  if (!binding) return undefined
  return assemblyFrameBindingSchema.parse({
    ...binding,
    originHint: ["X", "Y", "Z"].map((axis) => formNumber(data, `${prefix}.binding.origin.${axis}`)),
    xDirection: ["X", "Y", "Z"].map((axis) => formNumber(data, `${prefix}.binding.x.${axis}`)),
    reversed: data.get(`${prefix}.binding.reversed`) === "on",
  })
}
export function AssemblyFrameBindingFields({
  prefix,
  assembly,
  inspection,
  instanceId,
  binding,
  onChange,
}: {
  prefix: string
  assembly: AssemblyAuthority
  inspection?: AssemblyInspection | null | undefined
  instanceId: string
  binding: AssemblyFrameBinding | undefined
  onChange: (binding: AssemblyFrameBinding | undefined) => void
}) {
  const t = useTranslations("app.assembly"),
    options = bindingOptions(assembly, inspection, instanceId)
  const selected = binding
    ? options.find(
        (option) =>
          bindingSourceMatches(binding, option) && bindingCandidateMatches(binding, option),
      )
    : undefined
  const value = binding ? (selected?.key ?? "unresolved") : "explicit"
  return (
    <fieldset className="grid gap-2">
      <SelectField
        label={t(prefix === "parent" ? "parentBinding" : "childBinding")}
        value={value}
        onValueChange={(key) => {
          if (key === "explicit") {
            onChange(undefined)
            return
          }
          const option = options.find((o) => o.key === key)
          if (!option) return
          const definition = assembly.definitions.find(
            (d) => d.id === option.occurrence.definitionId,
          )
          if (!definition) return
          const { candidate } = option
          const reference = topoRefSchema.parse({
            schemaVersion: 0,
            featureId: option.occurrence.selectedBody.featureId,
            kind: candidate.kind,
            ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
            ...(!candidate.semanticRole && candidate.lineageTokens[0]
              ? { lineageToken: candidate.lineageTokens[0] }
              : {}),
            signature: candidate.signature,
          })
          onChange(
            assemblyFrameBindingSchema.parse({
              sourceIndex: option.occurrence.sourceIndex,
              pinRevision: definition.pinRevision,
              body: option.occurrence.selectedBody,
              reference,
              geometry: option.geometry,
              originHint: candidate.signature.centroid,
              xDirection: defaultX(candidate),
              reversed: false,
            }),
          )
        }}
      >
        <SelectOption value="explicit">{t("explicitFrame")}</SelectOption>
        {binding && !selected && (
          <SelectOption value="unresolved">{t("unresolvedBinding")}</SelectOption>
        )}
        {options.map(({ key, candidate, occurrence }) => (
          <SelectOption key={key} value={key}>
            {t("topologyOption", {
              kind: candidate.signature.geometryClass,
              source: occurrence.sourceIndex + 1,
              label:
                candidate.semanticRole ??
                candidate.signature.centroid.map((v) => v.toFixed(2)).join(", "),
            })}
          </SelectOption>
        ))}
      </SelectField>
      {binding && (
        <div key={value} className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t("frameBindingExplanation")}</p>
          <div className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <AssemblyNumberField
                key={axis}
                name={`${prefix}.binding.origin.${axis}`}
                label={t("originHintAxis", { axis })}
                value={binding.originHint[index]}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <AssemblyNumberField
                key={axis}
                name={`${prefix}.binding.x.${axis}`}
                label={t("xDirectionAxis", { axis })}
                value={binding.xDirection[index]}
                min={-1}
                max={1}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              name={`${prefix}.binding.reversed`}
              type="checkbox"
              defaultChecked={binding.reversed}
              className="size-4 accent-primary"
            />
            {t("reverseAxis")}
          </label>
        </div>
      )}
    </fieldset>
  )
}
