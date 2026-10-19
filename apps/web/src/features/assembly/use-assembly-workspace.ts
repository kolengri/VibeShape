import type { AssemblyAuthority, AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import type { AssemblyInstanceRecord as AssemblyInstance } from "@vibeshape/domain/assembly-mates"
import { useTranslations } from "@vibeshape/i18n"
import { useCallback, useRef, useState } from "react"
import {
  commitAuthoredTransaction,
  type DocumentControllerState,
  previewAssemblyChanges,
} from "../../document/document-controller"
import type { AssemblyFormActions } from "./assembly-forms"
import {
  type AssemblyDocumentContext,
  activeAssembly,
  assemblyDocumentContext,
  assemblyPartSources,
  createAssemblyTransaction,
  groundAssemblyInstanceChanges,
} from "./assembly-model"
import { type AssemblyMotionCoordinate, assemblyMotionCoordinates } from "./assembly-motion"
import type { AssemblyRemoval } from "./assembly-remove-dialog"
import { useAssemblyInspection } from "./use-assembly-inspection"

export type AssemblyTask = {
  kind:
    | "createDefinition"
    | "editDefinition"
    | "relinkDefinition"
    | "addInstance"
    | "editInstance"
    | "addJoint"
    | "editJoint"
  id: string | null
  revision: number
}
type AssemblyMotionTask = {
  id: string
  coordinate: AssemblyMotionCoordinate["kind"]
  documentKey: string
  revision: number
}
function reviewedBase(
  context: AssemblyDocumentContext | null,
  writable: boolean,
  revision: number,
) {
  if (!context || !writable || context.revision !== revision) return null
  return context
}
async function commitIntent(
  context: AssemblyDocumentContext,
  changes: readonly AssemblyMutation[],
  preflight = false,
) {
  try {
    if (preflight) {
      const preview = await previewAssemblyChanges(changes, context.revision)
      if (!preview.ok) return { ok: false as const, reason: preview.diagnostic.message }
    }
    const result = await commitAuthoredTransaction(
      context.revision,
      createAssemblyTransaction(context, changes),
    )
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, reason: result.diagnostic.message }
  } catch {
    return { ok: false as const, reason: null }
  }
}
function useAssemblyMutations(
  context: AssemblyDocumentContext | null,
  writable: boolean,
  general: boolean,
) {
  const t = useTranslations("app.assembly")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const failureCopy = (reason: string | null) =>
    reason === null ? t("saveFailed") : t("operationFailed", { reason })
  const apply = async (changes: readonly AssemblyMutation[], revision: number) => {
    if (lock.current) return false
    const base = reviewedBase(context, writable, revision)
    if (!base) {
      setError(t("staleRevision"))
      return false
    }
    lock.current = true
    setPending(true)
    setError(null)
    try {
      const prepared = general
        ? changes.map((change) => {
            if (
              (change.kind === "instance.create" || change.kind === "instance.update") &&
              change.instance.schemaVersion === 1 &&
              change.instance.grounded
            )
              return { ...change, instance: { ...change.instance, schemaVersion: 2 as const } }
            return change
          })
        : changes
      const result = await commitIntent(
        base,
        prepared,
        general || changes.some((change) => change.kind === "assembly.upgrade"),
      )
      if (!result.ok) setError(failureCopy(result.reason))
      return result.ok
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return { pending, error, apply }
}
function selectionRecords(
  assembly: AssemblyAuthority,
  instanceId: string | null,
  definitionId: string | null,
) {
  const instance = assembly.instances.find(({ id }) => id === instanceId)
  const definition = assembly.definitions.find(
    ({ id }) => id === (definitionId ?? instance?.definitionId),
  )
  return { instance, definition, activeId: instance ? instance.id : null }
}
function inspectionContext(context: AssemblyDocumentContext | null) {
  return context?.authorityVersion === 4 || context?.authorityVersion === 5 ? context : null
}
type StudyTask = { id: string | null; documentKey: string; revision: number }
function assemblyDocumentKey(context: AssemblyDocumentContext | null) {
  return context ? `${context.documentId}:${context.revision}` : "unavailable"
}
function useAssemblyStudyTask(context: AssemblyDocumentContext | null) {
  const [selection, setSelection] = useState<StudyTask | null>(null)
  const documentKey = assemblyDocumentKey(context)
  const task = selection?.documentKey === documentKey ? selection : null
  const open = (id: string | null) => {
    if (context) setSelection({ id, documentKey, revision: context.revision })
  }
  return { task, open, close: () => setSelection(null) }
}
function useAssemblyMotionTask(
  context: AssemblyDocumentContext | null,
  assembly: AssemblyAuthority,
  blocked: boolean,
) {
  const [task, setTask] = useState<AssemblyMotionTask | null>(null)
  const documentKey = assemblyDocumentKey(context)
  const motion = task?.documentKey === documentKey ? task : null
  const openMotion = (id: string) => {
    if (!context || blocked || motion) return
    const joint = assembly.joints.find((joint) => joint.id === id)
    const coordinate = joint ? assemblyMotionCoordinates(joint)[0] : null
    if (coordinate)
      setTask({ id, coordinate: coordinate.kind, documentKey, revision: context.revision })
  }
  const closeMotion = (expectedKey?: string) =>
    setTask((previous) => (expectedKey && previous?.documentKey !== expectedKey ? previous : null))
  const setMotionCoordinate = (coordinate: AssemblyMotionCoordinate["kind"]) => {
    if (!blocked && motion) setTask({ ...motion, coordinate })
  }
  return { motion, documentKey, openMotion, closeMotion, setMotionCoordinate }
}
function assemblyPanelState(
  task: AssemblyTask | null,
  motion: AssemblyMotionTask | null,
  study: StudyTask | null,
) {
  if (study)
    return { idle: false, panelKey: `motion-study:${study.id ?? "new"}`, motionActive: true }
  return {
    idle: task === null && motion === null,
    panelKey: task ? `${task.kind}:${task.id}` : motion ? `motion:${motion.id}` : "assembly",
    motionActive: motion !== null,
  }
}
export function useAssemblyWorkspace(controller: DocumentControllerState) {
  const context = assemblyDocumentContext(controller)
  const assembly = activeAssembly(controller)
  const sources = assemblyPartSources(controller)
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [definitionId, setDefinitionId] = useState<string | null>(null)
  const [task, setTask] = useState<AssemblyTask | null>(null)
  const [removal, setRemoval] = useState<AssemblyRemoval | null>(null)
  const study = useAssemblyStudyTask(context)
  const writable =
    controller.status === "ready" && controller.saveStatus !== "saving" && context !== null
  const mutations = useAssemblyMutations(context, writable, assembly.schemaVersion === 2)
  const inspection = useAssemblyInspection(inspectionContext(context))
  const selected = selectionRecords(assembly, instanceId, definitionId)
  const disabled = !writable || mutations.pending
  const { motion, documentKey, openMotion, closeMotion, setMotionCoordinate } =
    useAssemblyMotionTask(
      context,
      assembly,
      disabled || inspection.pending || task !== null || removal !== null || study.task !== null,
    )
  const studyTask = study.task
  const panelState = assemblyPanelState(task, motion, studyTask)
  const taskActionsDisabled = disabled || inspection.pending || !panelState.idle || removal !== null
  const selectInstance = useCallback((id: string | null) => {
    setInstanceId(id)
    setDefinitionId(null)
  }, [])
  const selectDefinition = useCallback((id: string) => {
    setDefinitionId(id)
    setInstanceId(null)
  }, [])
  const openTask = (kind: AssemblyTask["kind"], id: string | null = null) => {
    if (disabled || motion || studyTask) return
    if (context) setTask({ kind, id, revision: context.revision })
  }
  const onRemove = (kind: AssemblyRemoval["kind"], id: string, name: string) => {
    if (context) setRemoval({ kind, id, name, revision: context.revision })
  }
  const ground = async (instance: AssemblyInstance) => {
    if (context)
      await mutations.apply(
        groundAssemblyInstanceChanges(assembly, instance, inspection.inspection ?? undefined),
        context.revision,
      )
  }
  return {
    assembly,
    documentKey,
    sources,
    task,
    setTask,
    removal,
    setRemoval,
    mutations,
    inspection,
    selected,
    definitionId,
    disabled,
    selectInstance,
    selectDefinition,
    openTask,
    motion,
    studyTask,
    openStudy: (id: string | null) => {
      if (!taskActionsDisabled) study.open(id)
    },
    closeStudy: study.close,
    ...panelState,
    taskActionsDisabled,
    openMotion,
    closeMotion,
    setMotionCoordinate,
    onRemove,
    ground,
    upgrade: async () =>
      context ? mutations.apply([{ kind: "assembly.upgrade" }], context.revision) : false,
  }
}
export type AssemblyWorkspaceView = ReturnType<typeof useAssemblyWorkspace>
export function assemblyTaskActions(view: AssemblyWorkspaceView): AssemblyFormActions {
  const revision = view.task ? view.task.revision : -1
  return {
    pending: view.disabled,
    onCancel: () => view.setTask(null),
    onApply: async (changes) => {
      const applied = await view.mutations.apply(changes, revision)
      if (applied) view.setTask(null)
      return applied
    },
  }
}
