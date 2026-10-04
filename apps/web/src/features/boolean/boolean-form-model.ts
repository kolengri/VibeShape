import {
  booleanFeatureParametersSchema,
  booleanFeatureType,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  booleanBodyDependencyIds,
  booleanFeatureParametersV2Schema,
  booleanFeatureTypeV2,
  readBooleanFeatureParametersV2,
} from "@vibeshape/domain/part-design-subtract"
import { exactBodyOptionId } from "../part-design/exact-body-options"

export type BooleanInputOption = Readonly<{ id: string; label: string; body?: BodyReference }>
export type BooleanFormMode =
  | Readonly<{ kind: "create"; createFeatureId: () => FeatureId; featureLabel: string }>
  | Readonly<{ kind: "edit"; feature: FeatureRecord }>
export type BooleanFormValues = Readonly<{
  targetFeatureId: string
  toolFeatureId: string
  keepTools: boolean
}>
type InputField = "targetFeatureId" | "toolFeatureId"
function selectedId(
  featureId: string | undefined,
  body: BodyReference | undefined,
  options: readonly BooleanInputOption[],
) {
  if (body) return exactBodyOptionId(body)
  return (
    options.find(
      (option) => option.body?.featureId === featureId && option.body?.outputRole === "result",
    )?.id ??
    featureId ??
    ""
  )
}
export function defaultBooleanValues(
  mode: BooleanFormMode,
  options: readonly BooleanInputOption[],
): BooleanFormValues {
  if (mode.kind === "create")
    return {
      targetFeatureId: options[0]?.id ?? "",
      toolFeatureId: options[1]?.id ?? "",
      keepTools: false,
    }
  const parameters = readBooleanFeatureParametersV2(mode.feature)
  return {
    targetFeatureId: selectedId(mode.feature.dependencies[0], parameters?.targetBody, options),
    toolFeatureId: selectedId(mode.feature.dependencies[1], parameters?.toolBody, options),
    keepTools:
      parameters?.keepTools ??
      booleanFeatureParametersSchema.safeParse(mode.feature.parameters).data?.keepTools ??
      false,
  }
}
export function parseBooleanValues(
  values: BooleanFormValues,
  options: readonly BooleanInputOption[],
  copy: { missingInput: string; sameInput: string },
) {
  const target = options.find(({ id }) => id === values.targetFeatureId)
  const tool = options.find(({ id }) => id === values.toolFeatureId)
  const issues: Partial<Record<InputField, string>> = {}
  if (!target) issues.targetFeatureId = copy.missingInput
  if (!tool || Boolean(target?.body) !== Boolean(tool.body))
    issues.toolFeatureId = copy.missingInput
  if (target && tool && target.id === tool.id) issues.toolFeatureId = copy.sameInput
  if (target && tool && Object.keys(issues).length === 0) return { ok: true as const, target, tool }
  return { ok: false as const, issues }
}
export function booleanFeatureRecord(
  mode: BooleanFormMode,
  featureId: FeatureId,
  target: BooleanInputOption,
  tool: BooleanInputOption,
  keepTools: boolean,
) {
  const exact = target.body && tool.body
  const parameters = exact
    ? booleanFeatureParametersV2Schema.parse({
        operation: "subtract",
        targetBody: target.body,
        toolBody: tool.body,
        ...(keepTools ? { keepTools: true } : {}),
      })
    : booleanFeatureParametersSchema.parse({
        operation: "subtract",
        ...(keepTools ? { keepTools: true } : {}),
      })
  const dependencies = exact
    ? booleanBodyDependencyIds([target.body as BodyReference, tool.body as BodyReference])
    : [target.id, tool.id]
  return featureRecordSchema.parse({
    ...(mode.kind === "edit"
      ? mode.feature
      : { schemaVersion: 0, id: featureId, suppressed: false, label: mode.featureLabel }),
    type: exact ? booleanFeatureTypeV2.type : booleanFeatureType.type,
    parameters,
    dependencies,
    references: [],
  })
}
