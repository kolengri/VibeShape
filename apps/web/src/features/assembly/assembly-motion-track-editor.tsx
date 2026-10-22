import type { AssemblyMotionStudy, AssemblyMotionTrack } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { FieldError } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { useId, useState } from "react"
import { browserAuthoredUuid as browserUuidV7 } from "../../document/authored-document-session"
import { useDocumentDisplayUnits } from "../../document/document-display-units"
import { assemblyMotionCoordinates, assemblyMotionUnits } from "./assembly-motion"
import { AssemblyMotionKeyTimeline } from "./assembly-motion-key-timeline"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

function parsedNumber(raw: string | null, value: number) {
  if (raw === null) return value
  return raw.trim() ? Number(raw) : Number.NaN
}
function validNumber(
  value: number,
  min?: number,
  max?: number,
  validate?: (value: number) => boolean,
) {
  return (
    Number.isFinite(value) &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max) &&
    (validate === undefined || validate(value))
  )
}

function numberMessage(
  invalid: boolean,
  pending: boolean,
  invalidMessage: string,
  pendingMessage: string,
) {
  if (invalid) return invalidMessage
  return pending ? pendingMessage : ""
}

export function AssemblyStudyNumber({
  label,
  value,
  min,
  max,
  onCommit,
  onDirty,
  validate,
  errorMessage,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
  onDirty: () => void
  validate?: (value: number) => boolean
  errorMessage?: string
}) {
  const t = useTranslations("app.assembly")
  const id = useId()
  const [raw, setRaw] = useState<string | null>(null)
  const parsed = parsedNumber(raw, value)
  const invalid = !validNumber(parsed, min, max, validate)
  const pending = raw !== null && !invalid && parsed !== value
  const message = numberMessage(
    invalid,
    pending,
    errorMessage ?? t("motionNumberInvalid"),
    t("motionNumberPending"),
  )
  return (
    <div className="grid min-w-0 gap-1 text-xs">
      <label htmlFor={id}>{label}</label>
      <Input
        ref={(node) => node?.setCustomValidity(message)}
        id={id}
        type="number"
        step="any"
        required
        min={min}
        max={max}
        value={raw ?? String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setRaw(event.currentTarget.value)
          onDirty()
        }}
        onBlur={() => {
          if (raw !== null && !invalid) {
            onCommit(parsed)
            setRaw(null)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.blur()
          }
          if (event.key === "Escape" && raw !== null) {
            event.preventDefault()
            event.stopPropagation()
            setRaw(null)
          }
        }}
      />
      {message &&
        (invalid ? (
          <FieldError id={`${id}-error`}>{message}</FieldError>
        ) : (
          <span id={`${id}-error`} className="sr-only">
            {message}
          </span>
        ))}
    </div>
  )
}

type EditorProps = {
  study: AssemblyMotionStudy
  view: Pick<AssemblyWorkspaceView, "assembly">
  edit: (study: AssemblyMotionStudy) => void
  disabled: boolean
}

function useTrackOptions(view: Pick<AssemblyWorkspaceView, "assembly">) {
  const t = useTranslations("app.assembly")
  return view.assembly.joints.flatMap((joint, index) => {
    const parent = view.assembly.instances.find(({ id }) => id === joint.parentInstanceId)
    const child = view.assembly.instances.find(({ id }) => id === joint.childInstanceId)
    return assemblyMotionCoordinates(joint).map((coordinate) => ({
      coordinate,
      jointId: joint.id,
      key: `${joint.id}:${coordinate.kind}`,
      label: t("motionJointOption", {
        number: index + 1,
        joint: t("jointBetween", {
          kind: t(joint.kind),
          parent: parent?.name ?? t("unknownInstance"),
          child: child?.name ?? t("unknownInstance"),
        }),
        coordinate: t(coordinate.kind === "angle" ? "motionAngle" : "motionTranslation"),
      }),
    }))
  })
}
type TrackOption = ReturnType<typeof useTrackOptions>[number]

