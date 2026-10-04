import {
  applyDocumentCommand,
  boxFeatureType,
  createLengthQuantity,
  type DocumentEvent,
  type DocumentSnapshot,
  documentCommandSchema,
  documentSnapshotSchema,
  featureRecordSchema,
  sketchProfileSelectorSchema,
  sketchRecordSchema,
} from "../../packages/domain/src/index"

export const loftFixtureId = (value: number) =>
  `0195b5ac-b260-7a2c-8c33-${String(value).padStart(12, "0")}`
export function createLoftV3Project() {
  const id = loftFixtureId,
    events: DocumentEvent[] = []
  let snapshot: DocumentSnapshot | null = null
  const apply = (kind: string, payload: unknown) => {
    const result = applyDocumentCommand(
      snapshot,
      documentCommandSchema.parse({
        schemaVersion: 1,
        kind,
        commandId: id(9000 + events.length),
        documentId: id(9999),
        baseRevision: snapshot?.revision ?? 0,
        issuedAt: "2026-10-04T00:00:00Z",
        actor: { type: "user", userId: null },
        payload,
      }),
    )
    if (!result.ok) throw new Error(result.diagnostic.message)
    snapshot = result.snapshot
    events.push(result.event)
  }
  apply("org.vibeshape.document.create", { name: "Constrained Loft fixture" })
  const box = (number: number, depth: number, label: string) =>
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(number),
      type: boxFeatureType.type,
      label,
      parameters: {
        width: createLengthQuantity(4),
        depth: createLengthQuantity(depth),
        height: createLengthQuantity(10),
        centered: false,
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
  for (const feature of [box(850, 4, "Seed box"), box(851, 4.0002, "Guide support box")])
    apply("org.vibeshape.feature.add", { feature })
  const planeReference = (owner: number) => {
    const top = owner === 800,
      offset = owner === 801 ? 2.0001 : 2
    const centroid = top ? [0, 0, 10] : [0, -offset, 5]
    const bounds = top
      ? { min: [-2, -2, 10], max: [2, 2, 10] }
      : { min: [-2, -offset, 0], max: [2, -offset, 10] }
    return {
      schemaVersion: 0,
      featureId: id(owner === 801 ? 851 : 850),
      kind: "face",
      semanticRole: top ? "primitive.box.cap.end" : "primitive.box.side.y-min",
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: top ? 16 : 40,
        centroid,
        bounds,
        boundaryCount: 4,
        adjacentGeometryClasses: ["PLANE"],
        directionMode: "oriented",
        direction: top ? [0, 0, 1] : [0, -1, 0],
      },
    }
  }
  const sketch = (
    base: number,
    label: string,
    points: [number, number][],
    closed: boolean,
    plane: "xy" | "xz",
    owner?: number,
  ) =>
    sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(base),
      label,
      plane,
      ...(owner ? { support: { kind: "feature-face", reference: planeReference(owner) } } : {}),
      entities: [
        ...points.map(([x, y], index) => ({
          schemaVersion: 0,
          id: id(base + index + 1),
          type: "point",
          x,
          y,
          construction: false,
        })),
        ...Array.from({ length: closed ? points.length : points.length - 1 }, (_, index) => ({
          schemaVersion: 0,
          id: id(base + index + 11),
          type: "line",
          startPointId: id(base + index + 1),
          endPointId: id(base + ((index + 1) % points.length) + 1),
          construction: false,
        })),
      ],
      constraints: points.map((_, index) => ({
        schemaVersion: 0,
        id: id(base + index + 21),
        type: "fixed",
        pointId: id(base + index + 1),
      })),
    })
  const rectangle: [number, number][] = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ]
  const sketches = [
    sketch(1000, "Lower section", rectangle, true, "xy"),
    sketch(2000, "Upper section", rectangle, true, "xy", 800),
    sketch(
      3000,
      "Wall guide",
      [
        [-1, 5],
        [1, 5],
      ],
      false,
      "xz",
      801,
    ),
    sketch(
      4000,
      "Corner rail",
      [
        [-2, 0],
        [-2, 10],
      ],
      false,
      "xz",
      802,
    ),
  ]
  for (const sketch of sketches) apply("org.vibeshape.sketch.add", { sketch })
  if (!snapshot) throw new Error("The authored fixture requires a snapshot")
  const sections = [1000, 2000].map((base) =>
    sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId: id(base),
      outerBoundaryEntityIds: [11, 12, 13, 14].map((offset) => id(base + offset)),
      holeBoundaryEntityIds: [],
    }),
  )
  const outerCorrespondence = [0, 1, 2, 3].map((index) => ({
    sectionEntityIds: [id(1011 + index), id(2011 + index)],
    sectionStartPointIds: [id(1001 + index), id(2001 + index)],
  }))
  const path = (base: number) => ({
    schemaVersion: 0,
    sketchId: id(base),
    entityIds: [id(base + 11)],
    startPointId: id(base + 1),
  })
  return {
    snapshot: documentSnapshotSchema.parse(snapshot),
    events,
    sections,
    outerCorrespondence,
    guidePath: path(3000),
    railPath: path(4000),
    sketches,
  }
}
