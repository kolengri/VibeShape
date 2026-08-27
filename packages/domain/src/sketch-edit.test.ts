import { describe, expect, it } from "vitest"
import type {
  SketchConstraintId,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchId,
} from "./identifiers"
import { type SketchEntity, sketchRecordSchema } from "./sketch"
import {
  appendSketchAlignedRectangle,
  appendSketchArc,
  appendSketchCenteredAlignedRectangle,
  appendSketchCenteredSlot,
  appendSketchCenterRectangle,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchEllipse,
  appendSketchEllipticalArc,
  appendSketchLine,
  appendSketchMidpointLine,
  appendSketchPoint,
  appendSketchRectangle,
  appendSketchRegularPolygon,
  appendSketchStraightSlot,
  appendSketchTangentArc,
  appendSketchThreePointArc,
  appendSketchThreePointCircle,
  createEmptySketch,
  extendSketchLine,
  MAX_REGULAR_POLYGON_SIDES,
  MIN_REGULAR_POLYGON_SIDES,
  moveSketchPoint,
  regularPolygonGeometry,
  removeSketchConstraints,
  removeSketchEntities,
  removeSketchExternalReference,
  replaceSketchExternalReference,
  replaceSketchSupport,
  setSketchDimensionValue,
  setSketchEntityConstruction,
  sketchEllipticalArcGeometry,
  sketchEllipticalArcStartGeometry,
  sketchLineIntersection,
  splitSketchLine,
  tangentArcGeometry,
  trimSketchLine,
} from "./sketch-edit"
import type { EdgeTopoRef, PlanarFaceTopoRef, TopoRef, VertexTopoRef } from "./topology"
import { topoRefSchema } from "./topology"
import { createAngleQuantity, createLengthQuantity } from "./units"

const sketchId = "018f0000-0000-7000-8000-000000000001" as SketchId
let nextEntityId = 1
let nextConstraintId = 1

function entityId() {
  const suffix = String(nextEntityId++).padStart(12, "0")
  return `018f0000-0000-7000-9000-${suffix}` as SketchEntityId
}

function constraintId() {
  const suffix = String(nextConstraintId++).padStart(12, "0")
  return `018f0000-0000-7000-a000-${suffix}` as SketchConstraintId
}

function empty() {
  nextEntityId = 1
  nextConstraintId = 1
  return createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" })
}

type TopologyReferenceFor<Kind extends TopoRef["kind"]> = Kind extends "vertex"
  ? VertexTopoRef
  : Kind extends "edge"
    ? EdgeTopoRef
    : PlanarFaceTopoRef

function topologyReference<Kind extends TopoRef["kind"]>(
  kind: Kind,
  featureId: string,
  geometryClass = kind === "vertex" ? "POINT" : kind === "edge" ? "LINE" : "PLANE",
): TopologyReferenceFor<Kind> {
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind,
    semanticRole: "repair-target",
    lineageToken: "lineage-1",
    signature: {
      kind,
      geometryClass,
      measure: 0,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    },
    intent: { nearPoint: [0, 0, 0] },
  }) as TopologyReferenceFor<Kind>
}

function topologyReferenceWithRole<Reference extends TopoRef>(
  reference: Reference,
  semanticRole: string,
): Reference {
  return topoRefSchema.parse({ ...reference, semanticRole }) as Reference
}