function CopyTrack({
  track,
  study,
  options,
  edit,
}: {
  track: AssemblyMotionTrack
  study: AssemblyMotionStudy
  options: TrackOption[]
  edit: EditorProps["edit"]
}) {
  const t = useTranslations("app.assembly")
  const units = useDocumentDisplayUnits()
  const available = options.filter(
    (option) =>
      option.coordinate.kind === track.coordinate &&
      !study.tracks.some((other) => `${other.jointId}:${other.coordinate}` === option.key),
  )
  const [targetKey, setTargetKey] = useState("")
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState(false)
  const target = available.find(({ key }) => key === targetKey) ?? available[0]
  if (!target || study.tracks.length >= 64) return null
  const unit = assemblyMotionUnits(target.coordinate, units)
  const copy = (button: HTMLButtonElement) => {
    if (!button.form?.reportValidity()) return
    const keys = track.keys.map((key) => ({ ...key, value: key.value + offset }))
    if (
      keys.some(
        ({ value }) =>
          !Number.isFinite(value) || value < target.coordinate.min || value > target.coordinate.max,
      )
    ) {
      setError(true)
      return
    }
    edit({
      ...study,
      tracks: [
        ...study.tracks,
        { id: browserUuidV7(), jointId: target.jointId, coordinate: track.coordinate, keys },
      ],
    })
    setOffset(0)
    setError(false)
  }
  return (
    <details className="text-sm">
      <summary className="font-medium text-xs cursor-pointer py-1">{t("motionCopyTrack")}</summary>
      <div className="mt-2 grid gap-2">
        <label className="grid gap-1 text-xs">
          {t("motionCopyTarget")}
          <select
            className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
            value={target.key}
            onChange={(event) => {
              setTargetKey(event.currentTarget.value)
              setError(false)
            }}
          >
            {available.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <AssemblyStudyNumber
          label={t(track.coordinate === "angle" ? "motionAngleOffset" : "motionValueOffset", {
            unit: unit.unit,
          })}
          value={unit.display(offset)}
          onDirty={() => {
            edit(study)
            setError(false)
          }}
          onCommit={(value) => setOffset(unit.canonical(value))}
        />
        <p className="text-xs text-muted-foreground">{t("motionCopyHint")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => copy(event.currentTarget)}
        >
          {t("motionCopyApply")}
        </Button>
        {error && <Alert>{t("motionCopyOutOfLimits")}</Alert>}
      </div>
    </details>
  )
}

function TrackCard({
  track,
  index,
  study,
  options,
  edit,
  disabled,
}: {
  track: AssemblyMotionTrack
  index: number
  study: AssemblyMotionStudy
  options: TrackOption[]
  edit: EditorProps["edit"]
  disabled: boolean
}) {
  const t = useTranslations("app.assembly")
  const units = useDocumentDisplayUnits()
  const selected = options.find(({ key }) => key === `${track.jointId}:${track.coordinate}`)
  const update = (next: AssemblyMotionTrack) =>
    edit({ ...study, tracks: study.tracks.map((old) => (old.id === track.id ? next : old)) })
  const coordinate = selected?.coordinate
  const unit = coordinate && assemblyMotionUnits(coordinate, units)
  const addKey = () => {
    const interval = track.keys
      .slice(1)
      .map((right, i) => ({ left: track.keys[i], right, i }))
      .sort((a, b) => b.right.time - (b.left?.time ?? 0) - (a.right.time - (a.left?.time ?? 0)))[0]
    if (!interval?.left) return
    const { left, right, i } = interval
    const time = (left.time + right.time) / 2
    if (time <= left.time || time >= right.time) return
    update({
      ...track,
      keys: [
        ...track.keys.slice(0, i + 1),
        { time, value: (left.value + right.value) / 2 },
        ...track.keys.slice(i + 1),
      ],
    })
  }
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">
        {t("motionTrackNumber", { number: index + 1 })}
      </legend>
      <label className="grid min-w-0 gap-1 text-xs">
        {t("motionCoordinate")}
        <select
          className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
          value={`${track.jointId}:${track.coordinate}`}
          onChange={(event) => {
            const option = options.find(({ key }) => key === event.currentTarget.value)
            if (option)
              update({
                ...track,
                jointId: option.jointId,
                coordinate: option.coordinate.kind,
                keys: track.keys.map((key) => ({
                  ...key,
                  value:
                    option.coordinate.kind === track.coordinate
                      ? key.value
                      : option.coordinate.value,
                })),
              })
          }}
        >
          {!selected && (
            <option value={`${track.jointId}:${track.coordinate}`}>
              {t("motionMissingJoint")}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.key}
              value={option.key}
              disabled={study.tracks.some(
                (other) =>
                  other.id !== track.id && `${other.jointId}:${other.coordinate}` === option.key,
              )}
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {coordinate && unit ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t("motionLimits", {
              min: unit.display(coordinate.min),
              max: unit.display(coordinate.max),
              unit: unit.unit,
            })}
          </p>
          <AssemblyMotionKeyTimeline
            keys={track.keys}
            duration={study.duration}
            disabled={disabled}
            label={t("motionTrackTimeline", { number: index + 1 })}
            keyLabel={(number, time) => t("motionTimelineKey", { number: number + 1, time })}
            onChange={(keys) => update({ ...track, keys })}
          />
          <details>
            <summary className="font-medium cursor-pointer py-1 text-xs">
              {t("motionEditKeys", { count: track.keys.length })}
            </summary>
            <div className="mt-2 grid gap-3">
              {track.keys.map((key, keyIndex) => (
                <fieldset key={`${track.id}:${keyIndex}`} className="grid gap-2 border-b pb-3">
                  <legend className="font-medium text-xs text-muted-foreground">
                    {t("motionKeyNumber", { number: keyIndex + 1 })}
                  </legend>
                  <div
                    key={`${track.coordinate}:${track.keys.length}`}
                    className="grid min-w-0 grid-cols-2 gap-2"
                  >
                    <AssemblyStudyNumber
                      label={t("motionKeyTime")}
                      value={key.time}
                      min={0}
                      max={study.duration}
                      validate={(time) =>
                        (keyIndex === 0 || time > (track.keys[keyIndex - 1]?.time ?? 0)) &&
                        (keyIndex === track.keys.length - 1 ||
                          time < (track.keys[keyIndex + 1]?.time ?? study.duration))
                      }
                      onDirty={() => edit(study)}
                      onCommit={(time) =>
                        update({
                          ...track,
                          keys: track.keys.map((old, at) =>
                            at === keyIndex ? { ...old, time } : old,
                          ),
                        })
                      }
                    />
                    <AssemblyStudyNumber
                      label={t("motionKeyValue", { unit: unit.unit })}
                      value={unit.display(key.value)}
                      min={unit.display(coordinate.min)}
                      max={unit.display(coordinate.max)}
                      onDirty={() => edit(study)}
                      onCommit={(value) =>
                        update({
                          ...track,
                          keys: track.keys.map((old, at) =>
                            at === keyIndex
                              ? {
                                  ...old,
                                  value:
                                    unit.display(old.value) === value
                                      ? old.value
                                      : unit.canonical(value),
                                }
                              : old,
                          ),
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={track.keys.length <= 2}
                    onClick={() =>
                      update({ ...track, keys: track.keys.filter((_, at) => at !== keyIndex) })
                    }
                  >
                    {t("motionRemoveKey")}
                  </Button>
                </fieldset>
              ))}
            </div>
          </details>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={track.keys.length >= 256}
            onClick={addKey}
          >
            {t("motionAddKey")}
          </Button>
          <CopyTrack
            key={track.coordinate}
            track={track}
            study={study}
            options={options}
            edit={edit}
          />
        </>
      ) : (
        <Alert>{t("motionMissingJoint")}</Alert>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={study.tracks.length <= 1}
        onClick={() => edit({ ...study, tracks: study.tracks.filter(({ id }) => id !== track.id) })}
      >
        {t("motionRemoveTrack")}
      </Button>
    </fieldset>
  )
}

export function AssemblyMotionTrackEditor({ study, view, edit, disabled }: EditorProps) {
  const t = useTranslations("app.assembly")
  const units = useDocumentDisplayUnits()
  const options = useTrackOptions(view)
  const available = options.filter(
    (option) =>
      !study.tracks.some((track) => `${track.jointId}:${track.coordinate}` === option.key),
  )
  const add = () => {
    const option = available[0]
    if (!option) return
    edit({
      ...study,
      tracks: [
        ...study.tracks,
        {
          id: browserUuidV7(),
          jointId: option.jointId,
          coordinate: option.coordinate.kind,
          keys: [
            { time: 0, value: option.coordinate.value },
            { time: study.duration, value: option.coordinate.value },
          ],
        },
      ],
    })
  }
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <legend className="mb-2 text-xs font-medium">{t("motionTracks")}</legend>
      <p className="text-xs text-muted-foreground">{t("motionTimelineHint")}</p>
      {study.tracks.map((track, index) => (
        <TrackCard
          key={`${track.id}:${units.angle}:${units.length}`}
          track={track}
          index={index}
          study={study}
          options={options}
          edit={edit}
          disabled={disabled}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={study.tracks.length >= 64 || !available.length}
        onClick={add}
      >
        {t("motionAddTrack")}
      </Button>
    </fieldset>
  )
}
