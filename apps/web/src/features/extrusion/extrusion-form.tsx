import {
  canonicalJson,
  createAngleQuantity,
  createSketchProfileSet,
  evaluateExpression,
  evaluateVariableDefinitions,
  expectedExtrusionV6DependencyIds,
  expectedExtrusionV8DependencyIds,
  extrusionFeatureParametersSchema,
  extrusionFeatureParametersV4Schema,
  extrusionFeatureParametersV5Schema,
  extrusionFeatureParametersV6Schema,
  extrusionFeatureParametersV7Schema,
  extrusionFeatureParametersV8Schema,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV6,
  extrusionFeatureTypeV7,
  extrusionFeatureTypeV8,
  extrusionOperationSchema,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type LengthQuantity,
  multiProfileExtrusionFeatureParametersSchema,
  multiProfileExtrusionFeatureType,
  readExtrusionFeatureParameters,
  readExtrusionProfileSet,
  type SketchProfileSelector,
  type SketchProfileSet,
  sketchProfileSetSchema,
  type TopoRef,
  type VariableDefinition,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { FeatureMutationResult } from "../../document/document-controller"
import {
  defaultLengthExpression,
  normalizeExpressionWithDisplayUnit,
  positiveDirectManipulationLengthExpression,
  type useDocumentDisplayUnits,
} from "../../document/document-display-units"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import { featureEditPreview } from "../part-design/feature-edit-preview"
import { LengthExpressionField } from "../part-design/length-expression-field"
import {
  parsePrimitiveLengthExpression,
  quantityExpression,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { profileSelectorsEqual } from "../part-design/profile-feature-selection"
import { ReferencePickField } from "../part-design/reference-pick-field"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { VariableExpressionField } from "../variables/variable-expression-field"
import { type ExtrusionTargetOption, extrusionBodyOptionKey } from "./extrusion-body-options"
import type { ExtrusionDistanceRequest } from "./extrusion-distance-manipulator"
import {
  ExtrusionParameterPanel,
  type ExtrusionParameterPanelCopy,
} from "./extrusion-parameter-panel"
import {
  extrusionEndBodyPickCandidates,
  extrusionEndFacePickCandidates,
  extrusionEndFaceSelection,
  extrusionTargetPickCandidates,
} from "./extrusion-reference-picking"

type ExtrusionFormCopy = ExtrusionParameterPanelCopy &
  Readonly<{
    distance: string
    extentInvalidRange: string
    expressionDescription: string
    invalidDimension: string
    invalidExpression: string
    invalidRange: string
    missingProfile: string
    missingTarget: string
    operation: string
    operationAdd: string
    operationIntersect: string
    operationNew: string
    operationRemove: string
    saveFailed: string
    staleRevision: string
    submit: string
    symmetric: string
    symmetricDescription: string
    reversed: string
    secondDirection: string
    secondDistance: string
    target: string
    targetDescription: string
    validationSummary: string
  }>

type ExtrusionFormValues = Readonly<{
  startOffset: string
  draftAngle: string
  advanced: boolean
  multipleSketches: boolean
  endKind: "distance" | "through-all" | "up-to-body" | "up-to-face"
  endTarget: string
  endSourceHash: string
  endFace: string
  distance: string
  extended: boolean
  reversed: boolean
  secondDirection: boolean
  secondDistance: string
  operation: string
  profiles: SketchProfileSet
  supportReferences: readonly TopoRef[]
  symmetric: boolean
  targetFeatureId: string
}>

export type { ExtrusionTargetOption } from "./extrusion-body-options"

function defaultValues(
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  options: readonly ExtrusionTargetOption[],
  profiles: readonly SketchProfileSelector[],
  supportReferences: readonly TopoRef[] | undefined,
): ExtrusionFormValues {
  return {
    startOffset: "0 mm",
    draftAngle: "0 deg",
    advanced: false,
    multipleSketches: false,
    endKind: "distance",
    endTarget: options[0] ? extrusionBodyOptionKey(options[0]) : "",
    endSourceHash: options[0]?.contentHash ?? "",
    endFace: "",
    distance: defaultLengthExpression(10, unit),
    extended: false,
    reversed: false,
    secondDirection: false,
    secondDistance: defaultLengthExpression(5, unit),
    operation: "new",
    profiles: createSketchProfileSet(profiles),
    supportReferences: supportReferences ?? [],
    symmetric: false,
    targetFeatureId: options[0] ? extrusionBodyOptionKey(options[0]) : "",
  }
}

export type ExtrusionFormMode =
  | Readonly<{
      createFeatureId: () => FeatureId
      featureLabel: string
      kind: "create"
      profiles: readonly SketchProfileSelector[]
      supportReferences?: readonly TopoRef[]
    }>
  | Readonly<{
      feature: FeatureRecord
      kind: "edit"
      profiles: readonly SketchProfileSelector[]
      supportReferences?: readonly TopoRef[]
    }>

function profilesSpanSketches(profiles: readonly SketchProfileSelector[]) {
  return profiles.some(({ sketchId }) => sketchId !== profiles[0]?.sketchId)
}

function modeSupportReferences(mode: ExtrusionFormMode): readonly TopoRef[] {
  return mode.supportReferences ?? []
}

function advancedValuesFromParameters(
  parameters: NonNullable<ReturnType<typeof readExtrusionFeatureParameters>>,
) {
  const end = parameters.endCondition
  const condition =
    !end || end.kind === "distance"
      ? { endKind: "distance" as const, endTarget: "", endSourceHash: "", endFace: "" }
      : {
          endKind: end.kind,
          endTarget: extrusionBodyOptionKey({
            id: end.targetBody.featureId,
            outputRole: end.targetBody.outputRole,
          }),
          endSourceHash: end.sourceContentHash,
          endFace: end.kind === "up-to-face" ? JSON.stringify(end.face) : "",
        }
  return {
    ...condition,
    startOffset: parameters.startOffset ? quantityExpression(parameters.startOffset) : "0 mm",
    draftAngle: parameters.draftAngle
      ? (parameters.draftAngle.source.expression ??
        `${parameters.draftAngle.source.value} ${parameters.draftAngle.source.unit}`)
      : "0 deg",
  }
}

function valuesFromFeature(
  feature: FeatureRecord,
  profiles: readonly SketchProfileSelector[],
  supportReferences: readonly TopoRef[] | undefined,
): ExtrusionFormValues {
  const parameters = readExtrusionFeatureParameters(feature)
  if (!parameters) throw new Error("Extrusion parameters are unavailable.")
  return {
    ...advancedValuesFromParameters(parameters),
    advanced: feature.type.schemaVersion >= 6,
    multipleSketches: feature.type.schemaVersion === 8,
    distance: quantityExpression(parameters.distance),
    extended: feature.type.schemaVersion >= 5,
    reversed: parameters.reversed,
    secondDirection: parameters.secondDistance !== null,
    secondDistance: parameters.secondDistance
      ? quantityExpression(parameters.secondDistance)
      : "5 mm",
    operation: parameters.operation,
    profiles: createSketchProfileSet(profiles),
    supportReferences: supportReferences ?? [],
    symmetric: parameters.symmetric,
    targetFeatureId: parameters.targetBody
      ? extrusionBodyOptionKey({
          id: parameters.targetBody.featureId,
          outputRole: parameters.targetBody.outputRole,
        })
      : (feature.dependencies[0] ?? ""),
  }
}

function extrusionRecord(
  mode: ExtrusionFormMode,
  featureId: FeatureId,
  parameters:
    | ReturnType<typeof extrusionFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileExtrusionFeatureParametersSchema.parse>
    | ReturnType<typeof extrusionFeatureParametersV4Schema.parse>
    | ReturnType<typeof extrusionFeatureParametersV5Schema.parse>
    | ReturnType<typeof extrusionFeatureParametersV6Schema.parse>,
  targetFeatureId: FeatureId | null,
  supportReferences: readonly TopoRef[],
) {
  const references = supportReferences
  const dependencies = extrusionDependencies(
    parameters,
    targetFeatureId,
    references,
    mode.kind === "edit" && mode.feature.type.schemaVersion === 8,
  )
  if (mode.kind === "edit") {
    const preserved = preserveExtrusionSchema(mode.feature, parameters)
    return featureRecordSchema.parse({
      ...mode.feature,
      ...preserved,
      dependencies,
      references,
    })
  }
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: extrusionType(parameters),
    parameters,
    dependencies,
    references,
    suppressed: false,
    label: mode.featureLabel,
  })
}

