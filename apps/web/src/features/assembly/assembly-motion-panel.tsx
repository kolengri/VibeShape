import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { TextField } from "@vibeshape/ui/components/text-field"
import { Form, useAppForm, useFieldError } from "@vibeshape/ui/integrations/tanstack-form"
import { useMemo } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useDocumentDisplayUnits } from "../../document/document-display-units"
import { numberFieldValidators } from "./assembly-fields"
import {
  type AssemblyMotionCoordinate,
  assemblyMotionCoordinates,
  assemblyMotionUnits,
} from "./assembly-motion"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import {
  AssemblyPlaybackSettings,
  playbackFieldValues,
  playbackOptions,
} from "./assembly-motion-study-panel"
import type { AssemblyMotionView } from "./use-assembly-motion"

type MotionPanelProps = {
  joint: AssemblyJointRecord
  coordinate: AssemblyMotionCoordinate
  motion: AssemblyMotionView
  disabled: boolean
  error: string | null
  onCoordinate: (kind: AssemblyMotionCoordinate["kind"]) => void
  onClose: () => void
}
function useMotionInputs(
  coordinate: AssemblyMotionCoordinate,
  motion: AssemblyMotionView,
  disabled: boolean,
) {
  const units = useDocumentDisplayUnits()
  const unit = useMemo(() => assemblyMotionUnits(coordinate, units), [coordinate, units])
  const display = (value: number) => String(unit.display(value))
  const radius = coordinate.kind === "angle" ? Math.PI / 4 : 10
  const form = useAppForm({
    defaultValues: {
      value: display(coordinate.value),
      start: display(Math.max(coordinate.min, coordinate.value - radius)),
      end: display(Math.min(coordinate.max, coordinate.value + radius)),
      playback: playbackFieldValues(),
    },
    onSubmitMeta: { action: "preview" as "preview" | "play" },
    onSubmit: async ({ value, meta }) => {
      if (disabled || motion.applying || motion.pending || motion.playing) return
      if (meta.action === "play") {
        form.setFieldValue("value", visibleValue())
        await motion.play(parse(value.start), parse(value.end), playbackOptions(value.playback))
      } else {
        const current = visibleValue()
        form.setFieldValue("value", current)
        await motion.preview(parse(current))
      }
    },
  })
  const parse = (raw: string) => (raw.trim() ? unit.canonical(Number(raw)) : Number.NaN)
  const visibleValue = () =>
    motion.value === null ? form.getFieldValue("value") : display(motion.value)
  const edit = (name: "value" | "start" | "end", raw: string) => {
    if (name !== "value") form.setFieldValue("value", visibleValue())
    motion.reset()
    form.setFieldValue(name, raw)
  }
  const reset = () => {
    motion.reset()
    form.setFieldValue("value", display(coordinate.value))
  }
  return {
    form,
    unit,
    display,
    visibleValue,
    edit,
    reset,
    play: () => form.handleSubmit({ action: "play" }),
  }
}
type MotionInputs = ReturnType<typeof useMotionInputs>
function MotionCoordinateFields({
  joint,
  coordinate,
  input,
  onCoordinate,
  disabled,
}: Pick<MotionPanelProps, "joint" | "coordinate" | "onCoordinate" | "disabled"> & {
  input: MotionInputs
}) {
  const t = useTranslations("app.assembly")
  const { unit, display } = input
  const bounds = { min: unit.display(coordinate.min), max: unit.display(coordinate.max) }
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-2">
      <fieldset className="flex min-w-0 flex-wrap gap-2">
        <legend className="mb-1 text-xs font-medium">{t("motionCoordinate")}</legend>
        {assemblyMotionCoordinates(joint).map((item) => (
          <Button
            key={item.kind}
            type="button"
            variant={coordinate.kind === item.kind ? "secondary" : "outline"}
            size="sm"
            aria-pressed={coordinate.kind === item.kind}
            onClick={() => onCoordinate(item.kind)}
          >
            {t(item.kind === "angle" ? "motionAngle" : "motionTranslation")}
          </Button>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {t("motionLimits", {
          min: display(coordinate.min),
          max: display(coordinate.max),
          unit: unit.unit,
        })}
      </p>
      <input.form.AppField
        name="value"
        validators={numberFieldValidators(t("invalidParameters"), bounds.min, bounds.max)}
      >
        {(field) => (
          <MotionValueField
            label={t("motionValue", { unit: unit.unit })}
            name={field.name}
            value={input.visibleValue()}
            min={bounds.min}
            max={bounds.max}
            onBlur={field.handleBlur}
            onChange={(raw) => input.edit("value", raw)}
          />
        )}
      </input.form.AppField>
      <Button type="submit" variant="outline" size="sm">
        {t("motionPreview")}
      </Button>
      <div className="grid min-w-0 gap-2">
        {(["start", "end"] as const).map((name) => (
          <input.form.AppField
            key={name}
            name={name}
            validators={numberFieldValidators(t("invalidParameters"), bounds.min, bounds.max)}
          >
            {(field) => (
              <MotionValueField
                label={t(name === "start" ? "motionRangeStart" : "motionRangeEnd", {
                  unit: unit.unit,
                })}
                name={field.name}
                value={field.state.value}
                min={bounds.min}
                max={bounds.max}
                onBlur={field.handleBlur}
                onChange={(raw) => input.edit(name, raw)}
              />
            )}
          </input.form.AppField>
        ))}
      </div>
    </fieldset>
  )
}
function MotionValueField({
  onChange,
  ...props
}: {
  label: string
  name: string
  value: string
  min: number
  max: number
  onBlur: () => void
  onChange: (raw: string) => void
}) {
  const error = useFieldError()
  return (
    <TextField
      {...props}
      type="number"
      step="any"
      required
      error={error}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}
function MotionPlayback({
  motion,
  disabled,
  coordinate,
  input,
}: Pick<MotionPanelProps, "motion" | "disabled" | "coordinate"> & { input: MotionInputs }) {
  const t = useTranslations("app.assembly")
  return (
    <div className="flex flex-wrap gap-2">
      {motion.playing ? (
        <Button
          key="pause"
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={motion.pause}
        >
          {t("motionPause")}
        </Button>
      ) : (
        <Button
          key="play"
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || motion.pending || coordinate.min === coordinate.max}
          onClick={input.play}
        >
          {t("motionPlay")}
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={input.reset}>
        {t("motionReset")}
      </Button>
    </div>
  )
}
function MotionStatus({
  motion,
  error,
  coordinate,
  input,
}: Pick<MotionPanelProps, "motion" | "error" | "coordinate"> & { input: MotionInputs }) {
  const t = useTranslations("app.assembly")
  const failureKey = error ? "motionStudySaveFailed" : assemblyMotionFailureKey(motion.error)
  const failure = failureKey ? t(failureKey) : null
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-busy={motion.pending}
        className="text-xs text-muted-foreground"
      >
        {motion.pending && <p>{t("motionSolving")}</p>}
        {motion.value !== null && (
          <p>
            {t("motionPosition", { value: input.display(motion.value), unit: input.unit.unit })}
          </p>
        )}
      </div>
      {!coordinate.driven && (
        <p className="text-xs text-muted-foreground">{t("motionDriveNotice")}</p>
      )}
      {failure && <Alert>{failure}</Alert>}
    </>
  )
}
export function AssemblyMotionPanel({
  joint,
  coordinate,
  motion,
  disabled,
  error,
  onCoordinate,
  onClose,
}: MotionPanelProps) {
  const t = useTranslations("app.assembly")
  const input = useMotionInputs(coordinate, motion, disabled)
  const busy = disabled || motion.applying
  const close = () => {
    motion.reset()
    onClose()
  }
  return (
    <Form
      form={input.form}
      className="grid min-w-0 gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault()
          close()
        }
      }}
    >
      <TaskPanelHeader
        title={t("motionTitle")}
        description={t("motionDescription")}
        actions={
          <TaskPanelLifecycleActions
            ariaLabel={t("motionTitle")}
            acceptLabel={t("apply")}
            acceptDisabled={busy || motion.pending || motion.playing || !motion.inspection}
            acceptLoading={motion.applying}
            onAccept={motion.apply}
            cancelLabel={t("cancel")}
            cancelDisabled={busy}
            onCancel={close}
          />
        }
      />
      <MotionCoordinateFields
        joint={joint}
        coordinate={coordinate}
        input={input}
        onCoordinate={onCoordinate}
        disabled={busy || motion.playing || motion.pending}
      />
      <MotionPlayback motion={motion} coordinate={coordinate} input={input} disabled={busy} />
      <AssemblyPlaybackSettings
        form={input.form}
        fields="playback"
        disabled={busy || motion.playing || motion.pending}
      />
      <MotionStatus motion={motion} coordinate={coordinate} input={input} error={error} />
    </Form>
  )
}
