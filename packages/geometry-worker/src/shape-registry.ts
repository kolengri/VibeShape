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
