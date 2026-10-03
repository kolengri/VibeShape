import { sketchIdSchema } from "@vibeshape/domain"
import { describe, expect, it, vi } from "vitest"
import {
  type BuiltInEditorCommandContext,
  resolveBuiltInEditorCommands,
} from "../../../commands/built-in-editor-commands"
import { editorCommandIds } from "../../../commands/editor-command"
import type { DocumentControllerState } from "../../../document/document-controller"

const writable = {
  status: "ready",
  saveStatus: "saved",
  report: { mode: "read-write", snapshot: { features: [], revision: 1 } },
} as unknown as DocumentControllerState
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000001")
function textCommand(
  overrides: Partial<BuiltInEditorCommandContext["state"]> = {},
  openSketchText: (() => void) | null = vi.fn(),
) {
  const commands = resolveBuiltInEditorCommands({
    actions: {
      ...(openSketchText ? { openSketchText } : {}),
    } as BuiltInEditorCommandContext["actions"],
    state: {
      activePartDesignCommand: null,
      activeSketchTool: { kind: "edit-sketch", sketchId },
      controller: writable,
      extrusionAvailable: false,
      hasSavedSketches: true,
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
  })
  const command = commands.find(({ descriptor }) => descriptor.id === editorCommandIds.sketchText)
  if (!command) throw new Error("The Text command must remain registered.")
  return command
}
describe("sketch text command authority", () => {
  it("opens the active editor through the ordinary registered action", () => {
    const open = vi.fn()
    const command = textCommand({}, open)
    expect(command.eligibility.enabled).toBe(true)
    expect(command.descriptor).toMatchObject({
      group: "sketch",
      toolbarGroup: "sketch-tools",
      icon: "text",
      labelKey: "sketchText",
    })
    command.invoke()
    expect(open).toHaveBeenCalledOnce()
  })
  it.each([
    { activeSketchTool: null },
    { activeSketchTool: { kind: "select-sketch-plane" as const } },
    { controller: { ...writable, status: "loading" as const } },
    { controller: { ...writable, saveStatus: "saving" as const } },
    {
      controller: {
        ...writable,
        report: { ...writable.report, mode: "read-only" },
      } as DocumentControllerState,
    },
  ])("rejects inaccessible editing contexts before invoking the action", (state) => {
    const open = vi.fn()
    const command = textCommand(state, open)
    expect(command.eligibility.enabled).toBe(false)
    command.invoke()
    expect(open).not.toHaveBeenCalled()
  })
  it("requires the Text application port", () => {
    expect(textCommand({}, null).eligibility.enabled).toBe(false)
  })
})
