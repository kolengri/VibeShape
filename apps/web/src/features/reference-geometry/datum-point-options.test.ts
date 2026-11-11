import { describe, expect, it } from "bun:test"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  resolveTopologyReference,
  type TopologyCandidate,
} from "@vibeshape/domain"
import { datumPointOptions } from "./datum-point-options"

const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(10),
    depth: createLengthQuantity(10),
    height: createLengthQuantity(10),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Source",
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f6100",
  revision: 1,
  name: "Datum point options",
  variables: [],
  sketches: [],
  features: [feature],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
})

type Position = [number, number, number]

function vertex(index: number, position: Position, semanticRole?: string) {
  return {
    candidateId: `vertex:${index}`,
    kind: "vertex",
    ...(semanticRole ? { semanticRole } : {}),
    lineageTokens: [],
    signature: {
      kind: "vertex",
      geometryClass: "POINT",
      measure: 0,
      centroid: position,
      bounds: { min: position, max: position },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    },
    referenceGeometry: { kind: "vertex", position },
  }
}

function circle(index: number, center: Position) {
  return {
    candidateId: `edge:${index}`,
    kind: "edge",
    lineageTokens: [],
    signature: {
      kind: "edge",
      geometryClass: "CIRCLE",
      measure: 2 * Math.PI,
      centroid: center,
      bounds: {
        min: [center[0] - 1, center[1] - 1, center[2]],
        max: [center[0] + 1, center[1] + 1, center[2]],
      },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    },
    referenceGeometry: {
      kind: "circle-edge",
      center,
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      radius: 1,
    },
  }
}

/** Only the fields the option builder reads; worker evidence is otherwise opaque here. */
function rebuild(candidates: readonly unknown[]) {
  return {
    ok: true,
    response: {
      geometry: [
        {
          featureId,
          geometry: {
            bodies: [
              {
                outputRole: "result",
                shape: { valid: true, solidCount: 1 },
                topologyCandidates: candidates,
              },
            ],
          },
        },
      ],
    },
  } as unknown as DocumentRebuildOutcome
}

describe("datum point reference options", () => {
  it("offers uniquely resolving vertices and circle centers with their current positions", () => {
    const options = datumPointOptions(
      snapshot,
      rebuild([vertex(0, [0, 0, 0], "corner.a"), vertex(1, [10, 0, 0]), circle(2, [5, 5, 10])]),
    )
    expect(options.vertices.map(({ position }) => position)).toEqual([
      [0, 0, 0],
      [10, 0, 0],
    ])
    expect(options.vertices[0]?.reference).toMatchObject({
      schemaVersion: 1,
      featureId,
      outputRole: "result",
      kind: "vertex",
      semanticRole: "corner.a",
    })
    expect(options.circles).toHaveLength(1)
    expect(options.circles[0]).toMatchObject({ position: [5, 5, 10], reference: { kind: "edge" } })
  })

  it("fails closed for coincident vertices and non-unique semantic roles", () => {
    const options = datumPointOptions(
      snapshot,
      rebuild([
        vertex(0, [0, 0, 0]),
        vertex(1, [0, 0, 0]),
        vertex(2, [50, 0, 0], "shared"),
        vertex(3, [50, 0, 0], "shared"),
        vertex(4, [90, 0, 0]),
      ]),
    )
    expect(options.vertices.map(({ position }) => position)).toEqual([[90, 0, 0]])
    expect(options.vertices[0]?.reference).not.toHaveProperty("semanticRole")
  })

  it("offers exactly the vertices that resolve to themselves against every peer", () => {
    // Clusters closer than, at and beyond the 1e-7 mm tolerance exercise the neighbourhood bound.
    const offsets = [0, 4e-9, 5e-8, 1e-7, 2e-7, 1, 1 + 1e-9]
    const candidates = Array.from({ length: 245 }, (_, index) => {
      const offset = offsets[index % offsets.length] ?? 0
      const cluster = Math.floor(index / offsets.length)
      return vertex(
        index,
        [cluster * 10 + offset, cluster % 3, 0],
        index % 17 === 0 ? `r${index}` : undefined,
      )
    })
    const peers = candidates.map(
      ({ candidateId, kind, semanticRole, lineageTokens, signature }) =>
        ({
          candidateId,
          kind,
          ...(semanticRole ? { semanticRole } : {}),
          lineageTokens,
          signature,
        }) as TopologyCandidate,
    )
    const expected = candidates
      .filter((candidate) => {
        const {
          candidateId: _id,
          referenceGeometry: _geometry,
          lineageTokens: _tokens,
          ...rest
        } = candidate
        const resolution = resolveTopologyReference(
          { ...rest, schemaVersion: 0, featureId } as never,
          peers,
        )
        return resolution.status === "resolved" && resolution.candidateId === candidate.candidateId
      })
      .map(({ candidateId }) => candidateId)
    const offered = datumPointOptions(snapshot, rebuild(candidates)).vertices.map(
      ({ key }) => JSON.parse(key)[2],
    )
    expect(offered).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(candidates.length)
  })

  it("caps a 10,000-vertex catalogue at 2,000 options within a bounded time", () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) =>
      vertex(index, [(index % 100) * 2, Math.floor(index / 100) * 2, 0]),
    )
    const started = performance.now()
    const options = datumPointOptions(snapshot, rebuild(candidates))
    const elapsed = performance.now() - started
    expect(options.vertices).toHaveLength(2_000)
    expect(new Set(options.vertices.map(({ key }) => key)).size).toBe(2_000)
    // Measured well under a second locally; the bound only guards against quadratic regressions.
    expect(elapsed).toBeLessThan(5_000)
  })
})
