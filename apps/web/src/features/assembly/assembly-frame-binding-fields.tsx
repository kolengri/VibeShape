import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import {
  type AssemblyFrameBinding,
  assemblyFrameBindingSchema,
} from "@vibeshape/domain/assembly-mates"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { topoRefSchema } from "@vibeshape/domain/topology"
import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection, TopologyCandidate } from "@vibeshape/protocol"
import { withFieldGroup } from "@vibeshape/ui/integrations/tanstack-form"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { AssemblyNumberField, formNumber, numberFieldValidators } from "./assembly-fields"

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
export function frameBindingValues(binding?: AssemblyFrameBinding) {
  return {
    reference: binding,
    origin: {
      X: String(binding?.originHint[0] ?? 0),
      Y: String(binding?.originHint[1] ?? 0),
      Z: String(binding?.originHint[2] ?? 0),
    },
    x: {
      X: String(binding?.xDirection[0] ?? 1),
      Y: String(binding?.xDirection[1] ?? 0),
      Z: String(binding?.xDirection[2] ?? 0),
    },
    reversed: binding?.reversed ?? false,
  }
}
export function readAssemblyFrameBinding(values: ReturnType<typeof frameBindingValues>) {
  if (!values.reference) return undefined
  return assemblyFrameBindingSchema.parse({
    ...values.reference,
    originHint: [
      formNumber(values.origin.X),
      formNumber(values.origin.Y),
      formNumber(values.origin.Z),
    ],
    xDirection: [formNumber(values.x.X), formNumber(values.x.Y), formNumber(values.x.Z)],
    reversed: values.reversed,
  })
}
function optionBinding(assembly: AssemblyAuthority, option: BindingOption) {
  const { candidate, occurrence } = option
  const definition = assembly.definitions.find((d) => d.id === occurrence.definitionId)
  if (!definition) return undefined
  return assemblyFrameBindingSchema.parse({
    sourceIndex: occurrence.sourceIndex,
    pinRevision: definition.pinRevision,
    body: occurrence.selectedBody,
    reference: topoRefSchema.parse({
      schemaVersion: 0,
      featureId: occurrence.selectedBody.featureId,
      kind: candidate.kind,
      ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
      ...(!candidate.semanticRole && candidate.lineageTokens[0]
        ? { lineageToken: candidate.lineageTokens[0] }
        : {}),
      signature: candidate.signature,
    }),
    geometry: option.geometry,
    originHint: candidate.signature.centroid,
    xDirection: defaultX(candidate),
    reversed: false,
  })
}
function bindingSelection(binding: AssemblyFrameBinding | undefined, options: BindingOption[]) {
  if (!binding) return { value: "explicit", unresolved: false }
  const selected = options.find(
    (option) => bindingSourceMatches(binding, option) && bindingCandidateMatches(binding, option),
  )
  return { value: selected ? selected.key : "unresolved", unresolved: !selected }
}
export const AssemblyFrameBindingFields = withFieldGroup({
  defaultValues: frameBindingValues(),
  props: {} as {
    prefix: "parent" | "child"
    assembly: AssemblyAuthority
    inspection?: AssemblyInspection | null | undefined
    instanceId: string
  },
  render: function AssemblyFrameBindingFields({ group, prefix, assembly, inspection, instanceId }) {
    const t = useTranslations("app.assembly")
    const options = bindingOptions(assembly, inspection, instanceId)
    const label = t(prefix === "parent" ? "parentBinding" : "childBinding")
    return (
      <fieldset className="grid gap-2">
        <group.AppField name="reference">
          {(field) => {
            const binding = field.state.value
            const selection = bindingSelection(binding, options)
            return (
              <LocalizedSearchableSelectField
                label={label}
                description={binding ? t("frameBindingExplanation") : undefined}
                placeholder={label}
                value={selection.value}
                onBlur={field.handleBlur}
                onValueChange={(key) => {
                  const option = options.find((option) => option.key === key)
                  if (key !== "explicit" && !option) return
                  const next = frameBindingValues(
                    option ? optionBinding(assembly, option) : undefined,
                  )
                  field.handleChange(next.reference)
                  group.setFieldValue("origin", next.origin)
                  group.setFieldValue("x", next.x)
                  group.setFieldValue("reversed", next.reversed)
                }}
                options={[
                  { value: "explicit", label: t("explicitFrame") },
                  ...(selection.unresolved
                    ? [{ value: "unresolved", label: t("unresolvedBinding"), disabled: true }]
                    : []),
                  ...options.map(({ key, candidate, occurrence }) => ({
                    value: key,
                    label: t("topologyOption", {
                      kind: candidate.signature.geometryClass,
                      source: occurrence.sourceIndex + 1,
                      label:
                        candidate.semanticRole ??
                        candidate.signature.centroid.map((v) => v.toFixed(2)).join(", "),
                    }),
                    description:
                      assembly.definitions.find(
                        (definition) => definition.id === occurrence.definitionId,
                      )?.name ?? occurrence.definitionId,
                  })),
                ]}
              />
            )
          }}
        </group.AppField>
        <group.Subscribe selector={(state) => state.values.reference}>
          {(binding) =>
            binding && (
              <div className="grid gap-2">
                {(["origin", "x"] as const).map((kind) => (
                  <div key={kind} className="grid gap-2">
                    {(["X", "Y", "Z"] as const).map((axis) => (
                      <group.AppField
                        key={axis}
                        name={`${kind}.${axis}`}
                        validators={numberFieldValidators(
                          t("invalidParameters"),
                          kind === "x" ? -1 : -100_000,
                          kind === "x" ? 1 : 100_000,
                        )}
                      >
                        {() => (
                          <AssemblyNumberField
                            label={t(kind === "origin" ? "originHintAxis" : "xDirectionAxis", {
                              axis,
                            })}
                            min={kind === "x" ? -1 : -100_000}
                            max={kind === "x" ? 1 : 100_000}
                          />
                        )}
                      </group.AppField>
                    ))}
                  </div>
                ))}
                <group.AppField name="reversed">
                  {(field) => <field.CheckboxField label={t("reverseAxis")} />}
                </group.AppField>
              </div>
            )
          }
        </group.Subscribe>
      </fieldset>
    )
  },
})
