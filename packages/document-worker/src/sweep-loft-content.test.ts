import {
  expectedSketchFeatureDependencyIds,
  expectedSketchFeatureReferences,
} from "@vibeshape/application/feature-rebuild"
import {
  boxFeatureType,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  createRectangleSketch,
  datumPlaneFeatureType,
  documentCoreModule,
  documentSnapshotSchema,
  featureCoreModule,
  featureRecordSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { createFeatureContentIdentity } from "@vibeshape/domain/feature-content-identity"
import { loftFeatureType } from "@vibeshape/domain/part-design-loft"
import { sweepFeatureParametersSchema, sweepFeatureType } from "@vibeshape/domain/part-design-sweep"
import { sketchPathSelectorSchema } from "@vibeshape/domain/sketch-path-selector"
import {
  loftFeatureContentParametersSchema,
  sweepFeatureContentParametersSchema,
} from "@vibeshape/protocol"
import {
  createSketchProfileSelector,
  detectSketchProfiles,
  SKETCH_SOLVER_BUILD,
} from "@vibeshape/sketch-solver"
import { describe, expect, it, vi } from "vitest"
import { createDocumentFeatureContentPreparer } from "./extrusion-content"
import type { SketchSolvePort } from "./runtime"
import { materializeSelectedPath, shouldPrepareSweepLoftFeatureContent } from "./sweep-loft-content"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
function contentRegistry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const registry = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!registry.ok) throw new Error(registry.diagnostic.message)
  return registry.registry
}
const environment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test-build",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.9.2",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}
function rectangle(value: number, plane: SketchRecord["plane"] = "xy", width = 4) {
  let entityId = value + 10
  let constraintId = value + 30
  return createRectangleSketch({
    id: sketchIdSchema.parse(id(value)),
    label: `Section ${value}`,
    plane,
    width: createLengthQuantity(width),
    height: createLengthQuantity(6),
    createEntityId: () => sketchEntityIdSchema.parse(id(entityId++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraintId++)),
  })
}
function solution(sketch: SketchRecord, revision = 3) {
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  const circles = sketch.entities.flatMap((entity) =>
    entity.type === "circle" ? [{ entityId: entity.id, radius: entity.radius }] : [],
  )
  return {
    schemaVersion: 0 as const,
    sketchId: sketch.id,
    sourceRevision: revision,
    status: "under-constrained" as const,
    degreesOfFreedom: points.length * 2,
    maximumResidual: 0,
    points,
    circles,
    failedConstraintIds: [],
    profileResult: detectSketchProfiles(sketch, { points, circles }),
    heapCapacityBytes: 1024,
    solverBuild: SKETCH_SOLVER_BUILD,
  }
}
function selector(sketch: SketchRecord, index = 0) {
  const result = createSketchProfileSelector(sketch.id, solution(sketch).profileResult, index)
  if (!result) throw new Error("The fixture requires a solved profile selector.")
  return result
}
const solve: SketchSolvePort = (input) => ({
  ok: true,
  solution: solution(sketchRecordSchema.parse(input.sketch), input.revision),
})
function datum(value: number, offset: number) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    type: datumPlaneFeatureType.type,
    parameters: {
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(offset),
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
}
function planeReference(value: number) {
  return {
    schemaVersion: 0,
    kind: "face",
    featureId: id(value),
    semanticRole: "datum.plane",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 16,
      centroid: [0, 0, 0],
      bounds: { min: [-2, -2, 0], max: [2, 2, 0] },
      boundaryCount: 1,
      adjacentGeometryClasses: [],
    },
  }
}
function supported(sketch: SketchRecord, owner: number) {
  return sketchRecordSchema.parse({
    ...sketch,
    support: { kind: "feature-face", reference: planeReference(owner) },
  })
}
function document(sketches: readonly SketchRecord[], features: readonly unknown[]) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(999),
    revision: 3,
    name: "Exact Sweep and Loft preparation",
    variables: [],
    sketches,
    features,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })
}
function loftFixture() {
  const first = supported(rectangle(100, "xy", 2), 800)
  const second = supported(rectangle(200, "xy", 4), 801)
  const planes = [datum(800, 0), datum(801, 10)]
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(900),
    type: loftFeatureType.type,
    parameters: { sections: [selector(second), selector(first)], ruled: false },
    dependencies: [id(801), id(800)],
    references: [planeReference(801), planeReference(800)],
    suppressed: false,
  })
  return { feature, first, second, document: document([first, second], [...planes, feature]) }
}
function point(value: number, x: number, y: number) {
  return { schemaVersion: 0, id: id(value), type: "point", x, y, construction: false }
}
function line(value: number, start: number, end: number) {
  return {
    schemaVersion: 0,
    id: id(value),
    type: "line",
    startPointId: id(start),
    endPointId: id(end),
    construction: false,
  }
}
function pathSketch() {
  // The sorted curve IDs disagree with traversal order; the coincident join has distinct IDs.
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(300),
    label: "Line and arc path",
    plane: "xy",
    entities: [
      point(310, 0, 0),
      point(311, 5, 0),
      point(312, 5, 0),
      point(313, 10, 5),
      point(314, 5, 5),
      line(321, 311, 310),
      {
        schemaVersion: 0,
        id: id(320),
        type: "arc",
        centerPointId: id(314),
        startPointId: id(312),
        endPointId: id(313),
        construction: false,
      },
    ],
    constraints: [],
  })
}
function sweepFixture(profile = rectangle(100, "yz"), path = pathSketch(), start = id(310)) {
  const selectedPath = sketchPathSelectorSchema.parse({
    schemaVersion: 0,
    sketchId: path.id,
    entityIds: path.entities
      .flatMap((entity) => (entity.type === "line" || entity.type === "arc" ? [entity.id] : []))
      .sort(),
    startPointId: start,
  })
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(900),
    type: sweepFeatureType.type,
    parameters: { profile: selector(profile), path: selectedPath },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  return { feature, profile, path, selectedPath, document: document([profile, path], [feature]) }
}

