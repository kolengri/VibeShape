import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import type { ComponentType } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { useReportApplicationError } from "../../shell/application-notices"
import { ResponsiveTaskPanel } from "../../shell/responsive-task-panel"
import { WorkspacePanels } from "../../shell/workspace-panels"
import { AssemblyAsBuiltJointForm, AssemblyRigidGroupForm } from "./assembly-as-built-form"
import { AssemblyDefinitionForm } from "./assembly-definition-form"
import { AssemblyTaskPanelContext } from "./assembly-forms"
import { AssemblyInstanceForm } from "./assembly-instance-form"
import { AssemblyInterference } from "./assembly-interference"
import { AssemblyJointForm } from "./assembly-joint-form"
import {
  AssemblyMotionPreviewBadge,
  type AssemblyMotionSession,
  AssemblyMotionTask,
  useAssemblyMotionSession,
} from "./assembly-motion-session"
import {
  AssemblyMotionStudyPanel,
  type AssemblyMotionStudySession,
  useAssemblyMotionStudySession,
} from "./assembly-motion-study-panel"
import { AssemblyRemoveDialog } from "./assembly-remove-dialog"
import { AssemblyToolbar } from "./assembly-toolbar"
import { AssemblyTree } from "./assembly-tree"
import { AssemblyViewport } from "./assembly-viewport"
import {
  type AssemblyTask,
  type AssemblyWorkspaceView,
  assemblyTaskActions,
  useAssemblyWorkspace,
} from "./use-assembly-workspace"

