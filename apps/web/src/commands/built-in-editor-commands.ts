import type { PartId } from "@vibeshape/domain/identifiers"
import type { DocumentControllerState } from "../document/document-controller"
import type { SketchCameraMode } from "../editor-session/editor-session-store"
import { exactSolidBodyOptions } from "../features/part-design/exact-body-options"
import {
  type activePartDesignCommand,
  modifyingSolidTargetFeatures,
} from "../features/part-design/part-design-tool"
import {
  type ActiveSketchTool,
  isActiveSketchEditorTool,
  type SketchEditorTool,
  sketchConstraintEditorTools,
} from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "../shell/workspace"
import {
  createEditorCommandRegistry,
  type EditorCommandDescriptor,
  type EditorCommandHandler,
  type EditorCommandId,
  editorCommandDisabled,
  editorCommandEnabled,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "./editor-command"

type PartDesignCommand = NonNullable<ReturnType<typeof activePartDesignCommand>>

export type BuiltInEditorCommandContext = Readonly<{
  actions: Readonly<{
    lightweighting?: () => void
    quickLightweighting?: () => void
    generativeDesign?: () => void
    openShortcutHelp?: () => void
    openSketchText?: () => void
    cancelActive: () => void
    documentRedo?: (baseRevision: number) => Promise<unknown>
    documentUndo?: (baseRevision: number) => Promise<unknown>
    placePart?: ((partId: PartId) => void) | undefined
    mirrorPart?: ((partId: PartId) => void) | undefined
    shellPart?: ((partId: PartId) => void) | undefined
    splitPart?: ((partId: PartId) => void) | undefined
    patternPart?: ((partId: PartId) => void) | undefined
    threadPart?: ((partId: PartId) => void) | undefined
    combineParts?: ((operation: "compound" | "union") => void) | undefined
    createFdm?: (() => void) | undefined
    createHole: () => void
    createFillet: () => void
    createChamfer: () => void
    createBox: () => void
    createCylinder: () => void
    createSphere: () => void
    createCone: () => void
    createPyramid: () => void
    createTorus: () => void
    createDatumPlane: () => void
    createExtrusion: () => unknown
    createRevolve?: () => unknown
    createLoft?: () => void
    createSweep?: () => void
    createSketch: () => void
    createSubtract: () => void
    measure?: () => void
    surfaceTexture?: () => void
    redoSketch: () => void
    setSketchCameraMode: (mode: SketchCameraMode) => void
    setSketchConstruction: (construction: boolean) => void
    setSketchFinalContext: (visible: boolean) => void
    setSketchTool: (tool: SketchEditorTool) => void
    switchWorkspace: (workspace: EditorWorkspaceName) => void
    toggleAllSketchVisibility: () => void
    undoSketch: () => void
  }>
  state: Readonly<{
    activePartDesignCommand: PartDesignCommand | null
    activeSketchTool: ActiveSketchTool | null
    controller: DocumentControllerState
    extrusionAvailable: boolean
    selectedExactPartId?: PartId | null
    partCombinationAvailable?: boolean
    selectionAvailable?: boolean
    hasSavedSketches: boolean
    revolveAvailable?: boolean
    sketchConstruction: boolean
    sketchCameraMode: SketchCameraMode
    sketchFinalContext: boolean
    sketchRedoAvailable: boolean
    slotFromSelectionAvailable: boolean
    sketchTool: SketchEditorTool
    sketchUndoAvailable: boolean
    workspace: EditorWorkspaceName
  }>
}>

const editorOwner = "org.vibeshape.core.editor"
const partDesignOwner = "org.vibeshape.core.part-design"
const referenceGeometryOwner = "org.vibeshape.core.reference-geometry"
const sketchOwner = "org.vibeshape.core.sketch"

const constraintCommandDescriptors = [
  ["sketchConstraintCoincident", "constraint-coincident", "coincident"],
  ["sketchConstraintHorizontal", "constraint-horizontal", "horizontal"],
  ["sketchConstraintVertical", "constraint-vertical", "vertical"],
  ["sketchConstraintParallel", "constraint-parallel", "parallel"],
  ["sketchConstraintPerpendicular", "constraint-perpendicular", "perpendicular"],
  ["sketchConstraintEqual", "constraint-equal", "equal"],
  ["sketchConstraintTangent", "constraint-tangent", "tangent"],
  ["sketchConstraintConcentric", "constraint-concentric", "concentric"],
  ["sketchConstraintMidpoint", "constraint-midpoint", "midpoint"],
  ["sketchConstraintSymmetric", "constraint-symmetric", "symmetric"],
  ["sketchConstraintFixed", "constraint-fixed", "fixed"],
  ["sketchConstraintPointOnLine", "constraint-point-on-line", "point-on-line"],
  ["sketchConstraintPointOnCurve", "constraint-point-on-curve", "point-on-curve"],
] as const

const constraintEditorCommandDescriptors: readonly EditorCommandDescriptor[] =
  constraintCommandDescriptors.map(([key, icon], familyOrder) => ({
    group: "sketch",
    icon,
    id: editorCommandIds[key],
    labelKey: key,
    ownerModuleId: sketchOwner,
    sketchPresentation: {
      family: "constraint",
      ...(familyOrder === 0 ? { familyDefault: true as const } : {}),
      familyOrder,
    },
    toolbarGroup: "sketch-precision",
  }))

const partCommandDescriptors = [
  ["placePart", "transform", "placement"],
  ["mirrorPart", "mirror", "mirror"],
  ["shellPart", "shell", "shell"],
  ["splitPart", "split", "split-body"],
  ["patternPart", "linear-pattern", "pattern"],
  ["threadPart", "thread", "thread"],
] as const

const contextualPartDescriptors: readonly EditorCommandDescriptor[] = [
  ...partCommandDescriptors.map(([key, icon]) => ({
    group: "modeling" as const,
    icon,
    id: editorCommandIds[key],
    labelKey: key,
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-part" as const,
  })),
  ...(["compound", "union"] as const).map((operation) => ({
    group: "modeling" as const,
    icon: operation,
    id: editorCommandIds[operation === "compound" ? "compoundParts" : "unionParts"],
    labelKey: operation === "compound" ? ("compoundParts" as const) : ("unionParts" as const),
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-part" as const,
  })),
]

const descriptors: readonly EditorCommandDescriptor[] = [
  ...contextualPartDescriptors,
  {
    group: "modeling",
    icon: "generative-design",
    id: editorCommandIds.generativeDesign,
    labelKey: "generativeDesign",
    ownerModuleId: editorOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "quick-lightweighting",
    id: editorCommandIds.quickLightweighting,
    labelKey: "quickLightweighting",
    ownerModuleId: editorOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "lightweighting",
    id: editorCommandIds.lightweighting,
    labelKey: "lightweighting",
    ownerModuleId: editorOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "fdm-tools",
    id: editorCommandIds.createFdm,
    labelKey: "createFdm",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "surface-texture",
    id: editorCommandIds.surfaceTexture,
    labelKey: "surfaceTexture",
    ownerModuleId: editorOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "workspace",
    icon: "keyboard",
    id: editorCommandIds.openShortcutHelp,
    labelKey: "openShortcutHelp",
    ownerModuleId: editorOwner,
    shortcut: { key: "F1" },
  },
  {
    group: "modeling",
    icon: "measure",
    id: editorCommandIds.measure,
    labelKey: "measure",
    shortcut: { key: "m", modifiers: ["shift"] },
    ownerModuleId: editorOwner,
    toolbarGroup: "model-inspection",
  },
  {
    group: "history",
    icon: "undo",
    id: editorCommandIds.documentUndo,
    labelKey: "documentUndo",
    ownerModuleId: editorOwner,
    shortcut: { key: "z", modifiers: ["mod"] },
    toolbarGroup: "history",
  },
  {
    group: "history",
    icon: "redo",
    id: editorCommandIds.documentRedo,
    labelKey: "documentRedo",
    ownerModuleId: editorOwner,
    shortcut: { key: "z", modifiers: ["mod", "shift"] },
    toolbarGroup: "history",
  },
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
    shortcut: { key: "s", modifiers: ["shift"] },
    ownerModuleId: sketchOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "workspace",
    icon: "sketch-visibility",
    id: editorCommandIds.toggleAllSketchVisibility,
    labelKey: "toggleAllSketchVisibility",
    ownerModuleId: sketchOwner,
    shortcut: { key: "h", modifiers: ["shift"] },
  },
  {
    group: "modeling",
    icon: "datum-plane",
    id: editorCommandIds.createDatumPlane,
    labelKey: "createDatumPlane",
    ownerModuleId: referenceGeometryOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "extrude",
    id: editorCommandIds.createExtrusion,
    labelKey: "createExtrusion",
    shortcut: { key: "e" },
    ownerModuleId: partDesignOwner,
    sketchPresentation: { shortcutOrder: 9 },
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "revolve",
    id: editorCommandIds.createRevolve,
    labelKey: "createRevolve",
    shortcut: { key: "e", modifiers: ["shift"] },
    ownerModuleId: partDesignOwner,
    sketchPresentation: { shortcutOrder: 10 },
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "loft",
    id: editorCommandIds.createLoft,
    labelKey: "createLoft",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "sweep",
    id: editorCommandIds.createSweep,
    labelKey: "createSweep",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "hole",
    id: editorCommandIds.createHole,
    labelKey: "createHole",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "fillet",
    id: editorCommandIds.createFillet,
    labelKey: "createFillet",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "modeling",
    icon: "chamfer",
    id: editorCommandIds.createChamfer,
    labelKey: "createChamfer",
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
    icon: "sphere",
    id: editorCommandIds.createSphere,
    labelKey: "createSphere",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "cone",
    id: editorCommandIds.createCone,
    labelKey: "createCone",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "pyramid",
    id: editorCommandIds.createPyramid,
    labelKey: "createPyramid",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "torus",
    id: editorCommandIds.createTorus,
    labelKey: "createTorus",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primitives",
  },
  {
    group: "modeling",
    icon: "subtract",
    id: editorCommandIds.createSubtract,
    labelKey: "createSubtract",
    ownerModuleId: partDesignOwner,
    toolbarGroup: "model-primary",
  },
  {
    group: "sketch",
    icon: "select",
    id: editorCommandIds.sketchSelect,
    labelKey: "sketchSelect",
    ownerModuleId: sketchOwner,
    sketchPresentation: { shortcutOrder: 0 },
    shortcut: { key: "v" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "use-external-geometry",
    id: editorCommandIds.sketchUse,
    labelKey: "sketchUse",
    shortcut: { key: "u" },
    ownerModuleId: sketchOwner,
    sketchPresentation: { shortcutOrder: 1 },
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
    sketchPresentation: {
      family: "line",
      familyDefault: true,
      familyOrder: 0,
      shortcutOrder: 2,
    },
    shortcut: { key: "l" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "midpoint-line",
    id: editorCommandIds.sketchMidpointLine,
    labelKey: "sketchMidpointLine",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "line", familyOrder: 1 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "rectangle",
    id: editorCommandIds.sketchRectangle,
    labelKey: "sketchRectangle",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "rectangle", familyOrder: 0 },
    shortcut: { key: "g" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "center-rectangle",
    id: editorCommandIds.sketchCenterRectangle,
    labelKey: "sketchCenterRectangle",
    ownerModuleId: sketchOwner,
    sketchPresentation: {
      family: "rectangle",
      familyDefault: true,
      familyOrder: 1,
      shortcutOrder: 3,
    },
    shortcut: { key: "r" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "aligned-rectangle",
    id: editorCommandIds.sketchAlignedRectangle,
    labelKey: "sketchAlignedRectangle",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "rectangle", familyOrder: 2 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "centered-aligned-rectangle",
    id: editorCommandIds.sketchCenteredAlignedRectangle,
    labelKey: "sketchCenteredAlignedRectangle",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "rectangle", familyOrder: 3 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "circle",
    id: editorCommandIds.sketchCircle,
    labelKey: "sketchCircle",
    ownerModuleId: sketchOwner,
    sketchPresentation: {
      family: "circle",
      familyDefault: true,
      familyOrder: 0,
      shortcutOrder: 4,
    },
    shortcut: { key: "c" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "ellipse",
    id: editorCommandIds.sketchEllipse,
    labelKey: "sketchEllipse",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "circle", familyOrder: 2 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "text",
    id: editorCommandIds.sketchText,
    labelKey: "sketchText",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "spline",
    id: editorCommandIds.sketchSpline,
    labelKey: "sketchSpline",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "elliptical-arc",
    id: editorCommandIds.sketchEllipticalArc,
    labelKey: "sketchEllipticalArc",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "arc", familyOrder: 3 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "inscribed-polygon",
    id: editorCommandIds.sketchInscribedPolygon,
    labelKey: "sketchInscribedPolygon",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "polygon", familyDefault: true, familyOrder: 0 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "circumscribed-polygon",
    id: editorCommandIds.sketchCircumscribedPolygon,
    labelKey: "sketchCircumscribedPolygon",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "polygon", familyOrder: 1 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "three-point-circle",
    id: editorCommandIds.sketchThreePointCircle,
    labelKey: "sketchThreePointCircle",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "circle", familyOrder: 1 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "slot",
    id: editorCommandIds.sketchSlot,
    labelKey: "sketchSlot",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "slot", familyOrder: 0 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "centered-slot",
    id: editorCommandIds.sketchCenteredSlot,
    labelKey: "sketchCenteredSlot",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "slot", familyDefault: true, familyOrder: 1 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "slot-around-line",
    id: editorCommandIds.sketchSlotAroundLine,
    labelKey: "sketchSlotAroundLine",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "slot", familyOrder: 2 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "arc",
    id: editorCommandIds.sketchArc,
    labelKey: "sketchArc",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "arc", familyOrder: 2 },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "three-point-arc",
    id: editorCommandIds.sketchThreePointArc,
    labelKey: "sketchThreePointArc",
    ownerModuleId: sketchOwner,
    sketchPresentation: {
      family: "arc",
      familyDefault: true,
      familyOrder: 0,
      shortcutOrder: 5,
    },
    shortcut: { key: "a" },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "tangent-arc",
    id: editorCommandIds.sketchTangentArc,
    labelKey: "sketchTangentArc",
    ownerModuleId: sketchOwner,
    sketchPresentation: { family: "arc", familyOrder: 1 },
    shortcut: { key: "a", modifiers: ["shift"] },
    toolbarGroup: "sketch-tools",
  },
  {
    group: "sketch",
    icon: "trim",
    id: editorCommandIds.sketchTrim,
    labelKey: "sketchTrim",
    ownerModuleId: sketchOwner,
    sketchPresentation: { compactToolbar: "visible", shortcutOrder: 7 },
    shortcut: { key: "m" },
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "dimension",
    id: editorCommandIds.sketchDimension,
    labelKey: "sketchDimension",
    ownerModuleId: sketchOwner,
    sketchPresentation: { shortcutOrder: 6 },
    shortcut: { key: "d" },
    toolbarGroup: "sketch-precision",
  },
  ...constraintEditorCommandDescriptors,
  {
    group: "sketch",
    icon: "extend",
    id: editorCommandIds.sketchExtend,
    labelKey: "sketchExtend",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "mirror",
    id: editorCommandIds.sketchMirror,
    labelKey: "sketchMirror",
    shortcut: { key: "i" },
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "sketch-fillet",
    id: editorCommandIds.sketchFillet,
    labelKey: "sketchFillet",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "sketch-chamfer",
    id: editorCommandIds.sketchChamfer,
    labelKey: "sketchChamfer",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "offset",
    id: editorCommandIds.sketchOffset,
    labelKey: "sketchOffset",
    ownerModuleId: sketchOwner,
    sketchPresentation: { shortcutOrder: 8 },
    shortcut: { key: "o" },
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "linear-pattern",
    id: editorCommandIds.sketchLinearPattern,
    labelKey: "sketchLinearPattern",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "circular-pattern",
    id: editorCommandIds.sketchCircularPattern,
    labelKey: "sketchCircularPattern",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "split",
    id: editorCommandIds.sketchSplit,
    labelKey: "sketchSplit",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
  },
  {
    group: "sketch",
    icon: "sketch-transform",
    id: editorCommandIds.sketchTransform,
    labelKey: "sketchTransform",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-modify",
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
    group: "sketch",
    icon: "navigate-view",
    id: editorCommandIds.sketchNavigateView,
    labelKey: "sketchNavigateView",
    ownerModuleId: sketchOwner,
    shortcut: { key: "Space" },
    toolbarGroup: "sketch-view",
  },
  {
    group: "sketch",
    icon: "orbit-view",
    id: editorCommandIds.sketchOrbitView,
    labelKey: "sketchOrbitView",
    shortcut: { key: "n", modifiers: ["shift"] },
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-view",
  },
  {
    group: "sketch",
    icon: "final-context",
    id: editorCommandIds.sketchFinalContext,
    labelKey: "sketchFinalContext",
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-view",
  },
  {
    group: "sketch",
    icon: "normal-view",
    id: editorCommandIds.sketchNormalView,
    labelKey: "sketchNormalView",
    shortcut: { key: "n" },
    ownerModuleId: sketchOwner,
    toolbarGroup: "sketch-view",
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

function writableDocumentEligibility(
  context: BuiltInEditorCommandContext,
  options: Readonly<{ allowActiveSketch?: boolean }> = {},
) {
  const { controller } = context.state
  if (controller.status !== "ready" || !controller.report) {
    return editorCommandDisabled("documentUnavailable")
  }
  if (controller.report.mode !== "read-write") return editorCommandDisabled("readOnly")
  if (controller.saveStatus === "saving") return editorCommandDisabled("saving")
  if (context.state.activeSketchTool && !options.allowActiveSketch) {
    return editorCommandDisabled("activeSketch")
  }
  if (context.state.activePartDesignCommand) return editorCommandDisabled("activeFeature")
  return editorCommandEnabled()
}

function canCreateFeature(context: BuiltInEditorCommandContext) {
  return writableDocumentEligibility(context)
}

function canUseDocumentHistory(context: BuiltInEditorCommandContext, direction: "undo" | "redo") {
  const eligibility = writableDocumentEligibility(context)
  if (!eligibility.enabled) return eligibility
  const { controller } = context.state
  const available = direction === "undo" ? controller.history?.canUndo : controller.history?.canRedo
  return available
    ? editorCommandEnabled()
    : editorCommandDisabled(direction === "undo" ? "noDocumentUndo" : "noDocumentRedo")
}

function canCreateSavedSketchFeature(context: BuiltInEditorCommandContext) {
  const eligibility = canCreateFeature(context)
  if (!eligibility.enabled) return eligibility
  return context.state.hasSavedSketches
    ? editorCommandEnabled()
    : editorCommandDisabled("noSavedSketches")
}

function canCreateEdgeTreatment(context: BuiltInEditorCommandContext) {
  const eligibility = canCreateFeature(context)
  if (!eligibility.enabled) return eligibility
  const features = context.state.controller.report?.snapshot.features ?? []
  return modifyingSolidTargetFeatures(features, undefined, context.state.controller.report?.rebuild)
    .length > 0
    ? editorCommandEnabled()
    : editorCommandDisabled("selectSolid")
}

function canCreateHole(context: BuiltInEditorCommandContext) {
  const eligibility = canCreateEdgeTreatment(context)
  if (!eligibility.enabled) return eligibility
  const sketches = context.state.controller.report?.snapshot.sketches ?? []
  return sketches.some(({ entities }) => entities.some(({ type }) => type === "point"))
    ? editorCommandEnabled()
    : editorCommandDisabled("selectHolePoints")
}

function canCreateProfileFeature(context: BuiltInEditorCommandContext, available: boolean) {
  const { activeSketchTool } = context.state
  if (isActiveSketchEditorTool(activeSketchTool)) {
    const eligibility = writableDocumentEligibility(context, { allowActiveSketch: true })
    if (!eligibility.enabled) return eligibility
    return available ? editorCommandEnabled() : editorCommandDisabled("selectProfile")
  }
  const eligibility = canCreateFeature(context)
  if (!eligibility.enabled) return eligibility
  return available ? editorCommandEnabled() : editorCommandDisabled("selectProfile")
}

function requiresSketch(context: BuiltInEditorCommandContext) {
  return isActiveSketchEditorTool(context.state.activeSketchTool)
    ? editorCommandEnabled()
    : editorCommandDisabled("requiresSketch")
}

function requiresExistingSketch(context: BuiltInEditorCommandContext) {
  return context.state.activeSketchTool?.kind === "edit-sketch"
    ? editorCommandEnabled()
    : editorCommandDisabled("requiresExistingSketch")
}

function canUseExternalGeometry(context: BuiltInEditorCommandContext) {
  const sketchEligibility = requiresSketch(context)
  if (!sketchEligibility.enabled) return sketchEligibility
  return context.state.sketchFinalContext
    ? editorCommandDisabled("hideFinalContext")
    : editorCommandEnabled()
}

function sketchToolHandler(
  id: EditorCommandId,
  tool: SketchEditorTool,
  getEligibility: EditorCommandHandler<BuiltInEditorCommandContext>["getEligibility"] = requiresSketch,
): EditorCommandHandler<BuiltInEditorCommandContext> {
  return {
    execute: ({ actions }) => actions.setSketchTool(tool),
    getEligibility,
    id,
    isActive: ({ state }) => state.sketchTool === tool,
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  }
}

function contextualPartVisible({ state }: BuiltInEditorCommandContext) {
  return (
    state.workspace === "model" &&
    !state.activeSketchTool &&
    !state.activePartDesignCommand &&
    Boolean(state.selectedExactPartId)
  )
}

const contextualPartHandlers: readonly EditorCommandHandler<BuiltInEditorCommandContext>[] = [
  ...partCommandDescriptors.map(([key, , activeCommand]) => ({
    id: editorCommandIds[key],
    ownerModuleId: partDesignOwner,
    execute: ({ actions, state }: BuiltInEditorCommandContext) => {
      if (state.selectedExactPartId) actions[key]?.(state.selectedExactPartId)
    },
    getEligibility: (context: BuiltInEditorCommandContext) => {
      const eligibility = writableDocumentEligibility(context)
      if (!eligibility.enabled) return eligibility
      return context.state.selectedExactPartId && context.actions[key]
        ? editorCommandEnabled()
        : editorCommandDisabled("selectSolid")
    },
    isActive: ({ state }: BuiltInEditorCommandContext) =>
      state.activePartDesignCommand === activeCommand,
    isToolbarVisible: contextualPartVisible,
  })),
  ...(["compound", "union"] as const).map((operation) => ({
    id: editorCommandIds[operation === "compound" ? "compoundParts" : "unionParts"],
    ownerModuleId: partDesignOwner,
    execute: ({ actions }: BuiltInEditorCommandContext) => actions.combineParts?.(operation),
    getEligibility: (context: BuiltInEditorCommandContext) => {
      const eligibility = writableDocumentEligibility(context)
      if (!eligibility.enabled) return eligibility
      return context.state.partCombinationAvailable && context.actions.combineParts
        ? editorCommandEnabled()
        : editorCommandDisabled("selectTwoSolids")
    },
    isToolbarVisible: (context: BuiltInEditorCommandContext) =>
      contextualPartVisible(context) && Boolean(context.state.partCombinationAvailable),
  })),
]

const handlers: readonly EditorCommandHandler<BuiltInEditorCommandContext>[] = [
  {
    execute: ({ actions }) => actions.generativeDesign?.(),
    getEligibility: (context) =>
      context.actions.generativeDesign
        ? writableDocumentEligibility(context)
        : editorCommandDisabled("documentUnavailable"),
    id: editorCommandIds.generativeDesign,
    isToolbarVisible: ({ state }) => state.workspace === "model" && !state.activeSketchTool,
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.quickLightweighting?.(),
    getEligibility: (context) =>
      context.actions.quickLightweighting
        ? writableDocumentEligibility(context)
        : editorCommandDisabled("documentUnavailable"),
    id: editorCommandIds.quickLightweighting,
    isToolbarVisible: ({ state }) => state.workspace === "model" && !state.activeSketchTool,
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.lightweighting?.(),
    getEligibility: (context) =>
      context.actions.lightweighting
        ? writableDocumentEligibility(context)
        : editorCommandDisabled("documentUnavailable"),
    id: editorCommandIds.lightweighting,
    isToolbarVisible: ({ state }) => state.workspace === "model" && !state.activeSketchTool,
    ownerModuleId: editorOwner,
  },
  ...contextualPartHandlers,
  {
    execute: ({ actions }) => actions.openShortcutHelp?.(),
    getEligibility: ({ actions }) =>
      actions.openShortcutHelp
        ? editorCommandEnabled()
        : editorCommandDisabled("documentUnavailable"),
    id: editorCommandIds.openShortcutHelp,
    isToolbarVisible: () => false,
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.surfaceTexture?.(),
    getEligibility: (context) =>
      context.actions.surfaceTexture
        ? writableDocumentEligibility(context)
        : editorCommandDisabled("documentUnavailable"),
    id: editorCommandIds.surfaceTexture,
    isActive: ({ state }) => state.activePartDesignCommand === "surface-texture",
    isToolbarVisible: ({ state }) => state.workspace === "model" && !state.activeSketchTool,
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.measure?.(),
    getEligibility: (context) => {
      const { controller, activePartDesignCommand } = context.state
      if (controller.status !== "ready" || !controller.report || !context.actions.measure)
        return editorCommandDisabled("documentUnavailable")
      if (context.state.activeSketchTool) return editorCommandDisabled("activeSketch")
      if (controller.saveStatus === "saving") return editorCommandDisabled("saving")
      if (activePartDesignCommand) return editorCommandDisabled("activeFeature")
      return editorCommandEnabled()
    },
    id: editorCommandIds.measure,
    isActive: ({ state }) => state.activePartDesignCommand === "measure",
    isToolbarVisible: ({ state }) => state.workspace === "model" && !state.activeSketchTool,
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions, state }) => {
      const revision = state.controller.report?.snapshot.revision
      return revision === undefined
        ? Promise.resolve()
        : (actions.documentUndo?.(revision) ?? Promise.resolve())
    },
    getEligibility: (context) => canUseDocumentHistory(context, "undo"),
    id: editorCommandIds.documentUndo,
    isToolbarVisible: ({ state }) =>
      !state.activeSketchTool && !state.activePartDesignCommand && state.workspace === "model",
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions, state }) => {
      const revision = state.controller.report?.snapshot.revision
      return revision === undefined
        ? Promise.resolve()
        : (actions.documentRedo?.(revision) ?? Promise.resolve())
    },
    getEligibility: (context) => canUseDocumentHistory(context, "redo"),
    id: editorCommandIds.documentRedo,
    isToolbarVisible: ({ state }) =>
      !state.activeSketchTool && !state.activePartDesignCommand && state.workspace === "model",
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.toggleAllSketchVisibility(),
    getEligibility: ({ state }) =>
      state.hasSavedSketches ? editorCommandEnabled() : editorCommandDisabled("noSavedSketches"),
    id: editorCommandIds.toggleAllSketchVisibility,
    ownerModuleId: sketchOwner,
  },
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
        : state.activeSketchTool?.kind === "select-sketch-plane"
          ? editorCommandDisabled("activeSketch")
          : editorCommandEnabled(),
    id: editorCommandIds.workspaceSketch,
    isActive: ({ state }) => state.workspace === "sketch",
    ownerModuleId: editorOwner,
  },
  {
    execute: ({ actions }) => actions.createSketch(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createSketch,
    isActive: ({ state }) =>
      state.activeSketchTool?.kind === "select-sketch-plane" && !state.activeSketchTool.returnTo,
    isToolbarVisible: ({ state }) =>
      state.activeSketchTool === null ||
      (state.activeSketchTool.kind === "select-sketch-plane" && !state.activeSketchTool.returnTo),
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.createDatumPlane(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createDatumPlane,
    isActive: ({ state }) => state.activePartDesignCommand === "datum-plane",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: referenceGeometryOwner,
  },
  {
    execute: ({ actions }) => actions.createExtrusion(),
    getEligibility: (context) => canCreateProfileFeature(context, context.state.extrusionAvailable),
    id: editorCommandIds.createExtrusion,
    isActive: ({ state }) => state.activePartDesignCommand === "extrusion",
    isToolbarVisible: ({ state }) => state.activeSketchTool?.kind !== "select-sketch-plane",
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createRevolve?.(),
    getEligibility: (context) =>
      canCreateProfileFeature(context, context.state.revolveAvailable ?? false),
    id: editorCommandIds.createRevolve,
    isActive: ({ state }) => state.activePartDesignCommand === "revolve",
    isToolbarVisible: ({ state }) => state.activeSketchTool?.kind !== "select-sketch-plane",
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createLoft?.(),
    getEligibility: canCreateSavedSketchFeature,
    id: editorCommandIds.createLoft,
    isActive: ({ state }) => state.activePartDesignCommand === "loft",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createSweep?.(),
    getEligibility: canCreateSavedSketchFeature,
    id: editorCommandIds.createSweep,
    isActive: ({ state }) => state.activePartDesignCommand === "sweep",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createFdm?.(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createFdm,
    isActive: ({ state }) => state.activePartDesignCommand === "fdm",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createHole(),
    getEligibility: canCreateHole,
    id: editorCommandIds.createHole,
    isActive: ({ state }) => state.activePartDesignCommand === "hole",
    isToolbarVisible: ({ state }) => state.activeSketchTool?.kind !== "select-sketch-plane",
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createFillet(),
    getEligibility: canCreateEdgeTreatment,
    id: editorCommandIds.createFillet,
    isActive: ({ state }) => state.activePartDesignCommand === "fillet",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createChamfer(),
    getEligibility: canCreateEdgeTreatment,
    id: editorCommandIds.createChamfer,
    isActive: ({ state }) => state.activePartDesignCommand === "chamfer",
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
    execute: ({ actions }) => actions.createSphere(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createSphere,
    isActive: ({ state }) => state.activePartDesignCommand === "sphere",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createCone(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createCone,
    isActive: ({ state }) => state.activePartDesignCommand === "cone",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createPyramid(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createPyramid,
    isActive: ({ state }) => state.activePartDesignCommand === "pyramid",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createTorus(),
    getEligibility: canCreateFeature,
    id: editorCommandIds.createTorus,
    isActive: ({ state }) => state.activePartDesignCommand === "torus",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  {
    execute: ({ actions }) => actions.createSubtract(),
    getEligibility: (context) => {
      const eligibility = canCreateFeature(context)
      if (!eligibility.enabled) return eligibility
      const report = context.state.controller.report
      return report &&
        exactSolidBodyOptions(report.snapshot, report.rebuild, undefined, [], "").length >= 2
        ? editorCommandEnabled()
        : editorCommandDisabled("selectTwoSolids")
    },
    id: editorCommandIds.createSubtract,
    isActive: ({ state }) => state.activePartDesignCommand === "subtract",
    isToolbarVisible: ({ state }) => state.activeSketchTool === null,
    ownerModuleId: partDesignOwner,
  },
  sketchToolHandler(editorCommandIds.sketchSelect, "select"),
  sketchToolHandler(editorCommandIds.sketchUse, "use", canUseExternalGeometry),
  sketchToolHandler(editorCommandIds.sketchPoint, "point"),
  sketchToolHandler(editorCommandIds.sketchLine, "line"),
  sketchToolHandler(editorCommandIds.sketchMidpointLine, "midpoint-line"),
  sketchToolHandler(editorCommandIds.sketchRectangle, "rectangle"),
  sketchToolHandler(editorCommandIds.sketchCenterRectangle, "center-rectangle"),
  sketchToolHandler(editorCommandIds.sketchAlignedRectangle, "aligned-rectangle"),
  sketchToolHandler(editorCommandIds.sketchCenteredAlignedRectangle, "centered-aligned-rectangle"),
  sketchToolHandler(editorCommandIds.sketchCircle, "circle"),
  sketchToolHandler(editorCommandIds.sketchEllipse, "ellipse"),
  {
    execute: ({ actions }) => actions.openSketchText?.(),
    getEligibility: (context) => {
      const eligible = writableDocumentEligibility(context, { allowActiveSketch: true })
      if (!eligible.enabled) return eligible
      return context.actions.openSketchText
        ? requiresSketch(context)
        : editorCommandDisabled("documentUnavailable")
    },
    id: editorCommandIds.sketchText,
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  sketchToolHandler(editorCommandIds.sketchSpline, "cubic-bezier"),
  sketchToolHandler(editorCommandIds.sketchEllipticalArc, "elliptical-arc"),
  sketchToolHandler(editorCommandIds.sketchThreePointCircle, "three-point-circle"),
  sketchToolHandler(editorCommandIds.sketchInscribedPolygon, "inscribed-polygon"),
  sketchToolHandler(editorCommandIds.sketchCircumscribedPolygon, "circumscribed-polygon"),
  sketchToolHandler(editorCommandIds.sketchSlot, "slot"),
  sketchToolHandler(editorCommandIds.sketchCenteredSlot, "centered-slot"),
  {
    execute: ({ actions }) => actions.setSketchTool("slot-from-selection"),
    getEligibility: (context) => {
      const sketchEligibility = requiresSketch(context)
      if (!sketchEligibility.enabled) return sketchEligibility
      return context.state.slotFromSelectionAvailable
        ? editorCommandEnabled()
        : editorCommandDisabled("selectSketchLine")
    },
    id: editorCommandIds.sketchSlotAroundLine,
    isActive: ({ state }) => state.sketchTool === "slot-from-selection",
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  sketchToolHandler(editorCommandIds.sketchArc, "arc"),
  sketchToolHandler(editorCommandIds.sketchThreePointArc, "three-point-arc"),
  sketchToolHandler(editorCommandIds.sketchTangentArc, "tangent-arc"),
  sketchToolHandler(editorCommandIds.sketchDimension, "dimension"),
  ...constraintCommandDescriptors.map(([key, , kind]) =>
    sketchToolHandler(editorCommandIds[key], sketchConstraintEditorTools[kind]),
  ),
  sketchToolHandler(editorCommandIds.sketchTrim, "trim"),
  sketchToolHandler(editorCommandIds.sketchExtend, "extend"),
  sketchToolHandler(editorCommandIds.sketchMirror, "mirror"),
  sketchToolHandler(editorCommandIds.sketchOffset, "offset"),
  sketchToolHandler(editorCommandIds.sketchFillet, "fillet"),
  sketchToolHandler(editorCommandIds.sketchChamfer, "chamfer"),
  sketchToolHandler(editorCommandIds.sketchLinearPattern, "linear-pattern"),
  sketchToolHandler(editorCommandIds.sketchCircularPattern, "circular-pattern"),
  sketchToolHandler(editorCommandIds.sketchSplit, "split"),
  sketchToolHandler(editorCommandIds.sketchTransform, "transform"),
  {
    execute: ({ actions, state }) => actions.setSketchConstruction(!state.sketchConstruction),
    getEligibility: requiresSketch,
    id: editorCommandIds.sketchConstruction,
    isActive: ({ state }) => state.sketchConstruction,
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions, state }) =>
      actions.setSketchCameraMode(
        state.sketchCameraMode.startsWith("navigate") ? "orbit" : "navigate",
      ),
    getEligibility: requiresSketch,
    id: editorCommandIds.sketchNavigateView,
    isActive: ({ state }) => state.sketchCameraMode.startsWith("navigate"),
    isToolbarVisible: () => false,
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.setSketchCameraMode("orbit"),
    getEligibility: requiresSketch,
    id: editorCommandIds.sketchOrbitView,
    isActive: ({ state }) => state.sketchCameraMode === "orbit",
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions }) => actions.setSketchCameraMode("normal"),
    getEligibility: requiresSketch,
    id: editorCommandIds.sketchNormalView,
    isActive: ({ state }) => state.sketchCameraMode === "normal",
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions, state }) => actions.setSketchFinalContext(!state.sketchFinalContext),
    getEligibility: requiresExistingSketch,
    id: editorCommandIds.sketchFinalContext,
    isActive: ({ state }) => state.sketchFinalContext,
    isToolbarVisible: ({ state }) => state.activeSketchTool?.kind === "edit-sketch",
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
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
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
    isToolbarVisible: ({ state }) => isActiveSketchEditorTool(state.activeSketchTool),
    ownerModuleId: sketchOwner,
  },
  {
    execute: ({ actions, state }) => {
      if (isActiveSketchEditorTool(state.activeSketchTool) && state.sketchTool !== "select") {
        actions.setSketchTool("select")
        return
      }
      actions.cancelActive()
    },
    getEligibility: ({ state }) =>
      state.activePartDesignCommand || state.activeSketchTool || state.selectionAvailable
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
