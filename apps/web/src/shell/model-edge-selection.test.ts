import { describe, expect, it } from "bun:test"
import type { DocumentControllerState } from "../document/document-controller"
import { authoredTestBody, authoredTreeFixture } from "../test-support/authored-tree-fixture"
import {
  modelEdgeOptions,
  pickedModelEdge,
  resolveModelEdgeSelection,
} from "./model-edge-selection"

function fixture(candidateId = "edge-1") {
  const { authority, snapshot } = authoredTreeFixture()
  const geometry = authority.parts.map((part) => {
    const body = authoredTestBody(part)
    const topologyCandidates = [
      {
        candidateId,
        kind: "edge" as const,
        semanticRole: "box.edge",
        lineageTokens: [],
        signature: {
          kind: "edge" as const,
          geometryClass: "LINE",
          measure: 20,
          centroid: [10, 0, 0],
          bounds: { min: [0, 0, 0], max: [20, 0, 0] },
          boundaryCount: 0,
          adjacentGeometryClasses: [],
        },
        edgePolyline: [
          [0, 0, 0],
          [20, 0, 0],
        ],
      },
    ]
    return {
      featureId: body.featureId,
      contentHash: body.contentHash,
      geometry: { ...body, topologyCandidates, bodies: [{ ...body, topologyCandidates }] },
    }
  })
  const response = {
    documentId: snapshot.id,
    revision: snapshot.revision,
    geometry,
    evaluation: {
      records: geometry.map(({ featureId, contentHash }) => ({
        featureId,
        contentHash,
        status: "succeeded",
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
  }
  const controller = {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: authority,
    report: { mode: "read-write", snapshot, rebuild: { ok: true, response } },
  } as unknown as DocumentControllerState
  return { controller, response, authority }
}

const label = (feature: string, ordinal: number) => `${feature} edge ${ordinal}`
const options = (controller: DocumentControllerState) =>
  modelEdgeOptions(controller, [], undefined, label)

describe("ordinary model-edge authority", () => {
  it("projects visible exact terminal edges to stable intent and rejects stale rebuilds", () => {
    const { controller, response } = fixture()
    const edges = options(controller)
    expect(edges).toHaveLength(3)
    expect(edges[0]?.display.label).toBe("Box 1 edge 1")
    expect(edges[0]?.selection.reference.semanticRole).toBe("box.edge")
    expect(edges[0]?.selection.reference).not.toHaveProperty("candidateId")
    response.revision += 1
    expect(options(controller)).toEqual([])
  })

  it("excludes hidden features, hidden Parts, and triangle-mesh bodies", () => {
    const { controller, authority, response } = fixture()
    const first = authority.parts[0]
    if (!first) throw new Error("Missing part fixture")
    const feature = response.geometry[0]?.featureId
    if (!feature) throw new Error("Missing feature fixture")
    expect(modelEdgeOptions(controller, [feature], undefined, label)).toHaveLength(2)
    expect(modelEdgeOptions(controller, [], { [first.id]: false }, label)).toHaveLength(2)
    for (const record of response.geometry) {
      Object.assign(record.geometry.bodies[0] ?? {}, { representation: "triangle-mesh" })
    }
    expect(options(controller)).toEqual([])
  })

  it("re-resolves a selection after transient IDs change and refuses another body", () => {
    const original = options(fixture().controller)[0]
    if (!original) throw new Error("Missing edge fixture")
    const rebuilt = options(fixture("rebuilt-edge").controller)
    const resolved = resolveModelEdgeSelection(rebuilt, original.selection)
    expect(resolved?.display.candidateId).toBe("rebuilt-edge")
    expect(
      resolveModelEdgeSelection(rebuilt, { ...original.selection, outputRole: "other" }),
    ).toBeNull()
    expect(pickedModelEdge(rebuilt, { ...original.display, candidateId: "rebuilt-edge" })).toBe(
      resolved,
    )
    expect(pickedModelEdge(rebuilt, { ...original.display, outputRole: "other" })).toBeNull()
  })

  it("refuses missing and ambiguous topology instead of retargeting", () => {
    const original = options(fixture().controller)[0]
    if (!original) throw new Error("Missing edge fixture")
    expect(resolveModelEdgeSelection([], original.selection)).toBeNull()
    const ambiguous = [
      original,
      { ...original, candidate: { ...original.candidate, candidateId: "duplicate" } },
    ]
    expect(resolveModelEdgeSelection(ambiguous, original.selection)).toBeNull()
  })
})