describe("sketch editing", () => {
  it("replaces an origin-plane sketch support with a validated feature face", () => {
    const sketch = createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" })
    const reference = topologyReference("face", "0195b5ac-b220-7a2c-8c33-67a36a7f3301")

    const result = replaceSketchSupport(sketch, {
      kind: "feature-face",
      plane: "xy",
      support: { kind: "feature-face", reference },
    })

    expect(result).toMatchObject({ plane: "xy", support: { kind: "feature-face", reference } })
  })

  it("replaces a feature-face support with an origin plane and removes stale support", () => {
    const reference = topologyReference("face", "0195b5ac-b220-7a2c-8c33-67a36a7f3301")
    const sketch = createEmptySketch({
      id: sketchId,
      label: "Profile",
      plane: "xy",
      support: { kind: "feature-face", reference },
    })

    const result = replaceSketchSupport(sketch, { kind: "origin-plane", plane: "xz" })

    expect(result.plane).toBe("xz")
    expect("support" in result).toBe(false)
  })

  it("preserves sketch and authored entity, constraint, and external-reference identities", () => {
    const reference = topologyReference("face", "0195b5ac-b220-7a2c-8c33-67a36a7f3301")
    const initial = appendSketchPoint(empty(), {
      createEntityId: entityId,
      point: { x: 3, y: 4 },
    }).sketch
    const point = initial.entities[0]
    if (point?.type !== "point") throw new Error("The identity fixture requires a point.")
    const withReference = sketchRecordSchema.parse({
      ...initial,
      constraints: [{ schemaVersion: 0, id: constraintId(), type: "fixed", pointId: point.id }],
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-b000-000000000001" as SketchExternalReferenceId,
          kind: "model-point",
          reference: topologyReference("vertex", "0195b5ac-b220-7a2c-8c33-67a36a7f3302"),
          projectedPointId: "018f0000-0000-7000-9000-000000000002" as SketchEntityId,
        },
      ],
      support: { kind: "feature-face", reference },
    })

    const result = replaceSketchSupport(withReference, { kind: "origin-plane", plane: "yz" })

    expect(result.id).toBe(withReference.id)
    expect(result.entities).toEqual(withReference.entities)
    expect(result.constraints).toEqual(withReference.constraints)
    expect(result.externalReferences).toEqual(withReference.externalReferences)
  })

  it("fails closed when the replacement support is invalid", () => {
    expect(() =>
      replaceSketchSupport(empty(), {
        kind: "feature-face",
        plane: "xy",
        support: {
          kind: "feature-face",
          reference: topologyReference("edge", "0195b5ac-b220-7a2c-8c33-67a36a7f3301"),
        },
      } as never),
    ).toThrow()
  })

  it("appends a standalone analytical point", () => {
    const result = appendSketchPoint(empty(), {
      construction: true,
      createEntityId: entityId,
      point: { x: 3, y: -4 },
    })

    expect(result.createdEntityIds).toHaveLength(1)
    expect(result.sketch.entities).toEqual([
      expect.objectContaining({ type: "point", x: 3, y: -4, construction: true }),
    ])
  })

  it("creates an empty sketch and appends connected lines through existing point targets", () => {
    const first = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 20, y: 0 } },
    })
    const endPointId = first.sketch.entities.find((entity) => entity.type === "line")?.endPointId
    expect(endPointId).toBeDefined()
    if (!endPointId) return

    const second = appendSketchLine(first.sketch, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: endPointId },
      end: { kind: "new", point: { x: 20, y: 10 } },
    })

    expect(second.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(3)
    expect(second.sketch.entities.filter(({ type }) => type === "line")).toHaveLength(2)
    expect(second.sketch.entities.at(-1)).toMatchObject({ type: "line", startPointId: endPointId })
  })

  it("computes stable infinite-line intersection parameters", () => {
    expect(
      sketchLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: -3 }, { x: 4, y: 3 }),
    ).toEqual({ firstParameter: 0.4, secondParameter: 0.5, point: { x: 4, y: 0 } })
    expect(
      sketchLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 2 }, { x: 10, y: 2 }),
    ).toBeNull()
  })

  it("splits a line while preserving its identity and collinear intent", () => {
    const initial = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const original = initial.sketch.entities.find((entity) => entity.type === "line")
    if (!original) throw new Error("The split fixture requires one line.")

    const result = splitSketchLine(initial.sketch, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      lineId: original.id,
      point: { x: 4, y: 2 },
    })
    const lines = result.sketch.entities.filter((entity) => entity.type === "line")
    const splitPoint = result.sketch.entities.find(
      (entity) => entity.type === "point" && entity.x === 4 && entity.y === 0,
    )

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ id: original.id, endPointId: splitPoint?.id })
    expect(lines[1]).toMatchObject({
      startPointId: splitPoint?.id,
      endPointId: original.endPointId,
    })
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({
        type: "parallel",
        firstEntityId: original.id,
        secondEntityId: lines[1]?.id,
      }),
    ])
    expect(() =>
      splitSketchLine(initial.sketch, {
        createConstraintId: constraintId,
        createEntityId: entityId,
        lineId: original.id,
        point: { x: 0, y: 0 },
      }),
    ).toThrow("inside")
  })

  it("trims the selected bounded line segment between two intersections", () => {
    const targetResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const firstBoundaryResult = appendSketchLine(targetResult.sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 3, y: -4 } },
      end: { kind: "new", point: { x: 3, y: 4 } },
    })
    const fixture = appendSketchLine(firstBoundaryResult.sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 7, y: -4 } },
      end: { kind: "new", point: { x: 7, y: 4 } },
    })
    const linesBefore = fixture.sketch.entities.filter((entity) => entity.type === "line")
    const target = linesBefore[0]
    if (!target) throw new Error("The trim fixture requires a target line.")

    const result = trimSketchLine(fixture.sketch, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      lineId: target.id,
      point: { x: 5, y: 0 },
    })
    const lines = result.sketch.entities.filter((entity) => entity.type === "line")
    const horizontalSegments = lines.filter(
      ({ id }) => !linesBefore.some(({ id: old }) => old === id) || id === target.id,
    )
    const points = new Map(
      result.sketch.entities
        .filter(
          (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
        )
        .map((point) => [point.id, point]),
    )

    expect(lines).toHaveLength(4)
    expect(horizontalSegments).toHaveLength(2)
    expect(points.get(horizontalSegments[0]?.endPointId as SketchEntityId)).toMatchObject({
      x: 3,
      y: 0,
    })
    expect(points.get(horizontalSegments[1]?.startPointId as SketchEntityId)).toMatchObject({
      x: 7,
      y: 0,
    })
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-line")).toHaveLength(3)
    expect(result.sketch.constraints.filter(({ type }) => type === "parallel")).toHaveLength(1)
  })

  it("extends the selected line endpoint to the nearest bounded line", () => {
    const targetResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 5, y: 0 } },
    })
    const fixture = appendSketchLine(targetResult.sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 10, y: -4 } },
      end: { kind: "new", point: { x: 10, y: 4 } },
    })
    const target = fixture.sketch.entities.find((entity) => entity.type === "line")
    if (!target) throw new Error("The extend fixture requires a target line.")

    const constrainedFixture = appendSketchConstraint(
      fixture.sketch,
      { type: "fixed", pointId: target.endPointId },
      constraintId,
    )
    const result = extendSketchLine(constrainedFixture, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      lineId: target.id,
      point: { x: 4.5, y: 0 },
    })
    const extended = result.sketch.entities.find(({ id }) => id === target.id)
    const endPoint =
      extended?.type === "line"
        ? result.sketch.entities.find(({ id }) => id === extended.endPointId)
        : null

    expect(extended).toMatchObject({ type: "line", id: target.id })
    expect(endPoint).toMatchObject({ type: "point", x: 10, y: 0 })
    expect(result.sketch.entities.some(({ id }) => id === target.endPointId)).toBe(false)
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({ type: "point-on-line", pointId: endPoint?.id }),
    ])
  })

  it("adds a line symmetrically from its midpoint with persistent design intent", () => {
    const result = appendSketchMidpointLine(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      midpoint: { kind: "new", point: { x: 3, y: -2 } },
      endpoint: { kind: "new", point: { x: 8, y: 1 } },
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )
    const line = result.sketch.entities.find((entity) => entity.type === "line")

    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 3, y: -2, construction: true }),
        expect.objectContaining({ x: 8, y: 1 }),
        expect.objectContaining({ x: -2, y: -5 }),
      ]),
    )
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({
        type: "midpoint",
        pointId: points.find(({ x, y }) => x === 3 && y === -2)?.id,
        lineId: line?.id,
      }),
    ])
  })

  it("adds a rectangle with shared corners and automatic horizontal and vertical constraints", () => {
    const result = appendSketchRectangle(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      firstCorner: { x: -5, y: -3 },
      oppositeCorner: { x: 5, y: 3 },
    })

    expect(result.sketch.entities).toHaveLength(8)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
    ])
  })

  it("adds a center rectangle with persistent symmetric construction intent", () => {
    const result = appendSketchCenterRectangle(empty(), {
      center: { kind: "new", point: { x: 2, y: -1 } },
      corner: { x: 7, y: 2 },
      createConstraintId: constraintId,
      createEntityId: entityId,
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )
    const lines = result.sketch.entities.filter(({ type }) => type === "line")

    expect(points).toHaveLength(5)
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 2, y: -1, construction: true }),
        expect.objectContaining({ x: -3, y: -4 }),
        expect.objectContaining({ x: 7, y: 2 }),
      ]),
    )
    expect(lines.filter(({ construction }) => construction)).toHaveLength(4)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
      "parallel",
      "equal",
    ])
  })

  it("adds an aligned rectangle with perpendicular and parallel design intent", () => {
    const result = appendSketchAlignedRectangle(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      firstSideStart: { kind: "new", point: { x: 0, y: 0 } },
      firstSideEnd: { kind: "new", point: { x: 10, y: 10 } },
      widthPoint: { x: 5, y: 15 },
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )

    expect(points).toHaveLength(4)
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[1]).toMatchObject({ x: 10, y: 10 })
    expect(points[2]?.x).toBeCloseTo(5)
    expect(points[2]?.y).toBeCloseTo(15)
    expect(points[3]?.x).toBeCloseTo(-5)
    expect(points[3]?.y).toBeCloseTo(5)
    expect(result.sketch.entities.filter(({ type }) => type === "line")).toHaveLength(4)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "perpendicular",
      "parallel",
      "parallel",
    ])
  })

  it("rejects a degenerate aligned rectangle width", () => {
    expect(() =>
      appendSketchAlignedRectangle(empty(), {
        createConstraintId: constraintId,
        createEntityId: entityId,
        firstSideStart: { kind: "new", point: { x: 0, y: 0 } },
        firstSideEnd: { kind: "new", point: { x: 10, y: 10 } },
        widthPoint: { x: 5, y: 5 },
      }),
    ).toThrow("perpendicular width")
  })

  it("adds a centered aligned rectangle with a persistent center axis", () => {
    const result = appendSketchCenteredAlignedRectangle(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createConstraintId: constraintId,
      createEntityId: entityId,
      sidePoint: { kind: "new", point: { x: 10, y: 0 } },
      widthPoint: { x: 0, y: 4 },
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )
    const lines = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line",
    )

    expect(points).toHaveLength(7)
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 0, y: 0, construction: true }),
        expect.objectContaining({ x: 10, y: 0, construction: true }),
        expect.objectContaining({ x: -10, y: 0, construction: true }),
        expect.objectContaining({ x: -10, y: -4, construction: false }),
        expect.objectContaining({ x: 10, y: 4, construction: false }),
      ]),
    )
    expect(lines).toHaveLength(5)
    expect(lines.filter(({ construction }) => construction)).toHaveLength(1)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "perpendicular",
      "parallel",
      "parallel",
      "midpoint",
      "midpoint",
      "midpoint",
    ])
  })

  it("rejects a degenerate centered aligned rectangle", () => {
    expect(() =>
      appendSketchCenteredAlignedRectangle(empty(), {
        center: { kind: "new", point: { x: 0, y: 0 } },
        createConstraintId: constraintId,
        createEntityId: entityId,
        sidePoint: { kind: "new", point: { x: 10, y: 0 } },
        widthPoint: { x: 5, y: 0 },
      }),
    ).toThrow("perpendicular width")
  })

  it("adds a straight slot with an exact construction centerline and tangent end caps", () => {
    const result = appendSketchStraightSlot(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      endCenter: { kind: "new", point: { x: 20, y: 0 } },
      startCenter: { kind: "new", point: { x: 0, y: 0 } },
      widthPoint: { x: 5, y: 3 },
    })
    const points = result.sketch.entities.filter(({ type }) => type === "point")
    const lines = result.sketch.entities.filter(({ type }) => type === "line")
    const arcs = result.sketch.entities.filter(({ type }) => type === "arc")

    expect(points).toHaveLength(6)
    expect(lines).toHaveLength(3)
    expect(lines.filter(({ construction }) => construction)).toHaveLength(1)
    expect(arcs).toHaveLength(2)
    expect(arcs.every(({ construction }) => !construction)).toBe(true)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual(["parallel"])
  })

  it("adds a centered slot with a midpoint-constrained symmetric centerline", () => {
    const result = appendSketchCenteredSlot(empty(), {
      center: { kind: "new", point: { x: 2, y: -1 } },
      createConstraintId: constraintId,
      createEntityId: entityId,
      endCenter: { kind: "new", point: { x: 12, y: 4 } },
      widthPoint: { x: 5, y: 7 },
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )

    expect(points).toHaveLength(7)
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 2, y: -1, construction: true }),
        expect.objectContaining({ x: 12, y: 4, construction: true }),
        expect.objectContaining({ x: -8, y: -6, construction: true }),
      ]),
    )
    expect(result.sketch.entities.filter(({ type }) => type === "line")).toHaveLength(3)
    expect(result.sketch.entities.filter(({ type }) => type === "arc")).toHaveLength(2)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual(["midpoint", "parallel"])
  })

  it("reuses an inferred center point without duplicating its identity", () => {
    const withCenter = appendSketchPoint(empty(), {
      createEntityId: entityId,
      point: { x: 0, y: 0 },
    })
    const centerId = withCenter.createdEntityIds[0]
    expect(centerId).toBeDefined()
    if (!centerId) return

    const result = appendSketchCenterRectangle(withCenter.sketch, {
      center: { kind: "existing", pointId: centerId },
      corner: { x: 5, y: 3 },
      createConstraintId: constraintId,
      createEntityId: entityId,
    })

    expect(result.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(5)
    expect(result.sketch.entities.filter(({ id }) => id === centerId)).toHaveLength(1)
  })

  it("adds circles and projects arc endpoints onto the authored radius", () => {
    const circle = appendSketchCircle(empty(), {
      center: { kind: "new", point: { x: 2, y: 2 } },
      createEntityId: entityId,
      perimeterPoint: { x: 7, y: 2 },
    })
    expect(circle.sketch.entities.at(-1)).toMatchObject({ type: "circle", radius: 5 })

    const arc = appendSketchArc(circle.sketch, {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 10, y: 0 },
      end: { x: 0, y: 3 },
    })
    const end = arc.sketch.entities.at(-2)
    expect(end).toMatchObject({ type: "point", x: 0, y: 10 })
  })

  it("adds an exact ellipse from center, primary radius, and projected secondary radius", () => {
    const result = appendSketchEllipse(empty(), {
      center: { kind: "new", point: { x: 2, y: 3 } },
      createEntityId: entityId,
      primaryAxisPoint: { kind: "new", point: { x: 8, y: 3 } },
      secondaryRadiusPoint: { x: 5, y: -1 },
    })
    const ellipse = result.sketch.entities.find((entity) => entity.type === "ellipse")
    if (!ellipse) throw new Error("The ellipse fixture requires an ellipse entity.")
    const secondary = result.sketch.entities.find(
      (entity) => entity.id === ellipse.secondaryAxisPointId,
    )

    expect(result.createdEntityIds).toHaveLength(4)
    expect(ellipse).toMatchObject({
      type: "ellipse",
      centerPointId: result.createdEntityIds[0],
      primaryAxisPointId: result.createdEntityIds[1],
      secondaryAxisPointId: result.createdEntityIds[2],
    })
    expect(secondary).toMatchObject({ type: "point", x: 2, y: -1 })
  })

  it("derives and appends an exact center-origin elliptical arc", () => {
    const startGeometry = sketchEllipticalArcStartGeometry(
      { x: 2, y: 3 },
      { x: 8, y: 3 },
      { x: 5, y: -1 },
    )
    if (!startGeometry) throw new Error("The elliptical-arc start fixture must be valid.")
    const geometry = sketchEllipticalArcGeometry(
      startGeometry.center,
      startGeometry.primaryAxisPoint,
      startGeometry.secondaryAxisPoint,
      startGeometry.startPoint,
      { x: 2, y: 7 },
    )
    if (!geometry) throw new Error("The elliptical-arc fixture must be valid.")

    expect(startGeometry.primaryRadius).toBe(6)
    expect(startGeometry.secondaryRadius).toBeCloseTo(4.6188021535)
    expect(startGeometry.startPoint.x).toBeCloseTo(5)
    expect(startGeometry.startPoint.y).toBeCloseTo(-1)
    expect(geometry.endPoint.x).toBeCloseTo(2)
    expect(geometry.endPoint.y).toBeCloseTo(7.6188021535)
    expect(geometry.sweep).toBeGreaterThan(0)

    const result = appendSketchEllipticalArc(empty(), {
      center: { kind: "new", point: geometry.center },
      createEntityId: entityId,
      endPoint: { kind: "new", point: geometry.endPoint },
      primaryAxisPoint: { kind: "new", point: geometry.primaryAxisPoint },
      secondaryAxisPoint: geometry.secondaryAxisPoint,
      startPoint: { kind: "new", point: geometry.startPoint },
    })
    const arc = result.sketch.entities.find((entity) => entity.type === "elliptical-arc")
    if (!arc) throw new Error("The sketch must contain the appended elliptical arc.")

    expect(result.createdEntityIds).toHaveLength(6)
    expect(arc).toMatchObject({
      centerPointId: result.createdEntityIds[0],
      primaryAxisPointId: result.createdEntityIds[1],
      secondaryAxisPointId: result.createdEntityIds[2],
      startPointId: result.createdEntityIds[3],
      endPointId: result.createdEntityIds[4],
    })
  })

  it("reuses an elliptical-arc quadrant axis point and rejects a full sweep", () => {
    const result = appendSketchEllipticalArc(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      endPoint: { kind: "new", point: { x: 0, y: 4 } },
      primaryAxisPoint: { kind: "new", point: { x: 6, y: 0 } },
      secondaryAxisPoint: { x: 0, y: 4 },
      startPoint: { kind: "new", point: { x: 6, y: 0 } },
    })
    const arc = result.sketch.entities.find((entity) => entity.type === "elliptical-arc")
    if (!arc) throw new Error("The quadrant fixture must contain an elliptical arc.")
    expect(arc.startPointId).toBe(arc.primaryAxisPointId)
    expect(arc.endPointId).toBe(arc.secondaryAxisPointId)
    expect(result.createdEntityIds).toHaveLength(4)

    expect(() =>
      appendSketchEllipticalArc(empty(), {
        center: { kind: "new", point: { x: 0, y: 0 } },
        createEntityId: entityId,
        endPoint: { kind: "new", point: { x: 6, y: 0 } },
        primaryAxisPoint: { kind: "new", point: { x: 6, y: 0 } },
        secondaryAxisPoint: { x: 0, y: 4 },
        startPoint: { kind: "new", point: { x: 6, y: 0 } },
      }),
    ).toThrow("distinct endpoints")
  })

  it("constructs Onshape-compatible regular polygon geometry from a center and radius", () => {
    const circumscribed = regularPolygonGeometry(
      { x: 2, y: -1 },
      { x: 12, y: -1 },
      4,
      "circumscribed",
    )
    const inscribed = regularPolygonGeometry({ x: 2, y: -1 }, { x: 12, y: -1 }, 4, "inscribed")
    if (!circumscribed || !inscribed) {
      throw new Error("The regular polygon fixtures require a positive radius.")
    }

    expect(circumscribed.constructionRadius).toBe(10)
    expect(circumscribed.tangentPoints).toHaveLength(0)
    expect(circumscribed.vertices).toHaveLength(4)
    expect(circumscribed.vertices[0]).toMatchObject({ x: 12, y: -1 })
    expect(circumscribed.vertices[1]?.x).toBeCloseTo(2)
    expect(circumscribed.vertices[1]?.y).toBeCloseTo(9)
    expect(inscribed.constructionRadius).toBe(10)
    expect(inscribed.tangentPoints).toHaveLength(4)
    expect(inscribed.tangentPoints[0]).toMatchObject({ x: 12, y: -1 })
    expect(inscribed.vertices).toHaveLength(4)
    expect(inscribed.vertices[0]?.x).toBeCloseTo(12)
    expect(inscribed.vertices[0]?.y).toBeCloseTo(-11)
    expect(inscribed.vertices[1]?.x).toBeCloseTo(12)
    expect(inscribed.vertices[1]?.y).toBeCloseTo(9)
  })

  it("rejects invalid regular polygon side counts and radii", () => {
    const center = { x: 0, y: 0 }
    const radiusPoint = { x: 10, y: 0 }

    expect(() =>
      regularPolygonGeometry(center, radiusPoint, MIN_REGULAR_POLYGON_SIDES - 1, "inscribed"),
    ).toThrow("integer side count")
    expect(() =>
      regularPolygonGeometry(center, radiusPoint, MAX_REGULAR_POLYGON_SIDES + 1, "circumscribed"),
    ).toThrow("integer side count")
    expect(() => regularPolygonGeometry(center, radiusPoint, 4.5, "inscribed")).toThrow(
      "integer side count",
    )
    expect(regularPolygonGeometry(center, center, 6, "circumscribed")).toBeNull()
    expect(
      regularPolygonGeometry(center, { x: Number.POSITIVE_INFINITY, y: 0 }, 6, "inscribed"),
    ).toBeNull()
  })

  it("adds a circumscribed polygon inside its construction circle with equal chords", () => {
    const result = appendSketchRegularPolygon(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createConstraintId: constraintId,
      createEntityId: entityId,
      mode: "circumscribed",
      radiusPoint: { kind: "new", point: { x: 10, y: 0 } },
      sideCount: 6,
    })
    const points = result.sketch.entities.filter(({ type }) => type === "point")
    const lines = result.sketch.entities.filter(({ type }) => type === "line")
    const circles = result.sketch.entities.filter(({ type }) => type === "circle")

    expect(result.sketch.entities).toHaveLength(14)
    expect(points).toHaveLength(7)
    expect(lines).toHaveLength(6)
    expect(lines.every(({ construction }) => !construction)).toBe(true)
    expect(circles).toEqual([
      expect.objectContaining({ construction: true, radius: 10, type: "circle" }),
    ])
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-curve")).toHaveLength(
      6,
    )
    expect(result.sketch.constraints.filter(({ type }) => type === "equal")).toHaveLength(5)
  })

  it("adds an inscribed polygon around its tangent circle with exact midpoint intent", () => {
    const result = appendSketchRegularPolygon(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createConstraintId: constraintId,
      createEntityId: entityId,
      mode: "inscribed",
      radiusPoint: { kind: "new", point: { x: 10, y: 0 } },
      sideCount: 4,
    })
    const points = result.sketch.entities.filter(({ type }) => type === "point")
    const lines = result.sketch.entities.filter(({ type }) => type === "line")
    const circle = result.sketch.entities.find(({ type }) => type === "circle")

    expect(result.sketch.entities).toHaveLength(14)
    expect(points).toHaveLength(9)
    expect(points.filter(({ construction }) => construction)).toHaveLength(5)
    expect(lines).toHaveLength(4)
    expect(lines.filter(({ construction }) => construction)).toHaveLength(0)
    expect(circle).toMatchObject({ construction: true, radius: 10, type: "circle" })
    expect(result.sketch.constraints.filter(({ type }) => type === "midpoint")).toHaveLength(4)
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-curve")).toHaveLength(
      3,
    )
    expect(result.sketch.constraints.filter(({ type }) => type === "equal")).toHaveLength(3)
  })

  it("adds an arc tangent to a shared line endpoint", () => {
    const lineResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const line = lineResult.sketch.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The line fixture must create a line.")
    const result = appendSketchTangentArc(lineResult.sketch, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      end: { kind: "new", point: { x: 20, y: 10 } },
      lineId: line.id,
      startPointId: line.endPointId,
    })
    const arc = result.sketch.entities.find((entity) => entity.type === "arc")
    const center = result.sketch.entities.find(
      (entity): entity is Extract<SketchEntity, { type: "point" }> =>
        entity.id === arc?.centerPointId && entity.type === "point",
    )

    expect(center).toMatchObject({ type: "point", construction: true })
    expect(center?.x).toBeCloseTo(10)
    expect(center?.y).toBeCloseTo(10)
    expect(arc).toMatchObject({ startPointId: line.endPointId })
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({ type: "tangent", arcId: arc?.id, lineId: line.id }),
    ])
  })

  it("orients a tangent arc below the reference line without creating a major sweep", () => {
    const geometry = tangentArcGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -10 })
    expect(geometry?.center.x).toBeCloseTo(10)
    expect(geometry?.center.y).toBeCloseTo(-10)
    expect(geometry?.sharedEndpoint).toBe("end")
  })

  it("adds a circle through three points and preserves each circumference relation", () => {
    const result = appendSketchThreePointCircle(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      firstPoint: { kind: "new", point: { x: -10, y: 0 } },
      secondPoint: { kind: "new", point: { x: 0, y: 10 } },
      thirdPoint: { kind: "new", point: { x: 10, y: 0 } },
    })
    const circle = result.sketch.entities.find((entity) => entity.type === "circle")
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )

    expect(circle).toMatchObject({ radius: 10 })
    expect(points).toHaveLength(4)
    const center = points.find(({ id }) => id === circle?.centerPointId)
    expect(center?.x).toBeCloseTo(0)
    expect(center?.y).toBeCloseTo(0)
    expect(result.sketch.constraints).toHaveLength(3)
    expect(result.sketch.constraints).toEqual(
      points
        .filter(({ x, y }) => x !== 0 || y !== 0)
        .map(({ id }) =>
          expect.objectContaining({ type: "point-on-curve", pointId: id, curveId: circle?.id }),
        ),
    )
  })

  it("rejects repeated or collinear three-point circle positions", () => {
    expect(() =>
      appendSketchThreePointCircle(empty(), {
        createConstraintId: constraintId,
        createEntityId: entityId,
        firstPoint: { kind: "new", point: { x: 0, y: 0 } },
        secondPoint: { kind: "new", point: { x: 5, y: 0 } },
        thirdPoint: { kind: "new", point: { x: 10, y: 0 } },
      }),
    ).toThrow("non-collinear")
  })

  it("creates a three-point arc whose positive sweep passes through the third pick", () => {
    const result = appendSketchThreePointArc(empty(), {
      createEntityId: entityId,
      firstEndpoint: { kind: "new", point: { x: -10, y: 0 } },
      secondEndpoint: { kind: "new", point: { x: 10, y: 0 } },
      pointOnArc: { x: 0, y: 5 },
    })
    const points = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
    )
    const arc = result.sketch.entities.find(({ type }) => type === "arc")

    expect(points).toHaveLength(3)
    expect(points).toEqual(expect.arrayContaining([expect.objectContaining({ x: 0, y: -7.5 })]))
    expect(arc).toMatchObject({
      startPointId: points.find(({ x }) => x === 10)?.id,
      endPointId: points.find(({ x }) => x === -10)?.id,
    })
  })

  it("reuses inferred three-point arc endpoints and rejects collinear picks", () => {
    const first = appendSketchPoint(empty(), {
      createEntityId: entityId,
      point: { x: -10, y: 0 },
    })
    const second = appendSketchPoint(first.sketch, {
      createEntityId: entityId,
      point: { x: 10, y: 0 },
    })
    const [firstId, secondId] = second.sketch.entities.map(({ id }) => id)
    expect(firstId && secondId).toBeTruthy()
    if (!firstId || !secondId) return

    const result = appendSketchThreePointArc(second.sketch, {
      createEntityId: entityId,
      firstEndpoint: { kind: "existing", pointId: firstId },
      secondEndpoint: { kind: "existing", pointId: secondId },
      pointOnArc: { x: 0, y: -5 },
    })

    expect(result.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(3)
    expect(
      result.sketch.entities.filter(({ id }) => id === firstId || id === secondId),
    ).toHaveLength(2)
    expect(() =>
      appendSketchThreePointArc(empty(), {
        createEntityId: entityId,
        firstEndpoint: { kind: "new", point: { x: 0, y: 0 } },
        secondEndpoint: { kind: "new", point: { x: 10, y: 0 } },
        pointOnArc: { x: 5, y: 0 },
      }),
    ).toThrow("non-collinear")
  })

  it("adds validated constraints and rejects incompatible selections", () => {
    const line = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 5 } },
    }).sketch
    const lineId = line.entities.find((entity) => entity.type === "line")?.id
    expect(lineId).toBeDefined()
    if (!lineId) return

    const constrained = appendSketchConstraint(line, { type: "horizontal", lineId }, constraintId)
    expect(constrained.constraints).toHaveLength(1)
    expect(appendSketchConstraint(constrained, { type: "horizontal", lineId }, constraintId)).toBe(
      constrained,
    )
    expect(() =>
      appendSketchConstraint(line, { type: "fixed", pointId: lineId }, constraintId),
    ).toThrow()
  })

  it("cascades geometry and constraint removal without deleting shared points", () => {
    const first = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const firstLine = first.entities.find((entity) => entity.type === "line")
    expect(firstLine).toBeDefined()
    if (!firstLine) return
    const second = appendSketchLine(first, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: firstLine.endPointId },
      end: { kind: "new", point: { x: 10, y: 10 } },
    }).sketch
    const constrained = appendSketchConstraint(
      second,
      { type: "horizontal", lineId: firstLine.id },
      constraintId,
    )

    const removed = removeSketchEntities(constrained, [firstLine.id])

    expect(removed.entities.filter(({ type }) => type === "line")).toHaveLength(1)
    expect(removed.entities.some(({ id }) => id === firstLine.endPointId)).toBe(true)
    expect(removed.constraints).toEqual([])
  })

  it("moves points, toggles construction state, and removes constraints independently", () => {
    const line = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const point = line.entities.find((entity) => entity.type === "point")
    const segment = line.entities.find((entity) => entity.type === "line")
    expect(point && segment).toBeTruthy()
    if (!point || !segment) return
    const moved = moveSketchPoint(line, point.id, { x: -2, y: 4 })
    const construction = setSketchEntityConstruction(moved, [segment.id], true)
    const constrained = appendSketchConstraint(
      construction,
      { type: "fixed", pointId: point.id },
      constraintId,
    )

    expect(construction.entities.find(({ id }) => id === point.id)).toMatchObject({ x: -2, y: 4 })
    expect(construction.entities.find(({ id }) => id === segment.id)).toMatchObject({
      construction: true,
    })
    const constraint = constrained.constraints[0]
    expect(constraint).toBeDefined()
    if (!constraint) return
    expect(removeSketchConstraints(constrained, [constraint.id]).constraints).toEqual([])
  })

  it("removes constraints owned by a removed external line reference", () => {
    const local = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = local.entities.find((entity) => entity.type === "line")
    if (!line) return
    const referenceId = "018f0000-0000-7000-8000-000000000501" as SketchExternalReferenceId
    const projectedLineId = "018f0000-0000-7000-8000-000000000502" as SketchEntityId
    const withReference = sketchRecordSchema.parse({
      ...local,
      externalReferences: [
        {
          schemaVersion: 0,
          id: referenceId,
          kind: "line",
          sourceSketchId: "018f0000-0000-7000-8000-000000000503",
          sourceLineId: "018f0000-0000-7000-8000-000000000504",
          projectedLineId,
          projectedStartPointId: "018f0000-0000-7000-8000-000000000505",
          projectedEndPointId: "018f0000-0000-7000-8000-000000000506",
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000507",
          type: "parallel",
          firstEntityId: line.id,
          secondEntityId: projectedLineId,
        },
      ],
    })

    const removed = removeSketchExternalReference(withReference, referenceId)

    expect(removed.externalReferences).toEqual([])
    expect(removed.constraints).toEqual([])
  })

  it("replaces a model reference topology while preserving its identity and metadata", () => {
    const local = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = local.entities.find((entity) => entity.type === "line")
    if (!line) throw new Error("The repair fixture requires a line.")

    const references = [
      {
        schemaVersion: 0 as const,
        id: "018f0000-0000-7000-8000-000000000601" as SketchExternalReferenceId,
        kind: "model-point" as const,
        reference: topologyReference("vertex", "018f0000-0000-7000-8000-000000000611"),
        projectedPointId: "018f0000-0000-7000-8000-000000000621" as SketchEntityId,
      },
      {
        schemaVersion: 0 as const,
        id: "018f0000-0000-7000-8000-000000000602" as SketchExternalReferenceId,
        kind: "model-line" as const,
        reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000612"),
        projectedLineId: "018f0000-0000-7000-8000-000000000622" as SketchEntityId,
        projectedStartPointId: "018f0000-0000-7000-8000-000000000623" as SketchEntityId,
        projectedEndPointId: "018f0000-0000-7000-8000-000000000624" as SketchEntityId,
      },
      {
        schemaVersion: 0 as const,
        id: "018f0000-0000-7000-8000-000000000603" as SketchExternalReferenceId,
        kind: "model-curve" as const,
        reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000613"),
        sourceType: "circle" as const,
        projectedEntityId: "018f0000-0000-7000-8000-000000000625" as SketchEntityId,
        projectedType: "circle" as const,
        projectedPointIds: ["018f0000-0000-7000-8000-000000000626"] as SketchEntityId[],
      },
      {
        schemaVersion: 0 as const,
        id: "018f0000-0000-7000-8000-000000000604" as SketchExternalReferenceId,
        kind: "model-intersection" as const,
        reference: topologyReference("face", "018f0000-0000-7000-8000-000000000614"),
        projectedLineId: "018f0000-0000-7000-8000-000000000627" as SketchEntityId,
        projectedStartPointId: "018f0000-0000-7000-8000-000000000628" as SketchEntityId,
        projectedEndPointId: "018f0000-0000-7000-8000-000000000629" as SketchEntityId,
      },
    ]
    const withReferences = sketchRecordSchema.parse({
      ...local,
      externalReferences: references,
      constraints: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000630",
          type: "fixed",
          pointId: line.startPointId,
        },
      ],
    })

    for (const [index, reference] of references.entries()) {
      const replacement =
        reference.kind === "model-point"
          ? {
              kind: reference.kind,
              reference: topologyReferenceWithRole(
                topologyReference("vertex", reference.reference.featureId),
                `replacement-target-${index}`,
              ),
            }
          : reference.kind === "model-line"
            ? {
                kind: reference.kind,
                reference: topologyReferenceWithRole(
                  topologyReference("edge", reference.reference.featureId),
                  `replacement-target-${index}`,
                ),
              }
            : reference.kind === "model-curve"
              ? {
                  kind: reference.kind,
                  projectedType: reference.projectedType,
                  reference: topologyReferenceWithRole(
                    topologyReference("edge", reference.reference.featureId, "CIRCLE"),
                    `replacement-target-${index}`,
                  ),
                  sourceType: reference.sourceType,
                }
              : {
                  kind: reference.kind,
                  reference: topologyReferenceWithRole(
                    topologyReference("face", reference.reference.featureId),
                    `replacement-target-${index}`,
                  ),
                }
      const repaired = replaceSketchExternalReference(withReferences, reference.id, replacement)
      const repairedReference = repaired.externalReferences?.find(({ id }) => id === reference.id)
      expect(repairedReference).toEqual({ ...reference, reference: replacement.reference })
      expect(repaired.constraints).toEqual(withReferences.constraints)
    }
  })

  it("rejects missing, sketch-to-sketch, cross-feature, and incompatible repairs", () => {
    const sketch = sketchRecordSchema.parse({
      ...empty(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000651",
          kind: "point",
          sourceSketchId: "018f0000-0000-7000-8000-000000000652",
          sourcePointId: "018f0000-0000-7000-8000-000000000653",
          projectedPointId: "018f0000-0000-7000-8000-000000000654",
        },
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000655",
          kind: "model-point",
          reference: topologyReference("vertex", "018f0000-0000-7000-8000-000000000656"),
          projectedPointId: "018f0000-0000-7000-8000-000000000657",
        },
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000661",
          kind: "model-line",
          reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000662"),
          projectedLineId: "018f0000-0000-7000-8000-000000000663",
          projectedStartPointId: "018f0000-0000-7000-8000-000000000664",
          projectedEndPointId: "018f0000-0000-7000-8000-000000000665",
        },
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000666",
          kind: "model-curve",
          reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000667", "CIRCLE"),
          sourceType: "circle",
          projectedEntityId: "018f0000-0000-7000-8000-000000000668",
          projectedType: "circle",
          projectedPointIds: ["018f0000-0000-7000-8000-000000000669"],
        },
      ],
    })
    const modelPointId = "018f0000-0000-7000-8000-000000000655" as SketchExternalReferenceId
    const modelLineId = "018f0000-0000-7000-8000-000000000661" as SketchExternalReferenceId
    const modelCurveId = "018f0000-0000-7000-8000-000000000666" as SketchExternalReferenceId

    expect(() =>
      replaceSketchExternalReference(
        sketch,
        "018f0000-0000-7000-8000-000000000650" as SketchExternalReferenceId,
        {
          kind: "model-point",
          reference: topologyReference("vertex", "018f0000-0000-7000-8000-000000000658"),
        },
      ),
    ).toThrow("existing reference")
    expect(() =>
      replaceSketchExternalReference(
        sketch,
        "018f0000-0000-7000-8000-000000000651" as SketchExternalReferenceId,
        {
          kind: "model-point",
          reference: topologyReference("vertex", "018f0000-0000-7000-8000-000000000659"),
        },
      ),
    ).toThrow("model-backed")
    expect(() =>
      replaceSketchExternalReference(sketch, modelPointId, {
        kind: "model-line",
        reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000660"),
      }),
    ).toThrow("cannot be replaced")
    expect(() =>
      replaceSketchExternalReference(sketch, modelPointId, {
        kind: "model-point",
        reference: topologyReference("vertex", "018f0000-0000-7000-8000-000000000660"),
      }),
    ).toThrow("producing feature")
    expect(() =>
      replaceSketchExternalReference(sketch, modelLineId, {
        kind: "model-line",
        reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000662", "CIRCLE"),
      }),
    ).toThrow("requires LINE")
    expect(() =>
      replaceSketchExternalReference(sketch, modelCurveId, {
        kind: "model-curve",
        projectedType: "arc",
        reference: topologyReference("edge", "018f0000-0000-7000-8000-000000000667", "CIRCLE"),
        sourceType: "arc",
      }),
    ).toThrow("preserve its source and projected curve types")
  })

  it("updates a driving dimension while preserving its identity and references", () => {
    const sketch = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const constrained = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(10, "mm", "10 mm"),
      },
      constraintId,
    )
    const dimension = constrained.constraints[0]
    expect(dimension).toBeDefined()
    if (!dimension) return

    const updated = setSketchDimensionValue(
      constrained,
      dimension.id,
      createLengthQuantity(25, "mm", "#width"),
    )

    expect(updated.constraints[0]).toEqual({
      ...dimension,
      value: createLengthQuantity(25, "mm", "#width"),
    })
  })

  it("rejects missing, geometric, and dimensionally incompatible constraint edits", () => {
    const sketch = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const geometric = appendSketchConstraint(
      sketch,
      { type: "horizontal", lineId: line.id },
      constraintId,
    )
    const horizontal = geometric.constraints[0]
    expect(horizontal).toBeDefined()
    if (!horizontal) return
    expect(() =>
      setSketchDimensionValue(geometric, horizontal.id, createLengthQuantity(20)),
    ).toThrow("Only dimensional")

    const dimensional = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(10),
      },
      constraintId,
    )
    const distance = dimensional.constraints[0]
    expect(distance).toBeDefined()
    if (!distance) return
    expect(() =>
      setSketchDimensionValue(dimensional, distance.id, createAngleQuantity(Math.PI / 2)),
    ).toThrow()
    expect(() =>
      setSketchDimensionValue(
        dimensional,
        "018f0000-0000-7000-a000-999999999999" as SketchConstraintId,
        createLengthQuantity(20),
      ),
    ).toThrow("existing constraint")
  })
})
