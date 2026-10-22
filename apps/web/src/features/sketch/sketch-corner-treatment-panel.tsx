import {
  createLengthQuantity,
  type DocumentDisplayUnits,
  evaluateExpression,
  evaluateVariableDefinitions,
  type SketchEntityId,
  type SketchPoint2,
  type SketchRecord,
  type VariableDefinition,
} from "@vibeshape/domain"
import { type SketchCornerTreatment, treatSketchCorner } from "@vibeshape/domain/sketch-corner-edit"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import {
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
} from "../../document/document-controller"
import {
  normalizeExpressionWithDisplayUnit,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"

function cornerLength(
  source: string,
  variables: readonly VariableDefinition[],
  unit: DocumentDisplayUnits["length"],
) {
  const expression = normalizeExpressionWithDisplayUnit(source, unit)
  const evaluated = evaluateVariableDefinitions(variables)
  if (!evaluated.ok) return null
  const result = evaluateExpression(expression, evaluated.valuesByName)
  return result.ok && result.value.dimension === "length" && result.value.value > 0
    ? createLengthQuantity(result.value.value, "mm", expression)
    : null
}
function previewCorner(
  draft: SketchRecord,
  treatment: SketchCornerTreatment | null,
  solvedPoints: ReadonlyMap<string, SketchPoint2>,
) {
  if (!treatment) return null
  try {
    return treatSketchCorner(draft, {
      treatment,
      solvedPoints,
      createEntityId: createBrowserSketchEntityId,
      createConstraintId: createBrowserSketchConstraintId,
    }).sketch
  } catch {
    return null
  }
}
function CornerPreview({
  sketch,
  source,
  label,
}: {
  sketch: SketchRecord
  source: SketchRecord
  label: string
}) {
  const points = new Map(
    sketch.entities.flatMap((entity) =>
      entity.type === "point" ? [[entity.id, entity] as const] : [],
    ),
  )
  const ids = new Set(source.entities.map(({ id }) => id))
  const added = sketch.entities.filter((entity) => !ids.has(entity.id) && !entity.construction)
  const bounds = added.flatMap((entity) => (entity.type === "point" ? [[entity.x, entity.y]] : []))
  const minX = Math.min(...bounds.map(([x]) => x ?? 0)),
    minY = Math.min(...bounds.map(([, y]) => y ?? 0))
  const span = Math.max(
    1,
    ...bounds.map(([x]) => (x ?? 0) - minX),
    ...bounds.map(([, y]) => (y ?? 0) - minY),
  )
  return (
    <svg
      aria-label={label}
      role="img"
      viewBox={`${minX - span / 3} ${-minY - (span * 4) / 3} ${(span * 5) / 3} ${(span * 5) / 3}`}
      className="h-32 w-full rounded border bg-viewport-background text-primary"
    >
      <g transform="scale(1 -1)" fill="none" stroke="currentColor" strokeWidth={span / 60}>
        {sketch.entities.flatMap((entity) => {
          if (entity.type !== "line" && entity.type !== "arc") return []
          const start = points.get(entity.startPointId),
            end = points.get(entity.endPointId)
          if (!start || !end) return []
          if (entity.type === "line")
            return [
              <line
                key={entity.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                strokeDasharray={entity.construction ? span / 15 : undefined}
                opacity={entity.construction ? 0.35 : 1}
              />,
            ]
          const center = points.get(entity.centerPointId)
          if (!center) return []
          const radius = Math.hypot(start.x - center.x, start.y - center.y)
          return [
            <path
              key={entity.id}
              d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`}
            />,
          ]
        })}
      </g>
    </svg>
  )
}
function cornerTreatment(
  kind: "fillet" | "chamfer",
  selected: readonly SketchEntityId[],
  first: ReturnType<typeof cornerLength>,
  second: ReturnType<typeof cornerLength>,
): SketchCornerTreatment | null {
  const [firstLineId, secondLineId] = selected
  if (selected.length !== 2 || !firstLineId || !secondLineId || !first) return null
  if (kind === "fillet") return { kind, firstLineId, secondLineId, radius: first }
  return second
    ? { kind, firstLineId, secondLineId, firstDistance: first, secondDistance: second }
    : null
}
export function SketchCornerTreatmentPanel({
  draft,
  kind,
  selectedEntityIds,
  solvedPoints,
  variables,
  onApply,
  onCancel,
}: {
  draft: SketchRecord
  kind: "fillet" | "chamfer"
  selectedEntityIds: readonly SketchEntityId[]
  solvedPoints: ReadonlyMap<string, SketchPoint2>
  variables: readonly VariableDefinition[]
  onApply: (sketch: SketchRecord) => void
  onCancel: () => void
}) {
  const t = useTranslations("app.sketch.cornerTreatment")
  const displayUnits = useDocumentDisplayUnits()
  const getPreview = (values: { first: string; second: string }) =>
    previewCorner(
      draft,
      cornerTreatment(
        kind,
        selectedEntityIds,
        cornerLength(values.first, variables, displayUnits.length),
        cornerLength(values.second, variables, displayUnits.length),
      ),
      solvedPoints,
    )
  const validate = (values: { first: string; second: string }) => {
    const fields: Partial<Record<"first" | "second", string>> = {}
    if (!cornerLength(values.first, variables, displayUnits.length)) fields.first = t("invalid")
    if (kind === "chamfer" && !cornerLength(values.second, variables, displayUnits.length))
      fields.second = t("invalid")
    return Object.keys(fields).length ? { fields } : undefined
  }
  const form = useAppForm({
    defaultValues: { first: "2 mm", second: "2 mm" },
    validators: {
      onChange: ({ value, formApi }) =>
        formApi.state.submissionAttempts > 0 ? validate(value) : undefined,
      onSubmit: ({ value }) => validate(value),
    },
    onSubmit: ({ value }) => {
      const preview = getPreview(value)
      if (preview) onApply(preview)
    },
  })
  return (
    <Form
      form={form}
      aria-label={t(kind)}
      className="absolute bottom-3 right-3 z-10 grid w-80 max-w-[calc(100%-1.5rem)] gap-3 rounded border bg-background/95 p-3 shadow-md"
    >
      <p className="text-xs text-muted-foreground">{t("select")}</p>
      <form.AppField name="first">
        {(field) => (
          <field.TextField
            id="sketch-corner-first"
            label={t(kind === "fillet" ? "radius" : "firstDistance")}
            required
          />
        )}
      </form.AppField>
      {kind === "chamfer" && (
        <form.AppField name="second">
          {(field) => (
            <field.TextField id="sketch-corner-second" label={t("secondDistance")} required />
          )}
        </form.AppField>
      )}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const preview = getPreview(values)
          return (
            <>
              {preview ? (
                <CornerPreview sketch={preview} source={draft} label={t("preview")} />
              ) : (
                <p className="text-xs text-muted-foreground" role="status">
                  {t("invalid")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                  {t("cancel")}
                </Button>
                <form.SubmitButton size="sm" requireDirty={false} disabled={!preview}>
                  {t("apply")}
                </form.SubmitButton>
              </div>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
