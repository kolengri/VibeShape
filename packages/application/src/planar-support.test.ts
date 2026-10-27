import { describe, expect, it } from "bun:test"
import {
  createAngleQuantity,
  createLengthQuantity,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  extrusionFeatureParametersV6Schema,
  extrusionFeatureTypeV6,
  featureRecordSchema,
  filletFeatureType,
  planarFaceTopoRefSchema,
  sketchRecordSchema,
  topologyCandidateSchema,
} from "@vibeshape/domain"
import { datumPlaneFrame, type SupportFrame, sketchFrame } from "./support-frame"
import { resolvePlanarSupportReference } from "./support-health"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
type Vector = [number, number, number]
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)

function fixture(normal: Vector = [0, 1, 0], role?: string) {
  const candidate = topologyCandidateSchema.parse({
    candidateId: "current-face",
    kind: "face",
    ...(role ? { semanticRole: role } : {}),
    lineageTokens: [],
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 20,
      centroid: [3, 4, 5],
      bounds: { min: [-10, -10, -10], max: [10, 10, 10] },
      direction: normal,
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE", "CYLINDRE"],
    },
  })
  const reference = planarFaceTopoRefSchema.parse({
    schemaVersion: 0,
    featureId: id(1),
    kind: "face",
    ...(role ? { semanticRole: role } : {}),
    signature: candidate.signature,
    intent: { nearPoint: [2, 1, 4], expectedDirection: normal },
  })
  const owner = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(1),
    type: filletFeatureType.type,
    parameters: { radius: createLengthQuantity(1) },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(2),
    label: "Supported profile",
    plane: "xy",
    entities: [],
    constraints: [],
    support: { kind: "feature-face", reference },
  })
  const document = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(10),
    revision: 1,
    name: "Planar support regression",
    features: [owner],
    sketches: [sketch],
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
  })
  return {
    candidate,
    reference,
    owner,
    sketch,
    document,
    geometry: [{ featureId: owner.id, geometry: { topologyCandidates: [candidate] } }],
  }
}

function assertFrame(frame: SupportFrame | null, normal: Vector) {
  if (!frame) throw new Error("A unique oriented planar face must resolve.")
  for (const axis of [frame.xAxis, frame.yAxis, frame.normal])
    expect(Math.hypot(...axis)).toBeCloseTo(1, 12)
  expect(dot(frame.xAxis, frame.yAxis)).toBeCloseTo(0, 12)
  expect(dot(frame.xAxis, frame.normal)).toBeCloseTo(0, 12)
  expect(dot(frame.yAxis, frame.normal)).toBeCloseTo(0, 12)
  for (let i = 0; i < 3; i++) expect(frame.normal[i]).toBeCloseTo(normal[i] ?? 0, 12)
  const cross = [
    frame.xAxis[1] * frame.yAxis[2] - frame.xAxis[2] * frame.yAxis[1],
    frame.xAxis[2] * frame.yAxis[0] - frame.xAxis[0] * frame.yAxis[2],
    frame.xAxis[0] * frame.yAxis[1] - frame.xAxis[1] * frame.yAxis[0],
  ]
  for (let i = 0; i < 3; i++) expect(cross[i]).toBeCloseTo(normal[i] ?? 0, 12)
  expect(
    dot(
      frame.origin.map((v, i) => v - ([3, 4, 5][i] ?? 0)),
      normal,
    ),
  ).toBeCloseTo(0, 12)
}

