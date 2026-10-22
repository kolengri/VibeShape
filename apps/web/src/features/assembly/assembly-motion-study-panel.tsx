import {
  type AssemblyMotionStudy,
  assemblyMotionStudySchema,
} from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel, fieldVariants } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { browserAuthoredUuid as browserUuidV7 } from "../../document/authored-document-session"
import { assemblyMotionCoordinates, retimeAssemblyMotionStudy } from "./assembly-motion"
import {
  assemblyMotionExportData,
  assemblyMotionExportFailureKey,
  assemblyMotionTraceInput,
  downloadAssemblyMotion,
  prepareAssemblyMotionExport,
} from "./assembly-motion-export"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import { AssemblyMotionTrackEditor, AssemblyStudyNumber } from "./assembly-motion-track-editor"
import { type AssemblyPlaybackOptions, useAssemblyMotion } from "./use-assembly-motion"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

function newStudy(joints: readonly AssemblyJointRecord[]): AssemblyMotionStudy | null {
  const joint = joints.find((joint) => assemblyMotionCoordinates(joint).length)
  const coordinate = joint && assemblyMotionCoordinates(joint)[0]
  const span = coordinate?.kind === "angle" ? Math.PI / 2 : 10
  const end =
    coordinate &&
    (coordinate.max > coordinate.value
      ? Math.min(coordinate.max, coordinate.value + span)
      : Math.max(coordinate.min, coordinate.value - span))
  return joint && coordinate
    ? assemblyMotionStudySchema.parse({
        schemaVersion: 1,
        id: browserUuidV7(),
        name: "Motion study",
        duration: 2,
        tracks: [
          {
            id: browserUuidV7(),
            jointId: joint.id,
            coordinate: coordinate.kind,
            keys: [
              { time: 0, value: coordinate.value },
              { time: 2, value: end },
            ],
          },
        ],
      })
    : null
}

