// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import {
  createWorkspaceLayoutStore,
  useWorkspaceLayoutPreferences,
  WorkspaceLayoutPreferencesProvider,
} from "./workspace-layout-preferences"

afterEach(cleanup)

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe("workspace layout preferences", () => {
  it("persists bounded preferences and reloads them in a new store", () => {
    const storage = createMemoryStorage()
    const store = createWorkspaceLayoutStore(storage)
    store.getState().actions.setWidth("tree", 501)
    store.getState().actions.setWidth("task", 333.7)
    store.getState().actions.setOpacity("tree", -2)
    store.getState().actions.setCollapsed("task", true)

    const reloaded = createWorkspaceLayoutStore(storage)
    expect(reloaded.getState()).toMatchObject({
      treeWidth: 420,
      taskWidth: 334,
      treeOpacity: 0,
      taskCollapsed: true,
    })
  })

  it("ignores non-finite action values and accepts only valid versioned persisted data", () => {
    const storage = createMemoryStorage()
    const store = createWorkspaceLayoutStore(storage)
    store.getState().actions.setWidth("tree", Number.NaN)
    store.getState().actions.setOpacity("task", Number.POSITIVE_INFINITY)
    expect(store.getState()).toMatchObject({ treeWidth: 240, taskOpacity: 100 })

    for (const value of [
      '{"version":2,"treeWidth":300,"taskWidth":320,"treeOpacity":100,"taskOpacity":100,"treeCollapsed":false,"taskCollapsed":false}',
      '{"version":1,"treeWidth":999,"taskWidth":320,"treeOpacity":100,"taskOpacity":100,"treeCollapsed":false,"taskCollapsed":false}',
      "not-json",
    ]) {
      const brokenStorage = createMemoryStorage({ "vibeshape.workspace-layout.v1": value })
      expect(createWorkspaceLayoutStore(brokenStorage).getState()).toMatchObject({
        treeWidth: 240,
        taskWidth: 320,
        treeOpacity: 100,
        taskOpacity: 100,
        treeCollapsed: false,
        taskCollapsed: false,
      })
    }
  })

  it("keeps session preferences working when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable")
      },
      setItem: () => {
        throw new Error("quota exceeded")
      },
    }
    const store = createWorkspaceLayoutStore(storage)
    expect(() => store.getState().actions.setWidth("tree", 300)).not.toThrow()
    expect(store.getState().treeWidth).toBe(300)
  })

  it("resets all panel preferences to their defaults", () => {
    const store = createWorkspaceLayoutStore(createMemoryStorage())
    store.getState().actions.setWidth("tree", 400)
    store.getState().actions.setOpacity("task", 35)
    store.getState().actions.setCollapsed("tree", true)
    store.getState().actions.reset()

    expect(store.getState()).toMatchObject({
      treeWidth: 240,
      taskWidth: 320,
      treeOpacity: 100,
      taskOpacity: 100,
      treeCollapsed: false,
      taskCollapsed: false,
    })
  })

  it("isolates state between provider mounts", async () => {
    function Probe() {
      const width = useWorkspaceLayoutPreferences((state) => state.treeWidth)
      const setWidth = useWorkspaceLayoutPreferences((state) => state.actions.setWidth)
      return (
        <button type="button" onClick={() => setWidth("tree", 350)}>
          Width {width}
        </button>
      )
    }

    const user = userEvent.setup()
    render(
      <>
        <WorkspaceLayoutPreferencesProvider>
          <Probe />
        </WorkspaceLayoutPreferencesProvider>
        <WorkspaceLayoutPreferencesProvider>
          <Probe />
        </WorkspaceLayoutPreferencesProvider>
      </>,
    )
    const [firstButton] = screen.getAllByRole("button")
    if (!firstButton) throw new Error("Expected provider probe button")
    await user.click(firstButton)
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Width 350",
      "Width 240",
    ])
  })
})
