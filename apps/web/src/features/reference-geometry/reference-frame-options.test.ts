import { describe, expect, it, spyOn } from "bun:test"
import { createLengthQuantity, datumPlaneFeatureType, featureIdSchema } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { referenceAxisSchema, referencePlaneSchema } from "@vibeshape/domain/reference-frame"
import { documentWorkerResponseSchema, type TopologyCandidate } from "@vibeshape/protocol"
import { extrusionBodyFixture } from "../extrusion/extrusion-body-test-fixtures"
import { referenceFrameOptions } from "./reference-frame-options"

function candidate(
  candidateId: string,
  kind: "face" | "edge" = "face",
  geometryClass = kind === "face" ? "PLANE" : "LINE",
): TopologyCandidate {
  return {
    candidateId,
    kind,
    signature: {
      kind,
      geometryClass,
      measure: 1,
      centroid: [0.5, 0.5, 1],
      bounds: { min: [0, 0, 1], max: [1, 1, 1] },
      boundaryCount: kind === "face" ? 4 : 2,
      adjacentGeometryClasses: [],
      direction: [0, 0, 1],
      directionMode: "oriented",
    },
    lineageTokens: [],
  }
}

function fixture(candidates: TopologyCandidate[]) {
  const seed = extrusionBodyFixture(undefined, false, "PLANE")
  if (!seed.rebuild.ok) throw new Error("Expected successful rebuild")
  const geometry = seed.rebuild.response.geometry[0]
  const body = geometry?.geometry.bodies?.[0]
  if (!geometry || !body) throw new Error("Expected exact body")
  body.topologyCandidates = candidates
  body.shape = {
    ...body.shape,
    faceCount: candidates.filter(({ kind }) => kind === "face").length,
    edgeCount: candidates.filter(({ kind }) => kind === "edge").length,
  }
  geometry.geometry.shape = { ...body.shape }
  return { snapshot: seed.snapshot, rebuild: seed.rebuild, body }
}

