import {
  type AssemblyMotionStudy,
  assemblyMotionStudySchema,
} from "@vibeshape/domain/assembly-authority"
import type { AssemblyJointRecord } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import {
  Form,
  useAppForm,
  useStore,
  withFieldGroup,
} from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useId, useRef, useState } from "react"
import { TaskPanelLayout } from "../../components/task-panel-layout"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { browserAuthoredUuid as browserUuidV7 } from "../../document/authored-document-session"
import { formNumber, numberFieldValidators } from "./assembly-fields"
import { assemblyMotionCoordinates, retimeAssemblyMotionStudy } from "./assembly-motion"
import {
  assemblyMotionExportData,
  assemblyMotionExportFailureKey,
  assemblyMotionTraceInput,
  downloadAssemblyMotion,
  prepareAssemblyMotionExport,
} from "./assembly-motion-export"
import { assemblyMotionFailureKey } from "./assembly-motion-runner"
import { AssemblyMotionTrackEditor } from "./assembly-motion-track-editor"
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

export function playbackFieldValues() {
  return { reverse: false, loop: false, speed: "1", count: "13" }
}
export function playbackOptions(
  values: ReturnType<typeof playbackFieldValues>,
): AssemblyPlaybackOptions {
  return {
    reverse: values.reverse,
    loop: values.loop,
    speed: Number(values.speed),
    count: Number(values.count),
  }
}
export const AssemblyPlaybackSettings = withFieldGroup({
  defaultValues: playbackFieldValues(),
  props: { disabled: false },
  render: function AssemblyPlaybackSettings({ group, disabled }) {
    const t = useTranslations("app.assembly")
    return (
      <fieldset disabled={disabled} className="grid gap-2 text-sm">
        <group.AppField name="reverse">
          {(field) => <field.CheckboxField label={t("motionReverse")} />}
        </group.AppField>
        <group.AppField name="loop">
          {(field) => <field.CheckboxField label={t("motionLoop")} />}
        </group.AppField>
        <group.AppField
          name="speed"
          validators={numberFieldValidators(t("motionNumberInvalid"), 0.1, 10)}
        >
          {(field) => (
            <field.TextField
              label={t("motionSpeed")}
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              required
            />
          )}
        </group.AppField>
        <group.AppField
          name="count"
          validators={{
            onChange: ({ value }) =>
              Number.isInteger(Number(value))
                ? numberFieldValidators(t("motionNumberInvalid"), 2, 256).onChange({ value })
                : t("motionNumberInvalid"),
          }}
        >
          {(field) => (
            <field.TextField
              label={t("motionSampleCount")}
              type="number"
              min={2}
              max={256}
              step={1}
              required
            />
          )}
        </group.AppField>
      </fieldset>
    )
  },
})

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
  const t = useTranslations("app.assembly")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [session.draft, session.motion.samples])
  const occurrences = session.motion.samples[0]?.inspection.occurrences ?? []
  const form = useAppForm({
    defaultValues: { target: "", point: "0,0,0" },
    onSubmitMeta: { format: "json" as "json" | "csv" | "zip" },
    onSubmit: async ({ value, meta, formApi }) => {
      if (request.current || disabled) return
      const abort = new AbortController()
      request.current = abort
      try {
        if (!session.draft) throw new Error("The motion study is missing.")
        const data = assemblyMotionExportData(
          session.draft,
          revision,
          session.motion.samples,
          assemblyMotionTraceInput(
            value.point,
            value.target,
            session.motion.samples[0]?.inspection,
          ),
        )
        const result = await prepareAssemblyMotionExport(
          meta.format,
          data,
          session.motion.samples,
          abort.signal,
        )
        abort.signal.throwIfAborted()
        downloadAssemblyMotion(data.studyName, meta.format, result)
      } catch (failure) {
        if (!abort.signal.aborted)
          formApi.setErrorMap({
            onSubmit: {
              form: t("motionExportFailed", {
                reason: t(assemblyMotionExportFailureKey(failure)),
              }),
              fields: {},
            },
          })
      } finally {
        if (request.current === abort) request.current = null
      }
    },
  })
  return (
    <form.AppForm>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <fieldset
            disabled={disabled || busy || !session.motion.samples.length}
            className="grid gap-2"
          >
            <form.AppField name="target">
              {(field) => (
                <field.NativeSelectField label={t("motionTraceInstance")}>
                  <option value="">—</option>
                  {occurrences.map(({ instanceId, sourceIndex }) => (
                    <option
                      key={`${instanceId}:${sourceIndex}`}
                      value={`${instanceId}:${sourceIndex}`}
                    >
                      {instanceId} · {sourceIndex}
                    </option>
                  ))}
                </field.NativeSelectField>
              )}
            </form.AppField>
            <form.AppField name="point">
              {(field) => <field.TextField label={t("motionTracePoint")} />}
            </form.AppField>
            {(["json", "csv", "zip"] as const).map((format) => (
              <Button
                key={format}
                type="button"
                variant="outline"
                disabled={format === "zip" && session.motion.samples.length > 64}
                aria-busy={busy}
                onClick={() => form.handleSubmit({ format })}
              >
                {t(
                  format === "json"
                    ? "motionExportJson"
                    : format === "csv"
                      ? "motionExportCsv"
                      : "motionExportPng",
                )}
              </Button>
            ))}
            <form.FormError />
          </fieldset>
        )}
      </form.Subscribe>
    </form.AppForm>
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