function extrusionDependencies(
  parameters: Parameters<typeof extrusionType>[0],
  targetFeatureId: FeatureId | null,
  references: readonly TopoRef[],
  preserveV8: boolean,
) {
  const supports = references.map(({ featureId }) => featureId)
  if (!("endCondition" in parameters))
    return expectedExtrusionV8DependencyIds(targetFeatureId, supports, null)
  const end =
    parameters.endCondition.kind === "distance"
      ? null
      : parameters.endCondition.targetBody.featureId
  return preserveV8 || profilesSpanSketches(parameters.profiles.profiles)
    ? expectedExtrusionV8DependencyIds(targetFeatureId, supports, end)
    : expectedExtrusionV6DependencyIds(targetFeatureId, supports[0] ?? null, end)
}

function preserveExtrusionSchema(
  feature: FeatureRecord,
  parameters: Parameters<typeof extrusionType>[0],
) {
  if (
    feature.type.schemaVersion === 8 ||
    ("profiles" in parameters && profilesSpanSketches(parameters.profiles.profiles))
  )
    return {
      type: extrusionFeatureTypeV8.type,
      parameters: extrusionFeatureParametersV8Schema.parse(parameters),
    }
  if (
    feature.type.schemaVersion === 7 &&
    "endCondition" in parameters &&
    parameters.endCondition.kind === "up-to-face"
  )
    return {
      type: extrusionFeatureTypeV7.type,
      parameters: extrusionFeatureParametersV7Schema.parse(parameters),
    }
  return preserveLegacyExtrusionSchema(feature, parameters)
}