describe("general current planar support frames", () => {
  it.each<Vector>([
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [2 / 3, -1 / 3, 2 / 3],
  ])("resolves a role-free face with outward normal (%j, %j, %j)", (x, y, z) => {
    const normal: Vector = [x, y, z]
    const source = fixture(normal)
    assertFrame(
      sketchFrame(source.sketch, source.document, [source.owner], new Set(), source.geometry),
      normal,
    )
  })

  it("projects the persisted anchor onto the exact plane without using its moving centroid as local origin", () => {
    const source = fixture()
    expect(
      sketchFrame(source.sketch, source.document, [source.owner], new Set(), source.geometry)
        ?.origin,
    ).toEqual([2, 4, 4])
    expect(source.sketch.support?.reference.intent?.nearPoint).toEqual([2, 1, 4])
  })

  it("keeps local axes continuous across the world-axis fallback threshold after a small support tilt", () => {
    const x = 0.89999
    const source = fixture([x, Math.sqrt(1 - x * x), 0])
    const initial = sketchFrame(
      source.sketch,
      source.document,
      [source.owner],
      new Set(),
      source.geometry,
    )
    const movedX = 0.90001
    const candidate = topologyCandidateSchema.parse({
      ...source.candidate,
      signature: {
        ...source.candidate.signature,
        direction: [movedX, Math.sqrt(1 - movedX * movedX), 0],
      },
    })
    const moved = sketchFrame(source.sketch, source.document, [source.owner], new Set(), [
      { featureId: source.owner.id, geometry: { topologyCandidates: [candidate] } },
    ])
    if (!initial || !moved)
      throw new Error("A small uniquely resolved support tilt must retain a frame.")
    expect(dot(initial.xAxis, moved.xAxis)).toBeGreaterThan(0.99999)
    expect(dot(initial.yAxis, moved.yAxis)).toBeGreaterThan(0.99999)
  })

  it("fails closed without throwing when the authored tangent becomes nearly normal to the current plane", () => {
    const source = fixture([0.3, 0.4, Math.sqrt(0.75)], "fillet.planar")
    const initial = sketchFrame(
      source.sketch,
      source.document,
      [source.owner],
      new Set(),
      source.geometry,
    )
    if (!initial) throw new Error("The authored plane must have a valid initial frame.")
    for (const epsilon of [0, 1e-10]) {
      const vector = initial.xAxis.map(
        (value, index) => value + epsilon * (initial.normal[index] ?? 0),
      )
      const magnitude = Math.hypot(...vector)
      const candidate = topologyCandidateSchema.parse({
        ...source.candidate,
        signature: {
          ...source.candidate.signature,
          direction: vector.map((value) => value / magnitude),
        },
      })
      expect(resolvePlanarSupportReference(source.reference, [candidate]).status).toBe("resolved")
      expect(
        sketchFrame(source.sketch, source.document, [source.owner], new Set(), [
          { featureId: source.owner.id, geometry: { topologyCandidates: [candidate] } },
        ]),
      ).toBeNull()
    }
  })

  it("fails closed on missing, duplicated, curved and unoriented current candidates", () => {
    const source = fixture()
    const candidate = source.candidate
    const variants = [
      [],
      [candidate, { ...candidate, candidateId: "duplicate-face" }],
      [{ ...candidate, signature: { ...candidate.signature, geometryClass: "CYLINDRE" } }],
      [{ ...candidate, signature: { ...candidate.signature, directionMode: "axis" as const } }],
      [
        {
          ...candidate,
          signature: { ...candidate.signature, direction: undefined, directionMode: undefined },
        },
      ],
    ]
    for (const candidates of variants) {
      const current = candidates.map((value) => topologyCandidateSchema.parse(value))
      expect(
        sketchFrame(source.sketch, source.document, [source.owner], new Set(), [
          { featureId: source.owner.id, geometry: { topologyCandidates: current } },
        ]),
      ).toBeNull()
    }
    expect(sketchFrame(source.sketch, source.document, [], new Set(), source.geometry)).toBeNull()
    expect(
      sketchFrame(
        source.sketch,
        source.document,
        [source.owner],
        new Set([source.owner.id]),
        source.geometry,
      ),
    ).toBeNull()
  })

  it("rejects named-only aggregate topology while accepting legacy and explicit whole-result geometry", () => {
    const source = fixture()
    for (const outputRoles of [
      undefined,
      ["result"],
      ["pattern.instance.0", "pattern.instance.1"],
      ["split.negative", "split.positive"],
    ]) {
      const frame = sketchFrame(source.sketch, source.document, [source.owner], new Set(), [
        {
          featureId: source.owner.id,
          geometry: {
            topologyCandidates: [source.candidate],
            ...(outputRoles ? { bodies: outputRoles.map((outputRole) => ({ outputRole })) } : {}),
          },
        },
      ])
      if (outputRoles && !outputRoles.includes("result")) expect(frame).toBeNull()
      else assertFrame(frame, [0, 1, 0])
    }
  })

  it("uses the same exact face resolver for offset and angular datum supports", () => {
    const source = fixture([0, 1, 0])
    const owner = source.owner
    const datum = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(3),
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "feature-face", reference: source.reference },
        offset: createLengthQuantity(2),
        rotation: { axis: "x", angle: createAngleQuantity(90, "deg") },
      },
      dependencies: [owner.id],
      references: [source.reference],
      suppressed: false,
    })
    const document = documentSnapshotSchema.parse({ ...source.document, features: [owner, datum] })
    const frame = datumPlaneFrame(
      datum,
      document,
      [owner, datum],
      new Set([datum.id]),
      source.geometry,
    )
    expect(frame?.origin).toEqual([2, 6, 4])
    expect(frame?.normal[0]).toBeCloseTo(0, 12)
    expect(frame?.normal[1]).toBeCloseTo(0, 12)
    expect(frame?.normal[2]).toBeCloseTo(1, 12)
  })

  it.each(["through-all", "up-to-body", "up-to-face"] as const)(
    "resolves actual cap geometry for %s instead of the nominal distance",
    (kind) => {
      const source = fixture([0, 0, 1], "extrusion.cap.end")
      const targetBody = { schemaVersion: 0, featureId: id(4), outputRole: "result" }
      const endCondition = {
        kind,
        targetBody,
        sourceContentHash: "b".repeat(64),
        ...(kind === "up-to-face"
          ? {
              face: {
                ...source.reference,
                featureId: id(4),
                schemaVersion: 1,
                outputRole: "result",
              },
            }
          : {}),
      }
      const parameters = extrusionFeatureParametersV6Schema.parse({
        profiles: {
          schemaVersion: 0,
          profiles: [
            {
              schemaVersion: 0,
              sketchId: id(5),
              outerBoundaryEntityIds: [id(30)],
              holeBoundaryEntityIds: [],
            },
          ],
        },
        distance: createLengthQuantity(99),
        symmetric: false,
        reversed: false,
        secondDistance: null,
        operation: "new",
        targetBody: null,
        startOffset: createLengthQuantity(0),
        draftAngle: createAngleQuantity(0),
        endCondition,
      })
      const owner = featureRecordSchema.parse({
        ...source.owner,
        type: extrusionFeatureTypeV6.type,
        parameters,
      })
      const base = sketchRecordSchema.parse({
        schemaVersion: 0,
        id: id(5),
        label: "Source profile",
        plane: "xy",
        entities: [],
        constraints: [],
      })
      const document = documentSnapshotSchema.parse({
        ...source.document,
        features: [owner],
        sketches: [base, source.sketch],
      })
      const frame = sketchFrame(source.sketch, document, [owner], new Set(), source.geometry)
      expect(frame?.origin).toEqual([2, 1, 5])
      expect(frame?.normal).toEqual([0, 0, 1])
    },
  )

  it("keeps the authored datum face orientation when both display caps share the same role", () => {
    const source = fixture([0, 0, 1], "datum.plane")
    const opposite = topologyCandidateSchema.parse({
      ...source.candidate,
      candidateId: "opposite-cap",
      signature: { ...source.candidate.signature, direction: [0, 0, -1] },
    })
    expect(
      resolvePlanarSupportReference(source.reference, [opposite, source.candidate]),
    ).toMatchObject({ status: "resolved", candidateId: source.candidate.candidateId })
    expect(resolvePlanarSupportReference(source.reference, [opposite])).toMatchObject({
      status: "missing",
    })
  })
})