function studyDurationInput(raw: string, study: AssemblyMotionStudy) {
  const value = Number(raw)
  const valid =
    Boolean(raw.trim()) &&
    Number.isFinite(value) &&
    value >= 0.001 &&
    value <= 3600 &&
    canRetimeStudy(study, value)
  return { value, valid, pending: valid && value !== study.duration }
}

type StudyPanelProps = {
  view: Pick<AssemblyWorkspaceView, "assembly" | "studyTask" | "disabled" | "closeStudy"> & {
    mutations: Pick<AssemblyWorkspaceView["mutations"], "apply" | "error">
  }
  session: AssemblyMotionStudySession
}
const StudyFields = withFieldGroup({
  defaultValues: { name: "", duration: "2" },
  props: {} as {
    session: AssemblyMotionStudySession
    draft: AssemblyMotionStudy
    disabled: boolean
  },
  render: function StudyFields({ group, session, draft, disabled }) {
    const t = useTranslations("app.assembly")
    const durationId = useId()
    return (
      <fieldset disabled={disabled} className="grid gap-2">
        <group.AppField
          name="name"
          validators={{
            onChange: ({ value }) => (value.trim() ? undefined : t("motionStudyInvalidDetails")),
          }}
          listeners={{ onChange: ({ value }) => session.edit({ ...draft, name: value }) }}
        >
          {(field) => <field.TextField label={t("motionStudyName")} required />}
        </group.AppField>
        <group.AppField
          name="duration"
          validators={{
            onChange: ({ value }) =>
              studyDurationInput(value, draft).valid ? undefined : t("motionRetimeInvalid"),
          }}
          listeners={{ onChange: () => session.motion.reset() }}
        >
          {(field) => {
            const { value: parsed, valid, pending } = studyDurationInput(field.state.value, draft)
            const invalid = !valid
            const message = invalid
              ? t("motionRetimeInvalid")
              : pending
                ? t("motionNumberPending")
                : ""
            return (
              <Field>
                <FieldLabel htmlFor={durationId}>{t("motionDuration")}</FieldLabel>
                <Input
                  id={durationId}
                  ref={(node) => node?.setCustomValidity(message)}
                  type="number"
                  min={0.001}
                  max={3600}
                  step="any"
                  required
                  value={field.state.value}
                  aria-invalid={invalid || undefined}
                  aria-describedby={message ? `${durationId}-error` : undefined}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  onBlur={() => {
                    field.handleBlur()
                    if (!invalid) {
                      session.edit(retimeAssemblyMotionStudy(draft, parsed))
                      field.handleChange(String(parsed))
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      event.stopPropagation()
                      event.currentTarget.blur()
                    }
                    if (event.key === "Escape" && field.state.value !== String(draft.duration)) {
                      event.preventDefault()
                      event.stopPropagation()
                      field.handleChange(String(draft.duration))
                    }
                  }}
                />
                {message && (
                  <span
                    id={`${durationId}-error`}
                    role={invalid ? "alert" : undefined}
                    className={invalid ? "text-xs text-destructive" : "sr-only"}
                  >
                    {message}
                  </span>
                )}
              </Field>
            )
          }}
        </group.AppField>
      </fieldset>
    )
  },
})
function StudyPlayback({
  draft,
  motion,
  options,
  settings,
  disabled,
}: {
  draft: AssemblyMotionStudy
  motion: AssemblyMotionStudySession["motion"]
  options: AssemblyPlaybackOptions
  settings: React.ReactNode
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
        {settings}
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
  if (view.mutations.error) return <Alert>{t("motionStudySaveFailed")}</Alert>
  const key = assemblyMotionFailureKey(session.motion.error)
  if (!error && !key) return null
  return (
    <Alert>
      {t("motionStudyInvalid", { reason: error ?? t(key ?? "motionStudyInvalidDetails") })}
    </Alert>
  )
}
type ReadyStudyPanelProps = StudyPanelProps & {
  draft: AssemblyMotionStudy
  task: NonNullable<StudyPanelProps["view"]["studyTask"]>
}
function useStudyForm({ view, session, draft, task }: ReadyStudyPanelProps) {
  const t = useTranslations("app.assembly")
  const motion = session.motion
  const form = useAppForm({
    defaultValues: {
      name: draft.name,
      duration: String(draft.duration),
      playback: playbackFieldValues(),
    },
    onSubmit: async ({ value, formApi }) => {
      if (view.disabled || motion.applying || motion.pending || motion.playing) return
      motion.pause()
      const parsed = assemblyMotionStudySchema.safeParse({
        ...draft,
        name: value.name,
        duration: formNumber(value.duration),
      })
      if (!parsed.success) {
        formApi.setErrorMap({ onSubmit: { form: t("motionStudyInvalidDetails"), fields: {} } })
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
          task.revision,
        )
      )
        view.closeStudy()
    },
  })
  return form
}
export function AssemblyMotionStudyPanel({ view, session }: StudyPanelProps) {
  const t = useTranslations("app.assembly")
  const draft = session.draft
  const task = view.studyTask
  if (!draft || !task) return <p>{t("motionStudyEmpty")}</p>
  return <StudyEditor view={view} session={session} draft={draft} task={task} />
}
function StudyEditor(props: ReadyStudyPanelProps) {
  const { view, session, draft, task } = props
  const t = useTranslations("app.assembly")
  const motion = session.motion
  const form = useStudyForm(props)
  const submitting = useStore(form.store, (state) => state.isSubmitting)
  const options = useStore(form.store, (state) => state.values.playback)
  const busy = view.disabled || motion.applying || submitting
  const solving = motion.pending || motion.playing
  const editingDisabled = busy || solving
  const playbackDisabled = busy || motion.playing
  const close = () => {
    motion.reset()
    view.closeStudy()
  }
  return (
    <Form
      form={form}
      noValidate={false}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
      aria-label={t("motionStudies")}
      onInvalidCapture={(event) => {
        let ancestor = event.target instanceof HTMLElement ? event.target.parentElement : null
        while (ancestor && ancestor !== event.currentTarget) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
          ancestor = ancestor.parentElement
        }
      }}
    >
      <TaskPanelLayout
        title={t(session.existing ? "motionEditStudy" : "motionNewStudy")}
        description={t("motionStudyDescription")}
        actions={
          <TaskPanelLifecycleActions
            ariaLabel={t("motionStudies")}
            acceptLabel={t("motionSaveStudy")}
            acceptType="submit"
            acceptDisabled={editingDisabled}
            acceptLoading={submitting}
            cancelLabel={t("cancel")}
            cancelDisabled={busy}
            onCancel={close}
          />
        }
      >
        <StudyPlayback
          draft={draft}
          motion={motion}
          options={playbackOptions(options)}
          disabled={busy}
          settings={
            <AssemblyPlaybackSettings form={form} fields="playback" disabled={playbackDisabled} />
          }
        />
        <StudyFields
          form={form}
          fields={{ name: "name", duration: "duration" }}
          session={session}
          draft={draft}
          disabled={editingDisabled}
        />
        <AssemblyMotionTrackEditor
          study={draft}
          view={view}
          edit={session.edit}
          disabled={editingDisabled}
        />
        <details>
          <summary className="font-medium cursor-pointer py-1 text-xs">
            {t("motionExportOptions")}
          </summary>
          <StudyExport session={session} revision={task.revision} disabled={editingDisabled} />
        </details>
        <form.FormError />
        <StudyFailure view={view} session={session} error={null} />
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
      </TaskPanelLayout>
    </Form>
  )
}