function preserveLegacyExtrusionSchema(
  feature: FeatureRecord,
  parameters: Parameters<typeof extrusionType>[0],
) {
  const type = extrusionType(parameters)
  if (type.schemaVersion !== 2) return { type, parameters }
  if (feature.type.schemaVersion === 1 && parameters.operation === "new")
    return { type: feature.type, parameters }
  if (feature.type.schemaVersion === 3 || feature.type.schemaVersion === 4) {
    const { profile, ...common } = extrusionFeatureParametersSchema.parse(parameters)
    const schema =
      parameters.operation === "new"
        ? multiProfileExtrusionFeatureParametersSchema
        : extrusionFeatureParametersV4Schema
    const preserved = schema.parse({ ...common, profiles: createSketchProfileSet([profile]) })
    return { type: extrusionType(preserved), parameters: preserved }
  }
  return { type, parameters }
}

function extrusionType(
  parameters:
    | ReturnType<typeof extrusionFeatureParametersSchema.parse>
    | ReturnType<typeof multiProfileExtrusionFeatureParametersSchema.parse>
    | ReturnType<typeof extrusionFeatureParametersV4Schema.parse>
    | ReturnType<typeof extrusionFeatureParametersV5Schema.parse>
    | ReturnType<typeof extrusionFeatureParametersV6Schema.parse>,
) {
  if ("profiles" in parameters && profilesSpanSketches(parameters.profiles.profiles))
    return extrusionFeatureTypeV8.type
  if ("endCondition" in parameters)
    return parameters.endCondition.kind === "up-to-face" &&
      parameters.endCondition.face.signature.geometryClass !== "PLANE"
      ? extrusionFeatureTypeV7.type
      : extrusionFeatureTypeV6.type
  if ("reversed" in parameters) return extrusionFeatureTypeV5.type
  if (!("profiles" in parameters)) return extrusionFeatureType.type
  return parameters.operation === "new"
    ? multiProfileExtrusionFeatureType.type
    : extrusionFeatureTypeV4.type
}

function ExtrusionPreviewSync({
  copy,
  displayUnit,
  angleUnit,
  featureId,
  mode,
  onPreviewChange,
  options,
  values,
  variables,
}: {
  copy: ExtrusionFormCopy
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  angleUnit: ReturnType<typeof useDocumentDisplayUnits>["angle"]
  featureId: FeatureId
  mode: ExtrusionFormMode
  onPreviewChange: (feature: FeatureRecord | null) => void
  options: readonly ExtrusionTargetOption[]
  values: ExtrusionFormValues
  variables: readonly VariableDefinition[]
}) {
  const parsed = parseValues(values, variables, options, copy, displayUnit, angleUnit)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: featureEditPreview(
      mode,
      values,
      mode.kind === "edit"
        ? valuesFromFeature(
            mode.feature,
            readExtrusionProfileSet(mode.feature)?.profiles ?? [],
            modeSupportReferences(mode),
          )
        : null,
      parsed.ok
        ? extrusionRecord(
            mode,
            featureId,
            parsed.parameters,
            parsed.targetFeatureId,
            parsed.supportReferences,
          )
        : null,
    ),
  })
  return null
}

function parseExtrusionDepth(
  expression: string,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  return parsePrimitiveLengthExpression(
    expression,
    variables,
    copy,
    (quantity) => extrusionFeatureParametersSchema.shape.distance.safeParse(quantity).success,
    displayUnit,
  )
}

const independentExtrusionDraftSchema = extrusionFeatureParametersV5Schema.safeExtend({
  profiles: sketchProfileSetSchema,
})