type TaskProps = { view: AssemblyWorkspaceView; task: AssemblyTask; selectedPartId: string | null }
function DefinitionTask({ view, task, selectedPartId }: TaskProps) {
  const definition = view.assembly.definitions.find(({ id }) => id === task.id)
  const mode = task.kind === "editDefinition" ? "metadata" : "relink"
  return definition ? (
    <AssemblyDefinitionForm
      mode={mode}
      definition={definition}
      sources={view.sources}
      selectedPartId={selectedPartId}
      actions={assemblyTaskActions(view)}
    />
  ) : null
}
function InstanceTask({ view, task }: TaskProps) {
  const instance = view.assembly.instances.find(({ id }) => id === task.id)
  return instance ? (
    <AssemblyInstanceForm
      assembly={view.assembly}
      instance={instance}
      actions={assemblyTaskActions(view)}
    />
  ) : null
}
function JointTask({ view, task }: TaskProps) {
  const joint = view.assembly.joints.find(({ id }) => id === task.id)
  return joint ? (
    <AssemblyJointForm
      assembly={view.assembly}
      joint={joint}
      selectedId={view.selected.activeId}
      inspection={view.inspection.inspection}
      actions={assemblyTaskActions(view)}
    />
  ) : null
}
function CapturedPoseTask({ view, task }: TaskProps) {
  if (!("capture" in task)) return null
  const Form = task.kind === "asBuiltJoint" ? AssemblyAsBuiltJointForm : AssemblyRigidGroupForm
  return (
    <Form
      assembly={view.assembly}
      capture={task.capture}
      selectedId={view.selected.activeId}
      actions={assemblyTaskActions(view)}
    />
  )
}
const taskForms: Record<AssemblyTask["kind"], ComponentType<TaskProps>> = {
  asBuiltJoint: CapturedPoseTask,
  rigidGroup: CapturedPoseTask,
  createDefinition: ({ view, selectedPartId }) => (
    <AssemblyDefinitionForm
      mode="create"
      sources={view.sources}
      selectedPartId={selectedPartId}
      actions={assemblyTaskActions(view)}
    />
  ),
  editDefinition: DefinitionTask,
  relinkDefinition: DefinitionTask,
  addInstance: ({ view }) => (
    <AssemblyInstanceForm assembly={view.assembly} actions={assemblyTaskActions(view)} />
  ),
  editInstance: InstanceTask,
  addJoint: ({ view }) => (
    <AssemblyJointForm
      assembly={view.assembly}
      selectedId={view.selected.activeId}
      inspection={view.inspection.inspection}
      actions={assemblyTaskActions(view)}
    />
  ),
  editJoint: JointTask,
}
function AssemblySolveSummary({ kinematics }: { kinematics: AssemblyInspection["kinematics"] }) {
  const t = useTranslations("app.assembly")
  if (!kinematics) return null
  return (
    <div role="status" className="grid gap-1 text-sm">
      <p>
        {t("solverState", {
          status: t(
            kinematics.status === "fully-constrained" ? "fullyConstrained" : "underConstrained",
          ),
          dof: kinematics.degreesOfFreedom,
        })}
      </p>
      {kinematics.redundant && (
        <p className="text-xs text-muted-foreground">{t("redundantMates")}</p>
      )}
    </div>
  )
}
function GeneralMateStatus({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <>
      {view.assembly.schemaVersion === 1 && (
        <p className="text-xs text-muted-foreground">{t("generalMatesExplanation")}</p>
      )}
      <AssemblySolveSummary kinematics={view.inspection.inspection?.kinematics} />
    </>
  )
}
function FrozenDefinitionReference({ selected }: { selected: AssemblyWorkspaceView["selected"] }) {
  const t = useTranslations("app.assembly")
  if (!selected.definition) return null
  return (
    <p className="break-words text-xs text-muted-foreground">
      {selected.instance?.name ?? selected.definition.name} ·{" "}
      {t("pinRevision", { revision: selected.definition.pinRevision })}
    </p>
  )
}
function AssemblyActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <>
      <AssemblyToolbar view={view} />
      <GeneralMateStatus view={view} />
      <p className="text-xs text-muted-foreground">{t("frozenExplanation")}</p>
      <FrozenDefinitionReference selected={view.selected} />
      <AssemblyInterference
        assembly={view.assembly}
        inspection={view.inspection.inspection}
        selectedId={view.selected.activeId}
        pending={view.inspection.pending || view.disabled}
        onInspect={view.inspection.inspectPairs}
      />
    </>
  )
}
function AssemblyPanelContent({
  view,
  selectedPartId,
  motion,
  study,
}: {
  view: AssemblyWorkspaceView
  selectedPartId: string | null
  motion: AssemblyMotionSession
  study: AssemblyMotionStudySession
}) {
  const t = useTranslations("app.assembly")
  const task = view.task
  if (view.studyTask)
    return (
      <AssemblyMotionStudyPanel
        key={`${view.documentKey}:${view.panelKey}`}
        view={view}
        session={study}
      />
    )
  if (view.motion) return <AssemblyMotionTask view={view} motion={motion} />
  if (!task) return <AssemblyActions view={view} />
  const Form = taskForms[task.kind]
  return (
    <AssemblyTaskPanelContext.Provider value={{ title: t(task.kind), error: view.mutations.error }}>
      <Form
        key={`${task.kind}:${task.id}:${task.revision}`}
        task={task}
        view={view}
        selectedPartId={selectedPartId}
      />
    </AssemblyTaskPanelContext.Provider>
  )
}
function AssemblyInspectionStatus({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <>
      {view.inspection.pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("inspecting")}
        </p>
      )}
      {view.inspection.diagnostic && (
        <p role="alert" className="text-sm text-destructive">
          {t("inspectionFailed", { reason: view.inspection.diagnostic })}
        </p>
      )}
    </>
  )
}
function IdleAssemblyPanelHeading({ error }: { error: string | null }) {
  const t = useTranslations("app.assembly")
  const appOwnsError = useReportApplicationError(error)
  return (
    <>
      <h2 className="text-base font-semibold">{t("workspaceTitle")}</h2>
      {error && !appOwnsError && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

function AssemblyPanel({
  view,
  selectedPartId,
  motion,
  study,
}: {
  view: AssemblyWorkspaceView
  selectedPartId: string | null
  motion: AssemblyMotionSession
  study: AssemblyMotionStudySession
}) {
  const t = useTranslations("app.assembly")
  return (
    <ResponsiveTaskPanel
      activeTaskKey={view.panelKey}
      collapseLabel={t("collapsePanel")}
      expandLabel={t("expandPanel")}
    >
      <section
        className="grid h-full min-h-0 min-w-0 content-start gap-4 overflow-y-auto p-4"
        aria-label={t("taskPanel")}
      >
        {view.idle && <IdleAssemblyPanelHeading error={view.mutations.error} />}
        <AssemblyPanelContent
          view={view}
          selectedPartId={selectedPartId}
          motion={motion}
          study={study}
        />
        <AssemblyInspectionStatus view={view} />
      </section>
    </ResponsiveTaskPanel>
  )
}
export function AssemblyWorkspace({
  controller,
  selectedPartId,
}: {
  controller: DocumentControllerState
  selectedPartId: string | null
}) {
  const view = useAssemblyWorkspace(controller)
  const motion = useAssemblyMotionSession(view)
  const study = useAssemblyMotionStudySession(view)
  const preview = study.motion.inspection ?? motion.state.inspection
  return (
    <>
      <WorkspacePanels
        allowTransparency={false}
        modelTree={
          <AssemblyTree
            assembly={view.assembly}
            selectedId={view.selected.activeId}
            selectedDefinitionId={view.definitionId}
            onSelectInstance={view.selectInstance}
            onSelectDefinition={view.selectDefinition}
            onDriveJoint={view.openMotion}
            onSelectJoint={(id: string) => view.openTask("editJoint", id)}
            motionDisabled={view.taskActionsDisabled}
          />
        }
        taskPanel={
          <AssemblyPanel
            view={view}
            selectedPartId={selectedPartId}
            motion={motion}
            study={study}
          />
        }
      >
        <AssemblyViewport
          inspection={preview ?? view.inspection.inspection}
          selectedId={view.selected.activeId}
          onSelect={view.selectInstance}
          autoFit={!view.motionActive}
        />
        <AssemblyMotionPreviewBadge visible={preview !== null} />
      </WorkspacePanels>
      {view.removal && (
        <AssemblyRemoveDialog
          key={`${view.removal.kind}:${view.removal.id}`}
          removal={view.removal}
          general={view.assembly.schemaVersion === 2}
          pending={view.disabled}
          error={view.mutations.error}
          onApply={view.mutations.apply}
          onClose={() => view.setRemoval(null)}
        />
      )}
    </>
  )
}
