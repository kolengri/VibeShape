import type { SketchEntityId, SketchRecord } from "@vibeshape/domain"
import { detachSketchTextGroup } from "@vibeshape/domain/sketch-text-edit"
import type { SketchTextGroup } from "@vibeshape/domain/sketch-text-groups"
import { useEffect, useRef, useState } from "react"
import type { SketchTextActions } from "./text-context"
import { loadSketchTextFont, SketchTextFontError } from "./text-font"
import {
  attachedSketchTextConstraints,
  createSketchTextDraft,
  parseSketchTextValues,
  SketchTextOutlineError,
  type SketchTextValues,
  sketchTextDraftUnchanged,
  sketchTextOutlineAltered,
  sketchTextValues,
  type TextFieldErrors,
} from "./text-model"

export type SketchTextTarget = { sketch: SketchRecord; group: SketchTextGroup | null }
export function useSketchTextManager({
  draft,
  disabled,
  getDraft,
  onDraftChange,
  onOpen,
  staleMessage,
}: {
  draft: SketchRecord | null
  disabled: boolean
  getDraft: () => SketchRecord | null
  onDraftChange: (draft: SketchRecord) => void
  onOpen: () => void
  staleMessage: string
}) {
  const [target, setTarget] = useState<SketchTextTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (disabled || target?.sketch.id !== draft?.id) setTarget(null)
  }, [disabled, draft?.id, target])
  const begin = (groupId?: SketchEntityId) => {
    if (disabled || target) return
    const sketch = getDraft()
    if (!sketch) return
    const group = groupId ? sketch.textGroups?.find(({ id }) => id === groupId) : null
    if (groupId && !group) {
      setError(staleMessage)
      return
    }
    setError(null)
    onOpen()
    setTarget({ sketch, group: group ?? null })
  }
  const actions: SketchTextActions = {
    create: () => begin(),
    edit: begin,
    detach: (groupId) => {
      if (disabled || target) return
      const current = getDraft()
      if (!current?.textGroups?.some(({ id }) => id === groupId)) {
        setError(staleMessage)
        return
      }
      setError(null)
      onDraftChange(detachSketchTextGroup(current, groupId))
    },
    error,
  }
  return { target, actions, close: () => setTarget(null) }
}
export type SketchTextTaskCopy = {
  stale: string
  constraints: string
  fontFailed: string
  outlineFailed: string
  outlineProblem: (error: SketchTextOutlineError) => string
}
function taskPrecondition(
  target: SketchTextTarget,
  current: SketchRecord | null,
  constraints: number,
  removeConstraints: boolean,
  copy: SketchTextTaskCopy,
) {
  if (constraints && !removeConstraints) return copy.constraints
  if (!sketchTextDraftUnchanged(target.sketch, current)) return copy.stale
  return null
}
function taskProblem(problem: unknown, copy: SketchTextTaskCopy) {
  if (problem instanceof SketchTextOutlineError) return copy.outlineProblem(problem)
  if (problem instanceof SketchTextFontError) return copy.fontFailed
  return copy.outlineFailed
}
async function prepareTaskDraft(
  target: SketchTextTarget,
  parsed: Extract<ReturnType<typeof parseSketchTextValues>, { ok: true }>,
  removeAttachedConstraints: boolean,
  isActive: () => boolean,
) {
  const fontBytes = await loadSketchTextFont()
  if (!isActive()) return null
  return createSketchTextDraft(target.sketch, {
    parameters: parsed.parameters,
    origin: parsed.origin,
    fontBytes,
    ...(target.group ? { groupId: target.group.id } : {}),
    removeAttachedConstraints,
  })
}
function publishTaskDraft({
  isActive,
  generated,
  captured,
  getDraft,
  onDraftChange,
  onApplied,
  onStale,
}: {
  isActive: () => boolean
  generated: SketchRecord | null
  captured: SketchRecord
  getDraft: () => SketchRecord | null
  onDraftChange: (draft: SketchRecord) => void
  onApplied: () => void
  onStale: () => void
}) {
  if (!isActive() || !generated) return
  if (!sketchTextDraftUnchanged(captured, getDraft())) return onStale()
  onDraftChange(generated)
  onApplied()
}
export function useSketchTextTask({
  target,
  getDraft,
  onDraftChange,
  onApplied,
  copy,
}: {
  target: SketchTextTarget
  getDraft: () => SketchRecord | null
  onDraftChange: (draft: SketchRecord) => void
  onApplied: () => void
  copy: SketchTextTaskCopy
}) {
  const [values, setValues] = useState(() => sketchTextValues(target.group ?? undefined))
  const [fieldErrors, setFieldErrors] = useState<TextFieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [altered, setAltered] = useState<boolean | null>(target.group ? null : false)
  const active = useRef(true),
    lock = useRef(false)
  const constraints = target.group
    ? attachedSketchTextConstraints(target.sketch, target.group).length
    : 0
  useEffect(() => {
    active.current = true
    if (target.group)
      void sketchTextOutlineAltered(target.sketch, target.group)
        .then((changed) => {
          if (active.current) setAltered(changed)
        })
        .catch(() => {
          if (active.current) setError(copy.outlineFailed)
        })
    return () => {
      active.current = false
    }
  }, [target, copy.outlineFailed])
  const update = <K extends keyof SketchTextValues>(field: K, value: SketchTextValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setError(null)
  }
  const apply = async () => {
    if (lock.current || altered === null) return
    const parsed = parseSketchTextValues(values)
    setFieldErrors(parsed.errors)
    if (!parsed.ok) return
    const precondition = taskPrecondition(
      target,
      getDraft(),
      constraints,
      values.removeAttachedConstraints,
      copy,
    )
    if (precondition) return setError(precondition)
    lock.current = true
    setPending(true)
    setError(null)
    try {
      const generated = await prepareTaskDraft(
        target,
        parsed,
        values.removeAttachedConstraints,
        () => active.current,
      )
      publishTaskDraft({
        isActive: () => active.current,
        generated,
        captured: target.sketch,
        getDraft,
        onDraftChange,
        onApplied,
        onStale: () => setError(copy.stale),
      })
    } catch (problem) {
      if (active.current) setError(taskProblem(problem, copy))
    } finally {
      lock.current = false
      if (active.current) setPending(false)
    }
  }
  return { values, fieldErrors, error, pending, altered, constraints, update, apply }
}
export type SketchTextTask = ReturnType<typeof useSketchTextTask>
