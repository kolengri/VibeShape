import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  addFeature,
  createBrowserFeatureId,
  type DocumentControllerState,
  updateFeature,
} from "../document/document-controller"
import { BoxForm, type BoxFormMode } from "../features/box/box-form"
import { type ActiveBoxTool, isBoxFeature } from "../features/box/box-tool"

type TaskPanelProps = Readonly<{
  activeTool: ActiveBoxTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
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

function boxTaskContext(mode: BoxFormMode, revision: number) {
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
  const task = boxTaskContext(mode, snapshot.revision)
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

function boxFormMode(
  activeTool: ActiveBoxTool,
  report: NonNullable<DocumentControllerState["report"]>,
  featureLabel: string,
): BoxFormMode | null {
  if (activeTool.kind === "create-box") {
    return { kind: "create", createFeatureId: createBrowserFeatureId, featureLabel }
  }
  const feature = report.snapshot.features.find(({ id }) => id === activeTool.featureId)
  return feature && isBoxFeature(feature) ? { kind: "edit", feature } : null
}

function StartTaskPanel({
  canCreate,
  onCreateBox,
}: {
  canCreate: boolean
  onCreateBox: () => void
}) {
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("startModeling")}</h2>
      <p className="mt-2 leading-5 text-muted-foreground">{t("description")}</p>
      <Button type="button" className="mt-4 w-full" disabled={!canCreate} onClick={onCreateBox}>
        {t("createBox")}
      </Button>
    </aside>
  )
}

function canCreateFeature(controller: DocumentControllerState) {
  return controller.status === "ready" && controller.report?.mode === "read-write"
}

function ModelTaskPanel({ activeTool, controller, onCloseTool, onCreateBox }: TaskPanelProps) {
  const t = useTranslations("app.shell.taskPanel")
  const report = controller.report
  if (activeTool && report) {
    const boxCount = report.snapshot.features.filter(isBoxFeature).length
    const mode = boxFormMode(activeTool, report, t("box.featureLabel", { number: boxCount + 1 }))
    if (mode) return <BoxTaskPanel report={report} mode={mode} onCloseTool={onCloseTool} />
  }
  return <StartTaskPanel canCreate={canCreateFeature(controller)} onCreateBox={onCreateBox} />
}

const taskPanelByWorkspace = {
  model: ModelTaskPanel,
  variables: VariablesTaskPanel,
} satisfies Record<TaskPanelProps["workspace"], (props: TaskPanelProps) => ReactNode>

export function TaskPanel(props: TaskPanelProps) {
  const Panel = taskPanelByWorkspace[props.workspace]
  return <Panel {...props} />
}
