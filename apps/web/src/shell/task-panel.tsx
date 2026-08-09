import { rectangleSketchDefinition, type SketchId, type SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"
import {
  addFeature,
  addSketch,
  createBrowserFeatureId,
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
  createBrowserSketchId,
  type DocumentControllerState,
  removeFeature,
  updateFeature,
  updateSketch,
} from "../document/document-controller"
import {
  BooleanForm,
  type BooleanFormMode,
  type BooleanInputOption,
} from "../features/boolean/boolean-form"
import { BoxForm, type BoxFormMode } from "../features/box/box-form"
import { CylinderForm, type CylinderFormMode } from "../features/cylinder/cylinder-form"
import { FeatureDeleteAction } from "../features/part-design/feature-delete-action"
import {
  type ActivePartDesignTool,
  booleanInputFeatures,
  isBooleanFeature,
  isBoxFeature,
  isCylinderFeature,
} from "../features/part-design/part-design-tool"
import {
  RectangleSketchForm,
  type RectangleSketchFormMode,
  type RectangleSketchPreview,
} from "../features/sketch/rectangle-sketch-form"
import type { ActiveSketchTool } from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "./workspace"

type TaskPanelProps = Readonly<{
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  activeTool: ActivePartDesignTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateSketch: () => void
  onCreateSubtract: () => void
  onEditSketch: (sketchId: SketchId) => void
  onSketchPreview: (preview: RectangleSketchPreview | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  workspace: EditorWorkspaceName
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

function useRectangleSketchFormCopy(mode: RectangleSketchFormMode["kind"]) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const operationCopy = {
    create: {
      title: t("title"),
      description: t("description"),
      submit: t("create"),
      validationSummary: t("validationSummary"),
      saveFailed: t("createFailed"),
    },
    edit: {
      title: t("editTitle"),
      description: t("editDescription"),
      submit: t("update"),
      validationSummary: t("updateValidationSummary"),
      saveFailed: t("updateFailed"),
    },
  }[mode]
  return {
    ...operationCopy,
    dimensions: t("dimensions"),
    plane: t("plane"),
    planeDescription: t("planeDescription"),
    planeXy: t("planeXy"),
    planeXz: t("planeXz"),
    planeYz: t("planeYz"),
    width: t("width"),
    height: t("height"),
    expressionDescription: t("expressionDescription"),
    cancel: t("cancel"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
  }
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

function useBooleanFormCopy(mode: BooleanFormMode["kind"]) {
  const t = useTranslations("app.shell.taskPanel")
  const operationCopy = {
    create: {
      title: t("boolean.title"),
      description: t("boolean.description"),
      submit: t("boolean.create"),
      saveFailed: t("boolean.createFailed"),
    },
    edit: {
      title: t("boolean.editTitle"),
      description: t("boolean.editDescription"),
      submit: t("boolean.update"),
      saveFailed: t("boolean.updateFailed"),
    },
  }[mode]
  return {
    ...operationCopy,
    inputs: t("boolean.inputs"),
    target: t("boolean.target"),
    tool: t("boolean.tool"),
    targetDescription: t("boolean.targetDescription"),
    toolDescription: t("boolean.toolDescription"),
    cancel: t("boolean.cancel"),
    missingInput: t("boolean.missingInput"),
    sameInput: t("boolean.sameInput"),
    validationSummary: t("boolean.validationSummary"),
    staleRevision: t("boolean.staleRevision"),
  }
}

function featureTaskContext(
  mode: BoxFormMode | CylinderFormMode | BooleanFormMode,
  revision: number,
) {
  return mode.kind === "edit"
    ? { key: `edit:${mode.feature.id}:${revision}`, onSave: updateFeature }
    : { key: `create:${revision}`, onSave: addFeature }
}

function EditFeatureDeleteAction({
  mode,
  onDeleted,
  report,
}: {
  mode: BoxFormMode | CylinderFormMode | BooleanFormMode
  onDeleted: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel.featureDelete")
  const modelTreeT = useTranslations("app.shell.modelTree")
  if (mode.kind !== "edit") return null

  const feature = mode.feature
  const dependentFeatures = report.snapshot.features.filter(({ dependencies }) =>
    dependencies.includes(feature.id),
  )
  const featureLabel = feature.label ?? modelTreeT("unnamedFeature")
  const dependentLabels = dependentFeatures
    .map(({ label }) => label ?? modelTreeT("unnamedFeature"))
    .join(", ")

  return (
    <FeatureDeleteAction
      baseRevision={report.snapshot.revision}
      copy={{
        action: t("action"),
        title: t("title", { feature: featureLabel }),
        description: t("description"),
        confirm: t("confirm"),
        cancel: t("cancel"),
        failed: t("failed"),
        inUse: t("inUse", { features: dependentLabels }),
        readOnly: t("readOnly"),
      }}
      dependentFeatures={dependentFeatures}
      disabled={report.mode === "read-only"}
      feature={feature}
      onDeleted={onDeleted}
      onRemove={removeFeature}
    />
  )
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
      <EditFeatureDeleteAction mode={mode} report={report} onDeleted={onCloseTool} />
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
      <EditFeatureDeleteAction mode={mode} report={report} onDeleted={onCloseTool} />
    </aside>
  )
}

function BooleanTaskPanel({
  mode,
  onCloseTool,
  options,
  report,
}: {
  mode: BooleanFormMode
  onCloseTool: () => void
  options: readonly BooleanInputOption[]
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const snapshot = report.snapshot
  const booleanCopy = useBooleanFormCopy(mode.kind)
  const task = featureTaskContext(mode, snapshot.revision)
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <BooleanForm
        key={task.key}
        baseRevision={snapshot.revision}
        copy={booleanCopy}
        disabled={report.mode === "read-only"}
        mode={mode}
        options={options}
        onCancel={onCloseTool}
        onSave={task.onSave}
        onSaved={onCloseTool}
      />
      <EditFeatureDeleteAction mode={mode} report={report} onDeleted={onCloseTool} />
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

function booleanFormMode(
  activeTool: Extract<ActivePartDesignTool, { kind: "create-subtract" | "edit-subtract" }>,
  report: NonNullable<DocumentControllerState["report"]>,
  featureLabel: string,
): BooleanFormMode | null {
  if (activeTool.kind === "create-subtract") {
    return { kind: "create", createFeatureId: createBrowserFeatureId, featureLabel }
  }
  const feature = report.snapshot.features.find(({ id }) => id === activeTool.featureId)
  return feature && isBooleanFeature(feature) ? { kind: "edit", feature } : null
}

function booleanOptions(
  report: NonNullable<DocumentControllerState["report"]>,
  editingFeatureId: Extract<BooleanFormMode, { kind: "edit" }>["feature"]["id"] | undefined,
  unnamedFeature: string,
) {
  return booleanInputFeatures(report.snapshot.features, editingFeatureId).map((feature) => ({
    id: feature.id,
    label: feature.label ?? unnamedFeature,
  }))
}

function StartTaskPanel({
  canCreate,
  canSubtract,
  onCreateBox,
  onCreateCylinder,
  onCreateSubtract,
}: {
  canCreate: boolean
  canSubtract: boolean
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateSubtract: () => void
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
      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        disabled={!canSubtract}
        onClick={onCreateSubtract}
      >
        {t("createSubtract")}
      </Button>
      {!canSubtract ? (
        <p className="mt-2 text-xs leading-4 text-muted-foreground">{t("subtractUnavailable")}</p>
      ) : null}
    </aside>
  )
}

function canCreateFeature(controller: DocumentControllerState) {
  return controller.status === "ready" && controller.report?.mode === "read-write"
}

function canCreateSubtract(controller: DocumentControllerState) {
  if (!canCreateFeature(controller)) return false
  return booleanInputFeatures(controller.report?.snapshot.features ?? []).length >= 2
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

function ActiveSubtractTaskPanel({
  activeTool,
  onCloseTool,
  report,
}: {
  activeTool: Extract<ActivePartDesignTool, { kind: "create-subtract" | "edit-subtract" }>
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel")
  const modelTreeT = useTranslations("app.shell.modelTree")
  const booleanCount = report.snapshot.features.filter(isBooleanFeature).length
  const mode = booleanFormMode(
    activeTool,
    report,
    t("boolean.featureLabel", { number: booleanCount + 1 }),
  )
  if (!mode) return null
  const options = booleanOptions(
    report,
    mode.kind === "edit" ? mode.feature.id : undefined,
    modelTreeT("unnamedFeature"),
  )
  return (
    <BooleanTaskPanel report={report} mode={mode} options={options} onCloseTool={onCloseTool} />
  )
}

type ActiveTaskPanelProps = Readonly<{
  activeTool: ActivePartDesignTool
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}>

function BoxToolTaskPanel({ activeTool, ...props }: ActiveTaskPanelProps) {
  if (activeTool.kind !== "create-box" && activeTool.kind !== "edit-box") return null
  return <ActiveBoxTaskPanel activeTool={activeTool} {...props} />
}

function CylinderToolTaskPanel({ activeTool, ...props }: ActiveTaskPanelProps) {
  if (activeTool.kind !== "create-cylinder" && activeTool.kind !== "edit-cylinder") return null
  return <ActiveCylinderTaskPanel activeTool={activeTool} {...props} />
}

function SubtractToolTaskPanel({ activeTool, ...props }: ActiveTaskPanelProps) {
  if (activeTool.kind !== "create-subtract" && activeTool.kind !== "edit-subtract") return null
  return <ActiveSubtractTaskPanel activeTool={activeTool} {...props} />
}

const activeTaskPanelByKind = {
  "create-box": BoxToolTaskPanel,
  "edit-box": BoxToolTaskPanel,
  "create-cylinder": CylinderToolTaskPanel,
  "edit-cylinder": CylinderToolTaskPanel,
  "create-subtract": SubtractToolTaskPanel,
  "edit-subtract": SubtractToolTaskPanel,
} satisfies Record<ActivePartDesignTool["kind"], (props: ActiveTaskPanelProps) => ReactNode>

function ActiveTaskPanel(props: ActiveTaskPanelProps) {
  const Panel = activeTaskPanelByKind[props.activeTool.kind]
  return <Panel {...props} />
}

function ModelTaskPanel({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onCreateCylinder,
  onCreateSubtract,
}: TaskPanelProps) {
  const report = controller.report
  return activeTool && report ? (
    <ActiveTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  ) : (
    <StartTaskPanel
      canCreate={canCreateFeature(controller)}
      canSubtract={canCreateSubtract(controller)}
      onCreateBox={onCreateBox}
      onCreateCylinder={onCreateCylinder}
      onCreateSubtract={onCreateSubtract}
    />
  )
}

function rectangleSketchFormMode(
  activeSketchTool: ActiveSketchTool,
  report: NonNullable<DocumentControllerState["report"]>,
  sketchLabel: string,
): RectangleSketchFormMode | null {
  if (activeSketchTool.kind === "create-rectangle-sketch") {
    return {
      kind: "create",
      sketchLabel,
      createSketchId: createBrowserSketchId,
      createEntityId: createBrowserSketchEntityId,
      createConstraintId: createBrowserSketchConstraintId,
    }
  }
  const sketch = report.snapshot.sketches.find(({ id }) => id === activeSketchTool.sketchId)
  return sketch && rectangleSketchDefinition(sketch) ? { kind: "edit", sketch } : null
}

function UnsupportedSketchTaskPanel({ onCloseTool }: { onCloseTool: () => void }) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("unsupportedTitle")}</h2>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">{t("unsupportedDescription")}</p>
      <Button type="button" size="sm" variant="ghost" className="mt-4" onClick={onCloseTool}>
        {t("cancel")}
      </Button>
    </aside>
  )
}

function RectangleSketchTaskPanel({
  copy,
  mode,
  onCloseTool,
  onSketchPreview,
  onSketchSaved,
  report,
}: {
  copy: ReturnType<typeof useRectangleSketchFormCopy>
  mode: RectangleSketchFormMode
  onCloseTool: () => void
  onSketchPreview: (preview: RectangleSketchPreview | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const onSave = mode.kind === "edit" ? updateSketch : addSketch
  const key =
    mode.kind === "edit"
      ? `edit:${mode.sketch.id}:${report.snapshot.revision}`
      : `create:${report.snapshot.revision}`
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <RectangleSketchForm
        key={key}
        baseRevision={report.snapshot.revision}
        copy={copy}
        disabled={report.mode === "read-only"}
        mode={mode}
        variables={report.snapshot.variables}
        onCancel={onCloseTool}
        onPreview={onSketchPreview}
        onSave={onSave}
        onSaved={onSketchSaved}
      />
    </aside>
  )
}

function ActiveSketchTaskPanel({
  activeSketchTool,
  onCloseTool,
  onSketchPreview,
  onSketchSaved,
  report,
}: {
  activeSketchTool: ActiveSketchTool
  onCloseTool: () => void
  onSketchPreview: (preview: RectangleSketchPreview | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const mode = rectangleSketchFormMode(
    activeSketchTool,
    report,
    t("sketchLabel", { number: report.snapshot.sketches.length + 1 }),
  )
  const copy = useRectangleSketchFormCopy(mode?.kind ?? "create")
  return mode ? (
    <RectangleSketchTaskPanel
      copy={copy}
      mode={mode}
      report={report}
      onCloseTool={onCloseTool}
      onSketchPreview={onSketchPreview}
      onSketchSaved={onSketchSaved}
    />
  ) : (
    <UnsupportedSketchTaskPanel onCloseTool={onCloseTool} />
  )
}

function EmptySketchTaskPanel({
  canCreate,
  onCreateSketch,
}: {
  canCreate: boolean
  onCreateSketch: () => void
}) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{t("workspaceTitle")}</h2>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">{t("workspaceDescription")}</p>
      <Button
        type="button"
        size="sm"
        className="mt-2 w-full"
        disabled={!canCreate}
        onClick={onCreateSketch}
      >
        {t("create")}
      </Button>
    </aside>
  )
}

function SelectedSketchTaskPanel({
  canCreate,
  onCreateSketch,
  onEditSketch,
  sketch,
}: {
  canCreate: boolean
  onCreateSketch: () => void
  onEditSketch: (sketchId: SketchId) => void
  sketch: SketchRecord
}) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const canEdit = rectangleSketchDefinition(sketch) !== null
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{sketch.label}</h2>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">
        {t("savedDescription", { plane: sketch.plane.toUpperCase() })}
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-4 w-full"
        disabled={!canCreate || !canEdit}
        onClick={() => onEditSketch(sketch.id)}
      >
        {t("edit")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        disabled={!canCreate}
        onClick={onCreateSketch}
      >
        {t("create")}
      </Button>
      {!canEdit ? (
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {t("unsupportedDescription")}
        </p>
      ) : null}
    </aside>
  )
}

function SketchStartTaskPanel({
  activeSketchId,
  canCreate,
  onCreateSketch,
  onEditSketch,
  report,
}: {
  activeSketchId: SketchId | null
  canCreate: boolean
  onCreateSketch: () => void
  onEditSketch: (sketchId: SketchId) => void
  report: DocumentControllerState["report"]
}) {
  const sketch = report?.snapshot.sketches.find(({ id }) => id === activeSketchId)
  return sketch ? (
    <SelectedSketchTaskPanel
      canCreate={canCreate}
      sketch={sketch}
      onCreateSketch={onCreateSketch}
      onEditSketch={onEditSketch}
    />
  ) : (
    <EmptySketchTaskPanel canCreate={canCreate} onCreateSketch={onCreateSketch} />
  )
}

function SketchTaskPanel({
  activeSketchId,
  activeSketchTool,
  controller,
  onCloseTool,
  onCreateSketch,
  onEditSketch,
  onSketchPreview,
  onSketchSaved,
}: TaskPanelProps) {
  const report = controller.report
  return activeSketchTool && report ? (
    <ActiveSketchTaskPanel
      activeSketchTool={activeSketchTool}
      report={report}
      onCloseTool={onCloseTool}
      onSketchPreview={onSketchPreview}
      onSketchSaved={onSketchSaved}
    />
  ) : (
    <SketchStartTaskPanel
      activeSketchId={activeSketchId}
      canCreate={canCreateFeature(controller)}
      report={report}
      onCreateSketch={onCreateSketch}
      onEditSketch={onEditSketch}
    />
  )
}

const taskPanelByWorkspace = {
  model: ModelTaskPanel,
  sketch: SketchTaskPanel,
  variables: VariablesTaskPanel,
} satisfies Record<TaskPanelProps["workspace"], (props: TaskPanelProps) => ReactNode>

export function TaskPanel(props: TaskPanelProps) {
  const Panel = taskPanelByWorkspace[props.workspace]
  return <Panel {...props} />
}
