import {
  type AssemblyMotionStudy,
  assemblyMotionStudySchema,
} from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { useEffect, useId, useRef, useState } from "react"
import { browserAuthoredUuid as browserUuidV7 } from "../../document/authored-document-session"
import { assemblyMotionCoordinates } from "./assembly-motion"
import {
  assemblyMotionExportData,
  assemblyMotionExportFailureKey,
  assemblyMotionTraceInput,
  downloadAssemblyMotion,
  prepareAssemblyMotionExport,
} from "./assembly-motion-export"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import { type AssemblyPlaybackOptions, useAssemblyMotion } from "./use-assembly-motion"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

function newStudy(joints: readonly AssemblyJointRecord[]): AssemblyMotionStudy | null {
  const joint = joints.find((joint) => assemblyMotionCoordinates(joint).length)
  const coordinate = joint && assemblyMotionCoordinates(joint)[0]
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
              { time: 2, value: coordinate.value },
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
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.reverse ?? false}
          onChange={(event) => onChange({ ...value, reverse: event.currentTarget.checked })}
        />
        {t("motionReverse")}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.loop ?? false}
          onChange={(event) => onChange({ ...value, loop: event.currentTarget.checked })}
        />
        {t("motionLoop")}
      </label>
      <label htmlFor={`${id}-speed`}>
        {t("motionSpeed")}
        <Input
          id={`${id}-speed`}
          type="number"
          min={0.1}
          max={10}
          step={0.1}
          value={value.speed ?? 1}
          onChange={(event) => onChange({ ...value, speed: Number(event.currentTarget.value) })}
        />
      </label>
      <label htmlFor={`${id}-count`}>
        {t("motionSampleCount")}
        <Input
          id={`${id}-count`}
          type="number"
          min={2}
          max={256}
          step={1}
          value={value.count ?? 13}
          onChange={(event) => onChange({ ...value, count: Number(event.currentTarget.value) })}
        />
      </label>
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