describe("reference-frame catalogue", () => {
  it("keeps mixed support order, labels, mesh IDs and signed face/edge directions", () => {
    const forward = { ...candidate("forward"), meshFaceId: 0, semanticRole: "front" }
    const reverse = candidate("reverse")
    reverse.signature.direction = [0, 0, -1]
    const unoriented = candidate("unoriented")
    unoriented.signature.directionMode = "axis"
    const undirected = candidate("undirected")
    delete undirected.signature.direction
    delete undirected.signature.directionMode
    const edge = { ...candidate("axis", "edge"), semanticRole: "spine" }
    edge.signature.directionMode = "axis"
    const orientedEdge = candidate("oriented-axis", "edge")
    orientedEdge.signature.direction = [0, 0, -1]
    const undirectedEdge = candidate("undirected-edge", "edge")
    delete undirectedEdge.signature.direction
    delete undirectedEdge.signature.directionMode
    const { snapshot, rebuild } = fixture([
      forward,
      candidate("sphere", "face", "SPHERE"),
      edge,
      unoriented,
      reverse,
      undirected,
      candidate("circle", "edge", "CIRCLE"),
      candidate("face-with-line-class", "face", "LINE"),
      candidate("edge-with-plane-class", "edge", "PLANE"),
      orientedEdge,
      undirectedEdge,
    ])
    const options = referenceFrameOptions(snapshot, rebuild)
    const featureId = snapshot.features[0]?.id
    const reference = (value: TopologyCandidate) => ({
      schemaVersion: 1,
      featureId,
      outputRole: "result",
      kind: value.kind,
      signature: value.signature,
      ...(value.semanticRole ? { semanticRole: value.semanticRole } : {}),
    })
    expect(options).toEqual<unknown>({
      planes: [
        {
          key: JSON.stringify([featureId, "result", "forward"]),
          label: "Producer · result · front",
          support: { kind: "planar-face", reference: reference(forward) },
          meshFaceId: 0,
        },
        {
          key: JSON.stringify([featureId, "result", "reverse"]),
          label: "Producer · result · reverse",
          support: { kind: "planar-face", reference: reference(reverse) },
        },
      ],
      axes: [edge, orientedEdge].map((value) => ({
        key: JSON.stringify([featureId, "result", value.candidateId]),
        label: `Producer · result · ${value.semanticRole ?? value.candidateId}`,
        support: { kind: "linear-edge", reference: reference(value) },
      })),
    })
  })

  it.each(["face", "edge"] as const)(
    "counts ineligible %s peers when projecting semantic and lineage identity",
    (kind) => {
      const eligible = {
        ...candidate("eligible", kind),
        semanticRole: "shared-role",
        lineageTokens: ["shared-lineage", "unique-lineage"],
      }
      const peer = {
        ...candidate("ineligible", kind, kind === "face" ? "SPHERE" : "CIRCLE"),
        semanticRole: "shared-role",
        lineageTokens: ["shared-lineage"],
      }
      const { snapshot, rebuild } = fixture([peer, eligible])
      const evidence = spyOn(modelBodyTopologyEvidenceSchema, "parse")
      let options: ReturnType<typeof referenceFrameOptions>
      try {
        options = referenceFrameOptions(snapshot, rebuild)
        // Both projector and resolver must see ineligible peers in the exact evidence set.
        expect(evidence).toHaveBeenCalledTimes(2)
        for (const [input] of evidence.mock.calls)
          expect(input).toMatchObject({
            candidates: [{ candidateId: "ineligible" }, { candidateId: "eligible" }],
          })
      } finally {
        evidence.mockRestore()
      }
      const support = (kind === "face" ? options.planes : options.axes)[0]?.support
      expect(support).toEqual<unknown>({
        kind: kind === "face" ? "planar-face" : "linear-edge",
        reference: {
          schemaVersion: 1,
          featureId: snapshot.features[0]?.id,
          outputRole: "result",
          kind,
          signature: eligible.signature,
          lineageToken: "unique-lineage",
        },
      })
    },
  )

  it.each(["face", "edge"] as const)(
    "keeps coincident %s ambiguity unless unique authored identity disambiguates it",
    (kind) => {
      for (const identity of ["none", "semantic", "lineage"] as const) {
        const first = candidate("first", kind)
        const second = candidate("second", kind)
        if (identity === "semantic") {
          first.semanticRole = "first-role"
          second.semanticRole = "second-role"
        } else if (identity === "lineage") {
          first.lineageTokens = ["first-lineage"]
          second.lineageTokens = ["second-lineage"]
        }
        const { snapshot, rebuild } = fixture([second, first])
        const options = referenceFrameOptions(snapshot, rebuild)
        const supports = kind === "face" ? options.planes : options.axes
        expect(supports.map(({ key }) => JSON.parse(key)[2])).toEqual(
          identity === "none" ? [] : ["second", "first"],
        )
        first.semanticRole = second.semanticRole = "shared-role"
        first.lineageTokens = second.lineageTokens = ["shared-lineage"]
        expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
      }
    },
  )

  it.each([true, false])(
    "preserves the first cross-kind ID match (edge first: %s)",
    (edgeFirst) => {
      const edge = candidate("shared-id", "edge")
      const face = { ...candidate("shared-id"), meshFaceId: 0 }
      const { snapshot, rebuild } = fixture(edgeFirst ? [edge, face] : [face, edge])
      const plane = referenceFrameOptions(snapshot, rebuild).planes[0]
      expect(plane).toBeDefined()
      expect(plane && Object.hasOwn(plane, "meshFaceId")).toBe(!edgeFirst)
      if (!edgeFirst) expect(plane?.meshFaceId).toBe(0)
    },
  )

  it("keeps congruent sibling bodies in their own exact output roles", () => {
    const face = {
      ...candidate("shared-face"),
      semanticRole: "cap",
      lineageTokens: ["cap-history"],
    }
    const { snapshot, rebuild, body } = fixture([face])
    const geometry = rebuild.response.geometry[0]
    if (!geometry) throw new Error("Expected geometry")
    body.outputRole = "compound.input.0"
    geometry.geometry.bodies = [body, { ...body, outputRole: "compound.input.1" }]
    geometry.geometry.shape = { ...geometry.geometry.shape, solidCount: 2, volume: 2 }
    const options = referenceFrameOptions(snapshot, rebuild)
    expect(options.planes.map(({ support }) => support)).toEqual<unknown>(
      ["compound.input.0", "compound.input.1"].map((outputRole) => ({
        kind: "planar-face",
        reference: {
          schemaVersion: 1,
          featureId: snapshot.features[0]?.id,
          outputRole,
          kind: "face",
          semanticRole: "cap",
          lineageToken: "cap-history",
          signature: face.signature,
        },
      })),
    )
  })

  it("validates unsupported evidence fully but skips projector, resolver and support schema work", () => {
    const { snapshot, rebuild, body } = fixture([
      candidate("sphere", "face", "SPHERE"),
      candidate("circle", "edge", "CIRCLE"),
    ])
    const validate = spyOn(documentWorkerResponseSchema, "safeParse")
    const evidence = spyOn(modelBodyTopologyEvidenceSchema, "parse")
    const plane = spyOn(referencePlaneSchema, "safeParse")
    const axis = spyOn(referenceAxisSchema, "safeParse")
    try {
      expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
      expect(validate).toHaveBeenCalledTimes(1)
      expect(evidence).not.toHaveBeenCalled()
      expect(plane).not.toHaveBeenCalled()
      expect(axis).not.toHaveBeenCalled()
      const sphere = body.topologyCandidates[0]
      if (!sphere) throw new Error("Expected unsupported candidate")
      sphere.signature.direction = [0, 0, 2]
      expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate.mock.results[1]?.value).toMatchObject({ success: false })
    } finally {
      validate.mockRestore()
      evidence.mockRestore()
      plane.mockRestore()
      axis.mockRestore()
    }
  })

  it("retains complete final validation while attempting only the matching support kind", () => {
    const { snapshot, rebuild } = fixture([candidate("plane"), candidate("line", "edge")])
    const invalidPlane = referencePlaneSchema.safeParse({ kind: "unsupported" })
    const invalidAxis = referenceAxisSchema.safeParse({ kind: "unsupported" })
    const plane = spyOn(referencePlaneSchema, "safeParse")
    const axis = spyOn(referenceAxisSchema, "safeParse")
    try {
      const options = referenceFrameOptions(snapshot, rebuild)
      expect(options.planes).toHaveLength(1)
      expect(options.axes).toHaveLength(1)
      expect(plane).toHaveBeenCalledTimes(1)
      expect(axis).toHaveBeenCalledTimes(1)
      // Eligibility screening must never replace validation at the final support boundary.
      plane.mockReturnValue(invalidPlane)
      axis.mockReturnValue(invalidAxis)
      expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
    } finally {
      plane.mockRestore()
      axis.mockRestore()
    }
  })

  it("fails closed on stale, malformed, incomplete and duplicate exact evidence", () => {
    const { snapshot, rebuild, body } = fixture([candidate("plane")])
    const response = rebuild.response
    expect(
      referenceFrameOptions(snapshot, {
        ok: true,
        response: { ...response, revision: response.revision - 1 },
      }),
    ).toEqual({ planes: [], axes: [] })
    const first = body.topologyCandidates[0]
    if (!first) throw new Error("Expected face")
    body.topologyCandidates = [
      first,
      {
        ...candidate("unsupported", "face", "SPHERE"),
        signature: { ...first.signature, geometryClass: "SPHERE", direction: [0, 0, 2] },
      },
    ]
    body.shape.faceCount = 2
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
    body.topologyCandidates = [first, { ...first }]
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
    body.topologyCandidates = [first]
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
    body.shape.faceCount = 1
    expect(referenceFrameOptions(snapshot, rebuild).planes).toHaveLength(1)
    const geometry = response.geometry[0]
    if (!geometry) throw new Error("Expected geometry")
    geometry.contentHash = "b".repeat(64)
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
  })

  it("preserves datum options and excludes the edited feature and later history", () => {
    const { snapshot, rebuild } = fixture([candidate("plane"), candidate("line", "edge")])
    const source = snapshot.features[0]
    const geometry = rebuild.response.geometry[0]
    if (!source || !geometry) throw new Error("Expected source")
    const datum = {
      ...source,
      id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000101"),
      type: datumPlaneFeatureType.type,
      label: "Offset plane",
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(8),
      },
    }
    const later = { ...source, id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000102") }
    snapshot.features.push(datum, later)
    for (const feature of [datum, later]) {
      rebuild.response.geometry.push({ ...geometry, featureId: feature.id })
      rebuild.response.evaluation.records.push({
        featureId: feature.id,
        status: "succeeded",
        contentHash: geometry.contentHash,
      })
    }
    const options = referenceFrameOptions(snapshot, rebuild, later.id)
    expect(options.planes.map(({ label }) => label)).toEqual([
      "Producer · result · plane",
      "Offset plane",
    ])
    expect(options.planes[1]?.support).toEqual({ kind: "datum-plane", featureId: datum.id })
    expect(options.axes.slice(1).map(({ support }) => support)).toEqual<unknown>(
      ["x", "y", "normal"].map((axis) => ({ kind: "datum-axis", featureId: datum.id, axis })),
    )
    expect(referenceFrameOptions(snapshot, rebuild, datum.id).planes).toHaveLength(1)
    expect(referenceFrameOptions(snapshot, rebuild, source.id)).toEqual({ planes: [], axes: [] })
    expect(referenceFrameOptions(snapshot, rebuild).planes).toHaveLength(3)
  })

  it("uses the first duplicate geometry record and preserves datum availability on invalid evidence", () => {
    const { snapshot, rebuild } = fixture([candidate("plane")])
    const feature = snapshot.features[0]
    const geometry = rebuild.response.geometry[0]
    if (!feature || !geometry) throw new Error("Expected source")
    const duplicate = { ...geometry, geometry: { ...geometry.geometry } }
    // Deliberately malformed later raw data must fail validation without being selected for traversal.
    Reflect.set(duplicate.geometry, "bodies", [null])
    rebuild.response.geometry.push(duplicate)
    expect(documentWorkerResponseSchema.safeParse(rebuild.response).success).toBe(false)
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })

    feature.type = datumPlaneFeatureType.type
    feature.parameters = {
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(8),
    }
    const datumOptions = {
      planes: [
        {
          key: `datum:${feature.id}`,
          label: "Producer",
          support: { kind: "datum-plane", featureId: feature.id },
        },
      ],
      axes: ["x", "y", "normal"].map((axis) => ({
        key: `datum:${feature.id}:${axis}`,
        label: `Producer · ${axis}`,
        support: { kind: "datum-axis", featureId: feature.id, axis },
      })),
    }
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual<unknown>(datumOptions)
    rebuild.response.geometry = [geometry]
    rebuild.response.revision -= 1
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual<unknown>(datumOptions)
    rebuild.response.geometry = []
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
    rebuild.response.geometry = [geometry]
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual<unknown>(datumOptions)
    feature.suppressed = true
    expect(referenceFrameOptions(snapshot, rebuild)).toEqual({ planes: [], axes: [] })
  })
})