function parseIndependentExtents(
  values: ExtrusionFormValues,
  distance: LengthQuantity,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  const second = values.secondDirection
    ? parseExtrusionDepth(values.secondDistance, variables, copy, displayUnit)
    : null
  if (second && !second.ok)
    return { ok: false as const, issues: { secondDistance: second.message } }
  const parameters = independentExtrusionDraftSchema.safeParse({
    profiles: values.profiles,
    distance,
    symmetric: values.symmetric,
    reversed: values.reversed,
    secondDistance: second?.ok ? second.quantity : null,
    operation: values.operation,
  })
  return parameters.success
    ? { ok: true as const, parameters: parameters.data }
    : { ok: false as const, issues: { distance: copy.extentInvalidRange } }
}

function parseAdvancedQuantities(
  values: ExtrusionFormValues,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  angleUnit: ReturnType<typeof useDocumentDisplayUnits>["angle"],
) {
  const offset = parsePrimitiveLengthExpression(
    values.startOffset,
    variables,
    copy,
    () => true,
    unit,
  )
  if (!offset.ok) return { ok: false as const, issues: { startOffset: offset.message } }
  const evaluatedVariables = evaluateVariableDefinitions(variables)
  const expression = normalizeExpressionWithDisplayUnit(values.draftAngle, angleUnit)
  const angle = evaluatedVariables.ok
    ? evaluateExpression(expression, evaluatedVariables.valuesByName)
    : null
  if (!angle?.ok || angle.value.dimension !== "angle")
    return { ok: false as const, issues: { draftAngle: copy.invalidExpression } }
  return {
    ok: true as const,
    value: {
      startOffset: offset.quantity,
      draftAngle: createAngleQuantity(angle.value.value, "rad", expression),
    },
  }
}
function parseExtrusionEnd(
  values: ExtrusionFormValues,
  options: readonly ExtrusionTargetOption[],
  copy: ExtrusionFormCopy,
) {
  if (values.endKind === "distance")
    return { ok: true as const, value: { kind: "distance" as const } }
  const target = options.find((item) => extrusionBodyOptionKey(item) === values.endTarget)
  if (!target?.outputRole || target.contentHash !== values.endSourceHash || !target.contentHash)
    return { ok: false as const, issues: { endTarget: copy.missingTarget } }
  const base = {
    kind: values.endKind,
    targetBody: { schemaVersion: 0, featureId: target.id, outputRole: target.outputRole },
    sourceContentHash: target.contentHash,
  }
  if (values.endKind !== "up-to-face")
    return { ok: true as const, value: { ...base, kind: values.endKind } }
  const face = target.faces?.find((item) => JSON.stringify(item.reference) === values.endFace)
  return face
    ? { ok: true as const, value: { ...base, kind: "up-to-face" as const, face: face.reference } }
    : { ok: false as const, issues: { endTarget: copy.missingTarget } }
}
function needsAdvancedExtents(
  values: ExtrusionFormValues,
  target: ExtrusionTargetOption | undefined,
) {
  return (
    values.advanced ||
    profilesSpanSketches(values.profiles.profiles) ||
    values.endKind !== "distance" ||
    values.startOffset !== "0 mm" ||
    values.draftAngle !== "0 deg" ||
    (values.operation !== "new" && target?.outputRole !== undefined)
  )
}
function parseBasicExtents(
  values: ExtrusionFormValues,
  distance: LengthQuantity,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
) {
  return values.extended || values.reversed || values.secondDirection
    ? parseIndependentExtents(values, distance, variables, copy, unit)
    : { ok: true as const, parameters: legacyExtrusionParameters(values, distance) }
}

function parseAdvancedExtents(
  values: ExtrusionFormValues,
  distance: LengthQuantity,
  variables: readonly VariableDefinition[],
  copy: ExtrusionFormCopy,
  unit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  options: readonly ExtrusionTargetOption[],
  target: ExtrusionTargetOption | undefined,
  angleUnit: ReturnType<typeof useDocumentDisplayUnits>["angle"],
) {
  const targetBody = advancedTargetBody(values.operation, target, copy)
  if (!targetBody.ok) return targetBody
  const basic = parseIndependentExtents(values, distance, variables, copy, unit)
  if (!basic.ok) return basic
  const quantities = parseAdvancedQuantities(values, variables, copy, unit, angleUnit)
  if (!quantities.ok) return quantities
  const end = parseExtrusionEnd(values, options, copy)
  if (!end.ok) return end
  const schema = advancedExtrusionDraftSchema(values, end.value)
  const parsed = schema.safeParse({
    ...basic.parameters,
    targetBody: targetBody.value,
    ...quantities.value,
    endCondition: end.value,
  })
  return parsed.success
    ? { ok: true as const, parameters: parsed.data }
    : { ok: false as const, issues: { distance: copy.extentInvalidRange } }
}

