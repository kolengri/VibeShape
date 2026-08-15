import type { DocumentControllerState } from "../document/document-controller"
import {
  type activePartDesignCommand,
  booleanInputFeatures,
} from "../features/part-design/part-design-tool"
import type { ActiveSketchTool, SketchEditorTool } from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "../shell/workspace"
import {
  createEditorCommandRegistry,
  type EditorCommandDescriptor,
  type EditorCommandHandler,
  editorCommandDisabled,
  editorCommandEnabled,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "./editor-command"

type PartDesignCommand = NonNullable<ReturnType<typeof activePartDesignCommand>>

export type BuiltInEditorCommandContext = Readonly<{
  actions: Readonly<{
    cancelActive: () => void
    createBox: () => void
    createCylinder: () => void
    createExtrusion: () => void
    createSketch: () => void
    createSubtract: () => void
    redoSketch: () => void
    setSketchConstruction: (construction: boolean) => void
    setSketchTool: (tool: SketchEditorTool) => void
    switchWorkspace: (workspace: EditorWorkspaceName) => void
    undoSketch: () => void
  }>
  state: Readonly<{
    activePartDesignCommand: PartDesignCommand | null
    activeSketchTool: ActiveSketchTool | null
    controller: DocumentControllerState
    extrusionAvailable: boolean
    sketchConstruction: boolean
    sketchRedoAvailable: boolean
    sketchTool: SketchEditorTool
    sketchUndoAvailable: boolean
    workspace: EditorWorkspaceName
  }>
}>

const editorOwner = "org.vibeshape.core.editor"
const partDesignOwner = "org.vibeshape.core.part-design"
const sketchOwner = "org.vibeshape.core.sketch"

const descriptors: readonly EditorCommandDescriptor[] = [
  {
    group: "workspace",
    icon: "model",
    id: editorCommandIds.workspaceModel,
    labelKey: "workspaceModel",
    ownerModuleId: editorOwner,
    toolbarGroup: "workspace",
  },
  {
    group: "workspace",
    icon: "sketch",
    id: editorCommandIds.workspaceSketch,
    labelKey: "workspaceSketch",
    ownerModuleId: editorOwner,
    toolbarGroup: "workspace",
  },
  {
    group: "modeling",
    icon: "sketch",
    id: editorCommandIds.createSketch,
    labelKey: "createSketch",
    ownerModuleId: sketchOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "extrude",
    id: editorCommandIds.createExtrusion,
    labelKey: "createExtrusion",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "box",
    id: editorCommandIds.createBox,
    labelKey: "createBox",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "cylinder",
    id: editorCommandIds.createCylinder,
    labelKey: "createCylinder",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "subtract",
    id: editorCommandIds.createSubtract,
    labelKey: "createSubtract",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "sketch",
    icon: "select",
    id: editorCommandIds.sketchSelect,
    labelKey: "sketchSelect",
    ownerModuleId: sketchOwner,
    shortcut: { key: "v" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "point",
    id: editorCommandIds.sketchPoint,
    labelKey: "sketchPoint",
    ownerModuleId: sketchOwner,
    shortcut: { key: "p" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "line",
    id: editorCommandIds.sketchLine,
    labelKey: "sketchLine",
    ownerModuleId: sketchOwner,
    shortcut: { key: "l" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "rectangle",
    id: editorCommandIds.sketchRectangle,
    labelKey: "sketchRectangle",
    ownerModuleId: sketchOwner,
    shortcut: { key: "r" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "circle",
    id: editorCommandIds.sketchCircle,
    labelKey: "sketchCircle",
    ownerModuleId: sketchOwner,
    shortcut: { key: "c" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "arc",
    id: editorCommandIds.sketchArc,
    labelKey: "sketchArc",
    ownerModuleId: sketchOwner,
    shortcut: { key: "a" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "construction",
    id: editorCommandIds.sketchConstruction,
    labelKey: "sketchConstruction",
    ownerModuleId: sketchOwner,
    shortcut: { key: "x" },
    toolbarGroup: "sketch-mode",
  },
  {
    group: "history",
    icon: "undo",
    id: editorCommandIds.sketchUndo,
    labelKey: "sketchUndo",
    ownerModuleId: sketchOwner,
    shortcut: { key: "z", modifiers: ["mod"] },
    toolbarGroup: "history",
  },
  {
    group: "history",
    icon: "redo",
    id: editorCommandIds.sketchRedo,
    labelKey: "sketchRedo",
    ownerModuleId: sketchOwner,
    shortcut: { key: "z", modifiers: ["mod", "shift"] },
    toolbarGroup: "history",
  },
  {
    group: "workspace",
    icon: "cancel",
    id: editorCommandIds.cancelActive,
    labelKey: "cancelActive",
    ownerModuleId: editorOwner,
    shortcut: { key: "Escape" },
  },
]

function canCreateFeature(context: BuiltInEditorCommandContext) {
  const { controller } = context.state
  if (controller.status !== "ready" || !controller.report) {
    return editorCommandDisabled("documentUnavailable")
  }
  if (controller.report.mode !== "read-write") return editorCommandDisabled("readOnly")
  if (context.state.activeSketchTool) return editorCommandDisabled("activeSketch")
  if (context.state.activePartDesignCommand) return editorCommandDisabled("activeFeature")
  return editorCommandEnabled()
}

function requiresSketch(context: BuiltInEditorCommandContext) {
  return context.state.activeSketchTool
    ? editorCommandEnabled()
    : editorCommandDisabled("requiresSketch")
}

function sketchToolHandler(
  id: (typeof editorCommandIds)[
    | "sketchArc"
    | "sketchCircle"
    | "sketchLine"
    | "sketchPoint"
    | "sketchRectangle"
    | "sketchSelect"],
  tool: SketchEditorTool,
): EditorCommandHandler<BuiltInEditorCommandContext> {
  return {
    execute: ({ actions }) => actions.setSketchTool(tool),
    getEligibility: requiresSketch,
    id,
    isActive: ({ state }) => state.sketchTool === tool,
    isToolbarVisible: ({ state }) => state.activeSketchTool !== null,
    ownerModuleId: sketchOwner,
  }
}

const handlers: readonly EditorCommandHandler<BuiltInEditorCommandContext>[] = [
  {
    execute: ({ actions }) => actions.switchWorkspace("model"),
    getEligibility: ({ state }) =>
      state.activeSketchTool ? editorCommandDisabled("activeSketch") : editorCommandEnabled(),
    id: editorCommandIds.workspaceModel,
    isActive: ({ state }) => state.workspace === "model" || state.workspace === "variables",
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.switchWorkspace("sketch"),
    getEligibility: ({ state }) =>
      state.activePartDesignCommand
        ? editorCommandDisabled("activeFeature")
        : editorCommandEnabled(),
    id: editorCommandIds.workspaceSketch,
    isActive: ({ state }) => state.workspace === "sketch",
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.createSketch(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createSketch,
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.createExtrusion(),
    getEligibility: (context) => {
      const eligibility = canCreateFeature(context)
      if (!eligibility.enabled) return eligibility
      return context.state.extrusionAvailable
        ? editorCommandEnabled()
        : editorCommandDisabled("selectProfile")
    },
    id: editorCommandIds.createExtrusion,
    isActive: ({ state }) => state.activePartDesignCommand === "extrusion",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createBox(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createBox,
    isActive: ({ state }) => state.activePartDesignCommand === "box",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createCylinder(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createCylinder,
    isActive: ({ state }) => state.activePartDesignCommand === "cylinder",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createSubtract(),
    getEligibility: (context) => {
      const eligibility = canCreateFeature(context)
      if (!eligibility.enabled) return eligibility
      const features = context.state.controller.report?.snapshot.features ?? []
      return booleanInputFeatures(features).length >= 2
        ? editorCommandEnabled()
        : editorCommandDisabled("selectTwoSolids")
    },
    id: editorCommandIds.createSubtract,
    isActive: ({ state }) => state.activePartDesignCommand === "subtract",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  sketchToolHandler(editorCommandIds.sketchSelect, "select"),
  sketchToolHandler(editorCommandIds.sketchPoint, "point"),
  sketchToolHandler(editorCommandIds.sketchLine, "line"),
  sketchToolHandler(editorCommandIds.sketchRectangle, "rectangle"),
  sketchToolHandler(editorCommandIds.sketchCircle, "circle"),
  sketchToolHandler(editorCommandIds.sketchArc, "arc"),
  {
    execute: ({ actions, state }) => actions.setSketchConstruction(!state.sketchConstruction),
    getEligibility: requiresSketch,
    id: editorCommandIds.sketchConstruction,
    isActive: ({ state }) => state.sketchConstruction,
    isToolbarVisible: ({ state }) => state.activeSketchTool !== null,
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.undoSketch(),
    getEligibility: (context) => {
      const eligibility = requiresSketch(context)
      if (!eligibility.enabled) return eligibility
      return context.state.sketchUndoAvailable
        ? editorCommandEnabled()
        : editorCommandDisabled("noSketchUndo")
    },
    id: editorCommandIds.sketchUndo,
    isToolbarVisible: ({ state }) => state.activeSketchTool !== null,
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.redoSketch(),
    getEligibility: (context) => {
      const eligibility = requiresSketch(context)
      if (!eligibility.enabled) return eligibility
      return context.state.sketchRedoAvailable
        ? editorCommandEnabled()
        : editorCommandDisabled("noSketchRedo")
    },
    id: editorCommandIds.sketchRedo,
    isToolbarVisible: ({ state }) => state.activeSketchTool !== null,
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions, state }) => {
      if (state.activeSketchTool && state.sketchTool !== "select") {
        actions.setSketchTool("select")
        return
      }
      actions.cancelActive()
    },
    getEligibility: ({ state }) =>
      state.activePartDesignCommand || state.activeSketchTool
        ? editorCommandEnabled()
        : editorCommandDisabled("noActiveCommand"),
    id: editorCommandIds.cancelActive,
    ownerModuleId: editorOwner,
  },
]

const registryResult = createEditorCommandRegistry(descriptors, handlers)

if (!registryResult.ok) {
  throw new Error(registryResult.diagnostic.message)
}

const registry = registryResult.registry

export function resolveBuiltInEditorCommands(
  context: BuiltInEditorCommandContext,
): readonly ResolvedEditorCommand[] {
  return registry.resolve(context)
}

export { descriptors as builtInEditorCommandDescriptors }