function externalSourceFixture(modelOwner = false) {
  const source = loftFixture()
  const external = supported(
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(400),
      label: "External source",
      plane: "xy",
      entities: [point(410, 2, 3)],
      constraints: [],
    }),
    802,
  )
  const first = sketchRecordSchema.parse({
    ...source.first,
    externalReferences: [
      {
        schemaVersion: 0,
        id: id(420),
        kind: "point",
        sourceSketchId: external.id,
        sourcePointId: id(410),
        projectedPointId: id(421),
      },
    ],
  })
  const modelReference = {
    schemaVersion: 0,
    kind: "vertex",
    featureId: id(803),
    signature: {
      kind: "vertex",
      geometryClass: "POINT",
      measure: 0,
      centroid: [2, 3, 0],
      bounds: { min: [2, 3, 0], max: [2, 3, 0] },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    },
  }
  const referencedSource = modelOwner
    ? sketchRecordSchema.parse({
        ...external,
        externalReferences: [
          {
            schemaVersion: 0,
            id: id(422),
            kind: "model-point",
            reference: modelReference,
            projectedPointId: id(423),
          },
        ],
      })
    : external
  const model = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(803),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(4),
      depth: createLengthQuantity(4),
      height: createLengthQuantity(4),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const snapshot = document(
    [referencedSource, first, source.second],
    [...source.document.features, datum(802, 2), ...(modelOwner ? [model] : [])],
  )
  const references = expectedSketchFeatureReferences(snapshot, [source.second.id, first.id])
  const feature = featureRecordSchema.parse({
    ...source.feature,
    dependencies: expectedSketchFeatureDependencyIds(snapshot, [source.second.id, first.id]),
    references,
  })
  return {
    ...source,
    first,
    external: referencedSource,
    feature,
    document: {
      ...snapshot,
      features: snapshot.features.map((item) => (item.id === feature.id ? feature : item)),
    },
  }
}

