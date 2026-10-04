import {
  applyDocumentCommand,
  createLengthQuantity,
  type DocumentSnapshot,
  datumPlaneFeatureType,
  documentCommandSchema,
  extrusionFeatureType,
  featureRecordSchema,
  sketchProfileSelectorSchema,
  sketchRecordSchema,
} from "../../packages/domain/src/index"
import { createLoftV3Project, loftFixtureId as id } from "./loft-v3-fixture"

/** Ordinary authored commands retain the source cylinder and the semantic Datum support. */
export function createCylindricalLoftProject() {
  const original = createLoftV3Project(),
    events = [...original.events]
  let snapshot: DocumentSnapshot = original.snapshot
  const apply = (kind: string, payload: unknown) => {
    const result = applyDocumentCommand(
      snapshot,
      documentCommandSchema.parse({
        schemaVersion: 1,
        kind,
        commandId: id(9000 + events.length),
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        issuedAt: "2026-10-04T00:00:00Z",
        actor: { type: "user", userId: null },
        payload,
      }),
    )
    if (!result.ok) throw new Error(result.diagnostic.message)
    snapshot = result.snapshot
    events.push(result.event)
  }
  apply("org.vibeshape.feature.add", {
    feature: featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(870),
      type: datumPlaneFeatureType.type,
      label: "Upper datum",
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(10),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }),
  })
  const sections = [1000, 2000].map((base) => {
    const prior = snapshot.sketches.find((sketch) => sketch.id === id(base))
    if (!prior) throw new Error("The authored section must exist.")
    const points = [
      [2, 0],
      [0, 2],
      [0, 0],
    ] as const
    const sketch = sketchRecordSchema.parse({
      ...prior,
      ...(base === 2000
        ? {
            support: {
              kind: "feature-face",
              reference: {
                schemaVersion: 0,
                featureId: id(870),
                kind: "face",
                semanticRole: "datum.plane",
                signature: {
                  kind: "face",
                  geometryClass: "PLANE",
                  measure: 10000,
                  centroid: [0, 0, 10],
                  bounds: { min: [-50, -50, 10], max: [50, 50, 10] },
                  boundaryCount: 4,
                  adjacentGeometryClasses: ["PLANE"],
                  directionMode: "oriented",
                  direction: [0, 0, 1],
                },
              },
            },
          }
        : {}),
      entities: [
        ...points.map(([x, y], i) => ({
          schemaVersion: 0,
          id: id(base + i + 1),
          type: "point",
          x,
          y,
          construction: false,
        })),
        {
          schemaVersion: 0,
          id: id(base + 11),
          type: "arc",
          centerPointId: id(base + 3),
          startPointId: id(base + 1),
          endPointId: id(base + 2),
          construction: false,
        },
        {
          schemaVersion: 0,
          id: id(base + 12),
          type: "line",
          startPointId: id(base + 2),
          endPointId: id(base + 3),
          construction: false,
        },
        {
          schemaVersion: 0,
          id: id(base + 13),
          type: "line",
          startPointId: id(base + 3),
          endPointId: id(base + 1),
          construction: false,
        },
      ],
      constraints: [
        ...[0, 2].map((i) => ({
          schemaVersion: 0,
          id: id(base + i + 21),
          type: "fixed",
          pointId: id(base + i + 1),
        })),
        // The arc already enforces equal endpoint radii; fixing both endpoints is redundant.
        { schemaVersion: 0, id: id(base + 22), type: "vertical", lineId: id(base + 12) },
      ],
    })
    apply("org.vibeshape.sketch.update", { sketch })
    return sketchProfileSelectorSchema.parse({
      schemaVersion: 0,
      sketchId: id(base),
      outerBoundaryEntityIds: [11, 12, 13].map((i) => id(base + i)),
      holeBoundaryEntityIds: [],
    })
  })
  apply("org.vibeshape.feature.add", {
    feature: featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(860),
      type: extrusionFeatureType.type,
      label: "Seed cylinder",
      parameters: {
        profile: sections[0],
        distance: createLengthQuantity(10),
        symmetric: false,
        operation: "new",
      },
      dependencies: [],
      references: [],
      suppressed: false,
    }),
  })
  return {
    snapshot,
    events,
    sections,
    outerCorrespondence: [0, 1, 2].map((i) => ({
      sectionEntityIds: [id(1011 + i), id(2011 + i)],
      sectionStartPointIds: [id(1001 + i), id(2001 + i)],
    })),
  }
}
