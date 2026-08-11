import {
  extrusionFeatureParametersSchema,
  rectangleSketchDefinition,
  rectangleSketchProfileSelector,
  type SketchId,
  type SketchRecord,
} from "@vibeshape/domain"
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
import { ExtrusionForm, type ExtrusionFormMode } from "../features/extrusion/extrusion-form"
import { FeatureDeleteAction } from "../features/part-design/feature-delete-action"
import {
  type ActivePartDesignTool,
  booleanInputFeatures,
  isBooleanFeature,
  isBoxFeature,
  isCylinderFeature,
  isExtrusionFeature,
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
  onCreateExtrusion: () => void
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
      submit: t("finish"),
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

function useExtrusionFormCopy(mode: ExtrusionFormMode["kind"]) {
  const t = useTranslations("app.shell.taskPanel.extrusion")
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
    parameters: t("parameters"),
    profile: t("profile"),
    distance: t("distance"),
    symmetric: t("symmetric"),
    expressionDescription: t("expressionDescription"),
    cancel: t("cancel"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
  }
}

function featureTaskContext(
  mode: BoxFormMode | CylinderFormMode | BooleanFormMode | ExtrusionFormMode,
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
  mode: BoxFormMode | CylinderFormMode | BooleanFormMode | ExtrusionFormMode
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

function ExtrusionTaskPanel({
  mode,
  onCloseTool,
  report,
}: {
  mode: ExtrusionFormMode
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const snapshot = report.snapshot
  const copy = useExtrusionFormCopy(mode.kind)
  const task = featureTaskContext(mode, snapshot.revision)
  const t = useTranslations("app.shell.taskPanel")
  const profile =
    mode.kind === "create"
      ? mode.profile
      : extrusionFeatureParametersSchema.parse(mode.feature.parameters).profile
  const profileLabel =
    snapshot.sketches.find(({ id }) => id === profile.sketchId)?.label ??
    t("extrusion.missingProfile")
  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <ExtrusionForm
        key={task.key}
        baseRevision={snapshot.revision}
        copy={copy}
        disabled={report.mode === "read-only"}
        mode={mode}
        profileLabel={profileLabel}
        variables={snapshot.variables}
        onCancel={onCloseTool}
        onSave={task.onSave}
        onSaved={onCloseTool}
      />
      <EditFeatureDeleteAction mode={mode} report={report} onDeleted={onCloseTool} />
    </aside>
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

function extrusionFormMode(
  activeTool: Extract<ActivePartDesignTool, { kind: "create-extrusion" | "edit-extrusion" }>,
  report: NonNullable<DocumentControllerState["report"]>,
  featureLabel: string,
): ExtrusionFormMode | null {
  if (activeTool.kind === "create-extrusion") {
    return {
      kind: "create",
      createFeatureId: createBrowserFeatureId,
      featureLabel,
      profile: activeTool.profile,
    }
  }
  const feature = report.snapshot.features.find(({ id }) => id === activeTool.featureId)
  return feature && isExtrusionFeature(feature) ? { kind: "edit", feature } : null
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

function StartModelingAction({
  canCreate,
  canExtrude,
  onCreateExtrusion,
  onCreateSketch,
}: {
  canCreate: boolean
  canExtrude: boolean
  onCreateExtrusion: () => void
  onCreateSketch: () => void
}) {
  const t = useTranslations("app.shell.taskPanel")
  if (canExtrude) {
    return (
      <Button type="button" className="mt-4 w-full" onClick={onCreateExtrusion}>
        {t("createExtrusion")}
      </Button>
    )
  }
  return (
    <Button type="button" className="mt-4 w-full" disabled={!canCreate} onClick={onCreateSketch}>
      {t("createSketch")}
    </Button>
  )
}

function SketchFirstWorkflow() {
  const t = useTranslations("app.shell.taskPanel")
  return (
    <ol aria-label={t("workflowLabel")} className="mt-4 grid gap-2 border-t pt-4 text-xs">
      <li>
        <span className="font-medium">1. {t("workflowSketch")}</span>
        <span className="block text-muted-foreground">{t("workflowSketchDescription")}</span>
      </li>
      <li>
        <span className="font-medium">2. {t("workflowExtrude")}</span>
        <span className="block text-muted-foreground">{t("workflowExtrudeDescription")}</span>
      </li>
      <li>
        <span className="font-medium">3. {t("workflowRefine")}</span>
        <span className="block text-muted-foreground">{t("workflowRefineDescription")}</span>
      </li>
    </ol>
  )
}

function AvailableSubtractAction({
  available,
  onCreateSubtract,
}: {
  available: boolean
  onCreateSubtract: () => void
}) {
  const t = useTranslations("app.shell.taskPanel")
  if (!available) return null
  return (
    <Button type="button" variant="outline" className="mt-4 w-full" onClick={onCreateSubtract}>
      {t("createSubtract")}
    </Button>
  )
}

function DirectSolidsActions({
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
    <details className="mt-4 border-t pt-3">
      <summary className="cursor-pointer text-xs font-medium">{t("directSolids")}</summary>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">{t("directSolidsDescription")}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-3 w-full"
        disabled={!canCreate}
        onClick={onCreateBox}
      >
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
    </details>
  )
}

function StartTaskPanel({
  canCreate,
  canExtrude,
  canSubtract,
  onCreateBox,
  onCreateCylinder,
  onCreateExtrusion,
  onCreateSketch,
  onCreateSubtract,
}: {
  canCreate: boolean
  canExtrude: boolean
  canSubtract: boolean
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onCreateSubtract: () => void
}) {
  const t = useTranslations("app.shell.taskPanel")

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">
        {t(canExtrude ? "selectedProfileReady" : "startModeling")}
      </h2>
      <p className="mt-2 leading-5 text-muted-foreground">
        {t(canExtrude ? "selectedProfileDescription" : "description")}
      </p>
      <StartModelingAction
        canCreate={canCreate}
        canExtrude={canExtrude}
        onCreateExtrusion={onCreateExtrusion}
        onCreateSketch={onCreateSketch}
      />
      <SketchFirstWorkflow />
      <AvailableSubtractAction available={canSubtract} onCreateSubtract={onCreateSubtract} />
      <DirectSolidsActions
        canCreate={canCreate}
        onCreateBox={onCreateBox}
        onCreateCylinder={onCreateCylinder}
      />
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

function ActiveExtrusionTaskPanel({
  activeTool,
  onCloseTool,
  report,
}: {
  activeTool: Extract<ActivePartDesignTool, { kind: "create-extrusion" | "edit-extrusion" }>
  onCloseTool: () => void
  report: NonNullable<DocumentControllerState["report"]>
}) {
  const t = useTranslations("app.shell.taskPanel.extrusion")
  const extrusionCount = report.snapshot.features.filter(isExtrusionFeature).length
  const mode = extrusionFormMode(
    activeTool,
    report,
    t("featureLabel", { number: extrusionCount + 1 }),
  )
  return mode ? <ExtrusionTaskPanel report={report} mode={mode} onCloseTool={onCloseTool} /> : null
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

function ExtrusionToolTaskPanel({ activeTool, ...props }: ActiveTaskPanelProps) {
  if (activeTool.kind !== "create-extrusion" && activeTool.kind !== "edit-extrusion") return null
  return <ActiveExtrusionTaskPanel activeTool={activeTool} {...props} />
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
  "create-extrusion": ExtrusionToolTaskPanel,
  "edit-extrusion": ExtrusionToolTaskPanel,
  "create-subtract": SubtractToolTaskPanel,
  "edit-subtract": SubtractToolTaskPanel,
} satisfies Record<ActivePartDesignTool["kind"], (props: ActiveTaskPanelProps) => ReactNode>

function ActiveTaskPanel(props: ActiveTaskPanelProps) {
  const Panel = activeTaskPanelByKind[props.activeTool.kind]
  return <Panel {...props} />
}

function canExtrudeSelectedSketch(
  controller: DocumentControllerState,
  activeSketchId: SketchId | null,
) {
  const selectedSketch = controller.report?.snapshot.sketches.find(
    ({ id }) => id === activeSketchId,
  )
  return Boolean(
    canCreateFeature(controller) &&
      selectedSketch &&
      rectangleSketchProfileSelector(selectedSketch) !== null,
  )
}

function ModelTaskPanel({
  activeSketchId,
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onCreateCylinder,
  onCreateExtrusion,
  onCreateSketch,
  onCreateSubtract,
}: TaskPanelProps) {
  const report = controller.report
  const canCreate = canCreateFeature(controller)
  return activeTool && report ? (
    <ActiveTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  ) : (
    <StartTaskPanel
      canCreate={canCreate}
      canExtrude={canExtrudeSelectedSketch(controller, activeSketchId)}
      canSubtract={canCreateSubtract(controller)}
      onCreateBox={onCreateBox}
      onCreateCylinder={onCreateCylinder}
      onCreateExtrusion={onCreateExtrusion}
      onCreateSketch={onCreateSketch}
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
  onCreateExtrusion,
  onCreateSketch,
  onEditSketch,
  sketch,
}: {
  canCreate: boolean
  onCreateExtrusion: () => void
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
        onClick={onCreateExtrusion}
      >
        {t("extrude")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 w-full"
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
  onCreateExtrusion,
  onCreateSketch,
  onEditSketch,
  report,
}: {
  activeSketchId: SketchId | null
  canCreate: boolean
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onEditSketch: (sketchId: SketchId) => void
  report: DocumentControllerState["report"]
}) {
  const sketch = report?.snapshot.sketches.find(({ id }) => id === activeSketchId)
  return sketch ? (
    <SelectedSketchTaskPanel
      canCreate={canCreate}
      sketch={sketch}
      onCreateExtrusion={onCreateExtrusion}
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
  onCreateExtrusion,
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
      onCreateExtrusion={onCreateExtrusion}
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
