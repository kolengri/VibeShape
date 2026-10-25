import { describe, expect, it } from "bun:test"
import type { SketchId } from "@vibeshape/domain"
import { partIdSchema } from "@vibeshape/domain/identifiers"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { bodyCatalogueFixture } from "../features/part-design/exact-body-catalogue.test-fixtures"
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

it("publishes modeling and reference shortcuts on the shared descriptors", () => {
  const shortcuts = Object.fromEntries(
    builtInEditorCommandDescriptors.map((command) => [command.labelKey, command.shortcut]),
  )
  expect(shortcuts).toMatchObject({
    openShortcutHelp: { key: "F1" },
    createSketch: { key: "s", modifiers: ["shift"] },
    createExtrusion: { key: "e" },
    createRevolve: { key: "e", modifiers: ["shift"] },
    measure: { key: "m", modifiers: ["shift"] },
    sketchUse: { key: "u" },
    sketchMirror: { key: "i" },
    sketchNormalView: { key: "n" },
    sketchNavigateView: { key: "Space" },
    sketchOrbitView: { key: "n", modifiers: ["shift"] },
  })
})

it("opens shortcut help through its registered handler even while the document is loading", () => {
  const context = commandContext({ controller: { ...readyController(), status: "loading" } })
  const openShortcutHelp = vi.fn()
  const commands = resolveBuiltInEditorCommands({
    ...context,
    actions: { ...context.actions, openShortcutHelp },
  })
  const help = commands.find(
    ({ descriptor }) => descriptor.id === editorCommandIds.openShortcutHelp,
  )
  expect(help?.eligibility.enabled).toBe(true)
  help?.invoke()
  expect(openShortcutHelp).toHaveBeenCalledTimes(1)
  expect(context.actions.createSketch).not.toHaveBeenCalled()
})

it("shares Press Pull eligibility and activation across toolbar, palette, context menu, and Q", () => {
  const pressPull = vi.fn()
  const context = commandContext({ pressPullAvailable: true })
  const resolve = (state: BuiltInEditorCommandContext["state"]) =>
    resolveBuiltInEditorCommands({
      ...context,
      actions: { ...context.actions, pressPull },
      state,
    }).find((command) => command.descriptor.id === editorCommandIds.pressPull)
  const enabled = resolve(context.state)
  expect(enabled?.eligibility).toEqual({ enabled: true })
  expect(enabled?.descriptor.shortcut).toEqual({ key: "q" })
  expect(enabled?.toolbarVisible).toBe(true)
  enabled?.invoke()
  expect(pressPull).toHaveBeenCalledTimes(1)
  const absent = resolve({ ...context.state, pressPullAvailable: false })
  expect(absent?.eligibility).toEqual({ enabled: false, reason: "selectPlanarFace" })
  absent?.invoke()
  expect(pressPull).toHaveBeenCalledTimes(1)
  const saving = resolve({
    ...context.state,
    controller: { ...readyController(), saveStatus: "saving" },
  })
  expect(saving?.eligibility).toEqual({ enabled: false, reason: "saving" })
})

function readyController(featureCount = 0) {
  return {
    status: "ready",
    saveStatus: "saved",
    history: { canUndo: true, canRedo: true },
    report: {
      mode: "read-write",
      snapshot: { features: Array.from({ length: featureCount }), revision: 7 },
    },
  } as unknown as DocumentControllerState
}

