export const editorCommandIds = {
  cancelActive: "org.vibeshape.editor.cancel-active",
  createBox: "org.vibeshape.editor.part-design.create-box",
  createCylinder: "org.vibeshape.editor.part-design.create-cylinder",
  createExtrusion: "org.vibeshape.editor.part-design.create-extrusion",
  createSketch: "org.vibeshape.editor.sketch.create",
  createSubtract: "org.vibeshape.editor.part-design.create-subtract",
  sketchAlignedRectangle: "org.vibeshape.editor.sketch.tool.aligned-rectangle",
  sketchArc: "org.vibeshape.editor.sketch.tool.arc",
  sketchMidpointLine: "org.vibeshape.editor.sketch.tool.midpoint-line",
  sketchThreePointArc: "org.vibeshape.editor.sketch.tool.three-point-arc",
  sketchThreePointCircle: "org.vibeshape.editor.sketch.tool.three-point-circle",
  sketchCenterRectangle: "org.vibeshape.editor.sketch.tool.center-rectangle",
  sketchCenteredAlignedRectangle: "org.vibeshape.editor.sketch.tool.centered-aligned-rectangle",
  sketchCenteredSlot: "org.vibeshape.editor.sketch.tool.centered-slot",
  sketchCircle: "org.vibeshape.editor.sketch.tool.circle",
  sketchCircumscribedPolygon: "org.vibeshape.editor.sketch.tool.circumscribed-polygon",
  sketchConstruction: "org.vibeshape.editor.sketch.toggle-construction",
  sketchExtend: "org.vibeshape.editor.sketch.modify.extend",
  sketchLine: "org.vibeshape.editor.sketch.tool.line",
  sketchInscribedPolygon: "org.vibeshape.editor.sketch.tool.inscribed-polygon",
  sketchPoint: "org.vibeshape.editor.sketch.tool.point",
  sketchRectangle: "org.vibeshape.editor.sketch.tool.rectangle",
  sketchSlot: "org.vibeshape.editor.sketch.tool.slot",
  sketchSlotAroundLine: "org.vibeshape.editor.sketch.tool.slot-around-line",
  sketchRedo: "org.vibeshape.editor.sketch.redo",
  sketchSelect: "org.vibeshape.editor.sketch.tool.select",
  sketchTangentArc: "org.vibeshape.editor.sketch.tool.tangent-arc",
  sketchSplit: "org.vibeshape.editor.sketch.modify.split",
  sketchTrim: "org.vibeshape.editor.sketch.modify.trim",
  sketchUndo: "org.vibeshape.editor.sketch.undo",
  workspaceModel: "org.vibeshape.editor.workspace.model",
  workspaceSketch: "org.vibeshape.editor.workspace.sketch",
} as const

export type EditorCommandId = (typeof editorCommandIds)[keyof typeof editorCommandIds]

export type EditorCommandGroup = "workspace" | "modeling" | "sketch" | "history"

export type EditorCommandToolbarGroup =
  | "workspace"
  | "model-primary"
  | "model-primitives"
  | "sketch-tools"
  | "sketch-mode"
  | "sketch-modify"
  | "history"

export type EditorCommandIcon =
  | "aligned-rectangle"
  | "arc"
  | "box"
  | "cancel"
  | "circle"
  | "circumscribed-polygon"
  | "center-rectangle"
  | "centered-aligned-rectangle"
  | "centered-slot"
  | "construction"
  | "cylinder"
  | "extrude"
  | "extend"
  | "line"
  | "inscribed-polygon"
  | "midpoint-line"
  | "model"
  | "point"
  | "rectangle"
  | "redo"
  | "select"
  | "sketch"
  | "slot"
  | "split"
  | "subtract"
  | "tangent-arc"
  | "trim"
  | "undo"
  | "three-point-arc"
  | "three-point-circle"

export type EditorCommandLabelKey =
  | "cancelActive"
  | "createBox"
  | "createCylinder"
  | "createExtrusion"
  | "createSketch"
  | "createSubtract"
  | "sketchAlignedRectangle"
  | "sketchArc"
  | "sketchMidpointLine"
  | "sketchThreePointArc"
  | "sketchThreePointCircle"
  | "sketchCenterRectangle"
  | "sketchCenteredAlignedRectangle"
  | "sketchCenteredSlot"
  | "sketchCircle"
  | "sketchCircumscribedPolygon"
  | "sketchConstruction"
  | "sketchExtend"
  | "sketchLine"
  | "sketchInscribedPolygon"
  | "sketchPoint"
  | "sketchRectangle"
  | "sketchSlot"
  | "sketchSlotAroundLine"
  | "sketchRedo"
  | "sketchSelect"
  | "sketchSplit"
  | "sketchTangentArc"
  | "sketchTrim"
  | "sketchUndo"
  | "workspaceModel"
  | "workspaceSketch"

