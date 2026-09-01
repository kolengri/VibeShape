import { expect, it } from "vitest"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { featureRecordV1Schema } from "./feature-graph"
import {
  applyInsertSketchInHistoryCommand,
  reduceHistoryDocumentEvent,
  replayHistoryDocumentEvents,
  type SketchInsertedInHistoryEvent,
} from "./history-document-commands"
import { commandIdSchema, featureIdSchema, sketchIdSchema } from "./identifiers"
import { sketchRecordSchema } from "./sketch"
import { createEmptySketch } from "./sketch-edit"

const uuid = (value: number) => `0195b5ac-b220-7a2c-8c33-${value.toString().padStart(12, "0")}`
const actor = { type: "user", userId: "org.vibeshape.user.history-test" } as const
const issuedAt = "2026-09-01T08:00:00.000Z"

function sketch(value: number, label = `Sketch ${value}`) {
  return createEmptySketch({ id: sketchIdSchema.parse(uuid(value)), label, plane: "xy" })
}

function pointSketch(value: number, entityValue: number) {
  return sketchRecordSchema.parse({
    ...sketch(value),
    entities: [
      {
        schemaVersion: 0,
        id: uuid(entityValue),
        type: "point",
        construction: false,
        x: value,
        y: 0,
      },
    ],
  })
}

function feature(value: number) {
  return featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: uuid(value),
    type: {
      moduleId: "org.vibeshape.test",
      moduleVersion: "1.0.0",
      typeId: "org.vibeshape.test.feature",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies: [],
    references: [],
    semanticInputs: [],
    suppressed: false,
    label: `Feature ${value}`,
  })
}

function unavailableFeature(value: number) {
  return featureRecordV1Schema.parse({
    ...feature(value),
    semanticInputs: null,
  })
}

function seed(
  input: {
    revision?: number
    sketches?: DocumentSnapshotV1["sketches"]
    features?: DocumentSnapshotV1["features"]
    history?: DocumentSnapshotV1["history"]
  } = {},
) {
  return documentSnapshotV1Schema.parse({
    schemaVersion: 1,
    id: uuid(1),
    revision: input.revision ?? 4,
    name: "History commands",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    sketches: input.sketches ?? [],
    features: input.features ?? [],
    history: input.history ?? [],
    createdAt: "2026-09-01T07:00:00.000Z",
    updatedAt: "2026-09-01T07:30:00.000Z",
  })
}

function command(
  snapshot: DocumentSnapshotV1,
  input: {
    sketch?: ReturnType<typeof sketch>
    historyAfter?: DocumentSnapshotV1["history"][number] | null
    commandId?: string
    documentId?: string
    baseRevision?: number
  } = {},
) {
  return {
    kind: "org.vibeshape.history.insert-sketch",
    schemaVersion: 1,
    commandId: input.commandId ?? uuid(100 + snapshot.revision),
    documentId: input.documentId ?? snapshot.id,
    baseRevision: input.baseRevision ?? snapshot.revision,
    issuedAt,
    actor,
    payload: {
      sketch: input.sketch ?? sketch(20),
      historyAfter: input.historyAfter === undefined ? null : input.historyAfter,
    },
  }
}

function expectApplied(result: ReturnType<typeof applyInsertSketchInHistoryCommand>) {
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

it("uses History rather than sketch storage order for v1 external references", () => {
  const source = pointSketch(25, 26)
  const sourcePoint = source.entities[0]
  if (!sourcePoint) throw new Error("Expected a source point.")
  const consumer = sketchRecordSchema.parse({
    ...sketch(27),
    externalReferences: [
      {
        schemaVersion: 0,
        id: uuid(28),
        sourceSketchId: source.id,
        sourcePointId: sourcePoint.id,
        projectedPointId: uuid(29),
      },
    ],
  })
  const input = {
    ...seed(),
    sketches: [consumer, source],
    history: [
      { kind: "sketch" as const, id: source.id },
      { kind: "sketch" as const, id: consumer.id },
    ],
  }

  expect(documentSnapshotV1Schema.safeParse(input).success).toBe(true)
  expect(
    documentSnapshotV1Schema.safeParse({ ...input, history: [...input.history].reverse() }).success,
  ).toBe(false)
})

it("inserts a sketch at the start and emits a replayable event", () => {
  const first = sketch(2)
  const source = feature(3)
  const current = seed({
    sketches: [first],
    features: [source],
    history: [
      { kind: "sketch", id: first.id },
      { kind: "feature", id: source.id },
    ],
  })
  const inserted = sketch(4, "Inserted at start")
  const result = expectApplied(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: inserted })),
  )

  expect(result.snapshot).toMatchObject({ revision: 5, updatedAt: issuedAt })
  expect(result.snapshot.sketches).toEqual([first, inserted])
  expect(result.snapshot.history).toEqual([
    { kind: "sketch", id: inserted.id },
    { kind: "sketch", id: first.id },
    { kind: "feature", id: source.id },
  ])
  expect(result.event).toMatchObject({
    type: "org.vibeshape.history.sketch-inserted",
    baseRevision: 4,
    revision: 5,
    sketch: inserted,
    historyAfter: null,
  })
  expect(reduceHistoryDocumentEvent(current, result.event)).toEqual({
    ok: true,
    snapshot: result.snapshot,
  })
})