it("routes Generative Design through a writable registered toolbar and palette command", () => {
  const generativeDesign = vi.fn()
  const context = commandContext()
  const withAction = { ...context, actions: { ...context.actions, generativeDesign } }
  const command = resolveBuiltInEditorCommands(withAction).find(
    ({ descriptor }) => descriptor.id === editorCommandIds.generativeDesign,
  )
  expect(command?.descriptor.labelKey).toBe("generativeDesign")
  expect(command?.descriptor.toolbarGroup).toBe("model-primary")
  expect(command?.eligibility.enabled).toBe(true)
  command?.invoke()
  expect(generativeDesign).toHaveBeenCalledTimes(1)
  const blocked = resolveBuiltInEditorCommands({
    ...withAction,
    state: { ...withAction.state, controller: { ...readyController(), status: "loading" } },
  }).find(({ descriptor }) => descriptor.id === editorCommandIds.generativeDesign)
  expect(blocked?.eligibility.enabled).toBe(false)
  blocked?.invoke()
  expect(generativeDesign).toHaveBeenCalledTimes(1)
})

function commandContext(
  overrides: Partial<BuiltInEditorCommandContext["state"]> = {},
): BuiltInEditorCommandContext {
  return {
    actions: {
      cancelActive: vi.fn(),
      documentRedo: vi.fn(),
      documentUndo: vi.fn(),
      createFillet: vi.fn(),
      createChamfer: vi.fn(),
      createHole: vi.fn(),
      createBox: vi.fn(),
      createCylinder: vi.fn(),
      createSphere: vi.fn(),
      createCone: vi.fn(),
      createPyramid: vi.fn(),
      createTorus: vi.fn(),
      createDatumPlane: vi.fn(),
      createExtrusion: vi.fn(),
      createRevolve: vi.fn(),
      createSketch: vi.fn(),
      createSubtract: vi.fn(),
      measure: vi.fn(),
      redoSketch: vi.fn(),
      setSketchCameraMode: vi.fn(),
      setSketchConstruction: vi.fn(),
      setSketchFinalContext: vi.fn(),
      setSketchTool: vi.fn(),
      switchWorkspace: vi.fn(),
      toggleAllSketchVisibility: vi.fn(),
      undoSketch: vi.fn(),
    },
    state: {
      activePartDesignCommand: null,
      activeSketchTool: null,
      controller: readyController(),
      extrusionAvailable: false,
      hasSavedSketches: false,
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

  it("keeps sketch family defaults and shortcut ordering registry-owned", () => {
    const shortcutOrders = builtInEditorCommandDescriptors.flatMap(({ sketchPresentation }) =>
      sketchPresentation?.shortcutOrder === undefined ? [] : [sketchPresentation.shortcutOrder],
    )
    expect(shortcutOrders.sort((first, second) => first - second)).toEqual(
      Array.from({ length: shortcutOrders.length }, (_, index) => index),
    )

    const familyCommands = builtInEditorCommandDescriptors.filter(
      ({ sketchPresentation }) => sketchPresentation?.family,
    )
    const families = new Set(
      familyCommands.flatMap(({ sketchPresentation }) =>
        sketchPresentation?.family ? [sketchPresentation.family] : [],
      ),
    )
    for (const family of families) {
      const commands = familyCommands.filter(
        ({ sketchPresentation }) => sketchPresentation?.family === family,
      )
      expect(
        commands.filter(({ sketchPresentation }) => sketchPresentation?.familyDefault),
      ).toHaveLength(1)
      expect(
        commands
          .map(({ sketchPresentation }) => sketchPresentation?.familyOrder)
          .sort((first, second) => (first ?? 0) - (second ?? 0)),
      ).toEqual(Array.from({ length: commands.length }, (_, index) => index))
      const expectedToolbarGroup = family === "constraint" ? "sketch-precision" : "sketch-tools"
      expect(commands.every(({ toolbarGroup }) => toolbarGroup === expectedToolbarGroup)).toBe(true)
    }
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

  it("rejects ambiguous sketch presentation metadata at the registry boundary", () => {
    const line = builtInEditorCommandDescriptors.find(
      ({ id }) => id === editorCommandIds.sketchLine,
    )
    const midpointLine = builtInEditorCommandDescriptors.find(
      ({ id }) => id === editorCommandIds.sketchMidpointLine,
    )
    const centerRectangle = builtInEditorCommandDescriptors.find(
      ({ id }) => id === editorCommandIds.sketchCenterRectangle,
    )
    const trim = builtInEditorCommandDescriptors.find(
      ({ id }) => id === editorCommandIds.sketchTrim,
    )
    if (!line?.sketchPresentation?.family || !midpointLine?.sketchPresentation?.family) {
      throw new Error("Expected line-family command descriptors.")
    }
    if (!centerRectangle?.sketchPresentation?.family || !trim?.sketchPresentation) {
      throw new Error("Expected sketch presentation descriptors.")
    }

    expect(
      createEditorCommandRegistry(
        [
          { ...line, sketchPresentation: { ...line.sketchPresentation, shortcutOrder: 0 } },
          {
            ...centerRectangle,
            sketchPresentation: { ...centerRectangle.sketchPresentation, shortcutOrder: 0 },
          },
        ],
        [],
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })

    expect(
      createEditorCommandRegistry(
        [
          line,
          {
            ...midpointLine,
            sketchPresentation: { ...midpointLine.sketchPresentation, familyOrder: 0 },
          },
        ],
        [],
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })

    expect(
      createEditorCommandRegistry(
        [
          {
            ...line,
            sketchPresentation: {
              family: line.sketchPresentation.family,
              familyOrder: line.sketchPresentation.familyOrder,
            },
          },
        ],
        [],
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })

    expect(
      createEditorCommandRegistry(
        [
          line,
          {
            ...midpointLine,
            sketchPresentation: { ...midpointLine.sketchPresentation, familyDefault: true },
          },
        ],
        [],
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })

    expect(
      createEditorCommandRegistry([{ ...line, toolbarGroup: "sketch-modify" }], []),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })

    expect(
      createEditorCommandRegistry([{ ...trim, toolbarGroup: "sketch-tools" }], []),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-presentation" } })
  })

  it("exposes Spline through the ordinary sketch command eligibility and trusted handler", () => {
    const unavailable = resolveBuiltInEditorCommands(commandContext()).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchSpline,
    )
    expect(unavailable?.eligibility.enabled).toBe(false)
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchSpline,
    )
    expect(command?.eligibility.enabled).toBe(true)
    expect(command?.descriptor).toMatchObject({
      labelKey: "sketchSpline",
      toolbarGroup: "sketch-tools",
    })
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledTimes(1)
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("cubic-bezier")
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
    expect(context.actions.createSketch).toHaveBeenCalledTimes(1)
    expect(context.actions.createExtrusion).not.toHaveBeenCalled()
  })

  it.each(["createSphere", "createCone", "createTorus", "createPyramid"] as const)(
    "owns %s across command surfaces and preserves feature creation eligibility",
    async (key) => {
      const context = commandContext()
      const command = resolveBuiltInEditorCommands(context).find(
        ({ descriptor }) => descriptor.id === editorCommandIds[key],
      )
      expect(command?.descriptor).toMatchObject({
        ownerModuleId: "org.vibeshape.core.part-design",
        toolbarGroup: "model-primitives",
        labelKey: key,
      })
      expect(command?.eligibility).toEqual({ enabled: true })
      await command?.invoke()
      expect(context.actions[key]).toHaveBeenCalledTimes(1)

      const controller = readyController()
      if (!controller.report) throw new Error("The ready fixture must include a report.")
      const blockedStates: Partial<BuiltInEditorCommandContext["state"]>[] = [
        { controller: { ...controller, report: { ...controller.report, mode: "read-only" } } },
        { controller: { ...controller, saveStatus: "saving" } },
        { activePartDesignCommand: "sphere" },
        { activeSketchTool: { kind: "select-sketch-plane" } },
      ]
      for (const state of blockedStates) {
        const blockedContext = commandContext(state)
        const blocked = resolveBuiltInEditorCommands(blockedContext).find(
          ({ descriptor }) => descriptor.id === editorCommandIds[key],
        )
        expect(blocked?.eligibility.enabled).toBe(false)
        await blocked?.invoke()
        expect(blockedContext.actions[key]).not.toHaveBeenCalled()
      }
    },
  )

  it("keeps sketch commands discoverable but disabled outside an active sketch", () => {
    const context = commandContext()
    const line = resolveBuiltInEditorCommands(context).find(
      ({ descriptor: command }) => command.id === editorCommandIds.sketchLine,
    )

    expect(line?.toolbarVisible).toBe(false)
    expect(line?.eligibility).toEqual({ enabled: false, reason: "requiresSketch" })
  })

  it("routes committed history through the document controller and hides it during tasks", () => {
    const context = commandContext()
    const commands = resolveBuiltInEditorCommands(context)
    const undo = commands.find(({ descriptor }) => descriptor.id === editorCommandIds.documentUndo)
    const redo = commands.find(({ descriptor }) => descriptor.id === editorCommandIds.documentRedo)

    expect(undo?.eligibility).toEqual({ enabled: true })
    expect(redo?.eligibility).toEqual({ enabled: true })
    undo?.invoke()
    redo?.invoke()
    expect(context.actions.documentUndo).toHaveBeenCalledWith(7)
    expect(context.actions.documentRedo).toHaveBeenCalledWith(7)

    const activeContext = commandContext({ activePartDesignCommand: "box" })
    const activeUndo = resolveBuiltInEditorCommands(activeContext).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.documentUndo,
    )
    expect(activeUndo?.toolbarVisible).toBe(false)
    expect(activeUndo?.eligibility).toEqual({ enabled: false, reason: "activeFeature" })
  })

  it("keeps Use external geometry registry-owned and disables downstream display context", () => {
    const context = commandContext({
      activeSketchTool: { kind: "edit-sketch", sketchId: "sketch-1" as SketchId },
      sketchFinalContext: true,
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchUse,
    )

    expect(command?.toolbarVisible).toBe(true)
    expect(command?.eligibility).toEqual({ enabled: false, reason: "hideFinalContext" })
    command?.invoke()
    expect(context.actions.setSketchTool).not.toHaveBeenCalled()
  })

  it("toggles every saved sketch through the shared Shift+H command", () => {
    const unavailableContext = commandContext()
    const unavailable = resolveBuiltInEditorCommands(unavailableContext).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.toggleAllSketchVisibility,
    )
    expect(unavailable?.descriptor.shortcut).toEqual({ key: "h", modifiers: ["shift"] })
    expect(unavailable?.eligibility).toEqual({ enabled: false, reason: "noSavedSketches" })

    const availableContext = commandContext({ hasSavedSketches: true })
    const available = resolveBuiltInEditorCommands(availableContext).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.toggleAllSketchVisibility,
    )
    available?.invoke()
    expect(availableContext.actions.toggleAllSketchVisibility).toHaveBeenCalledTimes(1)
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
    expect(context.actions.createExtrusion).toHaveBeenCalledTimes(1)
  })

  it("offers Revolve inside an active sketch when a closed profile is selected", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      revolveAvailable: true,
      workspace: "sketch",
    })
    const revolve = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.createRevolve,
    )

    expect(revolve?.eligibility).toEqual({ enabled: true })
    expect(revolve?.toolbarVisible).toBe(true)
    revolve?.invoke()
    expect(context.actions.createRevolve).toHaveBeenCalledTimes(1)
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
    expect(command?.descriptor.toolbarGroup).toBe("sketch-precision")
    expect(command?.toolbarVisible).toBe(true)
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("dimension")
  })

  it("routes registered constraints to repeatable sketch tools", () => {
    const context = commandContext({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
    })
    const command = resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.sketchConstraintPointOnLine,
    )

    expect(command?.descriptor.toolbarGroup).toBe("sketch-precision")
    expect(command?.descriptor.sketchPresentation?.family).toBe("constraint")
    expect(command?.toolbarVisible).toBe(true)
    command?.invoke()
    expect(context.actions.setSketchTool).toHaveBeenCalledWith("constraint-point-on-line")
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
      sketchTool: "constraint-parallel",
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
    expect(sketchContext.actions.cancelActive).toHaveBeenCalledTimes(1)

    const planeContext = commandContext({
      activeSketchTool: { kind: "select-sketch-plane" },
      sketchTool: "rectangle",
    })
    const cancelPlaneSelection = resolveBuiltInEditorCommands(planeContext).find(
      ({ descriptor: command }) => command.id === editorCommandIds.cancelActive,
    )

    cancelPlaneSelection?.invoke()
    expect(planeContext.actions.cancelActive).toHaveBeenCalledTimes(1)
    expect(planeContext.actions.setSketchTool).not.toHaveBeenCalled()
  })
})