function advancedExtrusionDraftSchema(
  values: ExtrusionFormValues,
  end: Extract<ReturnType<typeof parseExtrusionEnd>, { ok: true }>["value"],
) {
  if (profilesSpanSketches(values.profiles.profiles) || values.multipleSketches)
    return extrusionFeatureParametersV8Schema
  return end.kind === "up-to-face" && end.face.signature.geometryClass !== "PLANE"
    ? extrusionFeatureParametersV7Schema
    : extrusionFeatureParametersV6Schema
}

function advancedTargetBody(
  operation: string,
  target: ExtrusionTargetOption | undefined,
  copy: ExtrusionFormCopy,
) {
  if (operation === "new") return { ok: true as const, value: null }
  if (!target?.outputRole)
    return { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
  return {
    ok: true as const,
    value: {
      schemaVersion: 0,
      featureId: target.id,
      outputRole: target.outputRole,
    },
  }
}

function legacyExtrusionParameters(values: ExtrusionFormValues, distance: LengthQuantity) {
  const common = { distance, symmetric: values.symmetric, operation: values.operation }
  if (values.profiles.profiles.length === 1)
    return extrusionFeatureParametersSchema.parse({
      ...common,
      profile: values.profiles.profiles[0],
    })
  const schema =
    values.operation === "new"
      ? multiProfileExtrusionFeatureParametersSchema
      : extrusionFeatureParametersV4Schema
  return schema.parse({ ...common, profiles: values.profiles })
}

function parseValues(
  values: ExtrusionFormValues,
  variables: readonly VariableDefinition[],
  options: readonly ExtrusionTargetOption[],
  copy: ExtrusionFormCopy,
  displayUnit: ReturnType<typeof useDocumentDisplayUnits>["length"],
  angleUnit: ReturnType<typeof useDocumentDisplayUnits>["angle"],
) {
  if (!values.profiles.profiles[0])
    return { ok: false as const, issues: { profiles: copy.missingProfile } }
  const distance = parseExtrusionDepth(values.distance, variables, copy, displayUnit)
  if (!distance.ok) return { ok: false as const, issues: { distance: distance.message } }
  const operation = extrusionOperationSchema.parse(values.operation)
  const target = parseTarget(values.targetFeatureId, operation, options, copy)
  if (!target.ok) return target
  const parsed = needsAdvancedExtents(values, target.option)
    ? parseAdvancedExtents(
        values,
        distance.quantity,
        variables,
        copy,
        displayUnit,
        options,
        target.option,
        angleUnit,
      )
    : parseBasicExtents(values, distance.quantity, variables, copy, displayUnit)
  if (!parsed.ok) return parsed
  return {
    ok: true as const,
    targetFeatureId: target.featureId,
    supportReferences: values.supportReferences,
    parameters: parsed.parameters,
  }
}

function parseTarget(
  rawTargetFeatureId: string,
  operation: ReturnType<typeof extrusionOperationSchema.parse>,
  options: readonly ExtrusionTargetOption[],
  copy: ExtrusionFormCopy,
) {
  if (operation === "new") return { ok: true as const, featureId: null, option: undefined }
  const option = options.find((item) => extrusionBodyOptionKey(item) === rawTargetFeatureId)
  return option
    ? { ok: true as const, featureId: option.id, option }
    : { ok: false as const, issues: { targetFeatureId: copy.missingTarget } }
}

function ExtrusionProfileSelectionSync({
  onChange,
  profiles,
  supportReferences,
}: Readonly<{
  onChange: (
    profiles: readonly SketchProfileSelector[],
    supportReferences: readonly TopoRef[],
  ) => void
  profiles: readonly SketchProfileSelector[]
  supportReferences: readonly TopoRef[]
}>) {
  useLayoutEffect(
    () => onChange(profiles, supportReferences),
    [onChange, profiles, supportReferences],
  )
  return null
}

export type ExtrusionFormProps = Readonly<{
  baseRevision: number
  copy: ExtrusionFormCopy
  disabled?: boolean | undefined
  distanceRequest?: ExtrusionDistanceRequest | null | undefined
  mode: ExtrusionFormMode
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  options: readonly ExtrusionTargetOption[]
  profileLabel: string
  profileLabels?: readonly string[] | undefined
  onProfileRemove?: ((index: number) => void) | undefined
  onProfilesClear?: (() => void) | undefined
  onProfileSelectionRequest?: (() => void) | undefined
  previewStatus?: FeaturePreviewState["status"] | undefined
  variables: readonly VariableDefinition[]
}>

function useExtrusionFormController(props: ExtrusionFormProps) {
  const {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } = useParameterFormState(props.variables)
  const [featureId] = useState(() =>
    props.mode.kind === "edit" ? props.mode.feature.id : props.mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues:
      props.mode.kind === "edit"
        ? valuesFromFeature(
            props.mode.feature,
            props.mode.profiles,
            modeSupportReferences(props.mode),
          )
        : defaultValues(
            displayUnits.length,
            props.options,
            props.mode.profiles,
            modeSupportReferences(props.mode),
          ),
    onSubmit: async ({ value }) => {
      const parsed = parseValues(
        value,
        props.variables,
        props.options,
        props.copy,
        displayUnits.length,
        displayUnits.angle,
      )
      if (!parsed.ok) {
        setIssues(parsed.issues)
        setMessage(
          "profiles" in parsed.issues ? parsed.issues.profiles : props.copy.validationSummary,
        )
        const invalidFieldName =
          "distance" in parsed.issues
            ? "distance"
            : "secondDistance" in parsed.issues
              ? "secondDistance"
              : "targetFeatureId" in parsed.issues
                ? "targetFeatureId"
                : null
        if (invalidFieldName) {
          formElementRef.current
            ?.querySelector<HTMLElement>(`[name="${invalidFieldName}"]`)
            ?.focus()
        }
        return
      }
      setIssues({})
      setMessage(null)
      await submitFeatureMutation({
        baseRevision: props.baseRevision,
        copy: props.copy,
        feature: extrusionRecord(
          props.mode,
          featureId,
          parsed.parameters,
          parsed.targetFeatureId,
          parsed.supportReferences,
        ),
        onSave: props.onSave,
        onSaved: props.onSaved,
        setMessage,
      })
    },
  })
  useEffect(() => {
    if (props.disabled || !props.distanceRequest || props.distanceRequest.featureId !== featureId) {
      return
    }
    if (props.distanceRequest.side === "second" && !form.getFieldValue("secondDirection")) return
    clearSubmissionErrors()
    form.setFieldValue(
      props.distanceRequest.side === "second" ? "secondDistance" : "distance",
      positiveDirectManipulationLengthExpression(
        props.distanceRequest.distance,
        displayUnits.length,
      ),
    )
  }, [
    clearSubmissionErrors,
    displayUnits.length,
    featureId,
    form,
    props.disabled,
    props.distanceRequest,
  ])
  const applyProfileSelection = useCallback(
    (profiles: readonly SketchProfileSelector[], supportReferences: readonly TopoRef[]) => {
      const nextProfiles = createSketchProfileSet(profiles)
      const currentProfiles = form.getFieldValue("profiles")
      const matches =
        currentProfiles.profiles.length === nextProfiles.profiles.length &&
        currentProfiles.profiles.every((profile, index) =>
          profileSelectorsEqual(profile, nextProfiles.profiles[index] ?? null),
        )
      if (!matches) {
        form.setFieldValue("profiles", nextProfiles)
      }
      if (
        canonicalJson(form.getFieldValue("supportReferences")) !== canonicalJson(supportReferences)
      ) {
        form.setFieldValue("supportReferences", supportReferences)
      }
    },
    [form],
  )
  return {
    ...props,
    applyProfileSelection,
    clearSubmissionErrors,
    disabled: props.disabled ?? false,
    displayUnits,
    featureId,
    form,
    formElementRef,
    issues,
    message,
    suggestions,
  } as const
}