describe("document preparation for exact Sweep and Loft", () => {
  it.each([19, 24])(
    "prepares %i datum-supported Loft sections without collapsing owner order",
    async (count) => {
      const sketches = Array.from({ length: count }, (_, index) =>
        supported(rectangle(10_000 + index * 100, "xy", 2), 30_000 + index),
      )
      const owners = sketches.map((_, index) => datum(30_000 + index, index))
      const sections = sketches.map((sketch) => selector(sketch))
      const feature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: id(50_000),
        type: loftFeatureType.type,
        parameters: { sections, ruled: false },
        dependencies: owners.map(({ id }) => id),
        references: sketches.map((_, index) => planeReference(30_000 + index)),
        suppressed: false,
      })
      const snapshot = document(sketches, [...owners, feature])
      const solver = vi.fn(solve)
      const prepared = await createDocumentFeatureContentPreparer(solver)({
        document: snapshot,
        feature,
      })
      if (!prepared?.ok) throw new Error(`Expected valid ${count}-section Loft preparation.`)
      const content = loftFeatureContentParametersSchema.parse(prepared.parameters)
      expect(content.sections.map(({ supportFeatureId }) => supportFeatureId)).toEqual(
        owners.map(({ id }) => id),
      )
      expect(content.sections.map(({ frame }) => frame.origin)).toEqual(
        sketches.map((_, index) => [0, 0, index]),
      )
      expect(solver).toHaveBeenCalledTimes(count)
    },
  )
  it("replaces ordered selectors with independently framed solved analytical sections", async () => {
    const source = loftFixture()
    const solver = vi.fn(solve)
    const prepared = await createDocumentFeatureContentPreparer(solver)({
      document: source.document,
      feature: source.feature,
    })
    expect(prepared?.ok).toBe(true)
    if (!prepared?.ok) throw new Error("Expected exact Loft preparation.")
    const content = loftFeatureContentParametersSchema.parse(prepared.parameters)
    expect(content.sections.map(({ sketchId }) => sketchId)).toEqual([
      source.second.id,
      source.first.id,
    ])
    expect(content.sections.map(({ frame }) => frame.origin)).toEqual([
      [0, 0, 10],
      [0, 0, 0],
    ])
    expect(content.sections.map(({ supportFeatureId }) => supportFeatureId)).toEqual([
      id(801),
      id(800),
    ])
    expect(content.sections[0]?.outer.segments).toHaveLength(4)
    expect(content.ruled).toBe(false)
    expect(solver).toHaveBeenCalledTimes(2)
    expect(shouldPrepareSweepLoftFeatureContent(source.feature)).toBe(true)
  })
  it("hashes prepared solved geometry rather than the authored selectors", async () => {
    const source = loftFixture()
    const prepare = createDocumentFeatureContentPreparer(solve)
    const first = await prepare({ document: source.document, feature: source.feature })
    if (!first?.ok) throw new Error("Expected the first solved Loft content.")
    const dependencies = source.feature.dependencies.map((featureId, index) => ({
      featureId,
      contentHash: String(index + 1).repeat(64),
    }))
    const registry = contentRegistry()
    const content = (parameters: unknown) =>
      createFeatureContentIdentity(registry, {
        feature: source.feature,
        dependencies,
        environment,
        contentParameters: parameters,
      })
    const initial = content(first.parameters)
    expect(initial.ok).toBe(true)
    if (!initial.ok) throw new Error("Expected a canonical content identity.")
    expect(initial.canonicalPayload).not.toContain("outerBoundaryEntityIds")
    expect(initial.canonicalPayload).toContain("segments")
    const changedSection = supported(rectangle(200, "xy", 8), 801)
    const changedDocument = {
      ...source.document,
      revision: 4,
      sketches: [source.first, changedSection],
    }
    const next = await createDocumentFeatureContentPreparer(solve)({
      document: changedDocument,
      feature: source.feature,
    })
    if (!next?.ok) throw new Error("Expected updated solved Loft content.")
    const changed = content(next.parameters)
    if (!changed.ok) throw new Error("Expected the updated canonical identity.")
    expect(changed.canonicalPayload).not.toBe(initial.canonicalPayload)
    const parameters = loftFeatureContentParametersSchema.parse(first.parameters)
    const reversed = content({ ...parameters, sections: [...parameters.sections].reverse() })
    if (!reversed.ok) throw new Error("Expected ordered canonical sections.")
    expect(reversed.canonicalPayload).not.toBe(initial.canonicalPayload)
  })
  it("orders every selected path entity from the directed start and preserves exact arc geometry", async () => {
    const source = sweepFixture()
    const prepared = await createDocumentFeatureContentPreparer(solve)({
      document: source.document,
      feature: source.feature,
    })
    expect(prepared?.ok).toBe(true)
    if (!prepared?.ok) throw new Error("Expected exact Sweep preparation.")
    const content = sweepFeatureContentParametersSchema.parse(prepared.parameters)
    expect(content.path.sourceEntityIds).toEqual([id(320), id(321)])
    expect(content.path.segments.map(({ entityId }) => entityId)).toEqual([id(321), id(320)])
    expect(content.path.segments[0]).toMatchObject({
      startPointId: id(310),
      start: [0, 0],
      end: [5, 0],
    })
    expect(content.path.segments[1]).toMatchObject({ type: "arc", start: [5, 0], end: [10, 5] })
    const arc = content.path.segments[1]
    if (arc?.type !== "arc") throw new Error("Expected an analytical arc.")
    expect(arc.middle[0]).toBeCloseTo(5 + 5 / Math.sqrt(2), 10)
    expect(arc.middle[1]).toBeCloseTo(5 - 5 / Math.sqrt(2), 10)
    expect(content.profile.frame.normal).toEqual([1, 0, 0])
    expect(source.path.entities.find(({ id: entityId }) => entityId === id(321))).toMatchObject({
      startPointId: id(311),
    })
  })
  it("uses the shared solve cache across feature preparations and rejects a reused stale revision", async () => {
    const source = sweepFixture()
    const solver = vi.fn(solve)
    const prepare = createDocumentFeatureContentPreparer(solver)
    await prepare({ document: source.document, feature: source.feature })
    await prepare({ document: source.document, feature: source.feature })
    expect(solver).toHaveBeenCalledTimes(2)
    await expect(
      prepare({ document: { ...source.document, revision: 4 }, feature: source.feature }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        values: { reason: "solution-revision-mismatch", sourceRevision: 3, revision: 4 },
      },
    })
    expect(solver).toHaveBeenCalledTimes(2)
    const fresh = await createDocumentFeatureContentPreparer(solver)({
      document: { ...source.document, revision: 4 },
      feature: source.feature,
    })
    expect(fresh?.ok).toBe(true)
    expect(solver).toHaveBeenCalledTimes(4)
  })
  it.each(["missing", "extra", "reordered", "suppressed"])(
    "rejects %s support-owner dependencies before solving",
    async (mode) => {
      const source = loftFixture()
      const feature = {
        ...source.feature,
        dependencies:
          mode === "missing"
            ? []
            : mode === "extra"
              ? [...source.feature.dependencies, source.feature.id]
              : mode === "reordered"
                ? [...source.feature.dependencies].reverse()
                : source.feature.dependencies,
      }
      const features = source.document.features.map((item) =>
        mode === "suppressed" && item.id === id(801) ? { ...item, suppressed: true } : item,
      )
      const solver = vi.fn(solve)
      await expect(
        createDocumentFeatureContentPreparer(solver)({
          document: source.document,
          feature,
          features,
        }),
      ).resolves.toMatchObject({
        ok: false,
        diagnostic: {
          values: {
            reason:
              mode === "suppressed" ? "dependency-owner-unavailable" : "dependency-owners-mismatch",
          },
        },
      })
      expect(solver).not.toHaveBeenCalled()
    },
  )
  it("deduplicates shared support owners in authored section order", () => {
    const source = loftFixture()
    const shared = supported(source.first, 801)
    const snapshot = { ...source.document, sketches: [shared, source.second] }
    expect(expectedSketchFeatureDependencyIds(snapshot, [source.second.id, shared.id])).toEqual([
      id(801),
    ])
    expect(expectedSketchFeatureReferences(snapshot, [source.second.id, shared.id])).toHaveLength(1)
  })
  it("includes recursively referenced sketch supports and external model owners without consuming bodies", () => {
    const source = externalSourceFixture(true)
    expect(
      expectedSketchFeatureDependencyIds(source.document, [source.second.id, source.first.id]),
    ).toEqual([id(801), id(800), id(802), id(803)])
    expect(
      expectedSketchFeatureReferences(source.document, [source.second.id, source.first.id]).map(
        ({ featureId }) => featureId,
      ),
    ).toEqual([id(801), id(800), id(802), id(803)])
  })
  it("validates external source solutions before target solving and shares their cached solve", async () => {
    const source = externalSourceFixture()
    const solver = vi.fn(solve)
    const prepared = await createDocumentFeatureContentPreparer(solver)({
      document: source.document,
      feature: source.feature,
    })
    expect(prepared?.ok).toBe(true)
    expect(solver.mock.calls.map(([input]) => input.sketch.id)).toEqual([
      source.second.id,
      source.external.id,
      source.first.id,
    ])
  })
  it.each(["failed", "stale", "wrong-sketch", "unresolved-support"])(
    "rejects %s external source state without the resolver's authored-point fallback",
    async (mode) => {
      const source = externalSourceFixture()
      const solver = vi.fn<SketchSolvePort>((input) => {
        const current = solution(sketchRecordSchema.parse(input.sketch), input.revision)
        return {
          ok: true,
          solution:
            input.sketch.id === source.external.id
              ? {
                  ...current,
                  ...(mode === "failed" ? { status: "failed" as const } : {}),
                  ...(mode === "stale" ? { sourceRevision: 2 } : {}),
                  ...(mode === "wrong-sketch" ? { sketchId: source.first.id } : {}),
                }
              : current,
        }
      })
      const features =
        mode === "unresolved-support"
          ? source.document.features.map((feature) =>
              feature.id === id(802) ? { ...feature, parameters: {} } : feature,
            )
          : source.document.features
      await expect(
        createDocumentFeatureContentPreparer(solver)({
          document: source.document,
          feature: source.feature,
          features,
        }),
      ).resolves.toMatchObject({ ok: false })
      expect(solver.mock.calls.some(([input]) => input.sketch.id === source.first.id)).toBe(false)
    },
  )
  it("retains the external model resolution failure instead of dispatching replacement geometry", async () => {
    const source = externalSourceFixture(true)
    await expect(
      createDocumentFeatureContentPreparer(solve)({
        document: source.document,
        feature: source.feature,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        values: {
          reason: "sketch-solve-or-external-reference-failed",
          message: `External model feature ${id(803)} geometry is unavailable.`,
        },
      },
    })
  })
  it("rejects more than twenty-four distinct Loft scheduling owners before solving", async () => {
    const source = loftFixture()
    const sources = Array.from({ length: 23 }, (_, index) =>
      supported(
        sketchRecordSchema.parse({
          schemaVersion: 0,
          id: id(400 + index),
          label: "External source",
          plane: "xy",
          entities: [point(500 + index, 1, 2)],
          constraints: [],
        }),
        810 + index,
      ),
    )
    const first = sketchRecordSchema.parse({
      ...source.first,
      externalReferences: sources.map((sketch, index) => ({
        schemaVersion: 0,
        id: id(600 + index),
        kind: "point",
        sourceSketchId: sketch.id,
        sourcePointId: id(500 + index),
        projectedPointId: id(700 + index),
      })),
    })
    const snapshot = document(
      [...sources, first, source.second],
      [...source.document.features, ...sources.map((_, index) => datum(810 + index, index))],
    )
    const feature = featureRecordSchema.parse({
      ...source.feature,
      dependencies: expectedSketchFeatureDependencyIds(snapshot, [source.second.id, first.id]),
      references: expectedSketchFeatureReferences(snapshot, [source.second.id, first.id]),
    })
    const solver = vi.fn(solve)
    await expect(
      createDocumentFeatureContentPreparer(solver)({ document: snapshot, feature }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "dependency-budget-exceeded", count: 25 } },
    })
    expect(solver).not.toHaveBeenCalled()
  })
  it.each([
    "missing-sketch",
    "unresolved-support",
    "missing-selector",
    "wrong-sketch-solution",
    "stale-solution",
    "failed-status",
    "missing-solver",
  ])("fails closed for %s", async (mode) => {
    const source = loftFixture()
    const snapshot =
      mode === "missing-sketch" ? { ...source.document, sketches: [] } : source.document
    const features =
      mode === "unresolved-support"
        ? source.document.features.map((feature) =>
            feature.id === id(801) ? { ...feature, parameters: {} } : feature,
          )
        : source.document.features
    const parameters = source.feature.parameters as {
      sections: ReturnType<typeof selector>[]
      ruled: boolean
    }
    const feature =
      mode === "missing-selector"
        ? featureRecordSchema.parse({
            ...source.feature,
            parameters: {
              ...parameters,
              sections: [
                { ...parameters.sections[0], outerBoundaryEntityIds: [id(500)] },
                parameters.sections[1],
              ],
            },
          })
        : source.feature
    const solver: SketchSolvePort = (input) => {
      const solved = solution(sketchRecordSchema.parse(input.sketch), input.revision)
      return {
        ok: true,
        solution: {
          ...solved,
          ...(mode === "wrong-sketch-solution" ? { sketchId: sketchIdSchema.parse(id(555)) } : {}),
          ...(mode === "stale-solution" ? { sourceRevision: 2 } : {}),
          ...(mode === "failed-status" ? { status: "failed" as const } : {}),
        },
      }
    }
    await expect(
      createDocumentFeatureContentPreparer(mode === "missing-solver" ? null : solver)({
        document: snapshot,
        feature,
        features,
      }),
    ).resolves.toMatchObject({ ok: false })
  })
  it("supports holes for Sweep and explicitly rejects authored Loft holes", async () => {
    const ring = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(100),
      label: "Ring",
      plane: "yz",
      entities: [
        point(110, 0, 0),
        {
          schemaVersion: 0,
          id: id(111),
          type: "circle",
          centerPointId: id(110),
          radius: 2,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: id(112),
          type: "circle",
          centerPointId: id(110),
          radius: 1,
          construction: false,
        },
      ],
      constraints: [],
    })
    const ringSelector = solution(ring).profileResult.profiles.findIndex(
      ({ holeLoopIndices }) => holeLoopIndices.length === 1,
    )
    expect(ringSelector).toBeGreaterThanOrEqual(0)
    const path = pathSketch()
    const source = sweepFixture(ring, path)
    const parameters = sweepFeatureParametersSchema.parse(source.feature.parameters)
    const feature = {
      ...source.feature,
      parameters: { ...parameters, profile: selector(ring, ringSelector) },
    }
    const prepared = await createDocumentFeatureContentPreparer(solve)({
      document: source.document,
      feature,
    })
    expect(prepared?.ok).toBe(true)
    if (!prepared?.ok) throw new Error("Expected holed Sweep preparation.")
    expect(
      sweepFeatureContentParametersSchema.parse(prepared.parameters).profile.holes,
    ).toHaveLength(1)
    const loft = {
      ...feature,
      type: loftFeatureType.type,
      parameters: {
        sections: [selector(ring, ringSelector), selector(rectangle(200))],
        ruled: true,
      },
    }
    await expect(
      createDocumentFeatureContentPreparer(solve)({ document: source.document, feature: loft }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        values: {
          reason: "invalid-authored-parameters",
          issue: expect.stringContaining("hole-free"),
        },
      },
    })
  })
  it("rejects ambiguous solved profile correspondence", async () => {
    const source = loftFixture()
    const solver: SketchSolvePort = (input) => {
      const current = solution(sketchRecordSchema.parse(input.sketch), input.revision)
      const first = current.profileResult.profiles[0]
      if (!first) throw new Error("Expected a solved source profile.")
      return {
        ok: true,
        solution: {
          ...current,
          profileResult: {
            ...current.profileResult,
            profiles: [first, { ...first, profileIndex: 1 }],
          },
        },
      }
    }
    await expect(
      createDocumentFeatureContentPreparer(solver)({
        document: source.document,
        feature: source.feature,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        code: "org.vibeshape.feature.sketch-profile-ambiguous",
        values: { matchCount: 2 },
      },
    })
  })
  it("rejects a disconnected path, branch, closed chain and a nonterminal start", () => {
    const source = sweepFixture()
    const additional = [point(330, 20, 5), point(331, 30, 5), line(332, 330, 331)]
    const disconnected = sketchRecordSchema.parse({
      ...source.path,
      entities: [...source.path.entities, ...additional],
    })
    const disconnectedSelector = sketchPathSelectorSchema.parse({
      ...source.selectedPath,
      entityIds: [...source.selectedPath.entityIds, id(332)],
    })
    expect(
      materializeSelectedPath(disconnected, solution(disconnected), disconnectedSelector),
    ).toMatchObject({ ok: false })
    const branched = sketchRecordSchema.parse({
      ...source.path,
      entities: [...source.path.entities, point(330, 5, 10), line(332, 312, 330)],
    })
    expect(
      materializeSelectedPath(branched, solution(branched), disconnectedSelector),
    ).toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "path-branch-or-revisited-endpoint" } },
    })
    const closed = sketchRecordSchema.parse({
      ...source.path,
      entities: [...source.path.entities, line(332, 313, 310)],
    })
    expect(materializeSelectedPath(closed, solution(closed), disconnectedSelector)).toMatchObject({
      ok: false,
    })
    expect(
      materializeSelectedPath(source.path, solution(source.path), {
        ...source.selectedPath,
        startPointId: sketchEntityIdSchema.parse(id(311)),
      }),
    ).toMatchObject({ ok: false, diagnostic: { values: { reason: "path-start-not-terminal" } } })
  })
  it("rejects non-G1 joins and authored profile-plane misalignment", async () => {
    const source = sweepFixture()
    const corner = sketchRecordSchema.parse({
      ...source.path,
      entities: [...source.path.entities.filter(({ type }) => type !== "arc"), line(320, 312, 313)],
    })
    const cornerSource = sweepFixture(source.profile, corner)
    await expect(
      createDocumentFeatureContentPreparer(solve)({
        document: cornerSource.document,
        feature: cornerSource.feature,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        values: { reason: "invalid-materialized-path", issue: expect.stringContaining("G1") },
      },
    })
    const unaligned = sweepFixture(rectangle(100, "xy"))
    await expect(
      createDocumentFeatureContentPreparer(solve)({
        document: unaligned.document,
        feature: unaligned.feature,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        values: {
          reason: "invalid-materialized-sweep",
          issue: expect.stringContaining("profile plane"),
        },
      },
    })
  })
  it("reverses the exact arc and line when the other terminal owns direction", () => {
    const source = sweepFixture()
    const selected = { ...source.selectedPath, startPointId: sketchEntityIdSchema.parse(id(313)) }
    const prepared = materializeSelectedPath(source.path, solution(source.path), selected)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error("Expected a reversed directed path.")
    expect(prepared.segments.map(({ entityId }) => entityId)).toEqual([id(320), id(321)])
    expect(prepared.segments[0]).toMatchObject({ type: "arc", start: [10, 5], end: [5, 0] })
    expect(prepared.segments[1]).toMatchObject({ start: [5, 0], end: [0, 0] })
  })
  it("rejects duplicate selection, unsupported curves and missing solved points", () => {
    const source = sweepFixture()
    expect(
      materializeSelectedPath(source.path, solution(source.path), {
        ...source.selectedPath,
        entityIds: [...source.selectedPath.entityIds, source.selectedPath.entityIds[0] as never],
      }),
    ).toMatchObject({ ok: false, diagnostic: { values: { reason: "path-curve-duplicate" } } })
    expect(
      materializeSelectedPath(source.path, solution(source.path), {
        ...source.selectedPath,
        entityIds: [sketchEntityIdSchema.parse(id(314))],
      }),
    ).toMatchObject({ ok: false, diagnostic: { values: { reason: "path-curve-unavailable" } } })
    expect(
      materializeSelectedPath(
        source.path,
        { ...solution(source.path), points: [] },
        source.selectedPath,
      ),
    ).toMatchObject({ ok: false, diagnostic: { values: { reason: "path-curve-unsolved" } } })
  })
  it("rejects solved arc endpoints that disagree with the authored analytical center", () => {
    const source = sweepFixture()
    const solved = solution(source.path)
    const inconsistent = {
      ...solved,
      points: solved.points.map((point) =>
        point.entityId === id(313) ? { ...point, x: 11 } : point,
      ),
    }
    expect(materializeSelectedPath(source.path, inconsistent, source.selectedPath)).toMatchObject({
      ok: false,
      diagnostic: { values: { reason: "path-arc-radius-mismatch", entityId: id(320) } },
    })
  })
})