it("blocks new modeling tasks while a saved document mutation is pending", () => {
  for (const activeSketchTool of [null, { kind: "create-sketch" as const, plane: "xy" as const }]) {
    const context = commandContext({
      controller: { ...readyController(), saveStatus: "saving" },
      activeSketchTool,
      extrusionAvailable: true,
      revolveAvailable: true,
    })
    const commands = resolveBuiltInEditorCommands(context)
    for (const id of [
      editorCommandIds.createExtrusion,
      editorCommandIds.createRevolve,
      editorCommandIds.createBox,
    ]) {
      expect(commands.find((command) => command.descriptor.id === id)?.eligibility).toMatchObject({
        enabled: false,
        reason: "saving",
      })
    }
  }
})

describe("measurement command", () => {
  const resolve = (context: BuiltInEditorCommandContext) =>
    resolveBuiltInEditorCommands(context).find(
      ({ descriptor }) => descriptor.id === editorCommandIds.measure,
    )

  it("reads a read-only document without invoking a document mutation", () => {
    const controller = readyController()
    if (!controller.report) throw new Error("Expected a loaded document.")
    const context = commandContext({
      controller: { ...controller, report: { ...controller.report, mode: "read-only" } },
    })
    const command = resolve(context)
    expect(command?.eligibility).toEqual({ enabled: true })
    command?.invoke()
    expect(context.actions.measure).toHaveBeenCalledTimes(1)
    expect(context.actions.createBox).not.toHaveBeenCalled()
    expect(context.actions.documentUndo).not.toHaveBeenCalled()
  })

  it("rejects missing handlers, saving, active features, and active sketch editing", () => {
    const unavailable = commandContext()
    const { measure: _measure, ...actions } = unavailable.actions
    const withoutHandler = { ...unavailable, actions }
    expect(resolve(withoutHandler)?.eligibility).toEqual({
      enabled: false,
      reason: "documentUnavailable",
    })
    const cases: Partial<BuiltInEditorCommandContext["state"]>[] = [
      { controller: { ...readyController(), saveStatus: "saving" } },
      { activePartDesignCommand: "box" },
      { activeSketchTool: { kind: "select-sketch-plane" } },
    ]
    for (const state of cases) {
      const context = commandContext(state)
      const command = resolve(context)
      expect(command?.eligibility.enabled).toBe(false)
      command?.invoke()
      expect(context.actions.measure).not.toHaveBeenCalled()
    }
  })
})

