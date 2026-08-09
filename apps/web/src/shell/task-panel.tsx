import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import {
  addFeature,
  createBrowserFeatureId,
  type DocumentControllerState,
} from "../document/document-controller"
import { BoxForm } from "../features/box/box-form"

type TaskPanelProps = Readonly<{
  activeTool: "box" | null
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

function BoxTaskPanel({
  onCloseTool,
  report,
}: {
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel")
  const snapshot = report.snapshot
  const boxCount = snapshot.features.filter(
    ({ type }) => type.typeId === "org.vibeshape.feature.part-design.box",
  ).length
  const boxCopy = {
    title: t("box.title"),
    description: t("box.description"),
    dimensions: t("box.dimensions"),
    width: t("box.width"),
    depth: t("box.depth"),
    height: t("box.height"),
    centered: t("box.centered"),
    expressionDescription: t("box.expressionDescription"),
    create: t("box.create"),
    cancel: t("box.cancel"),
    invalidExpression: t("box.invalidExpression"),
    invalidDimension: t("box.invalidDimension"),
    invalidRange: t("box.invalidRange"),
    validationSummary: t("box.validationSummary"),
    staleRevision: t("box.staleRevision"),
    createFailed: t("box.createFailed"),
  }

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <BoxForm
        key={snapshot.revision}
        baseRevision={snapshot.revision}
        variables={snapshot.variables}
        copy={boxCopy}
        createFeatureId={createBrowserFeatureId}
        disabled={report.mode === "read-only"}
        featureLabel={t("box.featureLabel", { number: boxCount + 1 })}
        onCancel={onCloseTool}
        onCreate={addFeature}
        onCreated={onCloseTool}
      />
    </aside>
  )
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
  if (activeTool === "box" && controller.report) {
    return <BoxTaskPanel report={controller.report} onCloseTool={onCloseTool} />
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