type ExtrusionFormController = ReturnType<typeof useExtrusionFormController>

function ExtrusionPreviewField({ controller }: { controller: ExtrusionFormController }) {
  const { form, onPreviewChange } = controller
  if (!onPreviewChange) return null
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <ExtrusionPreviewSync
          copy={controller.copy}
          displayUnit={controller.displayUnits.length}
          angleUnit={controller.displayUnits.angle}
          featureId={controller.featureId}
          mode={controller.mode}
          onPreviewChange={onPreviewChange}
          options={controller.options}
          values={values}
          variables={controller.variables}
        />
      )}
    </form.Subscribe>
  )
}

function ExtrusionOperationField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Field name="operation">
      {(field) => (
        <SelectField
          name={field.name}
          value={field.state.value}
          label={controller.copy.operation}
          disabled={controller.disabled}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            controller.clearSubmissionErrors()
            field.handleChange(value)
          }}
        >
          <SelectOption value="new">{controller.copy.operationNew}</SelectOption>
          <SelectOption value="add">{controller.copy.operationAdd}</SelectOption>
          <SelectOption value="remove">{controller.copy.operationRemove}</SelectOption>
          <SelectOption value="intersect">{controller.copy.operationIntersect}</SelectOption>
        </SelectField>
      )}
    </form.Field>
  )
}