it("allows Escape to clear idle body selection through the shared command", async () => {
  const context = commandContext({ selectionAvailable: true })
  const command = resolveBuiltInEditorCommands(context).find(
    ({ descriptor }) => descriptor.id === editorCommandIds.cancelActive,
  )
  expect(command?.eligibility.enabled).toBe(true)
  await command?.invoke()
  expect(context.actions.cancelActive).toHaveBeenCalledTimes(1)
})

it.each(["createLoft", "createSweep"] as const)(
  "routes %s through the registered saved-sketch guard",
  (command) => {
    const action = vi.fn()
    const unavailable = commandContext()
    const unavailableCommands = resolveBuiltInEditorCommands({
      ...unavailable,
      actions: { ...unavailable.actions, [command]: action },
    })
    expect(
      unavailableCommands.find(({ descriptor }) => descriptor.id === editorCommandIds[command])
        ?.eligibility,
    ).toMatchObject({ enabled: false, reason: "noSavedSketches" })
    const available = commandContext({ hasSavedSketches: true })
    const entry = resolveBuiltInEditorCommands({
      ...available,
      actions: { ...available.actions, [command]: action },
    }).find(({ descriptor }) => descriptor.id === editorCommandIds[command])
    expect(entry?.eligibility.enabled).toBe(true)
    entry?.invoke()
    expect(action).toHaveBeenCalledTimes(1)
    const editing = commandContext({ hasSavedSketches: true, activePartDesignCommand: "loft" })
    expect(
      resolveBuiltInEditorCommands(editing).find(
        ({ descriptor }) => descriptor.id === editorCommandIds[command],
      )?.eligibility.enabled,
    ).toBe(false)
  },
)

