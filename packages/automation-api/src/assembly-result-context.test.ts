import { describe, expect, it } from "bun:test"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import { assemblyResultContextMatches } from "./assembly-result-context"
import { assemblyInspectionViewSchema } from "./assembly-tools"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
function topologyFixture(offset: number, limit: number, total: number) {
  const count = Math.min(limit, Math.max(0, total - offset))
  const body = { schemaVersion: 0, featureId: id(3), outputRole: "result" }
  const reference = {
    schemaVersion: 0,
    featureId: body.featureId,
    kind: "face",
    signature: {
      kind: "face",
      geometryClass: "plane",
      measure: 1,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  }
  const value = assemblyInspectionViewSchema.parse({
    schemaVersion: 1,
    documentId: id(1),
    revision: 4,
    interference: [],
    occurrences: [
      {
        instanceId: id(2),
        definitionId: id(4),
        pinRevision: 2,
        sourceIndex: 0,
        selectedBody: body,
        contentHash: "a".repeat(64),
        representation: "exact-solid",
        geometryFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    ],
    topology: {
      instanceId: id(2),
      sourceIndex: 0,
      pinRevision: 2,
      body,
      total,
      nextOffset: offset + count < total ? offset + count : null,
      references: Array.from({ length: count }, () => ({
        reference,
        geometry: "planar-face",
        resolution: "resolved",
      })),
    },
  })
  const operation = {
    tool: "inspect_assembly",
    arguments: { revision: 4, topology: { instanceId: id(2), sourceIndex: 0, offset, limit } },
  }
  return { operation, result: { ok: true, value } }
}
describe("motion sample result authority", () => {
  it("rejects substituted times, occurrences, revision and trace receipts", () => {
    const operation = {
      tool: "sample_assembly_motion_study",
      arguments: { revision: 4, studyId: id(8), sampleCount: 2, instanceIds: [id(2)] },
    }
    const sample = (timeSeconds: number) => ({
      timeSeconds,
      occurrences: [
        {
          instanceId: id(2),
          sourceIndex: 0,
          geometryFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        },
      ],
    })
    const result = {
      ok: true,
      value: {
        schemaVersion: 1,
        documentId: id(1),
        revision: 4,
        studyId: id(8),
        samples: [sample(0), sample(2)],
      },
    }
    expect(assemblyResultContextMatches(operation, result, id(1))).toBe(true)
    for (const value of [
      { ...result.value, revision: 5 },
      { ...result.value, studyId: id(9) },
      { ...result.value, samples: [sample(1), sample(2)] },
      { ...result.value, samples: [sample(0), sample(0)] },
      { ...result.value, samples: [sample(0), { ...sample(2), occurrences: [] }] },
      { ...result.value, samples: [sample(0), { ...sample(2), tracePointMm: [0, 0, 0] }] },
    ])
      expect(assemblyResultContextMatches(operation, { ok: true, value }, id(1))).toBe(false)
  })
})
function mismatchedTopologyFixture() {
  const f = topologyFixture(2, 1, 3)
  const page = f.result.value.topology
  const occurrence = f.result.value.occurrences[0]
  const reference = page?.references[0]
  if (!page || !occurrence || !reference) throw new Error("Expected topology fixture.")
  return { ...f, page, occurrence, reference }
}
type MismatchFixture = ReturnType<typeof mismatchedTopologyFixture>
const topologyMismatches: [string, (f: MismatchFixture) => void][] = [
  [
    "missing-occurrence",
    (f) => {
      f.result.value.occurrences = []
    },
  ],
  [
    "duplicate-occurrence",
    (f) => {
      f.result.value.occurrences.push({ ...f.occurrence })
    },
  ],
  [
    "pin",
    (f) => {
      f.page.pinRevision = 1
    },
  ],
  [
    "body",
    (f) => {
      f.page.body.outputRole = "other"
    },
  ],
  [
    "reference",
    (f) => {
      f.reference.reference.featureId = featureIdSchema.parse(id(9))
    },
  ],
  [
    "geometry",
    (f) => {
      f.reference.geometry = "vertex"
    },
  ],
  [
    "count",
    (f) => {
      f.page.references = []
    },
  ],
  [
    "cursor",
    (f) => {
      f.page.nextOffset = 0
    },
  ],
]

describe("shared assembly inspection response context", () => {
  it.each([
    [0, 2, 3],
    [2, 1, 3],
    [3, 1, 3],
    [0, 1, 0],
  ])(
    "accepts exact topology offset %i limit %i total %i without inventing a cursor",
    (offset, limit, total) => {
      const f = topologyFixture(offset, limit, total)
      expect(assemblyResultContextMatches(f.operation, f.result, id(1))).toBe(true)
    },
  )
  it("rejects successful pages outside the final offset", () => {
    const f = topologyFixture(4, 1, 3)
    expect(assemblyResultContextMatches(f.operation, f.result, id(1))).toBe(false)
  })
  it.each(topologyMismatches)("rejects topology with mismatched %s evidence", (_field, mutate) => {
    const f = mismatchedTopologyFixture()
    mutate(f)
    expect(assemblyResultContextMatches(f.operation, f.result, id(1))).toBe(false)
  })
})
