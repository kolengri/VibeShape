import {
  applyDocumentCommand,
  createLengthQuantity,
  type DocumentEvent,
  type DocumentSnapshot,
  documentCommandSchema,
  sketchRecordSchema,
} from "../../packages/domain/src/index"

const id = (value: number) => `0195b5ac-b291-7a2c-8c33-${String(value).padStart(12, "0")}`

export function createCoordinateSketchProject() {
  const points = Array.from({ length: 24 }, (_, index) => ({
    schemaVersion: 0,
    id: id(index + 2),
    type: "point",
    construction: false,
    x: Math.round(26 * Math.cos((index * Math.PI) / 12)) || 0,
    y: Math.round(35 * Math.sin((index * Math.PI) / 12)) || 0,
  }))
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(100),
    label: "Coordinate outline",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: id(1), type: "point", construction: true, x: 0, y: 0 },
      ...points,
      ...points.map((point, index) => ({
        schemaVersion: 0,
        id: id(index + 200),
        type: "line",
        construction: false,
        startPointId: point.id,
        endPointId: points[(index + 1) % points.length]?.id,
      })),
    ],
    constraints: [
      { schemaVersion: 0, id: id(300), type: "fixed", pointId: id(1) },
      ...points.flatMap((point, index) =>
        (["horizontal-distance", "vertical-distance"] as const).map((type, axis) => {
          const value = createLengthQuantity(axis === 0 ? point.x : point.y)
          return {
            schemaVersion: 0,
            id: id(301 + index * 2 + axis),
            type,
            firstPointId: point.id,
            secondPointId: id(1),
            value: {
              ...value,
              source: { ...value.source, expression: `${value.value} mm * 1.000000000000` },
            },
          }
        }),
      ),
    ],
  })
  let snapshot: DocumentSnapshot | null = null
  const events: DocumentEvent[] = []
  for (const [kind, payload] of [
    ["org.vibeshape.document.create", { name: "Coordinate annotations fixture" }],
    ["org.vibeshape.sketch.add", { sketch }],
  ] as const) {
    const result = applyDocumentCommand(
      snapshot,
      documentCommandSchema.parse({
        schemaVersion: 1,
        kind,
        commandId: id(1000 + events.length),
        documentId: id(9999),
        baseRevision: snapshot?.revision ?? 0,
        issuedAt: "2026-10-05T00:00:00Z",
        actor: { type: "user", userId: null },
        payload,
      }),
    )
    if (!result.ok) throw new Error(result.diagnostic.message)
    snapshot = result.snapshot
    events.push(result.event)
  }
  if (!snapshot) throw new Error("The coordinate sketch project must exist.")
  return { sketch, snapshot, events }
}
