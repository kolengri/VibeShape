import { describe, expect, it } from "vitest"
import { DocumentFeatureShapeRegistry, OwnedShapeRegistry } from "./shape-registry"

class TrackedShape {
  deleteCount = 0

  constructor(
    readonly id: string,
    private readonly deletionOrder: string[],
    private shouldFail = false,
  ) {}

  delete() {
    this.deleteCount += 1

    if (this.shouldFail) {
      throw new Error(`Failed to delete ${this.id}.`)
    }

    this.deletionOrder.push(this.id)
  }

  recover() {
    this.shouldFail = false
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

  it("invalidates the previous feature entry when replacement disposal fails", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const previous = new TrackedShape("previous", [], true)
    const replacement = new TrackedShape("replacement", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), previous)

    expect(() => registry.replace("document-a", "feature-a", "b".repeat(64), replacement)).toThrow(
      "Failed to delete previous.",
    )
    expect(registry.get("document-a", "feature-a", "a".repeat(64))).toBeUndefined()
    expect(registry.get("document-a", "feature-a", "b".repeat(64))).toBeUndefined()
    expect(replacement.deleteCount).toBe(0)
    expect(registry.size).toBe(1)
  })

  it("resolves named outputs and treats result as the root alias", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const root = new TrackedShape("root", [])
    const cap = new TrackedShape("cap", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), root, [
      { role: "result", shape: root },
      { role: "cap.start", shape: cap },
    ])

    expect(
      registry.resolve("document-a", [
        { featureId: "feature-a", contentHash: "a".repeat(64), outputRole: "cap.start" },
        { featureId: "feature-a", contentHash: "a".repeat(64) },
      ]),
    ).toEqual([cap, root])
    expect(
      registry.resolve("document-a", [
        { featureId: "feature-a", contentHash: "a".repeat(64), outputRole: "result" },
      ]),
    ).toEqual([root])
    expect(
      registry.resolve("document-a", [
        { featureId: "feature-a", contentHash: "a".repeat(64), outputRole: "missing" },
      ]),
    ).toBeNull()

    const undeclared = new DocumentFeatureShapeRegistry<TrackedShape>()
    const undeclaredRoot = new TrackedShape("undeclared-root", [])
    undeclared.replace("document-a", "feature-a", "a".repeat(64), undeclaredRoot)
    expect(
      undeclared.resolve("document-a", [{ featureId: "feature-a", contentHash: "a".repeat(64) }]),
    ).toEqual([undeclaredRoot])
    expect(
      undeclared.resolve("document-a", [
        { featureId: "feature-a", contentHash: "a".repeat(64), outputRole: "result" },
      ]),
    ).toBeNull()
  })

  it("rejects duplicate roles and aliases before mutating the current entry", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const root = new TrackedShape("root", [])
    const current = new TrackedShape("current", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), current)

    expect(() =>
      registry.replace("document-a", "feature-a", "b".repeat(64), root, [
        { role: "cap", shape: root },
        { role: "cap", shape: new TrackedShape("other", []) },
      ]),
    ).toThrow("aliased")
    expect(registry.get("document-a", "feature-a", "a".repeat(64))).toBe(current)
    expect(current.deleteCount).toBe(0)
  })

  it("deduplicates root aliases and cleans every live wrapper once", () => {
    const order: string[] = []
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const root = new TrackedShape("root", order)
    const output = new TrackedShape("output", order)
    registry.replace("document-a", "feature-a", "a".repeat(64), root, [
      { role: "result", shape: root },
      { role: "cap", shape: output },
    ])

    expect(registry.size).toBe(2)
    registry.disposeDocument("document-a")
    expect(order).toEqual(["output", "root"])
    expect(root.deleteCount).toBe(1)
    expect(output.deleteCount).toBe(1)
    expect(registry.size).toBe(0)
  })

  it("retains only failed cleanup and recovers without double deletion", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const failed = new TrackedShape("failed", [], true)
    const successful = new TrackedShape("successful", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), failed, [
      { role: "cap", shape: successful },
    ])

    expect(() => registry.disposeDocument("document-a")).toThrow("Failed to delete failed.")
    expect(registry.size).toBe(1)
    expect(successful.deleteCount).toBe(1)
    failed.recover()
    expect(registry.disposeDocument("document-a")).toBe(0)
    expect(failed.deleteCount).toBe(2)
    expect(successful.deleteCount).toBe(1)
  })

  it("cleans sibling entries after one synchronization deletion fails", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const failed = new TrackedShape("failed", [], true)
    const successful = new TrackedShape("successful", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), failed)
    registry.replace("document-a", "feature-b", "b".repeat(64), successful)

    expect(() => registry.synchronize("document-a", [])).toThrow("Failed to delete failed.")
    expect(successful.deleteCount).toBe(1)
    expect(registry.size).toBe(1)
    failed.recover()
    expect(registry.synchronize("document-a", [])).toBe(0)
    expect(failed.deleteCount).toBe(2)
    expect(successful.deleteCount).toBe(1)
  })

  it("cleans sibling entries after one document deletion fails", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const failed = new TrackedShape("failed", [], true)
    const successful = new TrackedShape("successful", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), successful)
    registry.replace("document-a", "feature-b", "b".repeat(64), failed)

    expect(() => registry.disposeDocument("document-a")).toThrow("Failed to delete failed.")
    expect(successful.deleteCount).toBe(1)
    expect(registry.size).toBe(1)
    failed.recover()
    expect(registry.disposeDocument("document-a")).toBe(0)
    expect(failed.deleteCount).toBe(2)
    expect(successful.deleteCount).toBe(1)
  })

  it("rejects native object sharing across features and documents", () => {
    const registry = new DocumentFeatureShapeRegistry<TrackedShape>()
    const shared = new TrackedShape("shared", [])
    registry.replace("document-a", "feature-a", "a".repeat(64), shared)

    expect(() => registry.replace("document-a", "feature-b", "b".repeat(64), shared)).toThrow(
      "already owned",
    )
    expect(() => registry.replace("document-b", "feature-a", "c".repeat(64), shared)).toThrow(
      "already owned",
    )
    expect(registry.get("document-a", "feature-a", "a".repeat(64))).toBe(shared)
  })
})