function ExtrusionTargetField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values.operation}>
      {(operation) =>
        operation === "new" ? null : (
          <form.Field name="targetFeatureId">
            {(field) => (
              <ReferencePickField
                id="extrusion-target-body"
                name={field.name}
                value={field.state.value}
                label={controller.copy.target}
                placeholder={controller.copy.missingTarget}
                options={controller.options.map((option) => ({
                  value: extrusionBodyOptionKey(option),
                  label: option.label,
                }))}
                candidates={extrusionTargetPickCandidates(controller.options)}
                description={controller.copy.targetDescription}
                error={controller.issues.targetFeatureId}
                disabled={controller.disabled}
                required
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  controller.clearSubmissionErrors()
                  field.handleChange(value)
                }}
              />
            )}
          </form.Field>
        )
      }
    </form.Subscribe>
  )
}

function ExtrusionDistanceField({
  controller,
  second = false,
}: {
  controller: ExtrusionFormController
  second?: boolean
}) {
  const { form } = controller
  return (
    <form.Field name={second ? "secondDistance" : "distance"}>
      {(field) => (
        <LengthExpressionField
          id={second ? "extrusion-second-distance" : "extrusion-distance"}
          name={field.name}
          value={field.state.value}
          label={second ? controller.copy.secondDistance : controller.copy.distance}
          description={controller.copy.expressionDescription}
          error={controller.issues[second ? "secondDistance" : "distance"]}
          suggestions={controller.suggestions}
          onBlur={field.handleBlur}
          onValueChange={(value) => {
            controller.clearSubmissionErrors()
            field.handleChange(value)
          }}
        />
      )}
    </form.Field>
  )
}

function ExtrusionSymmetricField({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <form.Field name="symmetric">
      {(field) => (
        <BooleanParameterField
          name={field.name}
          checked={field.state.value}
          label={controller.copy.symmetric}
          onBlur={field.handleBlur}
          onChange={(event) => {
            controller.clearSubmissionErrors()
            field.handleChange(event.currentTarget.checked)
            if (event.currentTarget.checked) {
              form.setFieldValue("secondDirection", false)
              form.setFieldValue("reversed", false)
            }
          }}
        />
      )}
    </form.Field>
  )
}

function ExtrusionExtentFields({ controller }: { controller: ExtrusionFormController }) {
  const { form, copy } = controller
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{copy.symmetricDescription}</p>
      <form.Subscribe selector={(state) => state.values.symmetric}>
        {(symmetric) => (
          <form.Field name="reversed">
            {(field) => (
              <BooleanParameterField
                name={field.name}
                checked={field.state.value}
                label={copy.reversed}
                disabled={symmetric || controller.disabled}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  controller.clearSubmissionErrors()
                  field.handleChange(event.currentTarget.checked)
                }}
              />
            )}
          </form.Field>
        )}
      </form.Subscribe>
      <form.Field name="secondDirection">
        {(field) => (
          <BooleanParameterField
            name={field.name}
            checked={field.state.value}
            label={copy.secondDirection}
            onBlur={field.handleBlur}
            onChange={(event) => {
              controller.clearSubmissionErrors()
              field.handleChange(event.currentTarget.checked)
              if (event.currentTarget.checked) form.setFieldValue("symmetric", false)
            }}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.secondDirection}>
        {(enabled) => (enabled ? <ExtrusionDistanceField controller={controller} second /> : null)}
      </form.Subscribe>
    </div>
  )
}

function ExtrusionEndReferenceFields({
  controller,
  values,
}: {
  controller: ExtrusionFormController
  values: ExtrusionFormValues
}) {
  const t = useTranslations("app.extrusionExtent")
  const { form } = controller
  if (values.endKind === "distance") return null
  const target = controller.options.find(
    (option) => extrusionBodyOptionKey(option) === values.endTarget,
  )
  return (
    <>
      <ReferencePickField
        id="extrusion-end-body"
        name="endTarget"
        label={t("endBody")}
        value={values.endTarget}
        placeholder={t("chooseBody")}
        error={controller.issues.endTarget}
        disabled={controller.disabled}
        options={controller.options
          .filter((option) => option.outputRole && option.contentHash)
          .map((option) => ({ value: extrusionBodyOptionKey(option), label: option.label }))}
        candidates={extrusionEndBodyPickCandidates(controller.options)}
        onValueChange={(value) => {
          controller.clearSubmissionErrors()
          const option = controller.options.find((item) => extrusionBodyOptionKey(item) === value)
          form.setFieldValue("endTarget", value)
          form.setFieldValue("endSourceHash", option?.contentHash ?? "")
          form.setFieldValue("endFace", "")
        }}
      />
      {values.endKind === "up-to-face" ? (
        <ReferencePickField
          id="extrusion-end-face"
          name="endFace"
          label={t("endFace")}
          value={values.endFace}
          placeholder={t("chooseFace")}
          description={t("finiteFaceCoverage")}
          disabled={controller.disabled}
          options={
            target?.faces?.map((face) => ({
              value: JSON.stringify(face.reference),
              label: face.label,
            })) ?? []
          }
          candidates={extrusionEndFacePickCandidates(controller.options)}
          onValueChange={(value) => {
            controller.clearSubmissionErrors()
            if (!value) {
              form.setFieldValue("endFace", "")
              return
            }
            const selection = extrusionEndFaceSelection(controller.options, value)
            if (!selection) return
            form.setFieldValue("endTarget", selection.endTarget)
            form.setFieldValue("endSourceHash", selection.endSourceHash)
            form.setFieldValue("endFace", selection.endFace)
          }}
        />
      ) : null}
    </>
  )
}