it("inserts after a stable middle or end anchor instead of an array index", () => {
  const first = sketch(5)
  const source = feature(6)
  const current = seed({
    sketches: [first],
    features: [source],
    history: [
      { kind: "sketch", id: first.id },
      { kind: "feature", id: source.id },
    ],
  })
  const middle = sketch(7, "Middle")
  const middleResult = expectApplied(
    applyInsertSketchInHistoryCommand(
      current,
      command(current, {
        sketch: middle,
        historyAfter: { kind: "sketch", id: first.id },
      }),
    ),
  )
  expect(middleResult.snapshot.history).toEqual([
    { kind: "sketch", id: first.id },
    { kind: "sketch", id: middle.id },
    { kind: "feature", id: source.id },
  ])

  const atEnd = sketch(8, "End")
  const endResult = expectApplied(
    applyInsertSketchInHistoryCommand(
      current,
      command(current, {
        sketch: atEnd,
        historyAfter: { kind: "feature", id: source.id },
      }),
    ),
  )
  expect(endResult.snapshot.history.at(-1)).toEqual({ kind: "sketch", id: atEnd.id })
})

it("replays an ordered suffix from an already migrated v1 seed", () => {
  const current = seed()
  const first = expectApplied(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: sketch(9) })),
  )
  const secondSketch = sketch(10)
  const second = expectApplied(
    applyInsertSketchInHistoryCommand(
      first.snapshot,
      command(first.snapshot, {
        sketch: secondSketch,
        historyAfter: { kind: "sketch", id: first.event.sketch.id },
      }),
    ),
  )

  expect(replayHistoryDocumentEvents(current, [first.event, second.event])).toEqual({
    ok: true,
    snapshot: second.snapshot,
  })
})

it("rejects missing anchors without changing the snapshot", () => {
  const current = seed()
  const before = JSON.stringify(current)
  const result = applyInsertSketchInHistoryCommand(
    current,
    command(current, {
      historyAfter: { kind: "feature", id: featureIdSchema.parse(uuid(999)) },
    }),
  )

  expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })
  expect(result).toMatchObject({
    diagnostic: { issues: [{ path: "payload.historyAfter" }] },
  })
  expect(JSON.stringify(current)).toBe(before)

  const event = {
    schemaVersion: 1,
    type: "org.vibeshape.history.sketch-inserted",
    commandId: uuid(300),
    transactionId: null,
    documentId: current.id,
    baseRevision: current.revision,
    revision: current.revision + 1,
    issuedAt,
    actor,
    sketch: sketch(21),
    historyAfter: { kind: "sketch", id: uuid(998) },
  }
  expect(reduceHistoryDocumentEvent(current, event)).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event", issues: [{ path: "historyAfter" }] },
  })
})

it("fails closed when an extension dependency model is unavailable", () => {
  const unavailable = unavailableFeature(22)
  const current = seed({
    features: [unavailable],
    history: [{ kind: "feature", id: unavailable.id }],
  })
  const result = applyInsertSketchInHistoryCommand(
    current,
    command(current, {
      sketch: sketch(23),
      historyAfter: { kind: "feature", id: unavailable.id },
    }),
  )

  expect(result).toMatchObject({
    ok: false,
    diagnostic: {
      code: "unavailable-dependency-model",
      issues: [{ path: "features.0.type" }],
    },
  })

  const event = {
    schemaVersion: 1,
    type: "org.vibeshape.history.sketch-inserted",
    commandId: uuid(301),
    transactionId: null,
    documentId: current.id,
    baseRevision: current.revision,
    revision: current.revision + 1,
    issuedAt,
    actor,
    sketch: sketch(24),
    historyAfter: { kind: "feature", id: unavailable.id },
  }
  expect(reduceHistoryDocumentEvent(current, event)).toMatchObject({
    ok: false,
    diagnostic: {
      code: "invalid-event",
      issues: [{ path: "features.0.type" }],
    },
  })
})

