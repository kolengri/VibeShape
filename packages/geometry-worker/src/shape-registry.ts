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

export type ShapeRegistryOutput<Shape> = Readonly<{
  role: string
  shape: Shape
}>

type FeatureShapeEntry<Shape> = Readonly<{
  contentHash: string
  shape: Shape
  outputs: ReadonlyMap<string, Shape>
  wrappers: readonly Shape[]
}>

const ROLE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const MAX_ROLE_LENGTH = 128
const MAX_OUTPUT_ROLES = 256

export class DocumentFeatureShapeRegistry<Shape extends DeletableShape = AnyShape> {
  readonly #documents = new Map<string, Map<string, FeatureShapeEntry<Shape>>>()
  readonly #pendingCleanup = new Map<string, Set<Shape>>()
  readonly #owned = new Map<Shape, { documentId: string; featureId: string }>()

  get size() {
    return this.#owned.size
  }

  get(documentId: string, featureId: string, contentHash: string) {
    const entry = this.#documents.get(documentId)?.get(featureId)
    return entry?.contentHash === contentHash ? entry.shape : undefined
  }

  getOutput(
    documentId: string,
    featureId: string,
    contentHash: string,
    outputRole?: string | undefined,
  ) {
    const entry = this.#documents.get(documentId)?.get(featureId)
    if (!entry || entry.contentHash !== contentHash) return undefined
    if (outputRole === undefined) return entry.shape
    return entry.outputs.get(outputRole)
  }

  resolve(
    documentId: string,
    dependencies: readonly {
      featureId: string
      contentHash: string
      outputRole?: string | undefined
    }[],
  ): Shape[] | null {
    const shapes: Shape[] = []
    for (const dependency of dependencies) {
      const shape = this.getOutput(
        documentId,
        dependency.featureId,
        dependency.contentHash,
        dependency.outputRole,
      )
      if (!shape) return null
      shapes.push(shape)
    }
    return shapes
  }

  replace(
    documentId: string,
    featureId: string,
    contentHash: string,
    shape: Shape,
    outputs: readonly ShapeRegistryOutput<Shape>[] = [],
  ) {
    const candidate = this.#validateCandidate(documentId, featureId, shape, outputs)
    const features = this.#documents.get(documentId) ?? new Map()
    const previous = features.get(featureId)

    if (previous) {
      features.delete(featureId)
      const error = this.#cleanupWrappers(documentId, previous.wrappers)
      if (features.size === 0) this.#documents.delete(documentId)
      if (error) throw error
    }

    for (const wrapper of candidate.wrappers) {
      this.#owned.set(wrapper, { documentId, featureId })
    }
    this.#documents.set(documentId, features)
    features.set(featureId, {
      contentHash,
      shape,
      outputs: candidate.outputs,
      wrappers: candidate.wrappers,
    })
    return shape
  }

  synchronize(
    documentId: string,
    retainedFeatures: readonly { featureId: string; contentHash: string }[],
  ) {
    let firstError = this.#retryPending(documentId)
    const features = this.#documents.get(documentId)
    if (!features) {
      if (firstError) throw firstError
      return this.size
    }

    const retainedHashes = new Map(
      retainedFeatures.map(({ featureId, contentHash }) => [featureId, contentHash]),
    )
    for (const [featureId, entry] of [...features].reverse()) {
      if (retainedHashes.get(featureId) === entry.contentHash) continue
      features.delete(featureId)
      const error = this.#cleanupWrappers(documentId, entry.wrappers)
      firstError ??= error
    }

    if (features.size === 0) this.#documents.delete(documentId)
    if (firstError) throw firstError
    return this.size
  }

  disposeDocument(documentId: string) {
    let firstError = this.#retryPending(documentId)
    const features = this.#documents.get(documentId)
    if (features) {
      for (const [featureId, entry] of [...features].reverse()) {
        features.delete(featureId)
        const error = this.#cleanupWrappers(documentId, entry.wrappers)
        firstError ??= error
      }
      this.#documents.delete(documentId)
    }

    if (firstError) throw firstError
    return this.size
  }

  #validateCandidate(
    documentId: string,
    featureId: string,
    shape: Shape,
    outputs: readonly ShapeRegistryOutput<Shape>[],
  ) {
    const candidate = this.#validateBundle(shape, outputs)
    this.#assertUnowned(documentId, featureId, candidate.shapes)
    return candidate
  }

  #validateBundle(shape: Shape, outputs: readonly ShapeRegistryOutput<Shape>[]) {
    if (outputs.length > MAX_OUTPUT_ROLES) {
      throw new Error(`A feature may expose at most ${MAX_OUTPUT_ROLES} output roles.`)
    }

    const outputMap = new Map<string, Shape>()
    const roles = new Set<string>()
    const wrappers = [shape]
    const candidateShapes = new Set<Shape>([shape])
    for (const output of outputs) {
      const role = this.#validateRole(output.role, roles)
      if (role === "result") {
        if (output.shape !== shape) {
          throw new Error("The native output role result must alias the root shape.")
        }
        outputMap.set(role, output.shape)
        continue
      }
      if (candidateShapes.has(output.shape)) {
        throw new Error(`Native shape is aliased by multiple feature roles: ${role}.`)
      }
      outputMap.set(role, output.shape)
      wrappers.push(output.shape)
      candidateShapes.add(output.shape)
    }

    return { outputs: outputMap, wrappers, shapes: candidateShapes }
  }

  #validateRole(role: unknown, roles: Set<string>) {
    if (
      typeof role !== "string" ||
      role.length === 0 ||
      role.length > MAX_ROLE_LENGTH ||
      !ROLE_PATTERN.test(role)
    ) {
      throw new Error(`Invalid native output role: ${String(role)}.`)
    }
    if (roles.has(role)) {
      throw new Error(`Duplicate native output role: ${role}.`)
    }
    roles.add(role)
    return role
  }

  #assertUnowned(documentId: string, featureId: string, shapes: ReadonlySet<Shape>) {
    for (const candidateShape of shapes) {
      if (this.#owned.has(candidateShape)) {
        throw new Error(
          `Native shape is already owned by ${documentId}/${featureId} or another feature.`,
        )
      }
    }
  }

  #cleanupWrappers(documentId: string, wrappers: readonly Shape[]) {
    let firstError: unknown
    for (const wrapper of [...wrappers].reverse()) {
      try {
        wrapper.delete()
        this.#owned.delete(wrapper)
      } catch (error) {
        firstError ??= error
        const pending = this.#pendingCleanup.get(documentId) ?? new Set<Shape>()
        pending.add(wrapper)
        this.#pendingCleanup.set(documentId, pending)
      }
    }
    return firstError
  }

  #retryPending(documentId: string) {
    const pending = this.#pendingCleanup.get(documentId)
    if (!pending) return undefined
    let firstError: unknown
    for (const wrapper of [...pending].reverse()) {
      try {
        wrapper.delete()
        pending.delete(wrapper)
        this.#owned.delete(wrapper)
      } catch (error) {
        firstError ??= error
      }
    }
    if (pending.size === 0) this.#pendingCleanup.delete(documentId)
    return firstError
  }
}
