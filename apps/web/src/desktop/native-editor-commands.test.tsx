import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import type { DesktopCommand, DesktopHostBridge } from "@vibeshape/automation-api/desktop-host"
import { ActivityProvider, useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { vi } from "../../../../tests/unit/support/bun-test"
import { editorCommandIds, type ResolvedEditorCommand } from "../commands/editor-command"

const { act, cleanup, render, waitFor } = await import("@testing-library/react")
const { NativeApplicationCommandBridge, NativeEditorCommandBridge } = await import(
  "./native-editor-commands"
)

const commandListeners = new Set<(command: DesktopCommand) => void>()
const state = vi.fn((_value: Parameters<DesktopHostBridge["updateCommandState"]>[0]) => {})
const editText = vi.fn(async (_action: "undo" | "redo") => {})
const host: DesktopHostBridge = {
  protocolVersion: 1,
  platform: "darwin",
  windowChrome: "unified",
  async getMcpSetup() {
    throw new Error("Unused setup")
  },
  onCommand(callback) {
    commandListeners.add(callback)
    return () => commandListeners.delete(callback)
  },
  async updateCommandState(value) {
    state(value)
  },
  editText,
}

afterEach(() => {
  cleanup()
  delete window.vibeshapeDesktop
  commandListeners.clear()
  state.mockClear()
  editText.mockClear()
})

function command(
  id: keyof typeof editorCommandIds,
  invoke = vi.fn(),
  enabled = true,
  toolbarVisible = true,
): ResolvedEditorCommand {
  return {
    descriptor: {
      id: editorCommandIds[id],
      group: "history",
      icon: "undo",
      labelKey: "documentUndo",
      ownerModuleId: "test",
    },
    active: false,
    eligibility: enabled ? { enabled: true } : { enabled: false, reason: "saving" },
    toolbarVisible,
    invoke,
  }
}
async function emit(id: DesktopCommand) {
  await act(async () => {
    for (const listener of commandListeners) listener(id)
  })
}

function BlockingOwner({ active }: { active: boolean }) {
  useReportBlockingActivity(active, "Working")
  return null
}

it("disables both native command scopes until all blocking owners settle", async () => {
  window.vibeshapeDesktop = host
  const undo = vi.fn()
  const box = vi.fn()
  const application = vi.fn()
  const commands = [command("documentUndo", undo), command("createBox", box)]
  const view = (first: boolean, second: boolean) => (
    <ActivityProvider>
      <input aria-label="Blocked native text" />
      <NativeEditorCommandBridge commands={commands} />
      <NativeApplicationCommandBridge exportAvailable onCommand={application} />
      <BlockingOwner active={first} />
      <BlockingOwner active={second} />
    </ActivityProvider>
  )
  const result = render(view(false, false))
  await emit("undo")
  await emit("createBox")
  await emit("settings")
  expect(undo).toHaveBeenCalledTimes(1)
  expect(box).toHaveBeenCalledTimes(1)
  expect(application).toHaveBeenCalledTimes(1)
  const staleListeners = [...commandListeners]
  result.rerender(view(true, true))
  const latest = (scope: "editor" | "application") =>
    state.mock.calls
      .map(([value]) => value)
      .reverse()
      .find((value) => value.scope === scope)
  expect(latest("editor")).toEqual({ scope: "editor", enabled: [] })
  expect(latest("application")).toEqual({ scope: "application", enabled: [] })
  act(() => {
    document.querySelector("input")?.focus()
  })
  expect(latest("editor")).toEqual({ scope: "editor", enabled: [] })
  for (const id of ["undo", "redo", "createBox", "settings", "projects", "export"] as const)
    await emit(id)
  await act(async () => {
    for (const listener of staleListeners) {
      listener("undo")
      listener("settings")
    }
  })
  expect(undo).toHaveBeenCalledTimes(1)
  expect(box).toHaveBeenCalledTimes(1)
  expect(application).toHaveBeenCalledTimes(1)
  expect(editText).not.toHaveBeenCalled()
  result.rerender(view(false, true))
  expect(latest("editor")).toEqual({ scope: "editor", enabled: [] })
  expect(latest("application")).toEqual({ scope: "application", enabled: [] })
  await emit("createBox")
  expect(box).toHaveBeenCalledTimes(1)
  act(() => {
    document.querySelector("input")?.blur()
  })
  result.rerender(view(false, false))
  expect(latest("editor")?.enabled).toEqual(expect.arrayContaining(["undo", "createBox"]))
  expect(latest("application")?.enabled).toEqual(expect.arrayContaining(["settings", "export"]))
  await emit("undo")
  await emit("createBox")
  await emit("settings")
  expect(undo).toHaveBeenCalledTimes(2)
  expect(box).toHaveBeenCalledTimes(2)
  expect(application).toHaveBeenCalledTimes(2)
})

it("drops a queued native action when blocking begins before invocation", async () => {
  window.vibeshapeDesktop = host
  const invoke = vi.fn()
  const commands = [command("createBox", invoke)]
  const view = (blocking: boolean) => (
    <ActivityProvider>
      <NativeEditorCommandBridge commands={commands} />
      <BlockingOwner active={blocking} />
    </ActivityProvider>
  )
  const result = render(view(false))
  act(() => {
    for (const listener of commandListeners) listener("createBox")
    result.rerender(view(true))
  })
  await act(async () => {})
  expect(invoke).not.toHaveBeenCalled()
  result.rerender(view(false))
  await emit("createBox")
  expect(invoke).toHaveBeenCalledTimes(1)
})

it("uses registered eligibility and sketch history while preserving text undo", async () => {
  window.vibeshapeDesktop = host
  const documentUndo = vi.fn()
  const sketchUndo = vi.fn()
  const box = vi.fn()
  render(
    <>
      <input aria-label="Native text" />
      <NativeEditorCommandBridge
        commands={[
          command("documentUndo", documentUndo),
          command("sketchUndo", sketchUndo),
          command("createBox", box, false),
        ]}
      />
    </>,
  )
  await emit("createBox")
  expect(box).not.toHaveBeenCalled()
  await emit("undo")
  expect(sketchUndo).toHaveBeenCalledTimes(1)
  expect(documentUndo).not.toHaveBeenCalled()
  document.querySelector("input")?.focus()
  await emit("undo")
  expect(editText).toHaveBeenCalledWith("undo")
  expect(sketchUndo).toHaveBeenCalledTimes(1)
  expect(state).toHaveBeenCalledWith({
    scope: "editor",
    enabled: expect.arrayContaining(["undo", "redo"]),
  })
})

it("holds the command lock until rejection and allows the next activation", async () => {
  window.vibeshapeDesktop = host
  let reject: ((error: Error) => void) | undefined
  const invoke = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  )
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const rendered = render(<NativeEditorCommandBridge commands={[command("createBox", invoke)]} />)
    await emit("createBox")
    rendered.rerender(<NativeEditorCommandBridge commands={[command("createBox", invoke)]} />)
    await emit("createBox")
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => reject?.(new Error("Rejected test operation")))
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1))
    await emit("createBox")
    expect(invoke).toHaveBeenCalledTimes(2)
  } finally {
    errors.mockRestore()
  }
})

it("routes only available application commands and removes its listener on unmount", async () => {
  window.vibeshapeDesktop = host
  const invoke = vi.fn()
  const result = render(
    <NativeApplicationCommandBridge exportAvailable={false} onCommand={invoke} />,
  )
  await emit("export")
  await emit("createBox")
  expect(invoke).not.toHaveBeenCalled()
  await emit("settings")
  expect(invoke).toHaveBeenCalledWith("settings")
  result.unmount()
  await emit("settings")
  expect(invoke).toHaveBeenCalledTimes(1)
})

it("enables only explicitly allowed global commands on the project chooser", async () => {
  window.vibeshapeDesktop = host
  const invoke = vi.fn()
  render(
    <NativeApplicationCommandBridge
      exportAvailable
      allowedCommands={["settings", "faq"]}
      onCommand={invoke}
    />,
  )
  expect(state).toHaveBeenCalledWith({ scope: "application", enabled: ["settings", "faq"] })
  for (const id of ["projects", "export", "shortcuts", "createBox"] as const) await emit(id)
  expect(invoke).not.toHaveBeenCalled()
  await emit("settings")
  await emit("faq")
  expect(invoke.mock.calls).toEqual([["settings"], ["faq"]])
})