it("returns diagnostics instead of throwing for invalid runtime options", () => {
  const current = seed()
  const invalidOptions = [null, "invalid", { transactionId: "not-a-uuid" }]

  for (const options of invalidOptions) {
    const run = () => applyInsertSketchInHistoryCommand(current, command(current), options as never)
    expect(run).not.toThrow()
    expect(run()).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-command",
        issues: [expect.objectContaining({ path: expect.stringMatching(/^options/) })],
      },
    })
  }
})

it("rejects duplicate sketch identities for commands and events", () => {
  const existing = sketch(11)
  const current = seed({
    sketches: [existing],
    history: [{ kind: "sketch", id: existing.id }],
  })
  const result = applyInsertSketchInHistoryCommand(current, command(current, { sketch: existing }))

  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: "sketch-already-exists" },
  })

  const valid = expectApplied(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: sketch(12) })),
  )
  expect(reduceHistoryDocumentEvent(current, { ...valid.event, sketch: existing })).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event" },
  })
})

it("rejects cross-document, stale, and exhausted revisions", () => {
  const current = seed()

  expect(
    applyInsertSketchInHistoryCommand(current, command(current, { documentId: uuid(999) })),
  ).toMatchObject({ ok: false, diagnostic: { code: "document-id-mismatch" } })
  expect(
    applyInsertSketchInHistoryCommand(
      current,
      command(current, { baseRevision: current.revision - 1 }),
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision", retryable: true } })

  const exhausted = seed({ revision: Number.MAX_SAFE_INTEGER })
  expect(
    applyInsertSketchInHistoryCommand(exhausted, command(exhausted, { commandId: uuid(500) })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "revision-exhausted" },
  })
})

it("rejects insertion before a required feature support", () => {
  const source = feature(13)
  const current = seed({
    features: [source],
    history: [{ kind: "feature", id: source.id }],
  })
  const supported = createEmptySketch({
    id: sketchIdSchema.parse(uuid(14)),
    label: "Supported sketch",
    plane: "xy",
    support: {
      kind: "feature-face",
      reference: {
        schemaVersion: 0,
        featureId: source.id,
        kind: "face",
        semanticRole: "primitive.box.face.z-max",
        signature: {
          kind: "face",
          geometryClass: "PLANE",
          measure: 400,
          centroid: [0, 0, 10],
          bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
          direction: [0, 0, 1],
          directionMode: "oriented",
          boundaryCount: 4,
          adjacentGeometryClasses: ["PLANE"],
        },
      },
    },
  })

  expect(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: supported })),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "invalid-command",
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/dependency|precede/i) }),
      ]),
    },
  })
  expect(
    applyInsertSketchInHistoryCommand(
      current,
      command(current, {
        sketch: supported,
        historyAfter: { kind: "feature", id: source.id },
      }),
    ),
  ).toMatchObject({ ok: true })
})

it("rejects newly authored orphaned model-reference intent", () => {
  const current = seed()
  const orphaned = sketchRecordSchema.parse({
    ...sketch(15),
    externalReferences: [
      {
        schemaVersion: 1,
        id: uuid(16),
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId: uuid(17),
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
        projectedPointId: uuid(18),
        orphanedSource: { kind: "deleted-feature", featureId: uuid(17) },
      },
    ],
  })

  expect(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: orphaned })),
  ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch" } })

  const event: SketchInsertedInHistoryEvent = {
    schemaVersion: 1,
    type: "org.vibeshape.history.sketch-inserted",
    commandId: commandIdSchema.parse(uuid(400)),
    transactionId: null,
    documentId: current.id,
    baseRevision: current.revision,
    revision: current.revision + 1,
    issuedAt,
    actor,
    sketch: orphaned,
    historyAfter: null,
  }
  expect(reduceHistoryDocumentEvent(current, event)).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event" },
  })
})

it("fails closed for tampered event envelopes and replay suffixes", () => {
  const current = seed()
  const applied = expectApplied(
    applyInsertSketchInHistoryCommand(current, command(current, { sketch: sketch(19) })),
  )
  const tampered = { ...applied.event, unexpected: true }

  expect(reduceHistoryDocumentEvent(current, tampered)).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event" },
  })
  expect(replayHistoryDocumentEvents(current, [applied.event, tampered])).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-event" },
  })
})