export function AssemblyPlaybackSettings({
  value,
  onChange,
  disabled,
}: {
  value: AssemblyPlaybackOptions
  onChange: (value: AssemblyPlaybackOptions) => void
  disabled: boolean
}) {
  const t = useTranslations("app.assembly")
  const id = useId()
  return (
    <fieldset disabled={disabled} className="grid gap-2 text-sm">
      <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
        <span>{t("motionReverse")}</span>
        <input
          type="checkbox"
          checked={value.reverse ?? false}
          onChange={(event) => onChange({ ...value, reverse: event.currentTarget.checked })}
        />
      </label>
      <label className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}>
        <span>{t("motionLoop")}</span>
        <input
          type="checkbox"
          checked={value.loop ?? false}
          onChange={(event) => onChange({ ...value, loop: event.currentTarget.checked })}
        />
      </label>
      <Field>
        <FieldLabel htmlFor={`${id}-speed`}>{t("motionSpeed")}</FieldLabel>
        <Input
          id={`${id}-speed`}
          type="number"
          min={0.1}
          max={10}
          step={0.1}
          value={value.speed ?? 1}
          onChange={(event) => onChange({ ...value, speed: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-count`}>{t("motionSampleCount")}</FieldLabel>
        <Input
          id={`${id}-count`}
          type="number"
          min={2}
          max={256}
          step={1}
          value={value.count ?? 13}
          onChange={(event) => onChange({ ...value, count: Number(event.currentTarget.value) })}
        />
      </Field>
    </fieldset>
  )
}

export function useAssemblyMotionStudySession(view: AssemblyWorkspaceView) {
  const task = view.studyTask
  const joints = view.assembly.joints
  const stored = view.assembly.motionStudies?.find(({ id }) => id === task?.id)
  const sessionKey = `${view.documentKey}:${task ? (task.id ?? "new") : "idle"}`
  const [draftState, setDraftState] = useState<{ key: string; study: AssemblyMotionStudy | null }>(
    () => ({ key: sessionKey, study: null }),
  )
  useEffect(() => {
    setDraftState((previous) =>
      !task && previous.key === sessionKey && previous.study === null
        ? previous
        : { key: sessionKey, study: task ? (stored ?? newStudy(joints)) : null },
    )
  }, [sessionKey, stored, task, joints])
  const draft = draftState.key === sessionKey ? draftState.study : null
  const edit = (study: AssemblyMotionStudy) => {
    motion.reset()
    setDraftState({ key: sessionKey, study })
  }
  const motion = useAssemblyMotion({
    key: sessionKey,
    joint: null,
    coordinate: null,
    study: draft,
    joints: view.assembly.joints,
    revision: task?.revision ?? -1,
    disabled: view.disabled || !task || !draft,
    onApply: async (changes, revision) => {
      const ok = await view.mutations.apply(changes, revision)
      if (ok) view.closeStudy()
      return ok
    },
  })
  return { draft, edit, motion, existing: Boolean(stored) }
}
export type AssemblyMotionStudySession = ReturnType<typeof useAssemblyMotionStudySession>

function StudyExport({
  session,
  revision,
  disabled,
}: {
  session: AssemblyMotionStudySession
  revision: number
  disabled: boolean
}) {
  const t = useTranslations("app.assembly"),
    [error, setError] = useState<
      "motionTraceInvalid" | "motionPngLimit" | "motionExportUnavailable" | null
    >(null),
    [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const pointId = useId()
  const [target, setTarget] = useState(""),
    [point, setPoint] = useState("0,0,0")
  useEffect(() => () => request.current?.abort(), [session.draft, session.motion.samples])
  const occurrences = session.motion.samples[0]?.inspection.occurrences ?? []
  const exportData = () => {
    if (!session.draft) throw new Error("The motion study is missing.")
    return assemblyMotionExportData(
      session.draft,
      revision,
      session.motion.samples,
      assemblyMotionTraceInput(point, target, session.motion.samples[0]?.inspection),
    )
  }

  const run = async (format: "json" | "csv" | "zip") => {
    if (request.current || disabled) return
    const abort = new AbortController()
    request.current = abort
    setBusy(true)
    setError(null)
    try {
      const data = exportData()
      const result = await prepareAssemblyMotionExport(
        format,
        data,
        session.motion.samples,
        abort.signal,
      )
      abort.signal.throwIfAborted()
      downloadAssemblyMotion(data.studyName, format, result)
    } catch (failure) {
      if (!abort.signal.aborted) setError(assemblyMotionExportFailureKey(failure))
    } finally {
      if (request.current === abort) {
        request.current = null
        setBusy(false)
      }
    }
  }
  return (
    <fieldset disabled={disabled || busy || !session.motion.samples.length} className="grid gap-2">
      <NativeSelectField
        label={t("motionTraceInstance")}
        value={target}
        onChange={(event) => setTarget(event.currentTarget.value)}
      >
        <option value="">—</option>
        {occurrences.map(({ instanceId, sourceIndex }) => (
          <option key={`${instanceId}:${sourceIndex}`} value={`${instanceId}:${sourceIndex}`}>
            {instanceId} · {sourceIndex}
          </option>
        ))}
      </NativeSelectField>
      <Field>
        <FieldLabel htmlFor={pointId}>{t("motionTracePoint")}</FieldLabel>
        <Input
          id={pointId}
          value={point}
          onChange={(event) => setPoint(event.currentTarget.value)}
        />
      </Field>
      <Button type="button" variant="outline" onClick={() => void run("json")}>
        {t("motionExportJson")}
      </Button>
      <Button type="button" variant="outline" onClick={() => void run("csv")}>
        {t("motionExportCsv")}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={session.motion.samples.length > 64}
        aria-busy={busy}
        onClick={() => void run("zip")}
      >
        {t("motionExportPng")}
      </Button>
      {error && <p role="alert">{t("motionExportFailed", { reason: t(error) })}</p>}
    </fieldset>
  )
}

function canRetimeStudy(study: AssemblyMotionStudy, duration: number) {
  return retimeAssemblyMotionStudy(study, duration).tracks.every((track) =>
    track.keys.every(
      (key, index) =>
        Number.isFinite(key.time) &&
        key.time >= 0 &&
        key.time <= duration &&
        (index === 0 || key.time > (track.keys[index - 1]?.time ?? 0)),
    ),
  )
}

type StudyPanelProps = { view: AssemblyWorkspaceView; session: AssemblyMotionStudySession }
function StudyFields({
  session,
  draft,
  disabled,
}: StudyPanelProps & { draft: AssemblyMotionStudy; disabled: boolean }) {
  const t = useTranslations("app.assembly"),
    inputId = useId()
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <Field>
        <FieldLabel htmlFor={`${inputId}-name`}>{t("motionStudyName")}</FieldLabel>
        <Input
          id={`${inputId}-name`}
          value={draft.name}
          onChange={(event) => session.edit({ ...draft, name: event.currentTarget.value })}
        />
      </Field>
      <AssemblyStudyNumber
        label={t("motionDuration")}
        value={draft.duration}
        min={0.001}
        max={3600}
        onDirty={() => session.motion.reset()}
        validate={(duration) => canRetimeStudy(draft, duration)}
        errorMessage={t("motionRetimeInvalid")}
        onCommit={(duration) => session.edit(retimeAssemblyMotionStudy(draft, duration))}
      />
    </fieldset>
  )
}
function StudyPlayback({
  draft,
  motion,
  options,
  setOptions,
  disabled,
}: {
  draft: AssemblyMotionStudy
  motion: AssemblyMotionStudySession["motion"]
  options: AssemblyPlaybackOptions
  setOptions: (options: AssemblyPlaybackOptions) => void
  disabled: boolean
}) {
  const t = useTranslations("app.assembly")
  const seekId = useId()
  return (
    <>
      <Field>
        <FieldLabel htmlFor={seekId}>{t("motionSeek")}</FieldLabel>
        <div className="flex min-w-0 items-center gap-2">
          <input
            id={seekId}
            className="h-8 w-full min-w-0"
            type="range"
            min={0}
            max={draft.duration}
            step="any"
            value={motion.value ?? 0}
            disabled={disabled}
            onChange={(event) => {
              if (event.currentTarget.form?.reportValidity())
                void motion.preview(Number(event.currentTarget.value))
            }}
          />
          <output htmlFor={seekId} className="shrink-0 tabular-nums">
            {motion.value ?? 0}
          </output>
        </div>
      </Field>
      <details>
        <summary className="font-medium cursor-pointer py-1 text-xs">
          {t("motionPlaybackOptions")}
        </summary>
        <AssemblyPlaybackSettings
          value={options}
          onChange={setOptions}
          disabled={disabled || motion.playing}
        />
      </details>
      <div className="flex flex-wrap gap-2">
        <Button
          key={motion.playing ? "pause" : "play"}
          type="button"
          disabled={disabled}
          onClick={(event) => {
            if (motion.playing) motion.pause()
            else if (event.currentTarget.form?.reportValidity())
              void motion.play(0, draft.duration, options)
          }}
        >
          {t(motion.playing ? "motionPause" : "motionPlay")}
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={motion.reset}>
          {t("motionReset")}
        </Button>
        <Button
          type="button"
          disabled={disabled || motion.pending || motion.playing || !motion.changes}
          onClick={() => void motion.apply()}
        >
          {t("apply")}
        </Button>
      </div>
      <p role="status">{t("motionSampled", { count: motion.samples.length })}</p>
    </>
  )
}
function StudyFailure({ view, session, error }: StudyPanelProps & { error: string | null }) {
  const t = useTranslations("app.assembly")
  if (view.mutations.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("motionStudySaveFailed")}
      </p>
    )
  const key = assemblyMotionFailureKey(session.motion.error)
  if (!error && !key) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {t("motionStudyInvalid", { reason: error ?? t(key ?? "motionStudyInvalidDetails") })}
    </p>
  )
}
function StudyLifecycle({
  view,
  session,
  draft,
  revision,
  setError,
  children,
}: StudyPanelProps & {
  children: ReactNode
  draft: AssemblyMotionStudy
  revision: number
  setError: (error: string) => void
}) {
  const t = useTranslations("app.assembly"),
    motion = session.motion
  const busy = view.disabled || motion.applying
  const close = () => {
    motion.reset()
    view.closeStudy()
  }
  const save = async () => {
    motion.pause()
    const parsed = assemblyMotionStudySchema.safeParse(draft)
    if (!parsed.success) {
      setError(t("motionStudyInvalidDetails"))
      return
    }
    if (
      await view.mutations.apply(
        [
          {
            kind: session.existing ? "motion-study.update" : "motion-study.create",
            study: parsed.data,
          },
        ],
        revision,
      )
    )
      view.closeStudy()
  }
  return (
    <TaskPanelHeader
      title={t(session.existing ? "motionEditStudy" : "motionNewStudy")}
      description={t("motionStudyDescription")}
      className="bg-panel py-2"
      actions={
        <TaskPanelLifecycleActions
          ariaLabel={t("motionStudies")}
          acceptLabel={t("motionSaveStudy")}
          acceptDisabled={busy || motion.pending || motion.playing}
          onAccept={(event) => {
            if (event.currentTarget.form?.reportValidity()) return save()
          }}
          cancelLabel={t("cancel")}
          cancelDisabled={busy}
          onCancel={close}
        />
      }
    >
      {children}
    </TaskPanelHeader>
  )
}

export function AssemblyMotionStudyPanel({ view, session }: StudyPanelProps) {
  const t = useTranslations("app.assembly"),
    [options, setOptions] = useState<AssemblyPlaybackOptions>({ count: 13, speed: 1 }),
    [error, setError] = useState<string | null>(null)
  const draft = session.draft,
    task = view.studyTask,
    motion = session.motion
  if (!draft || !task) return <p>{t("motionStudyEmpty")}</p>
  const busy = view.disabled || motion.applying,
    solving = motion.pending || motion.playing
  return (
    <form
      className="grid min-w-0 gap-2"
      aria-label={t("motionStudies")}
      onSubmit={(event) => event.preventDefault()}
      onInvalidCapture={(event) => {
        let ancestor = event.target instanceof HTMLElement ? event.target.parentElement : null
        while (ancestor && ancestor !== event.currentTarget) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
          ancestor = ancestor.parentElement
        }
      }}
    >
      <StudyLifecycle
        view={view}
        session={session}
        draft={draft}
        revision={task.revision}
        setError={setError}
      >
        <StudyPlayback
          draft={draft}
          motion={motion}
          options={options}
          setOptions={setOptions}
          disabled={busy}
        />
      </StudyLifecycle>
      <StudyFields view={view} session={session} draft={draft} disabled={busy || solving} />
      <AssemblyMotionTrackEditor
        study={draft}
        view={view}
        edit={session.edit}
        disabled={busy || solving}
      />
      <details>
        <summary className="font-medium cursor-pointer py-1 text-xs">
          {t("motionExportOptions")}
        </summary>
        <StudyExport session={session} revision={task.revision} disabled={busy || solving} />
      </details>
      <StudyFailure view={view} session={session} error={error} />
      {session.existing && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            motion.reset()
            if (
              await view.mutations.apply(
                [{ kind: "motion-study.remove", studyId: draft.id }],
                task.revision,
              )
            )
              view.closeStudy()
          }}
        >
          {t("motionDeleteStudy")}
        </Button>
      )}
    </form>
  )
}