function ExtrusionAdvancedFields({ controller }: { controller: ExtrusionFormController }) {
  const t = useTranslations("app.extrusionExtent")
  const { form } = controller
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => {
        return (
          <div className="grid gap-3 pt-3">
            <NativeSelectField
              id="extrusion-end-condition"
              name="endKind"
              label={t("condition")}
              value={values.endKind}
              disabled={controller.disabled}
              onChange={(event) => {
                controller.clearSubmissionErrors()
                form.setFieldValue("advanced", true)
                form.setFieldValue(
                  "endKind",
                  event.currentTarget.value as ExtrusionFormValues["endKind"],
                )
                form.setFieldValue("symmetric", false)
                form.setFieldValue("secondDirection", false)
              }}
            >
              <option value="distance">{t("distance")}</option>
              <option value="through-all">{t("throughAll")}</option>
              <option value="up-to-body">{t("upToBody")}</option>
              <option value="up-to-face">{t("upToFace")}</option>
            </NativeSelectField>
            <ExtrusionEndReferenceFields controller={controller} values={values} />
            <LengthExpressionField
              id="extrusion-start-offset"
              name="startOffset"
              label={t("startOffset")}
              value={values.startOffset}
              suggestions={controller.suggestions}
              description={controller.copy.expressionDescription}
              error={controller.issues.startOffset}
              onValueChange={(value) => {
                controller.clearSubmissionErrors()
                form.setFieldValue("startOffset", value)
              }}
            />
            <VariableExpressionField
              id="extrusion-draft-angle"
              name="draftAngle"
              label={t("draftAngle")}
              value={values.draftAngle}
              suggestions={controller.suggestions}
              description={t("draftDescription")}
              error={controller.issues.draftAngle}
              onValueChange={(value) => {
                controller.clearSubmissionErrors()
                form.setFieldValue("draftAngle", value)
              }}
            />
          </div>
        )
      }}
    </form.Subscribe>
  )
}

function ExtrusionFormView({ controller }: { controller: ExtrusionFormController }) {
  const { form } = controller
  return (
    <Form
      ref={controller.formElementRef}
      form={form}
      aria-label={controller.copy.title}
      className="gap-0"
    >
      <ExtrusionProfileSelectionSync
        profiles={controller.mode.profiles}
        supportReferences={modeSupportReferences(controller.mode)}
        onChange={controller.applyProfileSelection}
      />
      <ExtrusionPreviewField controller={controller} />
      <ExtrusionParameterPanel
        actions={
          <TaskPanelFormActions
            acceptLabel={controller.copy.submit}
            ariaLabel={controller.copy.title}
            cancelLabel={controller.copy.cancel}
            disabled={controller.disabled}
            onCancel={controller.onCancel}
            previewStatus={controller.previewStatus}
          />
        }
        copy={controller.copy}
        disabled={controller.disabled}
        message={controller.message}
        profileLabels={controller.profileLabels ?? [controller.profileLabel]}
        onProfileSelectionRequest={controller.onProfileSelectionRequest}
        onProfileRemove={controller.onProfileRemove}
        onProfilesClear={controller.onProfilesClear}
        operationField={<ExtrusionOperationField controller={controller} />}
        targetField={<ExtrusionTargetField controller={controller} />}
        distanceField={<ExtrusionDistanceField controller={controller} />}
        symmetricField={<ExtrusionSymmetricField controller={controller} />}
        extentFields={
          <>
            <ExtrusionExtentFields controller={controller} />
            <ExtrusionAdvancedFields controller={controller} />
          </>
        }
      />
    </Form>
  )
}

export function ExtrusionForm(props: ExtrusionFormProps) {
  const controller = useExtrusionFormController(props)
  return <ExtrusionFormView controller={controller} />
}
