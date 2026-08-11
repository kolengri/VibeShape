import {
  extrusionFeatureParametersSchema,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { type ReactNode, useState } from "react"
import {
  addFeature,
  addSketch,
  createBrowserFeatureId,
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
import { SketchEditorPanel } from "../features/sketch/sketch-editor-panel"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "../features/sketch/sketch-tool"
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
  onSketchConstructionChange: (construction: boolean) => void
  onSketchDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onSketchEditorToolChange: (tool: SketchEditorTool) => void
  onSketchRedo: () => void
  onSketchSelectedProfileChange: (profile: SketchProfileSelector | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  onSketchUndo: () => void
  sketchConstruction: boolean
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchFailedConstraintIds: readonly SketchConstraintId[]
  sketchProfiles: readonly SketchProfileSelector[]
  sketchRedoAvailable: boolean
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
  sketchUndoAvailable: boolean
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

function useSketchEditorCopy() {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return {
    addConstraint: t("addConstraint"),
    angle: t("angle"),
    arc: t("arc"),
    cancel: t("cancel"),
    circle: t("circle"),
    coincident: t("coincident"),
    concentric: t("concentric"),
    conflict: t("conflict"),
    construction: t("construction"),
    constraints: t("constraints"),
    diameter: t("diameter"),
    dimension: t("dimension"),
    dimensionExpression: t("dimensionExpression"),
    dimensionInvalid: t("dimensionInvalid"),
    dimensions: t("dimensions"),
    distance: t("distance"),
    equal: t("equal"),
    finish: t("finish"),
    fixed: t("fixed"),
    geometry: t("geometry"),
    horizontal: t("horizontal"),
    horizontalDistance: t("horizontalDistance"),
    line: t("line"),
    noConstraints: t("noConstraints"),
    parallel: t("parallel"),
    perpendicular: t("perpendicular"),
    plane: t("plane"),
    planeXy: t("planeXy"),
    planeXz: t("planeXz"),
    planeYz: t("planeYz"),
    pointOnCurve: t("pointOnCurve"),
    pointOnLine: t("pointOnLine"),
    point: t("point"),
    profile: (number: number) => t("profile", { number }),
    profiles: t("profiles"),
    radius: t("radius"),
    rectangle: t("rectangle"),
    redo: t("redo"),
    remove: t("removeConstraint"),
    select: t("select"),
    tangent: t("tangent"),
    undo: t("undo"),
    vertical: t("vertical"),
    verticalDistance: t("verticalDistance"),
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
  selectedProfile: SketchProfileSelector | null,
) {
  return Boolean(
    canCreateFeature(controller) &&
      activeSketchId &&
      selectedProfile &&
      selectedProfile.sketchId === activeSketchId,
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
  sketchSelectedProfile,
}: TaskPanelProps) {
  const report = controller.report
  const canCreate = canCreateFeature(controller)
  return activeTool && report ? (
    <ActiveTaskPanel activeTool={activeTool} report={report} onCloseTool={onCloseTool} />
  ) : (
    <StartTaskPanel
      canCreate={canCreate}
      canExtrude={canExtrudeSelectedSketch(controller, activeSketchId, sketchSelectedProfile)}
      canSubtract={canCreateSubtract(controller)}
      onCreateBox={onCreateBox}
      onCreateCylinder={onCreateCylinder}
      onCreateExtrusion={onCreateExtrusion}
      onCreateSketch={onCreateSketch}
      onCreateSubtract={onCreateSubtract}
    />
  )
}

type ActiveSketchTaskPanelState = Readonly<{
  activeSketchTool: ActiveSketchTool
  construction: boolean
  draft: SketchRecord
  editorTool: SketchEditorTool
  failedConstraintIds: readonly SketchConstraintId[]
  profiles: readonly SketchProfileSelector[]
  redoAvailable: boolean
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  undoAvailable: boolean
}>

type ActiveSketchTaskPanelActions = Readonly<{
  onCloseTool: () => void
  onConstructionChange: (construction: boolean) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onRedo: () => void
  onSelectedProfileChange: (profile: SketchProfileSelector | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  onUndo: () => void
}>

function sketchSaveFailureMessage(
  activeSketchTool: ActiveSketchTool,
  sourceCode: string | null,
  copy: Readonly<{ createFailed: string; staleRevision: string; updateFailed: string }>,
) {
  if (sourceCode === "stale-revision") return copy.staleRevision
  return activeSketchTool.kind === "edit-sketch" ? copy.updateFailed : copy.createFailed
}

function ActiveSketchTaskPanel({
  actions,
  report,
  state,
}: {
  actions: ActiveSketchTaskPanelActions
  report: NonNullable<DocumentControllerState["report"]>
  state: ActiveSketchTaskPanelState
}) {
  const {
    activeSketchTool,
    construction,
    draft,
    editorTool,
    failedConstraintIds,
    profiles,
    redoAvailable,
    selectedEntityIds,
    selectedProfile,
    undoAvailable,
  } = state
  const {
    onCloseTool,
    onConstructionChange,
    onDraftChange,
    onEditorToolChange,
    onRedo,
    onSelectedProfileChange,
    onSketchSaved,
    onUndo,
  } = actions
  const t = useTranslations("app.shell.taskPanel.sketch")
  const [message, setMessage] = useState<string | null>(null)
  const copy = useSketchEditorCopy()
  const finish = async () => {
    setMessage(null)
    const save = activeSketchTool.kind === "edit-sketch" ? updateSketch : addSketch
    const result = await save(report.snapshot.revision, draft)
    if (!result.ok) {
      setMessage(
        sketchSaveFailureMessage(activeSketchTool, result.diagnostic.sourceCode, {
          createFailed: t("createFailed"),
          staleRevision: t("staleRevision"),
          updateFailed: t("updateFailed"),
        }),
      )
      return
    }
    onSketchSaved(draft)
  }
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <SketchEditorPanel
        copy={copy}
        state={{
          construction,
          disabled: report.mode === "read-only",
          draft,
          editorTool,
          failedConstraintIds,
          message,
          profiles,
          redoAvailable,
          selectedEntityIds,
          selectedProfile,
          undoAvailable,
          variables: report.snapshot.variables,
        }}
        actions={{
          onCancel: onCloseTool,
          onConstructionChange,
          onDraftChange,
          onEditorToolChange,
          onFinish: finish,
          onRedo,
          onSelectedProfileChange,
          onUndo,
        }}
      />
    </aside>
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
  canExtrude,
  onCreateExtrusion,
  onCreateSketch,
  onEditSketch,
  onSelectedProfileChange,
  profiles,
  selectedProfile,
  sketch,
}: {
  canCreate: boolean
  canExtrude: boolean
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onEditSketch: (sketchId: SketchId) => void
  onSelectedProfileChange: (profile: SketchProfileSelector) => void
  profiles: readonly SketchProfileSelector[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord
}) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return (
    <aside aria-label={t("taskAriaLabel")} className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">{sketch.label}</h2>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">
        {t("savedDescription", { plane: sketch.plane.toUpperCase() })}
      </p>
      {profiles.length > 1 ? (
        <fieldset className="mt-3 flex flex-wrap gap-1 border-0 p-0">
          <legend className="sr-only">{t("profiles")}</legend>
          {profiles.map((profile, index) => (
            <Button
              key={profile.outerBoundaryEntityIds.join(":")}
              type="button"
              size="xs"
              variant={selectedProfile === profile ? "secondary" : "outline"}
              aria-pressed={selectedProfile === profile}
              onClick={() => onSelectedProfileChange(profile)}
            >
              {t("profile", { number: index + 1 })}
            </Button>
          ))}
        </fieldset>
      ) : null}
      <Button
        type="button"
        size="sm"
        className="mt-4 w-full"
        disabled={!canExtrude}
        onClick={onCreateExtrusion}
      >
        {t("extrude")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        disabled={!canCreate}
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
    </aside>
  )
}

function SketchStartTaskPanel({
  activeSketchId,
  canCreate,
  canExtrude,
  onCreateExtrusion,
  onCreateSketch,
  onEditSketch,
  onSelectedProfileChange,
  profiles,
  report,
  selectedProfile,
}: {
  activeSketchId: SketchId | null
  canCreate: boolean
  canExtrude: boolean
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onEditSketch: (sketchId: SketchId) => void
  onSelectedProfileChange: (profile: SketchProfileSelector) => void
  profiles: readonly SketchProfileSelector[]
  report: DocumentControllerState["report"]
  selectedProfile: SketchProfileSelector | null
}) {
  const sketch = report?.snapshot.sketches.find(({ id }) => id === activeSketchId)
  return sketch ? (
    <SelectedSketchTaskPanel
      canCreate={canCreate}
      canExtrude={canExtrude}
      profiles={profiles}
      selectedProfile={selectedProfile}
      sketch={sketch}
      onCreateExtrusion={onCreateExtrusion}
      onCreateSketch={onCreateSketch}
      onEditSketch={onEditSketch}
      onSelectedProfileChange={onSelectedProfileChange}
    />
  ) : (
    <EmptySketchTaskPanel canCreate={canCreate} onCreateSketch={onCreateSketch} />
  )
}

function SketchTaskPanel(props: TaskPanelProps) {
  const report = props.controller.report
  if (props.activeSketchTool && report && props.sketchDraft) {
    return (
      <ActiveSketchTaskPanel
        report={report}
        state={{
          activeSketchTool: props.activeSketchTool,
          construction: props.sketchConstruction,
          draft: props.sketchDraft,
          editorTool: props.sketchEditorTool,
          failedConstraintIds: props.sketchFailedConstraintIds,
          profiles: props.sketchProfiles,
          redoAvailable: props.sketchRedoAvailable,
          selectedEntityIds: props.sketchSelectedEntityIds,
          selectedProfile: props.sketchSelectedProfile,
          undoAvailable: props.sketchUndoAvailable,
        }}
        actions={{
          onCloseTool: props.onCloseTool,
          onConstructionChange: props.onSketchConstructionChange,
          onDraftChange: props.onSketchDraftChange,
          onEditorToolChange: props.onSketchEditorToolChange,
          onRedo: props.onSketchRedo,
          onSelectedProfileChange: props.onSketchSelectedProfileChange,
          onSketchSaved: props.onSketchSaved,
          onUndo: props.onSketchUndo,
        }}
      />
    )
  }
  return (
    <SketchStartTaskPanel
      activeSketchId={props.activeSketchId}
      canCreate={canCreateFeature(props.controller)}
      canExtrude={canExtrudeSelectedSketch(
        props.controller,
        props.activeSketchId,
        props.sketchSelectedProfile,
      )}
      profiles={props.sketchProfiles}
      onCreateExtrusion={props.onCreateExtrusion}
      report={report}
      onCreateSketch={props.onCreateSketch}
      onEditSketch={props.onEditSketch}
      onSelectedProfileChange={props.onSketchSelectedProfileChange}
      selectedProfile={props.sketchSelectedProfile}
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
