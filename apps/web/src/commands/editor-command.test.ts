import type { SketchId } from "@vibeshape/domain"
import { describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import {
  type BuiltInEditorCommandContext,
  builtInEditorCommandDescriptors,
  resolveBuiltInEditorCommands,
} from "./built-in-editor-commands"
import {
  createEditorCommandRegistry,
  type EditorCommandDescriptor,
  type EditorCommandHandler,
  editorCommandEnabled,
  editorCommandIds,
} from "./editor-command"

const descriptor: EditorCommandDescriptor = {
  group: "workspace",
  icon: "model",
  id: editorCommandIds.workspaceModel,
  labelKey: "workspaceModel",
  ownerModuleId: "org.vibeshape.core.editor",
}

const handler: EditorCommandHandler<null> = {
  execute: vi.fn(),
  getEligibility: editorCommandEnabled,
  id: descriptor.id,
  ownerModuleId: descriptor.ownerModuleId,
}

function readyController(featureCount = 0) {
  return {
    status: "ready",
    report: {
      mode: "read-write",
      snapshot: { features: Array.from({ length: featureCount }) },
    },
  } as unknown as DocumentControllerState
}

function commandContext(
  overrides: Partial<BuiltInEditorCommandContext["state"]> = {},
): BuiltInEditorCommandContext {
  return {
    actions: {
      cancelActive: vi.fn(),
      createBox: vi.fn(),
      createCylinder: vi.fn(),
      createDatumPlane: vi.fn(),
      createExtrusion: vi.fn(),
      createSketch: vi.fn(),
      createSubtract: vi.fn(),
      redoSketch: vi.fn(),
      setSketchCameraMode: vi.fn(),
      setSketchConstruction: vi.fn(),
      setSketchFinalContext: vi.fn(),
      setSketchTool: vi.fn(),
      switchWorkspace: vi.fn(),
      undoSketch: vi.fn(),
    },
    state: {
      activePartDesignCommand: null,
      activeSketchTool: null,
      controller: readyController(),
      extrusionAvailable: false,
      sketchConstruction: false,
      sketchCameraMode: "normal",
      sketchFinalContext: false,
      sketchRedoAvailable: false,
      slotFromSelectionAvailable: false,
      sketchTool: "select",
      sketchUndoAvailable: false,
      workspace: "model",
      ...overrides,
    },
  }
}

describe("editor command registry", () => {
  it("keeps built-in descriptors serializable for future extension and automation adapters", () => {
    expect(JSON.parse(JSON.stringify(builtInEditorCommandDescriptors))).toEqual(
      builtInEditorCommandDescriptors,
    )
  })

  it("rejects duplicate, missing, orphaned, and owner-mismatched composition", () => {
    expect(createEditorCommandRegistry([descriptor, descriptor], [handler])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-descriptor" },
    })
    expect(createEditorCommandRegistry([descriptor], [])).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-handler" },
    })
    expect(createEditorCommandRegistry([], [handler])).toMatchObject({
      ok: false,
      diagnostic: { code: "orphan-handler" },
    })
    expect(
      createEditorCommandRegistry(
        [descriptor],
        [{ ...handler, ownerModuleId: "org.example.other" }],
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "owner-mismatch" } })
    expect(createEditorCommandRegistry([descriptor], [handler, handler])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-handler" },
    })
  })

  it("resolves eligibility and invokes the same trusted handler used by every surface", () => {
    const context = commandContext()
    const commands = resolveBuiltInEditorCommands(context)
    const createSketch = commands.find(
      ({ descriptor: command }) => command.id === editorCommandIds.createSketch,
    )
    const extrude = commands.find(
      ({ descriptor: command }) => command.id === editorCommandIds.createExtrusion,
    )

    expect(createSketch?.eligibility).toEqual({ enabled: true })
    expect(extrude?.eligibility).toEqual({ enabled: false, reason: "selectProfile" })
    createSketch?.invoke()
    extrude?.invoke()
    expect(context.actions.createSketch).toHaveBeenCalledOnce()
    expect(context.actions.createExtrusion).not.toHaveBeenCalled()
  })

  it("keeps sketch commands discoverable but disabled outside an active sketch", () => {
    const context = commandContext()
    const line = resolveBuiltInEditorCommands(context).find(
      ({ descriptor: command }) => command.id === editorCommandIds.sketchLine,
    )

    expect(line?.toolbarVisible).toBe(false)
    expect(line?.eligibility).toEqual({ enabled: false, reason: "requiresSketch" })
  })

  it("offers Extrude inside an active sketch when a closed profile is selected", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      extrusionAvailable: true,
      workspace: "sketch",
    })
    const extrude = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.createExtrusion,
    )

    expect(extrude?.eligibility).toEqual({ enabled: true })
    expect(extrude?.toolbarVisible).toBe(true)
    extrude?.invoke()
    expect(context.actions.createExtrusion).toHaveBeenCalledOnce()
  })

  it("routes the center rectangle shortcut descriptor to the trusted sketch tool handler", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCenterRectangle,
    )

    expect(command?.descriptor.shortcut).toEqual({ key: "r" })
    expect(command?.toolbarVisible).toBe(true)
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("center-rectangle")
  })

  it("routes the Dimension shortcut to the first-class sketch tool", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchDimension,
    )

    expect(command?.descriptor.shortcut).toEqual({ key: "d" })
    expect(command?.descriptor.toolbarGroup).toBe("sketch-modify")
    expect(command?.toolbarVisible).toBe(true)
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("dimension")
  })

  it("routes the three-point arc shortcut descriptor to the trusted sketch tool handler", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchThreePointArc,
    )

    expect(command?.descriptor.shortcut).toEqual({ key: "a" })
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("three-point-arc")
  })

  it("routes sketch modification commands through trusted sketch tool handlers", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const commands = resolveBuiltInEditorCommands(context)
    const trim = commands.find(({ descriptor }) => descriptor.id === editorCommandIds.sketchTrim)
    const extend = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchExtend,
    )
    const mirror = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchMirror,
    )
    const offset = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchOffset,
    )
    const linearPattern = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchLinearPattern,
    )
    const circularPattern = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCircularPattern,
    )
    const split = commands.find(({ descriptor }) => descriptor.id === editorCommandIds.sketchSplit)
    const transform = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchTransform,
    )

    expect(trim?.descriptor.shortcut).toEqual({ key: "m" })
    expect(trim?.toolbarVisible).toBe(true)
    expect(offset?.descriptor.shortcut).toEqual({ key: "o" })
    trim?.invoke()
    extend?.invoke()
    mirror?.invoke()
    offset?.invoke()
    linearPattern?.invoke()
    circularPattern?.invoke()
    split?.invoke()
    transform?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(1, "trim")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(2, "extend")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(3, "mirror")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(4, "offset")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(5, "linear-pattern")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(6, "circular-pattern")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(7, "split")
    expect(context.actions.setSketchTool).toHaveBeenNthCalledWith(8, "transform")
  })

  it("routes sketch camera commands without changing the active geometry tool", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      sketchCameraMode: "normal",
      sketchTool: "line",
      workspace: "sketch",
    })
    const commands = resolveBuiltInEditorCommands(context)
    const orbit = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchOrbitView,
    )
    const normal = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchNormalView,
    )

    expect(orbit?.toolbarVisible).toBe(true)
    expect(orbit?.active).toBe(false)
    expect(normal?.active).toBe(true)
    orbit?.invoke()
    normal?.invoke()
    expect(context.actions.setSketchCameraMode).toHaveBeenNthCalledWith(1, "orbit")
    expect(context.actions.setSketchCameraMode).toHaveBeenNthCalledWith(2, "normal")
    expect(context.actions.setSketchTool).not.toHaveBeenCalled()
  })

  it("offers final result context only while editing an existing sketch", () => {
    const creating = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const editing = commandContext({
      activeSketchTool: { kind: "edit-sketch", sketchId: "sketch-1" as SketchId },
      sketchFinalContext: true,
      workspace: "sketch",
    })
    const createCommand = resolveBuiltInEditorCommands(creating).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchFinalContext,
    )
    const editCommand = resolveBuiltInEditorCommands(editing).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchFinalContext,
    )

    expect(createCommand?.toolbarVisible).toBe(false)
    expect(createCommand?.eligibility).toEqual({
      enabled: false,
      reason: "requiresExistingSketch",
    })
    expect(editCommand?.toolbarVisible).toBe(true)
    expect(editCommand?.active).toBe(true)
    editCommand?.invoke()
    expect(editing.actions.setSketchFinalContext).toHaveBeenCalledWith(false)
  })

  it("routes aligned rectangles, polygons, slots, and tangent arc through trusted sketch tool handlers", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const commands = resolveBuiltInEditorCommands(context)
    const alignedRectangle = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchAlignedRectangle,
    )
    const centeredAlignedRectangle = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCenteredAlignedRectangle,
    )
    const tangentArc = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchTangentArc,
    )
    const straightSlot = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchSlot,
    )
    const centeredSlot = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCenteredSlot,
    )
    const inscribedPolygon = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchInscribedPolygon,
    )
    const circumscribedPolygon = commands.find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCircumscribedPolygon,
    )

    expect(alignedRectangle?.toolbarVisible).toBe(true)
    alignedRectangle?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("aligned-rectangle")
    expect(centeredAlignedRectangle?.toolbarVisible).toBe(true)
    centeredAlignedRectangle?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("centered-aligned-rectangle")
    expect(straightSlot?.toolbarVisible).toBe(true)
    straightSlot?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("slot")
    expect(centeredSlot?.toolbarVisible).toBe(true)
    centeredSlot?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("centered-slot")
    inscribedPolygon?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("inscribed-polygon")
    circumscribedPolygon?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("circumscribed-polygon")
    expect(tangentArc?.descriptor.shortcut).toEqual({ key: "a", modifiers: ["shift"] })
    tangentArc?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("tangent-arc")
  })

  it("offers slot from selection only for one selected sketch line", () => {
    const unavailableContext = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      slotFromSelectionAvailable: false,
      workspace: "sketch",
    })
    const unavailable = resolveBuiltInEditorCommands(unavailableContext).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchSlotAroundLine,
    )
    expect(unavailable?.eligibility).toEqual({ enabled: false, reason: "selectSketchLine" })

    const availableContext = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      slotFromSelectionAvailable: true,
      workspace: "sketch",
    })
    const available = resolveBuiltInEditorCommands(availableContext).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchSlotAroundLine,
    )
    expect(available?.eligibility).toEqual({ enabled: true })
    available?.invoke()
    expect(availableContext.actions.setSketchTool).toHaveBeenCalledWith("slot-from-selection")
  })

  it("keeps sketch geometry commands unavailable while an origin plane is being selected", () => {
    const context = commandContext({ activeSketchTool: { kind: "select-sketch-plane" } })
    const commands = resolveBuiltInEditorCommands(context)
    const createSketch = commands.find(
      ({ descriptor: command }) => command.id === editorCommandIds.createSketch,
    )
    const line = commands.find(
      ({ descriptor: command }) => command.id === editorCommandIds.sketchLine,
    )
    const sketchWorkspace = commands.find(
      ({ descriptor: command }) => command.id === editorCommandIds.workspaceSketch,
    )

    expect(createSketch?.active).toBe(true)
    expect(createSketch?.toolbarVisible).toBe(true)
    expect(line?.toolbarVisible).toBe(false)
    expect(line?.eligibility).toEqual({ enabled: false, reason: "requiresSketch" })
    expect(sketchWorkspace?.eligibility).toEqual({ enabled: false, reason: "activeSketch" })
  })

  it("cancels the active sketch tool before canceling the sketch command", () => {
    const toolContext = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      sketchTool: "rectangle",
      workspace: "sketch",
    })
    const cancelTool = resolveBuiltInEditorCommands(toolContext).find(
      ({ descriptor: command }) => command.id === editorCommandIds.cancelActive,
    )

    cancelTool?.invoke()
    expect(toolContext.actions.setSketchTool).toHaveBeenCalledWith("select")
    expect(toolContext.actions.cancelActive).not.toHaveBeenCalled()

    const sketchContext = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      sketchTool: "select",
      workspace: "sketch",
    })
    const cancelSketch = resolveBuiltInEditorCommands(sketchContext).find(
      ({ descriptor: command }) => command.id === editorCommandIds.cancelActive,
    )

    cancelSketch?.invoke()
    expect(sketchContext.actions.cancelActive).toHaveBeenCalledOnce()

    const planeContext = commandContext({
      activeSketchTool: { kind: "select-sketch-plane" },
      sketchTool: "rectangle",
    })
    const cancelPlaneSelection = resolveBuiltInEditorCommands(planeContext).find(
      ({ descriptor: command }) => command.id === editorCommandIds.cancelActive,
    )

    cancelPlaneSelection?.invoke()
    expect(planeContext.actions.cancelActive).toHaveBeenCalledOnce()
    expect(planeContext.actions.setSketchTool).not.toHaveBeenCalled()
  })
})
