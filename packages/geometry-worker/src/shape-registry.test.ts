import { describe, expect, it } from "vitest"
import { OwnedShapeRegistry } from "./shape-registry"

class TrackedShape {
  deleteCount = 0

  constructor(
    readonly id: string,
    private readonly deletionOrder: string[],
    private readonly shouldFail = false,
  ) {}

  delete() {
    this.deleteCount += 1

    if (this.shouldFail) {
      throw new Error(`Failed to delete ${this.id}.`)
    }

    this.deletionOrder.push(this.id)
  }
}

describe("OwnedShapeRegistry", () => {
  it("deletes owned shapes exactly once in reverse ownership order", () => {
    const deletionOrder: string[] = []
    const registry = new OwnedShapeRegistry<TrackedShape>()
    const first = registry.own(new TrackedShape("first", deletionOrder))
    const second = registry.own(new TrackedShape("second", deletionOrder))

    registry.dispose(second)
    registry.disposeAll()

    expect(deletionOrder).toEqual(["second", "first"])
    expect(first.deleteCount).toBe(1)
    expect(second.deleteCount).toBe(1)
    expect(registry.size).toBe(0)
  })

  it("rejects disposal of a shape it does not own", () => {
    const deletionOrder: string[] = []
    const registry = new OwnedShapeRegistry<TrackedShape>()

    expect(() => registry.dispose(new TrackedShape("foreign", deletionOrder))).toThrow("not owned")
  })

  it("keeps failed deletions visible in the owned count", () => {
    const registry = new OwnedShapeRegistry<TrackedShape>()
    registry.own(new TrackedShape("broken", [], true))

    expect(() => registry.disposeAll()).toThrow("Failed to delete broken.")
    expect(registry.size).toBe(1)
  })
})
