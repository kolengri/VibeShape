import { describe, expect, it } from "vitest"
import { DocumentFeatureShapeRegistry, OwnedShapeRegistry } from "./shape-registry"

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

describe("DocumentFeatureShapeRegistry", () => {
  it("reuses exact feature content and replaces only the edited feature", () => {
    const deletionOrder: string[] = []
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const first = new TrackedShape("first", deletionOrder)
    const replacement = new TrackedShape("replacement", deletionOrder)
    const independent = new TrackedShape("independent", deletionOrder)

    registry.replace("document-a", "feature-a", "a".repeat(64), first)
    registry.replace("document-a", "feature-b", "b".repeat(64), independent)
    expect(registry.get("document-a", "feature-a", "a".repeat(64))).toBe(first)
    expect(registry.get("document-a", "feature-a", "c".repeat(64))).toBeUndefined()

    registry.replace("document-a", "feature-a", "c".repeat(64), replacement)

    expect(first.deleteCount).toBe(1)
    expect(independent.deleteCount).toBe(0)
    expect(registry.size).toBe(2)
    expect(registry.get("document-a", "feature-a", "c".repeat(64))).toBe(replacement)
  })

  it("disposes one document without touching another document", () => {
    const deletionOrder: string[] = []
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const first = new TrackedShape("first", deletionOrder)
    const second = new TrackedShape("second", deletionOrder)

    registry.replace("document-a", "feature-a", "a".repeat(64), first)
    registry.replace("document-b", "feature-b", "b".repeat(64), second)

    expect(registry.disposeDocument("document-a")).toBe(1)
    expect(first.deleteCount).toBe(1)
    expect(second.deleteCount).toBe(0)
    expect(registry.get("document-b", "feature-b", "b".repeat(64))).toBe(second)
  })

  it("synchronizes exact document feature content and deletes stale ownership", () => {
    const deletionOrder: string[] = []
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const retained = new TrackedShape("retained", deletionOrder)
    const changed = new TrackedShape("changed", deletionOrder)
    const removed = new TrackedShape("removed", deletionOrder)
    const otherDocument = new TrackedShape("other-document", deletionOrder)

    registry.replace("document-a", "feature-a", "a".repeat(64), retained)
    registry.replace("document-a", "feature-b", "b".repeat(64), changed)
    registry.replace("document-a", "feature-c", "c".repeat(64), removed)
    registry.replace("document-b", "feature-a", "a".repeat(64), otherDocument)

    expect(
      registry.synchronize("document-a", [
        { featureId: "feature-a", contentHash: "a".repeat(64) },
        { featureId: "feature-b", contentHash: "d".repeat(64) },
      ]),
    ).toBe(2)
    expect(deletionOrder).toEqual(["removed", "changed"])
    expect(retained.deleteCount).toBe(0)
    expect(otherDocument.deleteCount).toBe(0)
    expect(registry.get("document-a", "feature-b", "b".repeat(64))).toBeUndefined()
    expect(registry.get("document-b", "feature-a", "a".repeat(64))).toBe(otherDocument)
  })

  it("resolves ordered exact-hash dependencies within one document", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const first = new TrackedShape("first", [])
    const second = new TrackedShape("second", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), first)
    registry.replace("document-a", "feature-b", "b".repeat(64), second)

    expect(
      registry.resolve("document-a", [
        { featureId: "feature-b", contentHash: "b".repeat(64) },
        { featureId: "feature-a", contentHash: "a".repeat(64) },
      ]),
    ).toEqual([second, first])
    expect(
      registry.resolve("document-a", [{ featureId: "feature-a", contentHash: "c".repeat(64) }]),
    ).toBeNull()
    expect(
      registry.resolve("document-b", [{ featureId: "feature-a", contentHash: "a".repeat(64) }]),
    ).toBeNull()
  })

  it("keeps failed document disposal visible for recovery", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    registry.replace(
      "document-a",
      "feature-a",
      "a".repeat(64),
      new TrackedShape("broken", [], true),
    )

    expect(() => registry.disposeDocument("document-a")).toThrow("Failed to delete broken.")
    expect(registry.size).toBe(1)
  })

  it("keeps the previous feature entry when replacement disposal fails", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const previous = new TrackedShape("previous", [], true)
    const replacement = new TrackedShape("replacement", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), previous)

    expect(() => registry.replace("document-a", "feature-a", "b".repeat(64), replacement)).toThrow(
      "Failed to delete previous.",
    )
    expect(registry.get("document-a", "feature-a", "a".repeat(64))).toBe(previous)
    expect(registry.get("document-a", "feature-a", "b".repeat(64))).toBeUndefined()
    expect(replacement.deleteCount).toBe(0)
    expect(registry.size).toBe(1)
  })
})
