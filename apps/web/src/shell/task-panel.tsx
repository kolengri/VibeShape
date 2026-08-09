import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"
import {
  addFeature,
  createBrowserFeatureId,
  type DocumentControllerState,
  updateFeature,
} from "../document/document-controller"
import { BoxForm, type BoxFormMode } from "../features/box/box-form"
import { CylinderForm, type CylinderFormMode } from "../features/cylinder/cylinder-form"
import {
  type ActivePartDesignTool,
  isBoxFeature,
  isCylinderFeature,
} from "../features/part-design/part-design-tool"

type TaskPanelProps = Readonly<{
  activeTool: ActivePartDesignTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onCreateCylinder: () => void
  workspace: "model" | "variables"
}>

function VariablesTaskPanel() {
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("variables.title")}</h2>
      <p className="mt-2 leading-5 text-muted-foreground">{t("variables.description")}</p>
      <ul className="mt-4 grid gap-2 border-t pt-4 text-muted-foreground">
        <li>{t("variables.reference")}</li>
        <li>{t("variables.units")}</li>
        <li>{t("variables.names")}</li>
      </ul>
    </aside>
  )
}

function useBoxFormCopy(mode: BoxFormMode["kind"]) {
  const t = useTranslations("app.shell.taskPanel")
  const operationCopy = {
    create: {
      title: t("box.title"),
      description: t("box.description"),
      submit: t("box.create"),
      validationSummary: t("box.validationSummary"),
      saveFailed: t("box.createFailed"),
    },
    edit: {
      title: t("box.editTitle"),
      description: t("box.editDescription"),
      submit: t("box.update"),
      validationSummary: t("box.updateValidationSummary"),
      saveFailed: t("box.updateFailed"),
    },
  }[mode]
  return {
    ...operationCopy,
    dimensions: t("box.dimensions"),
    width: t("box.width"),
    depth: t("box.depth"),
    height: t("box.height"),
    centered: t("box.centered"),
    expressionDescription: t("box.expressionDescription"),
    cancel: t("box.cancel"),
    invalidExpression: t("box.invalidExpression"),
    invalidDimension: t("box.invalidDimension"),
    invalidRange: t("box.invalidRange"),
    staleRevision: t("box.staleRevision"),
  }
}

function useCylinderFormCopy(mode: CylinderFormMode["kind"]) {
  const t = useTranslations("app.shell.taskPanel")
  const operationCopy = {
    create: {
      title: t("cylinder.title"),
      description: t("cylinder.description"),
      submit: t("cylinder.create"),
      validationSummary: t("cylinder.validationSummary"),
      saveFailed: t("cylinder.createFailed"),
    },
    edit: {
      title: t("cylinder.editTitle"),
      description: t("cylinder.editDescription"),
      submit: t("cylinder.update"),
      validationSummary: t("cylinder.updateValidationSummary"),
      saveFailed: t("cylinder.updateFailed"),
    },
  }[mode]
  return {
    ...operationCopy,
    dimensions: t("cylinder.dimensions"),
    radius: t("cylinder.radius"),
    height: t("cylinder.height"),
    centered: t("cylinder.centered"),
    expressionDescription: t("cylinder.expressionDescription"),
    cancel: t("cylinder.cancel"),
    invalidExpression: t("cylinder.invalidExpression"),
    invalidDimension: t("cylinder.invalidDimension"),
    invalidRange: t("cylinder.invalidRange"),
    staleRevision: t("cylinder.staleRevision"),
  }
}

function featureTaskContext(mode: BoxFormMode | CylinderFormMode, revision: number) {
  return mode.kind === "edit"
    ? { key: `edit:${mode.feature.id}:${revision}`, onSave: updateFeature }
    : { key: `create:${revision}`, onSave: addFeature }
}

function BoxTaskPanel({
  mode,
  onCloseTool,
  report,
}: {
  mode: BoxFormMode
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const snapshot = report.snapshot
  const boxCopy = useBoxFormCopy(mode.kind)
  const task = featureTaskContext(mode, snapshot.revision)
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <BoxForm
        key={task.key}
        baseRevision={snapshot.revision}
        variables={snapshot.variables}
        copy={boxCopy}
        disabled={report.mode === "read-only"}
        mode={mode}
        onCancel={onCloseTool}
        onSave={task.onSave}
        onSaved={onCloseTool}
      />
    </aside>
  )
}