it("guards selected-part commands against saving, read-only access and missing selection", () => {
  const partId = partIdSchema.parse("10000000-0000-7000-8000-000000000001")
  for (const state of [
    {},
    {
      selectedExactPartId: partId,
      controller: { ...readyController(), saveStatus: "saving" as const },
    },
    {
      selectedExactPartId: partId,
      controller: {
        ...readyController(),
        report: {
          ...readyController().report,
          mode: "read-only" as const,
        } as DocumentControllerState["report"],
      },
    },
  ]) {
    const context = commandContext(state)
    const placePart = vi.fn()
    const command = resolveBuiltInEditorCommands({
      ...context,
      actions: { ...context.actions, placePart },
    }).find(({ descriptor }) => descriptor.id === editorCommandIds.placePart)
    expect(command?.eligibility.enabled).toBe(false)
    command?.invoke()
    expect(placePart).not.toHaveBeenCalled()
  }
})

it("shares precise Boolean eligibility across command surfaces and refreshes replaced rebuilds", () => {
  const fixture = bodyCatalogueFixture(1, 2)
  const context = commandContext()
  const ready = readyController()
  if (!ready.report) throw new Error("Expected ready report")
  const controller = {
    ...ready,
    report: { ...ready.report, snapshot: fixture.snapshot, rebuild: fixture.rebuild },
  } as DocumentControllerState
  const resolve = (state = controller) =>
    resolveBuiltInEditorCommands({
      ...context,
      state: { ...context.state, controller: state },
    }).find(({ descriptor }) => descriptor.id === editorCommandIds.createSubtract)
  const command = resolve()
  expect(command?.eligibility.enabled).toBe(true)
  expect(command?.descriptor.toolbarGroup).toBe("model-primary")
  command?.invoke()
  expect(context.actions.createSubtract).toHaveBeenCalledTimes(1)

  const record = fixture.rebuild.response.geometry[0]
  if (!record?.geometry.bodies) throw new Error("Expected exact body fixture")
  if (!controller.report) throw new Error("Expected current report")
  const unavailable = {
    ...controller,
    report: {
      ...controller.report,
      rebuild: {
        ...fixture.rebuild,
        response: {
          ...fixture.rebuild.response,
          geometry: [
            {
              ...record,
              geometry: {
                ...record.geometry,
                bodies: record.geometry.bodies.map((body) => ({
                  ...body,
                  representation: "triangle-mesh" as const,
                })),
              },
            },
          ],
        },
      },
    },
  }
  const blocked = resolve(unavailable)
  expect(blocked?.eligibility).toEqual({ enabled: false, reason: "selectTwoSolids" })
  blocked?.invoke()
  expect(context.actions.createSubtract).toHaveBeenCalledTimes(1)
  expect(resolve({ ...controller, saveStatus: "saving" })?.eligibility).toEqual({
    enabled: false,
    reason: "saving",
  })
})
