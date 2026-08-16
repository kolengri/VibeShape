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
      createExtrusion: vi.fn(),
      createSketch: vi.fn(),
      createSubtract: vi.fn(),
      redoSketch: vi.fn(),
      setSketchConstruction: vi.fn(),
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
      sketchRedoAvailable: false,
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

  it("routes the center rectangle shortcut descriptor to the trusted sketch tool handler", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchCenterRectangle,
    )

    expect(command?.descriptor.shortcut).toEqual({ key: "r", modifiers: ["shift"] })
    expect(command?.toolbarVisible).toBe(true)
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("center-rectangle")
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
