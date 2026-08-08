import type { AnyShape } from "replicad"

interface DeletableShape {
  delete(): void
}

export class OwnedShapeRegistry<Shape extends DeletableShape = AnyShape> {
  readonly #shapes = new Set<Shape>()

  get size() {
    return this.#shapes.size
  }

  own<OwnedShape extends Shape>(shape: OwnedShape): OwnedShape {
    this.#shapes.add(shape)
    return shape
  }

  dispose(shape: Shape) {
    if (!this.#shapes.has(shape)) {
      throw new Error("Attempted to dispose a shape that is not owned by this registry.")
    }

    shape.delete()
    this.#shapes.delete(shape)
  }

  disposeAll() {
    const shapes = [...this.#shapes].reverse()
    let firstError: unknown

    for (const shape of shapes) {
      try {
        shape.delete()
        this.#shapes.delete(shape)
      } catch (error) {
        firstError ??= error
      }
    }

    if (firstError) {
      throw firstError
    }
  }
}

type FeatureShapeEntry<Shape> = Readonly<{
  contentHash: string
  shape: Shape
}>

export class DocumentFeatureShapeRegistry<Shape extends DeletableShape = AnyShape> {
  readonly #documents = new Map<string, Map<string, FeatureShapeEntry<Shape>>>()
  #size = 0

  get size() {
    return this.#size
  }

  get(documentId: string, featureId: string, contentHash: string) {
    const entry = this.#documents.get(documentId)?.get(featureId)
    return entry?.contentHash === contentHash ? entry.shape : undefined
  }

  resolve(
    documentId: string,
    dependencies: readonly { featureId: string; contentHash: string }[],
  ): Shape[] | null {
    const shapes: Shape[] = []
    for (const dependency of dependencies) {
      const shape = this.get(documentId, dependency.featureId, dependency.contentHash)
      if (!shape) return null
      shapes.push(shape)
    }
    return shapes
  }

  replace(documentId: string, featureId: string, contentHash: string, shape: Shape) {
    const features = this.#documents.get(documentId) ?? new Map()
    const previous = features.get(featureId)

    if (previous) {
      previous.shape.delete()
    } else {
      this.#size += 1
    }

    features.set(featureId, { contentHash, shape })
    this.#documents.set(documentId, features)
  }

  disposeDocument(documentId: string) {
    const features = this.#documents.get(documentId)
    if (!features) return this.#size

    let firstError: unknown
    for (const [featureId, entry] of [...features].reverse()) {
      try {
        entry.shape.delete()
        features.delete(featureId)
        this.#size -= 1
      } catch (error) {
        firstError ??= error
      }
    }

    if (features.size === 0) {
      this.#documents.delete(documentId)
    }
    if (firstError) throw firstError
    return this.#size
  }
}