export type EditorCommandDisabledReason =
  | "activeFeature"
  | "activeSketch"
  | "documentUnavailable"
  | "noActiveCommand"
  | "noSketchRedo"
  | "noSketchUndo"
  | "readOnly"
  | "requiresSketch"
  | "selectProfile"
  | "selectTwoSolids"
  | "selectSketchLine"

export type EditorCommandShortcut = Readonly<{
  key: string
  modifiers?: readonly ("alt" | "mod" | "shift")[]
}>

export type EditorCommandDescriptor = Readonly<{
  group: EditorCommandGroup
  icon: EditorCommandIcon
  id: EditorCommandId
  labelKey: EditorCommandLabelKey
  ownerModuleId: string
  shortcut?: EditorCommandShortcut
  toolbarGroup?: EditorCommandToolbarGroup
}>

export type EditorCommandEligibility =
  | Readonly<{ enabled: true }>
  | Readonly<{ enabled: false; reason: EditorCommandDisabledReason }>

export type EditorCommandHandler<Context> = Readonly<{
  execute: (context: Context) => unknown
  getEligibility: (context: Context) => EditorCommandEligibility
  id: EditorCommandId
  isActive?: (context: Context) => boolean
  isToolbarVisible?: (context: Context) => boolean
  ownerModuleId: string
}>

export type ResolvedEditorCommand = Readonly<{
  active: boolean | undefined
  descriptor: EditorCommandDescriptor
  eligibility: EditorCommandEligibility
  invoke: () => unknown
  toolbarVisible: boolean
}>

export type EditorCommandRegistry<Context> = Readonly<{
  descriptors: readonly EditorCommandDescriptor[]
  resolve: (context: Context) => readonly ResolvedEditorCommand[]
}>

export type EditorCommandRegistryDiagnostic = Readonly<{
  code:
    | "duplicate-descriptor"
    | "duplicate-handler"
    | "missing-handler"
    | "orphan-handler"
    | "owner-mismatch"
  message: string
}>

export type EditorCommandRegistryResult<Context> =
  | Readonly<{ ok: true; registry: EditorCommandRegistry<Context> }>
  | Readonly<{ ok: false; diagnostic: EditorCommandRegistryDiagnostic }>

const enabled = { enabled: true } as const

export function editorCommandEnabled(): EditorCommandEligibility {
  return enabled
}

export function editorCommandDisabled(
  reason: EditorCommandDisabledReason,
): EditorCommandEligibility {
  return { enabled: false, reason }
}

function registryFailure(
  code: EditorCommandRegistryDiagnostic["code"],
  message: string,
): Readonly<{ ok: false; diagnostic: EditorCommandRegistryDiagnostic }> {
  return { ok: false, diagnostic: { code, message } }
}

export function createEditorCommandRegistry<Context>(
  descriptors: readonly EditorCommandDescriptor[],
  handlers: readonly EditorCommandHandler<Context>[],
): EditorCommandRegistryResult<Context> {
  const descriptorsById = new Map<EditorCommandId, EditorCommandDescriptor>()
  for (const descriptor of descriptors) {
    if (descriptorsById.has(descriptor.id)) {
      return registryFailure(
        "duplicate-descriptor",
        `Editor command descriptor ${descriptor.id} is registered twice.`,
      )
    }
    descriptorsById.set(descriptor.id, descriptor)
  }

  const handlersById = new Map<EditorCommandId, EditorCommandHandler<Context>>()
  for (const handler of handlers) {
    if (handlersById.has(handler.id)) {
      return registryFailure(
        "duplicate-handler",
        `Editor command handler ${handler.id} is registered twice.`,
      )
    }
    const descriptor = descriptorsById.get(handler.id)
    if (!descriptor) {
      return registryFailure(
        "orphan-handler",
        `Editor command handler ${handler.id} has no descriptor.`,
      )
    }
    if (handler.ownerModuleId !== descriptor.ownerModuleId) {
      return registryFailure(
        "owner-mismatch",
        `Editor command handler ${handler.id} does not belong to ${descriptor.ownerModuleId}.`,
      )
    }
    handlersById.set(handler.id, handler)
  }

  const descriptorWithoutHandler = descriptors.find(({ id }) => !handlersById.has(id))
  if (descriptorWithoutHandler) {
    return registryFailure(
      "missing-handler",
      `Editor command ${descriptorWithoutHandler.id} has no trusted handler.`,
    )
  }

  return {
    ok: true,
    registry: {
      descriptors,
      resolve: (context) =>
        descriptors.map((descriptor) => {
          const handler = handlersById.get(descriptor.id)
          if (!handler) {
            throw new Error(`Editor command ${descriptor.id} lost its composed handler.`)
          }
          const eligibility = handler.getEligibility(context)
          return {
            active: handler.isActive?.(context),
            descriptor,
            eligibility,
            invoke: () => (eligibility.enabled ? handler.execute(context) : undefined),
            toolbarVisible:
              descriptor.toolbarGroup !== undefined &&
              (handler.isToolbarVisible?.(context) ?? true),
          }
        }),
    },
  }
}
