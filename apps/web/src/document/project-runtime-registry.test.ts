import { describe, expect, it } from "bun:test"
import { createProjectRuntimeRegistry } from "./project-runtime-registry"

function runtime(id: string) {
  let revision = 0
  const listeners = new Set<() => void>()
  return {
    getDocumentControllerState: () => ({ report: { snapshot: { id, revision } } }),
    subscribeDocumentController(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    commit() {
      revision++
      for (const listener of listeners) listener()
    },
  }
}

describe("retained project document authority", () => {
  it("keeps background work bound to its project while projecting only the selected tab", async () => {
    const first = runtime("first")
    const second = runtime("second")
    const registry = createProjectRuntimeRegistry(first)
    let visibleChanges = 0
    registry.subscribe(() => visibleChanges++)
    let finish = () => {}
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    }).then(() => first.commit())
    registry.activate(second)
    finish()
    await pending
    expect(registry.active()).toBe(second)
    expect(second.getDocumentControllerState().report.snapshot.revision).toBe(0)
    expect(registry.get("first")).toBe(first)
    expect(first.getDocumentControllerState().report.snapshot.revision).toBe(1)
    expect(visibleChanges).toBe(1)
    registry.activate(first)
    expect(registry.active().getDocumentControllerState().report.snapshot.revision).toBe(1)
    expect(visibleChanges).toBe(2)
  })

  it("does not duplicate document subscriptions when repeatedly selecting a retained project", () => {
    const first = runtime("first")
    const second = runtime("second")
    const registry = createProjectRuntimeRegistry(first)
    let changes = 0
    registry.subscribe(() => changes++)
    registry.retain(first)
    registry.activate(second)
    registry.activate(first)
    registry.activate(first)
    first.commit()
    expect(changes).toBe(3)
    expect(registry.get("second")).toBe(second)
  })

  it("releases an inactive project's subscription and refuses to release the visible document", () => {
    const first = runtime("first")
    const second = runtime("second")
    const registry = createProjectRuntimeRegistry(first)
    registry.activate(second)
    expect(registry.release(second)).toBe(false)
    expect(registry.release(first)).toBe(true)
    first.commit()
    expect(registry.get("first")).toBeUndefined()
    expect(registry.values()).toEqual([second])
  })
})
