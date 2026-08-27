import { documentSnapshotSchema, sketchRecordSchema } from "@vibeshape/domain"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  earlierSketchesForDraft,
  externalSketchContextGeometry,
  externalSketchGeometryCandidates,
} from "./external-sketch-points"

const sourcePointId = "0195b5ac-b220-7a2c-8c33-000000004001"
const sourceSketchId = "0195b5ac-b220-7a2c-8c33-000000004002"
const targetSketchId = "0195b5ac-b220-7a2c-8c33-000000004003"
const laterSketchId = "0195b5ac-b220-7a2c-8c33-000000004004"
const labels = {
  curve: (sourceLabel: string, kind: string, ordinal: number) =>
    `${sourceLabel} · ${kind} ${ordinal}`,
  line: (sourceLabel: string, ordinal: number) => `${sourceLabel} · Line ${ordinal}`,
  point: (sourceLabel: string, ordinal: number) => `${sourceLabel} · Point ${ordinal}`,
}

describe("external sketch point candidates", () => {
  it("uses every committed sketch as context for a new unsaved draft", () => {
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Layout",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: sourcePointId,
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
      ],
      constraints: [],
    })
    const unsavedTarget = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "New sketch",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const secondSource = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: laterSketchId,
      label: "Reference",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000004005",
          type: "point",
          x: 5,
          y: 7,
          construction: false,
        },
      ],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004099",
      revision: 1,
      name: "Unsaved target context",
      sketches: [source, secondSource],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(externalSketchContextGeometry(document, unsavedTarget, labels)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "point",
          sourcePointId,
          sourceSketchId,
          world: [2, 3, 0],
          x: 2,
          y: 3,
        }),
        expect.objectContaining({
          kind: "point",
          sourceSketchId: laterSketchId,
          world: [5, 7, 0],
          x: 5,
          y: 7,
        }),
      ]),
    )
  })

  it("excludes the active sketch and later sketches from existing-draft context", () => {
    const sketches = [sourceSketchId, targetSketchId, laterSketchId].map((id, index) =>
      sketchRecordSchema.parse({
        schemaVersion: 0,
        id,
        label: `Sketch ${index + 1}`,
        plane: "xy",
        entities: [],
        constraints: [],
      }),
    )

    const target = sketches[1]
    if (!target) throw new Error("The target sketch fixture is required.")
    expect(earlierSketchesForDraft({ sketches }, target.id).map(({ id }) => id)).toEqual([
      sourceSketchId,
    ])
  })

  it("projects an earlier sketch point into the active support while retaining its world position", () => {
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Source",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: sourcePointId,
          type: "point",
          x: 2,
          y: 3,
          construction: false,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "yz",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004004",
      revision: 1,
      name: "Cross-frame reference test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toEqual([
      {
        construction: false,
        kind: "point",
        label: "Source · Point 1",
        role: "vertex",
        sourcePointId,
        sourceSketchId,
        world: [2, 3, 0],
        x: 3,
        y: 0,
      },
    ])
    const solvedSource = {
      points: [{ entityId: sourcePointId, x: 8, y: 11 }],
      circles: [],
    } as unknown as SolvedSketchWire
    expect(
      externalSketchGeometryCandidates(
        document,
        target,
        labels,
        document.features,
        new Map([[source.id, solvedSource]]),
      ),
    ).toEqual([expect.objectContaining({ sourcePointId, world: [8, 11, 0], x: 11, y: 0 })])
  })

  it("projects an earlier sketch line into the active support with world-space endpoints", () => {
    const sourceEndPointId = "0195b5ac-b220-7a2c-8c33-000000004005"
    const sourceLineId = "0195b5ac-b220-7a2c-8c33-000000004006"
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Layout",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: sourcePointId, type: "point", x: 2, y: 3 },
        { schemaVersion: 0, id: sourceEndPointId, type: "point", x: 2, y: 8 },
        {
          schemaVersion: 0,
          id: sourceLineId,
          type: "line",
          startPointId: sourcePointId,
          endPointId: sourceEndPointId,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "yz",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004007",
      revision: 1,
      name: "Cross-frame line reference test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toContainEqual({
      construction: false,
      kind: "line",
      label: "Layout · Line 1",
      sourceEndPointId,
      sourceLineId,
      sourceSketchId,
      sourceStartPointId: sourcePointId,
      start: { world: [2, 3, 0], x: 3, y: 0 },
      end: { world: [2, 8, 0], x: 8, y: 0 },
    })
  })

  it("offers a prior circle as one analytical Use candidate", () => {
    const circleId = "0195b5ac-b220-7a2c-8c33-000000004008"
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Wheel profile",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: sourcePointId, type: "point", x: 2, y: 3 },
        {
          schemaVersion: 0,
          id: circleId,
          type: "circle",
          centerPointId: sourcePointId,
          radius: 5,
        },
      ],
      constraints: [],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Target",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004009",
      revision: 1,
      name: "Circle context test",
      sketches: [source, target],
      features: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    })

    const context = externalSketchContextGeometry(document, target, labels)
    const curve = context.find((geometry) => geometry.kind === "curve")

    expect(curve).toEqual(
      expect.objectContaining({
        closed: true,
        kind: "curve",
        projectedType: "circle",
        sourceEntityId: circleId,
        sourceType: "circle",
      }),
    )
    expect(curve?.points).toHaveLength(65)
    expect(curve?.points[0]?.x).toBeCloseTo(7)
    expect(curve?.points[0]?.y).toBeCloseTo(3)
    expect(curve?.points[32]?.x).toBeCloseTo(-3)
    expect(curve?.points[32]?.y).toBeCloseTo(3)
    expect(context).toContainEqual(
      expect.objectContaining({ kind: "point", role: "center", sourcePointId }),
    )
    expect(externalSketchGeometryCandidates(document, target, labels)).toContainEqual(
      expect.objectContaining({ sourceEntityId: circleId, projectedType: "circle" }),
    )
  })

  it("keeps a referenced sketch eligible as the next source in an ordered chain", () => {
    const first = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Layout",
      plane: "xy",
      entities: [{ schemaVersion: 0, id: sourcePointId, type: "point", x: 4, y: 2 }],
      constraints: [],
    })
    const secondPointId = "0195b5ac-b220-7a2c-8c33-000000004011"
    const secondEndPointId = "0195b5ac-b220-7a2c-8c33-000000004012"
    const secondLineId = "0195b5ac-b220-7a2c-8c33-000000004013"
    const second = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004014",
      label: "Driven layout",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: secondPointId, type: "point", x: 4, y: 2 },
        { schemaVersion: 0, id: secondEndPointId, type: "point", x: 12, y: 2 },
        {
          schemaVersion: 0,
          id: secondLineId,
          type: "line",
          startPointId: secondPointId,
          endPointId: secondEndPointId,
        },
      ],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000004015",
          sourceSketchId: first.id,
          sourcePointId,
          projectedPointId: "0195b5ac-b220-7a2c-8c33-000000004016",
        },
      ],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Detail",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004017",
      revision: 1,
      name: "Chained reference candidates",
      sketches: [first, second, target],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })

    expect(externalSketchGeometryCandidates(document, target, labels)).toContainEqual(
      expect.objectContaining({
        kind: "line",
        sourceSketchId: second.id,
        sourceLineId: secondLineId,
      }),
    )
  })

  it("offers a solved projected line owned by an intermediate sketch", () => {
    const sourceEndPointId = "0195b5ac-b220-7a2c-8c33-000000004018"
    const sourceLineId = "0195b5ac-b220-7a2c-8c33-000000004019"
    const projectedStartPointId = "0195b5ac-b220-7a2c-8c33-000000004020"
    const projectedEndPointId = "0195b5ac-b220-7a2c-8c33-000000004021"
    const projectedLineId = "0195b5ac-b220-7a2c-8c33-000000004022"
    const source = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sourceSketchId,
      label: "Master",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: sourcePointId, type: "point", x: 4, y: 3 },
        { schemaVersion: 0, id: sourceEndPointId, type: "point", x: 14, y: 3 },
        {
          schemaVersion: 0,
          id: sourceLineId,
          type: "line",
          startPointId: sourcePointId,
          endPointId: sourceEndPointId,
        },
      ],
      constraints: [],
    })
    const intermediate = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004023",
      label: "Layout",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-000000004024",
          kind: "line",
          sourceSketchId: source.id,
          sourceLineId,
          projectedStartPointId,
          projectedEndPointId,
          projectedLineId,
        },
      ],
    })
    const target = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: targetSketchId,
      label: "Detail",
      plane: "xy",
      entities: [],
      constraints: [],
    })
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000004025",
      revision: 1,
      name: "Projected chain candidates",
      sketches: [source, intermediate, target],
      features: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    const solvedIntermediate = {
      points: [
        { entityId: projectedStartPointId, x: 4, y: 3 },
        { entityId: projectedEndPointId, x: 14, y: 3 },
      ],
      circles: [],
    } as unknown as SolvedSketchWire

    expect(externalSketchGeometryCandidates(document, target, labels)).not.toContainEqual(
      expect.objectContaining({ sourceSketchId: intermediate.id, sourceLineId: projectedLineId }),
    )
    expect(
      externalSketchGeometryCandidates(
        document,
        target,
        labels,
        document.features,
        new Map([[intermediate.id, solvedIntermediate]]),
      ),
    ).toContainEqual({
      construction: true,
      kind: "line",
      label: "Layout · Line 1",
      sourceEndPointId: projectedEndPointId,
      sourceLineId: projectedLineId,
      sourceSketchId: intermediate.id,
      sourceStartPointId: projectedStartPointId,
      start: { world: [4, 3, 0], x: 4, y: 3 },
      end: { world: [14, 3, 0], x: 14, y: 3 },
    })
  })
})