function CylinderTaskPanel({
  mode,
  onCloseTool,
  report,
}: {
  mode: CylinderFormMode
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const snapshot = report.snapshot
  const cylinderCopy = useCylinderFormCopy(mode.kind)
  const task = featureTaskContext(mode, snapshot.revision)
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <CylinderForm
        key={task.key}
        baseRevision={snapshot.revision}
        variables={snapshot.variables}
        copy={cylinderCopy}
        disabled={report.mode === "read-only"}
        mode={mode}
        onCancel={onCloseTool}
        onSave={task.onSave}
        onSaved={onCloseTool}
      />
    </aside>
  )
}

function boxFormMode(
  activeTool: Extract<ActivePartDesignTool, { kind: "create-box" | "edit-box" }>,
  report: NonNullable<DocumentControllerState["report"]>,
  featureLabel: string,
): BoxFormMode | null {
  if (activeTool.kind === "create-box") {
    return { kind: "create", createFeatureId: createBrowserFeatureId, featureLabel }
  }
  const feature = report.snapshot.features.find(({ id }) => id === activeTool.featureId)
  return feature && isBoxFeature(feature) ? { kind: "edit", feature } : null
}

function cylinderFormMode(
  activeTool: Extract<ActivePartDesignTool, { kind: "create-cylinder" | "edit-cylinder" }>,
  report: NonNullable<DocumentControllerState["report"]>,
  featureLabel: string,
): CylinderFormMode | null {
  if (activeTool.kind === "create-cylinder") {
    return { kind: "create", createFeatureId: createBrowserFeatureId, featureLabel }
  }
  const feature = report.snapshot.features.find(({ id }) => id === activeTool.featureId)
  return feature && isCylinderFeature(feature) ? { kind: "edit", feature } : null
}

function StartTaskPanel({
  canCreate,
  onCreateBox,
  onCreateCylinder,
}: {
  canCreate: boolean
  onCreateBox: () => void
  onCreateCylinder: () => void
}) {
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("startModeling")}</h2>
      <p className="mt-2 leading-5 text-muted-foreground">{t("description")}</p>
      <Button type="button" className="mt-4 w-full" disabled={!canCreate} onClick={onCreateBox}>
        {t("createBox")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        disabled={!canCreate}
        onClick={onCreateCylinder}
      >
        {t("createCylinder")}
      </Button>
    </aside>
  )
}

function canCreateFeature(controller: DocumentControllerState) {
  return controller.status === "ready" && controller.report?.mode === "read-write"
}

function ActiveBoxTaskPanel({
  activeTool,
  onCloseTool,
  report,
}: {
  activeTool: Extract<ActivePartDesignTool, { kind: "create-box" | "edit-box" }>
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel")
  const boxCount = report.snapshot.features.filter(isBoxFeature).length
  const mode = boxFormMode(activeTool, report, t("box.featureLabel", { number: boxCount + 1 }))
  return mode ? <BoxTaskPanel report={report} mode={mode} onCloseTool={onCloseTool} /> : null
}

function ActiveCylinderTaskPanel({
  activeTool,
  onCloseTool,
  report,
}: {
  activeTool: Extract<ActivePartDesignTool, { kind: "create-cylinder" | "edit-cylinder" }>
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel")
  const cylinderCount = report.snapshot.features.filter(isCylinderFeature).length
  const mode = cylinderFormMode(
    activeTool,
    report,
    t("cylinder.featureLabel", { number: cylinderCount + 1 }),
  )
  return mode ? <CylinderTaskPanel report={report} mode={mode} onCloseTool={onCloseTool} /> : null
}

function ActiveTaskPanel({
  activeTool,
  onCloseTool,
  report,
}: {
  activeTool: ActivePartDesignTool
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  return activeTool.kind === "create-box" || activeTool.kind === "edit-box" ? (
    <ActiveBoxTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  ) : (
    <ActiveCylinderTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  )
}

function ModelTaskPanel({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onCreateCylinder,
}: TaskPanelProps) {
  const report = controller.report
  return activeTool && report ? (
    <ActiveTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  ) : (
    <StartTaskPanel
      canCreate={canCreateFeature(controller)}
      onCreateBox={onCreateBox}
      onCreateCylinder={onCreateCylinder}
    />
  )
}

const taskPanelByWorkspace = {
  model: ModelTaskPanel,
  variables: VariablesTaskPanel,
} satisfies Record<TaskPanelProps["workspace"], (props: TaskPanelProps) => ReactNode>

export function TaskPanel(props: TaskPanelProps) {
  const Panel = taskPanelByWorkspace[props.workspace]
  return <Panel {...props} />
}
