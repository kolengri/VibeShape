import { describe, expect, it } from "bun:test"
import {
  featureIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
} from "./identifiers"
import { projectedExternalSketchEntities, type SketchRecord, sketchRecordSchema } from "./sketch"
import { inspectSketchReferenceHealth } from "./sketch-reference-health"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${value.toString().padStart(12, "0")}`

function pointSketch(value: number, label: string) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    label,
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: id(value + 100),
        type: "point",
        construction: false,
        x: value,
        y: 0,
      },
    ],
    constraints: [],
  })
}

function projectedPointSketch(
  value: number,
  label: string,
  source: SketchRecord,
  sourcePointId = source.entities[0]?.id,
) {
  if (!sourcePointId) throw new Error("The source point fixture is required.")
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    label,
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: id(value + 200),
        sourceSketchId: source.id,
        sourcePointId,
        projectedPointId: id(value + 300),
      },
    ],
  })
}

function modelPointSketch(value: number) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    label: "Model reference",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: sketchExternalReferenceIdSchema.parse(id(value + 200)),
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId: featureIdSchema.parse(id(value + 400)),
          kind: "vertex",
          signature: {
            kind: "vertex",
            geometryClass: "POINT",
            measure: 0,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            boundaryCount: 0,
            adjacentGeometryClasses: [],
          },
        },
        projectedPointId: id(value + 300),
      },
    ],
  })
}

function externalReferenceId(sketch: SketchRecord) {
  const reference = sketch.externalReferences?.[0]
  if (!reference) throw new Error("The external reference fixture is required.")
  return reference.id
}

function pointSourceReference(sketch: SketchRecord) {
  const reference = sketch.externalReferences?.[0]
  if (!reference || !("sourcePointId" in reference)) {
    throw new Error("The source point reference fixture is required.")
  }
  return reference
}

function projectedPointId(sketch: SketchRecord) {
  const entity = projectedExternalSketchEntities(sketch.externalReferences ?? [])[0]
  if (!entity) throw new Error("The projected point fixture is required.")
  return entity.id
}

describe("inspectSketchReferenceHealth", () => {
  it("distinguishes healthy authored references from direct identity failures", () => {
    const source = pointSketch(1, "Source")
    const healthy = projectedPointSketch(2, "Healthy", source)
    const broken = projectedPointSketch(3, "Broken", source, sketchEntityIdSchema.parse(id(999)))

    const health = inspectSketchReferenceHealth([source, healthy, broken])

    expect(health.get(healthy.id)).toEqual({
      status: "healthy",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [],
      unknownReferenceIds: [],
    })
    expect(health.get(broken.id)).toEqual<unknown>({
      status: "broken",
      directBrokenReferenceIds: [externalReferenceId(broken)],
      transitiveBrokenReferenceIds: [],
      unknownReferenceIds: [],
    })
  })

  it("classifies missing source sketches and incompatible source types as direct failures", () => {
    const source = pointSketch(5, "Source")
    const missingSource = projectedPointSketch(6, "Missing source", source)
    const sourcePointId = source.entities[0]?.id
    if (!sourcePointId) throw new Error("The source point fixture is required.")
    const wrongType = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(7),
      label: "Wrong type",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(207),
          kind: "line",
          sourceSketchId: source.id,
          sourceLineId: sourcePointId,
          projectedLineId: id(307),
          projectedStartPointId: id(308),
          projectedEndPointId: id(309),
        },
      ],
    })

    expect(inspectSketchReferenceHealth([], [missingSource]).get(missingSource.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [externalReferenceId(missingSource)],
    })
    expect(inspectSketchReferenceHealth([source], [wrongType]).get(wrongType.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [externalReferenceId(wrongType)],
    })
  })

  it("requires a Pierce source to remain a line", () => {
    const source = pointSketch(8, "Source")
    const sourcePointId = source.entities[0]?.id
    if (!sourcePointId) throw new Error("The source point fixture is required.")
    const dependent = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(9),
      label: "Pierced",
      plane: "xz",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(209),
          kind: "pierce-point",
          sourceSketchId: source.id,
          sourceLineId: sourcePointId,
          projectedPointId: id(309),
        },
      ],
    })

    expect(inspectSketchReferenceHealth([source, dependent]).get(dependent.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [externalReferenceId(dependent)],
    })
  })

  it("reports a downstream projected reference as transitively broken", () => {
    const deletedSource = { ...pointSketch(10, "Source"), entities: [] }
    const middle = projectedPointSketch(
      11,
      "Middle",
      deletedSource,
      sketchEntityIdSchema.parse(id(110)),
    )
    const middleReference = middle.externalReferences?.[0]
    if (!middleReference || !("projectedPointId" in middleReference)) {
      throw new Error("The intermediate projection is required.")
    }
    const middleProjectedPointId = middleReference.projectedPointId
    const target = projectedPointSketch(12, "Target", middle, middleProjectedPointId)

    const health = inspectSketchReferenceHealth([deletedSource, middle, target])

    expect(health.get(middle.id)?.directBrokenReferenceIds).toEqual<unknown>([
      externalReferenceId(middle),
    ])
    expect(health.get(target.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [externalReferenceId(target)],
    })
  })

  it("fails closed when malformed projected-reference ownership is cyclic", () => {
    const firstProjectedPointId = sketchEntityIdSchema.parse(id(430))
    const secondProjectedPointId = sketchEntityIdSchema.parse(id(431))
    const firstId = id(40)
    const secondId = id(41)
    const first = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: firstId,
      label: "First",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(240),
          sourceSketchId: secondId,
          sourcePointId: secondProjectedPointId,
          projectedPointId: firstProjectedPointId,
        },
      ],
    })
    const second = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: secondId,
      label: "Second",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(241),
          sourceSketchId: firstId,
          sourcePointId: firstProjectedPointId,
          projectedPointId: secondProjectedPointId,
        },
      ],
    })

    const downstream = projectedPointSketch(42, "Downstream", first, firstProjectedPointId)
    const independent = pointSketch(43, "Independent")
    const health = inspectSketchReferenceHealth([first, second, downstream, independent])
    for (const sketch of [first, second, downstream]) {
      expect(health.get(sketch.id)).toMatchObject({
        status: "broken",
        directBrokenReferenceIds: [],
        transitiveBrokenReferenceIds: [externalReferenceId(sketch)],
      })
    }
    expect(health.get(independent.id)?.status).toBe("healthy")
  })

  it("merges worker model evidence and propagates a broken projection through sketch chains", () => {
    const sketch = modelPointSketch(50)

    expect(inspectSketchReferenceHealth([sketch]).get(sketch.id)).toEqual<unknown>({
      status: "unknown",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [],
      unknownReferenceIds: [externalReferenceId(sketch)],
    })

    expect(
      inspectSketchReferenceHealth([sketch], [sketch], () => "resolved").get(sketch.id),
    ).toEqual({
      status: "healthy",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [],
      unknownReferenceIds: [],
    })

    const modelReference = sketch.externalReferences?.[0]
    if (!modelReference || !("projectedPointId" in modelReference)) {
      throw new Error("The projected model point fixture is required.")
    }
    const dependent = projectedPointSketch(51, "Dependent", sketch, modelReference.projectedPointId)
    const broken = inspectSketchReferenceHealth([sketch, dependent], undefined, () => "broken")

    expect(broken.get(sketch.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [modelReference.id],
    })
    expect(broken.get(dependent.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [externalReferenceId(dependent)],
    })
  })

  it("marks typed orphan intent as directly broken and propagates it downstream", () => {
    const deletedFeatureId = featureIdSchema.parse(id(460))
    const orphan = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(60),
      label: "Orphaned model reference",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 1,
          id: sketchExternalReferenceIdSchema.parse(id(260)),
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId: deletedFeatureId,
            kind: "vertex",
            signature: {
              kind: "vertex",
              geometryClass: "POINT",
              measure: 0,
              centroid: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: id(360),
          orphanedSource: { kind: "deleted-feature", featureId: deletedFeatureId },
        },
      ],
    })
    const reference = orphan.externalReferences?.[0]
    if (!reference || !("projectedPointId" in reference))
      throw new Error("The orphaned model-point fixture is required.")
    const dependent = projectedPointSketch(61, "Dependent", orphan, reference.projectedPointId)
    const health = inspectSketchReferenceHealth([orphan, dependent])

    expect(health.get(orphan.id)).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [reference.id],
    })
    expect(health.get(dependent.id)).toMatchObject({
      status: "broken",
      transitiveBrokenReferenceIds: [externalReferenceId(dependent)],
    })
    let resolverCalls = 0
    inspectSketchReferenceHealth([orphan, dependent], undefined, () => {
      resolverCalls++
      return "resolved"
    })
    expect(resolverCalls).toBe(0)
  })

  it("keeps draft reference changes separate from committed source chains in either target order", () => {
    const authored = pointSketch(70, "Authored")
    const committed = projectedPointSketch(71, "Committed", authored)
    const dependent = projectedPointSketch(72, "Dependent", committed, projectedPointId(committed))
    const draft = sketchRecordSchema.parse({
      ...committed,
      externalReferences: committed.externalReferences?.map((reference) => ({
        ...reference,
        sourcePointId: id(999),
      })),
    })

    for (const targets of [
      [draft, dependent],
      [dependent, draft],
    ]) {
      const health = inspectSketchReferenceHealth([authored, committed, dependent], targets)
      expect(health.get(draft.id)?.directBrokenReferenceIds).toEqual([externalReferenceId(draft)])
      expect(health.get(dependent.id)?.status).toBe("healthy")
    }

    const changedSource = { ...authored, entities: [] }
    const changed = inspectSketchReferenceHealth([changedSource, committed, dependent])
    expect(changed.get(committed.id)?.directBrokenReferenceIds).toEqual([
      externalReferenceId(committed),
    ])
    expect(changed.get(dependent.id)?.transitiveBrokenReferenceIds).toEqual([
      externalReferenceId(dependent),
    ])
    expect(
      inspectSketchReferenceHealth([authored, committed, dependent]).get(dependent.id)?.status,
    ).toBe("healthy")
  })

  it("preserves a draft root's ID cycle check without poisoning committed nodes", () => {
    const authored = pointSketch(80, "Authored")
    const committed = projectedPointSketch(81, "Committed", authored)
    const dependent = projectedPointSketch(82, "Dependent", committed, projectedPointId(committed))
    const draft = sketchRecordSchema.parse({
      ...committed,
      externalReferences: committed.externalReferences?.map((reference) => ({
        ...reference,
        sourceSketchId: dependent.id,
        sourcePointId: projectedPointId(dependent),
      })),
    })

    for (const targets of [
      [draft, dependent],
      [dependent, draft],
    ]) {
      const health = inspectSketchReferenceHealth([authored, committed, dependent], targets)
      expect(health.get(draft.id)?.transitiveBrokenReferenceIds).toEqual([
        externalReferenceId(draft),
      ])
      expect(health.get(dependent.id)?.status).toBe("healthy")
    }
  })

  it("isolates changed draft model evidence and memoizes only identical owner/reference pairs", () => {
    const committed = modelPointSketch(90)
    const dependent = projectedPointSketch(91, "Dependent", committed, projectedPointId(committed))
    const draft = sketchRecordSchema.parse({
      ...committed,
      externalReferences: committed.externalReferences?.map((reference) => {
        if (reference.kind !== "model-point") throw new Error("Expected a model point.")
        return { ...reference, reference: { ...reference.reference, featureId: id(999) } }
      }),
    })
    for (const targets of [
      [draft, dependent],
      [dependent, draft],
    ]) {
      const calls: unknown[] = []
      const health = inspectSketchReferenceHealth([committed, dependent], targets, (owner, ref) => {
        calls.push([owner, ref])
        return ref.reference.featureId === id(999) ? "broken" : "resolved"
      })
      expect(health.get(draft.id)?.directBrokenReferenceIds).toEqual([externalReferenceId(draft)])
      expect(health.get(dependent.id)?.status).toBe("healthy")
      expect(calls).toHaveLength(2)
      expect(calls).toContainEqual([committed.id, committed.externalReferences?.[0]])
      expect(calls).toContainEqual([draft.id, draft.externalReferences?.[0]])
    }
  })

  it("resolves a committed model terminal before applying draft ID cycle tracking", () => {
    const committed = modelPointSketch(94)
    const dependent = projectedPointSketch(95, "Dependent", committed, projectedPointId(committed))
    const draft = sketchRecordSchema.parse({
      ...committed,
      externalReferences: [
        {
          schemaVersion: 0,
          id: externalReferenceId(committed),
          sourceSketchId: dependent.id,
          sourcePointId: projectedPointId(dependent),
          projectedPointId: projectedPointId(committed),
        },
      ],
    })
    const calls: unknown[] = []
    const health = inspectSketchReferenceHealth(
      [committed, dependent],
      [draft, dependent],
      (owner, ref) => {
        calls.push([owner, ref])
        return "resolved"
      },
    )
    expect(health.get(draft.id)?.status).toBe("healthy")
    expect(health.get(dependent.id)?.status).toBe("healthy")
    expect(calls).toEqual([[committed.id, committed.externalReferences?.[0]]])
  })

  it("does not confuse repeated sketch-reference IDs in different owners with a cycle", () => {
    const authored = pointSketch(96, "Authored")
    const first = projectedPointSketch(97, "First", authored)
    const second = projectedPointSketch(98, "Second", first, projectedPointId(first))
    const repeated = sketchRecordSchema.parse({
      ...second,
      externalReferences: second.externalReferences?.map((reference) => ({
        ...reference,
        id: externalReferenceId(first),
      })),
    })
    const health = inspectSketchReferenceHealth([authored, first, repeated])
    expect(health.get(first.id)?.status).toBe("healthy")
    expect(health.get(repeated.id)?.status).toBe("healthy")
  })

  it("keeps owner-dependent model evidence distinct even for a shared reference object", () => {
    const first = modelPointSketch(100)
    const second = {
      ...pointSketch(101, "Second owner"),
      entities: [],
      externalReferences: first.externalReferences,
    }
    const firstDependent = projectedPointSketch(
      102,
      "First dependent",
      first,
      projectedPointId(first),
    )
    const secondDependent = projectedPointSketch(
      103,
      "Second dependent",
      second,
      projectedPointId(second),
    )
    let calls = 0
    const health = inspectSketchReferenceHealth(
      [first, second, firstDependent, secondDependent],
      undefined,
      (owner) => {
        calls++
        return owner === first.id ? "resolved" : "broken"
      },
    )

    expect(calls).toBe(2)
    expect(health.get(first.id)?.status).toBe("healthy")
    expect(health.get(firstDependent.id)?.status).toBe("healthy")
    expect(health.get(second.id)?.directBrokenReferenceIds).toEqual([externalReferenceId(first)])
    expect(health.get(secondDependent.id)?.transitiveBrokenReferenceIds).toEqual([
      externalReferenceId(secondDependent),
    ])
  })

  it("shares unknown model results across branches only within the current inspection", () => {
    const model = modelPointSketch(110)
    const branches = Array.from({ length: 30 }, (_, index) =>
      projectedPointSketch(111 + index, "Branch", model, projectedPointId(model)),
    )
    let calls = 0
    const unknown = inspectSketchReferenceHealth([model, ...branches], undefined, () => {
      calls++
      return "unknown"
    })
    expect(calls).toBe(1)
    for (const sketch of [model, ...branches]) {
      expect(unknown.get(sketch.id)?.unknownReferenceIds).toEqual([externalReferenceId(sketch)])
    }
    expect(
      [
        ...inspectSketchReferenceHealth([model, ...branches], undefined, () => "resolved").values(),
      ].every(({ status }) => status === "healthy"),
    ).toBe(true)

    let unusedCalls = 0
    inspectSketchReferenceHealth([model], [], () => {
      unusedCalls++
      return "broken"
    })
    expect(unusedCalls).toBe(0)
  })

  it("distinguishes authored identities from unrelated broken projections in the same source", () => {
    const authored = pointSketch(150, "Authored")
    const broken = projectedPointSketch(
      151,
      "Broken",
      authored,
      sketchEntityIdSchema.parse(id(999)),
    )
    const mixed = { ...broken, entities: authored.entities }
    const authoredDependent = projectedPointSketch(152, "Authored dependent", mixed)
    const projectedDependent = projectedPointSketch(
      153,
      "Projected dependent",
      mixed,
      projectedPointId(mixed),
    )
    const health = inspectSketchReferenceHealth([
      authored,
      mixed,
      authoredDependent,
      projectedDependent,
    ])

    expect(health.get(authoredDependent.id)?.status).toBe("healthy")
    expect(health.get(projectedDependent.id)?.transitiveBrokenReferenceIds).toEqual([
      externalReferenceId(projectedDependent),
    ])
  })

  it("resolves deep chains in either target order with a linear number of source identity reads", () => {
    const chain = [pointSketch(10_000, "Root")]
    for (let index = 1; index < 12_000; index++) {
      const previous = chain[index - 1]
      if (!previous) throw new Error("Expected the preceding sketch.")
      chain.push(
        projectedPointSketch(
          10_000 + index,
          "Projected",
          previous,
          index === 1 ? previous.entities[0]?.id : projectedPointId(previous),
        ),
      )
    }
    let reads = 0
    for (const sketch of chain.slice(1)) {
      const reference = pointSourceReference(sketch)
      const sourcePointId = reference.sourcePointId
      Object.defineProperty(reference, "sourcePointId", {
        get() {
          reads++
          return sourcePointId
        },
      })
    }
    for (const targets of [chain, [...chain].reverse()]) {
      reads = 0
      const health = inspectSketchReferenceHealth(chain, targets)
      expect(health.size).toBe(12_000)
      expect([...health.values()].every(({ status }) => status === "healthy")).toBe(true)
      expect(reads).toBeLessThanOrEqual(4 * chain.length)
    }
  })
})