function TrackEditor({
  study,
  view,
  edit,
  disabled,
}: {
  study: AssemblyMotionStudy
  view: AssemblyWorkspaceView
  edit: (study: AssemblyMotionStudy) => void
  disabled: boolean
}) {
  const t = useTranslations("app.assembly")
  const options = view.assembly.joints.flatMap((joint) =>
    assemblyMotionCoordinates(joint).map((coordinate) => ({
      joint,
      coordinate,
      key: `${joint.id}:${coordinate.kind}`,
    })),
  )
  const update = (index: number, track: AssemblyMotionStudy["tracks"][number]) =>
    edit({
      ...study,
      tracks: study.tracks.map((old, current) => (current === index ? track : old)),
    })
  return (
    <fieldset disabled={disabled} className="grid gap-3">
      <legend>{t("motionTracks")}</legend>
      {study.tracks.map((track, index) => (
        <fieldset key={track.id} className="grid gap-2 rounded-md border p-2">
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            aria-label={t("motionCoordinate")}
            value={`${track.jointId}:${track.coordinate}`}
            onChange={(event) => {
              const option = options.find(({ key }) => key === event.currentTarget.value)
              if (option)
                update(index, {
                  ...track,
                  jointId: option.joint.id,
                  coordinate: option.coordinate.kind,
                })
            }}
          >
            {options.map(({ key, joint, coordinate }) => (
              <option key={key} value={key}>
                {joint.id} · {t(coordinate.kind === "angle" ? "motionAngle" : "motionTranslation")}
              </option>
            ))}
          </select>
          {track.keys.map((key, keyIndex) => (
            <div key={`${track.id}:${keyIndex}`} className="grid grid-cols-[1fr_1fr_auto] gap-1">
              <Input
                type="number"
                aria-label={t("motionKeyTime")}
                min={0}
                max={study.duration}
                step="any"
                value={key.time}
                onChange={(event) =>
                  update(index, {
                    ...track,
                    keys: track.keys.map((old, at) =>
                      at === keyIndex ? { ...old, time: Number(event.currentTarget.value) } : old,
                    ),
                  })
                }
              />
              <Input
                type="number"
                aria-label={t("motionKeyValue", {
                  unit: track.coordinate === "angle" ? "rad" : "mm",
                })}
                step="any"
                value={key.value}
                onChange={(event) =>
                  update(index, {
                    ...track,
                    keys: track.keys.map((old, at) =>
                      at === keyIndex ? { ...old, value: Number(event.currentTarget.value) } : old,
                    ),
                  })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("motionRemoveKey")}
                disabled={track.keys.length <= 2}
                onClick={() =>
                  update(index, { ...track, keys: track.keys.filter((_, at) => at !== keyIndex) })
                }
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={track.keys.length >= 256}
            onClick={() => {
              const intervals = track.keys
                .slice(1)
                .map((right, index) => ({ right, left: track.keys[index], index }))
              intervals.sort(
                (a, b) => b.right.time - (b.left?.time ?? 0) - (a.right.time - (a.left?.time ?? 0)),
              )
              const interval = intervals[0]
              if (interval?.left)
                update(index, {
                  ...track,
                  keys: [
                    ...track.keys.slice(0, interval.index + 1),
                    {
                      time: (interval.left.time + interval.right.time) / 2,
                      value: (interval.left.value + interval.right.value) / 2,
                    },
                    ...track.keys.slice(interval.index + 1),
                  ],
                })
            }}
          >
            {t("motionAddKey")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => edit({ ...study, tracks: study.tracks.filter((_, at) => at !== index) })}
          >
            {t("motionRemoveTrack")}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={
          study.tracks.length >= 64 ||
          options.every(({ key }) =>
            study.tracks.some((track) => `${track.jointId}:${track.coordinate}` === key),
          )
        }
        onClick={() => {
          const option = options.find(
            ({ key }) =>
              !study.tracks.some((track) => `${track.jointId}:${track.coordinate}` === key),
          )
          if (option)
            edit({
              ...study,
              tracks: [
                ...study.tracks,
                {
                  id: browserUuidV7(),
                  jointId: option.joint.id,
                  coordinate: option.coordinate.kind,
                  keys: [
                    { time: 0, value: option.coordinate.value },
                    { time: study.duration, value: option.coordinate.value },
                  ],
                },
              ],
            })
        }}
      >
        {t("motionAddTrack")}
      </Button>
    </fieldset>
  )
}

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
      <label>
        {t("motionTraceInstance")}
        <select
          className="h-9 w-full rounded-md border bg-background px-2"
          value={target}
          onChange={(event) => setTarget(event.currentTarget.value)}
        >
          <option value="">—</option>
          {occurrences.map(({ instanceId, sourceIndex }) => (
            <option key={`${instanceId}:${sourceIndex}`} value={`${instanceId}:${sourceIndex}`}>
              {instanceId} · {sourceIndex}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={pointId}>
        {t("motionTracePoint")}
        <Input
          id={pointId}
          value={point}
          onChange={(event) => setPoint(event.currentTarget.value)}
        />
      </label>
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

type StudyPanelProps = { view: AssemblyWorkspaceView; session: AssemblyMotionStudySession }
function StudyFields({
  view,
  session,
  draft,
  disabled,
}: StudyPanelProps & { draft: AssemblyMotionStudy; disabled: boolean }) {
  const t = useTranslations("app.assembly"),
    inputId = useId()
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <label htmlFor={`${inputId}-name`}>
        {t("motionStudyName")}
        <Input
          id={`${inputId}-name`}
          value={draft.name}
          onChange={(event) => session.edit({ ...draft, name: event.currentTarget.value })}
        />
      </label>
      <label htmlFor={`${inputId}-duration`}>
        {t("motionDuration")}
        <Input
          id={`${inputId}-duration`}
          type="number"
          min={0.001}
          max={3600}
          step="any"
          value={draft.duration}
          onChange={(event) =>
            session.edit({ ...draft, duration: Number(event.currentTarget.value) })
          }
        />
      </label>
      <TrackEditor study={draft} view={view} edit={session.edit} disabled={disabled} />
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
  return (
    <>
      <label>
        {t("motionSeek")}
        <input
          className="w-full"
          type="range"
          min={0}
          max={draft.duration}
          step="any"
          value={motion.value ?? 0}
          disabled={disabled}
          onChange={(event) => void motion.preview(Number(event.currentTarget.value))}
        />
        <output>{motion.value ?? 0}</output>
      </label>
      <AssemblyPlaybackSettings
        value={options}
        onChange={setOptions}
        disabled={disabled || motion.playing}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled}
          onClick={() =>
            motion.playing ? motion.pause() : void motion.play(0, draft.duration, options)
          }
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
}: StudyPanelProps & {
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
  const remove = async () => {
    motion.reset()
    if (await view.mutations.apply([{ kind: "motion-study.remove", studyId: draft.id }], revision))
      view.closeStudy()
  }
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        disabled={busy || motion.pending || motion.playing}
        onClick={() => void save()}
      >
        {t("motionSaveStudy")}
      </Button>
      {session.existing && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void remove()}>
          {t("motionDeleteStudy")}
        </Button>
      )}
      <Button type="button" variant="outline" disabled={busy} onClick={close}>
        {t("cancel")}
      </Button>
    </div>
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
    <section className="grid gap-3" aria-label={t("motionStudies")}>
      <h2 className="font-semibold">
        {t(session.existing ? "motionEditStudy" : "motionNewStudy")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("motionStudyDescription")}</p>
      <StudyFields view={view} session={session} draft={draft} disabled={busy || solving} />
      <StudyPlayback
        draft={draft}
        motion={motion}
        options={options}
        setOptions={setOptions}
        disabled={busy}
      />
      <StudyExport session={session} revision={task.revision} disabled={busy || solving} />
      <StudyFailure view={view} session={session} error={error} />
      <StudyLifecycle
        view={view}
        session={session}
        draft={draft}
        revision={task.revision}
        setError={setError}
      />
    </section>
  )
}

export function AssemblyMotionStudyActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <section className="grid gap-2" aria-label={t("motionStudies")}>
      <h3 className="text-sm font-medium">{t("motionStudies")}</h3>
      <Button
        variant="outline"
        disabled={
          view.taskActionsDisabled ||
          !view.assembly.joints.some((joint) => assemblyMotionCoordinates(joint).length)
        }
        onClick={() => view.openStudy(null)}
      >
        {t("motionNewStudy")}
      </Button>
      {view.assembly.motionStudies?.map((study) => (
        <Button
          key={study.id}
          variant="outline"
          disabled={view.taskActionsDisabled}
          onClick={() => view.openStudy(study.id)}
        >
          {study.name}
        </Button>
      ))}
    </section>
  )
}
