import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { useId, useMemo, useState } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useDocumentDisplayUnits } from "../../document/document-display-units"
import {
  type AssemblyMotionCoordinate,
  assemblyMotionCoordinates,
  assemblyMotionUnits,
} from "./assembly-motion"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import { AssemblyPlaybackSettings } from "./assembly-motion-study-panel"
import type { AssemblyMotionView, AssemblyPlaybackOptions } from "./use-assembly-motion"

function MotionNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: string
  min: number
  max: number
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step="any"
        required
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

type MotionPanelProps = {
  joint: AssemblyJointRecord
  coordinate: AssemblyMotionCoordinate
  motion: AssemblyMotionView
  disabled: boolean
  error: string | null
  onCoordinate: (kind: AssemblyMotionCoordinate["kind"]) => void
  onClose: () => void
}
function useMotionInputs(coordinate: AssemblyMotionCoordinate, motion: AssemblyMotionView) {
  const [playback, setPlayback] = useState<AssemblyPlaybackOptions>({ count: 13, speed: 1 })
  const units = useDocumentDisplayUnits()
  const unit = useMemo(() => assemblyMotionUnits(coordinate, units), [coordinate, units])
  const display = (value: number) => String(unit.display(value))
  const [rawValue, setValue] = useState(() => display(coordinate.value))
  const value = motion.value === null ? rawValue : display(motion.value)
  const radius = coordinate.kind === "angle" ? Math.PI / 4 : 10
  const [start, setStart] = useState(() =>
    display(Math.max(coordinate.min, coordinate.value - radius)),
  )
  const [end, setEnd] = useState(() => display(Math.min(coordinate.max, coordinate.value + radius)))
  const parse = (raw: string) => (raw.trim() ? unit.canonical(Number(raw)) : Number.NaN)
  const edit = (setter: (value: string) => void) => (raw: string) => {
    motion.reset()
    setValue(value)
    setter(raw)
  }
  const reset = () => {
    motion.reset()
    setValue(display(coordinate.value))
  }
  return {
    unit,
    display,
    value,
    start,
    end,
    editValue: edit(setValue),
    editStart: edit(setStart),
    editEnd: edit(setEnd),
    reset,
    playback,
    setPlayback,
    preview: () => {
      setValue(value)
      return motion.preview(parse(value))
    },
    play: () => {
      setValue(value)
      return motion.play(parse(start), parse(end), playback)
    },
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
      <MotionNumber
        label={t("motionValue", { unit: unit.unit })}
        value={input.value}
        {...bounds}
        onChange={input.editValue}
      />
      <Button type="submit" variant="outline" size="sm">
        {t("motionPreview")}
      </Button>
      <div className="grid min-w-0 gap-2">
        <MotionNumber
          label={t("motionRangeStart", { unit: unit.unit })}
          value={input.start}
          {...bounds}
          onChange={input.editStart}
        />
        <MotionNumber
          label={t("motionRangeEnd", { unit: unit.unit })}
          value={input.end}
          {...bounds}
          onChange={input.editEnd}
        />
      </div>
    </fieldset>
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
          onClick={() => void input.play()}
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
  const input = useMotionInputs(coordinate, motion)
  const busy = disabled || motion.applying
  const close = () => {
    motion.reset()
    onClose()
  }
  return (
    <form
      className="grid min-w-0 gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && !motion.playing && !motion.pending) void input.preview()
      }}
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
        value={input.playback}
        onChange={input.setPlayback}
        disabled={busy || motion.playing || motion.pending}
      />
      <MotionStatus motion={motion} coordinate={coordinate} input={input} error={error} />
    </form>
  )
}
