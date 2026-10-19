import { useTranslations } from "@vibeshape/i18n"
import type { AssemblyInspection } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import type { ComponentType } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { ResponsiveTaskPanel } from "../../shell/responsive-task-panel"
import { WorkspacePanels } from "../../shell/workspace-panels"
import { AssemblyDefinitionForm } from "./assembly-definition-form"
import { AssemblyExportDialog } from "./assembly-export-dialog"
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
  AssemblyMotionStudyActions,
  AssemblyMotionStudyPanel,
  type AssemblyMotionStudySession,
  useAssemblyMotionStudySession,
} from "./assembly-motion-study-panel"
import { AssemblyRemoveDialog } from "./assembly-remove-dialog"
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
const taskForms: Record<AssemblyTask["kind"], ComponentType<TaskProps>> = {
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
function InstanceActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const instance = view.selected.instance
  if (!instance) return null
  const joints = view.assembly.joints.filter(
    ({ childInstanceId, parentInstanceId }) =>
      childInstanceId === instance.id ||
      (view.assembly.schemaVersion === 2 && parentInstanceId === instance.id),
  )
  return (
    <div className="grid gap-2">
      <h3 className="break-words text-sm font-semibold">{instance.name}</h3>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={view.disabled}
        onClick={() => view.openTask("editInstance", instance.id)}
      >
        {t("editInstance")}
      </Button>
      {joints.map((joint) => (
        <Button
          key={joint.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={view.disabled}
          onClick={() => view.openTask("editJoint", joint.id)}
        >
          {t("editJoint")}
        </Button>
      ))}
      {!instance.grounded && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={view.disabled}
          onClick={() => view.ground(instance)}
        >
          {t("groundInstance")}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={view.disabled}
        onClick={() => view.onRemove("instance", instance.id, instance.name)}
      >
        {t("removeInstance")}
      </Button>
    </div>
  )
}
function DefinitionActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const definition = view.selected.definition
  if (!definition) return null
  return (
    <div className="grid gap-2">
      <h3 className="mt-2 break-words text-sm font-semibold">{definition.name}</h3>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={view.disabled}
        onClick={() => view.openTask("editDefinition", definition.id)}
      >
        {t("editDefinition")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={view.disabled}
        onClick={() => view.openTask("relinkDefinition", definition.id)}
      >
        {t("relinkDefinition")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={view.disabled}
        onClick={() => view.onRemove("definition", definition.id, definition.name)}
      >
        {t("removeDefinition")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("pinRevision", { revision: definition.pinRevision })}
      </p>
    </div>
  )
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
        <>
          <Button
            type="button"
            variant="outline"
            disabled={view.disabled || view.inspection.pending}
            onClick={() => void view.upgrade()}
          >
            {t("generalMates")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("generalMatesExplanation")}</p>
        </>
      )}
      <AssemblySolveSummary kinematics={view.inspection.inspection?.kinematics} />
    </>
  )
}
function AssemblyActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const available = {
    createDefinition: Boolean(view.sources.length),
    addInstance: Boolean(view.assembly.definitions.length),
    addJoint: Boolean(view.assembly.instances.length),
  }
  return (
    <>
      <div className="grid gap-2">
        {(["createDefinition", "addInstance", "addJoint"] as const).map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            disabled={view.disabled || !available[kind]}
            onClick={() => view.openTask(kind)}
          >
            {t(kind)}
          </Button>
        ))}
      </div>
      <GeneralMateStatus view={view} />
      <AssemblyMotionStudyActions view={view} />
      <AssemblyExportDialog
        key={view.documentKey}
        instances={view.assembly.instances}
        selectedId={view.selected.activeId}
        inspection={view.inspection.inspection}
        disabled={view.disabled || view.inspection.pending}
      />
      <p className="text-xs text-muted-foreground">{t("frozenExplanation")}</p>
      <InstanceActions view={view} />
      <DefinitionActions view={view} />
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
  return (
    <>
      <h2 className="text-base font-semibold">{t("workspaceTitle")}</h2>
      {error && (
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
