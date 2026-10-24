import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import {
  type CompoundSlotId,
  compoundSlotIdSchema,
  type PartId,
} from "@vibeshape/domain/identifiers"
import { Button } from "@vibeshape/ui/components/button"
import { FieldError } from "@vibeshape/ui/components/field"
import { ArrowDown, ArrowUp, X } from "@vibeshape/ui/components/icons"
import { Form, validationMessage } from "@vibeshape/ui/integrations/tanstack-form"
import { useId, useState } from "react"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import type { FeatureMutationResult } from "../../document/document-controller"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import { submitFeatureMutation } from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import {
  type BodyCombinationInput,
  type BodyCombinationMode,
  bodyCombinationFeature,
  moveCombinationInput,
  selectedCombinationInputs,
} from "./body-combination-model"

export type BodyCombinationCopy = ParameterPanelCopy & {
  parameters: string
  submit: string
  selectionRules: string
  invalidSelection: string
  staleRevision: string
  saveFailed: string
  selectedParts: string
  availableParts: string
  emptySelection: string
  selectPart: (name: string) => string
  removePart: (name: string) => string
  moveUp: (name: string) => string
  moveDown: (name: string) => string
  survivor: (name: string) => string
}
type SelectionProps = {
  options: readonly BodyCombinationInput[]
  selected: readonly PartId[]
  onChange: (ids: PartId[]) => void
  copy: BodyCombinationCopy
  error?: string | undefined
}
function OrderedCombinationInput({
  input,
  index,
  ...props
}: SelectionProps & { input: BodyCombinationInput; index: number }) {
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md border p-2">
      <span className="min-w-0 flex-1 break-words text-xs">
        {index + 1}. {input.name}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={props.copy.moveUp(input.name)}
        disabled={index === 0}
        onClick={() => props.onChange(moveCombinationInput(props.selected, index, -1))}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={props.copy.moveDown(input.name)}
        disabled={index === props.selected.length - 1}
        onClick={() => props.onChange(moveCombinationInput(props.selected, index, 1))}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={props.copy.removePart(input.name)}
        onClick={() => props.onChange(props.selected.filter((id) => id !== input.partId))}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  )
}
function BodyCombinationInputs(props: SelectionProps) {
  const id = useId()
  const rulesId = `${id}-rules`
  const errorId = `${id}-error`
  const selectedInputs = props.selected.flatMap((id) =>
    props.options.filter(({ partId }) => partId === id),
  )
  const bodies = new Set(selectedInputs.map(({ body }) => `${body.featureId}:${body.outputRole}`))
  const available = props.options.filter(({ partId }) => !props.selected.includes(partId))
  return (
    <>
      <p id={rulesId} className="text-xs text-muted-foreground">
        {props.copy.selectionRules}
      </p>
      <ol aria-label={props.copy.selectedParts} className="grid gap-2">
        {selectedInputs.map((input, index) => (
          <OrderedCombinationInput {...props} key={input.partId} input={input} index={index} />
        ))}
      </ol>
      {!selectedInputs.length && (
        <p className="text-xs text-muted-foreground">{props.copy.emptySelection}</p>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium">{props.copy.availableParts}</legend>
        {available.map((input) => (
          <Button
            key={input.partId}
            type="button"
            size="content"
            variant="outline"
            className="justify-start text-left"
            aria-label={props.copy.selectPart(input.name)}
            aria-describedby={props.error ? `${rulesId} ${errorId}` : rulesId}
            aria-invalid={Boolean(props.error) || undefined}
            disabled={
              props.selected.length >= 8 ||
              bodies.has(`${input.body.featureId}:${input.body.outputRole}`)
            }
            onClick={() => props.onChange([...props.selected, input.partId])}
          >
            {input.name}
          </Button>
        ))}
      </fieldset>
      {props.error && <FieldError id={errorId}>{props.error}</FieldError>}
    </>
  )
}
function CombinationPreview({
  selected,
  options,
  mode,
  featureId,
  slots,
  onPreviewChange,
}: {
  selected: readonly PartId[]
  options: readonly BodyCombinationInput[]
  mode: BodyCombinationMode
  featureId: FeatureId
  slots: ReadonlyMap<PartId, CompoundSlotId>
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  const inputs = selectedCombinationInputs(selected, options)
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: inputs ? bodyCombinationFeature(mode, featureId, inputs, slots) : null,
  })
  return null
}
export function BodyCombinationForm({
  baseRevision,
  copy,
  disabled,
  mode,
  options,
  onCancel,
  onSave,
  onSaved,
  onPreviewChange,
  previewStatus,
}: {
  baseRevision: number
  copy: BodyCombinationCopy
  disabled: boolean
  mode: BodyCombinationMode
  options: readonly BodyCombinationInput[]
  onCancel: () => void
  onSave: (baseRevision: number, feature: FeatureRecord) => Promise<FeatureMutationResult>
  onSaved: () => void
  onPreviewChange: (feature: FeatureRecord | null) => void
  previewStatus: FeaturePreviewState["status"]
}) {
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const [slots] = useState(
    () =>
      new Map(
        mode.operation === "compound"
          ? options.map(
              (input) =>
                [
                  input.partId,
                  input.slotId ?? compoundSlotIdSchema.parse(browserAuthoredUuid()),
                ] as const,
            )
          : [],
      ),
  )
  const [message, setMessage] = useState<string | null>(null)
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: { selected: mode.initial.map(({ partId }) => partId) },
    validators: {
      onDynamic: ({ value }) =>
        selectedCombinationInputs(value.selected, options)
          ? undefined
          : { fields: { selected: copy.invalidSelection } },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const inputs = selectedCombinationInputs(value.selected, options)
      if (!inputs) return
      setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature: bodyCombinationFeature(mode, featureId, inputs, slots),
          onSave,
          onSaved,
          setMessage,
        })
      } catch {
        setMessage(copy.saveFailed)
      }
    },
  })
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <form.Subscribe selector={(state) => state.values.selected}>
        {(selected) => (
          <CombinationPreview
            selected={selected}
            options={options}
            mode={mode}
            featureId={featureId}
            slots={slots}
            onPreviewChange={onPreviewChange}
          />
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <ParameterPanel
            previewStatus={previewStatus}
            copy={copy}
            legend={copy.parameters}
            disabled={disabled || pending}
            message={message}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            <form.Field name="selected">
              {(field) => (
                <>
                  {mode.operation === "union" && field.state.value.length > 0 && (
                    <p role="status" className="rounded-md border bg-panel-muted p-2 text-xs">
                      {copy.survivor(
                        options.find(({ partId }) => partId === field.state.value[0])?.name ?? "",
                      )}
                    </p>
                  )}
                  <BodyCombinationInputs
                    error={validationMessage(field.state.meta.errors[0])}
                    copy={copy}
                    options={options}
                    selected={field.state.value}
                    onChange={(ids) => {
                      setMessage(null)
                      field.handleChange(ids)
                    }}
                  />
                </>
              )}
            </form.Field>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
