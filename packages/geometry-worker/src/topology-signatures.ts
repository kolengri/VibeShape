import type { TopologyCandidate, TopologySignature } from "@vibeshape/protocol"
import {
  type Edge,
  type Face,
  measureShapeLinearProperties,
  measureShapeSurfaceProperties,
  type Shape3D,
  type Vector,
} from "replicad"

type Vector3 = [number, number, number]

interface TopologySample {
  candidateId: string
  kind: "edge" | "face"
  ownKey: number
  boundaryKeys: number[]
  signature: Omit<TopologySignature, "adjacentGeometryClasses">
}

export interface TopologyCandidateContext {
  candidateId: string
  kind: TopologyCandidate["kind"]
  signature: TopologySignature
}

export interface TopologyCandidateAnnotations {
  semanticRole?(context: TopologyCandidateContext): string | undefined
  lineageTokens?(context: TopologyCandidateContext): string[]
}

export interface TopologyCaptureSnapshot {
  candidates: TopologyCandidate[]
  // Shape keys exist only long enough to join one OCCT evaluation's history to its candidates.
  transientShapeKeys: ReadonlyMap<string, number>
}

function readVector(vector: Vector): Vector3 {
  try {
    return vector.toTuple()
  } finally {
    vector.delete()
  }
}

function normalizedDirection(vector: Vector): Vector3 | undefined {
  const tuple = readVector(vector)
  const magnitude = Math.hypot(...tuple)
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    return undefined
  }
  return tuple.map((component) => component / magnitude) as Vector3
}

function readBounds(shape: Face | Edge) {
  const boundingBox = shape.boundingBox
  try {
    const [min, max] = boundingBox.bounds
    return { min, max }
  } finally {
    boundingBox.delete()
  }
}

function readFaceSample(face: Face, index: number): TopologySample {
  const properties = measureShapeSurfaceProperties(face)
  const edges = face.edges
  try {
    const direction = normalizedDirection(face.normalAt())
    return {
      candidateId: `face:${index}`,
      kind: "face",
      ownKey: face.hashCode,
      boundaryKeys: edges.map((edge) => edge.hashCode),
      signature: {
        kind: "face",
        geometryClass: face.geomType,
        measure: properties.area,
        centroid: properties.centerOfMass,
        bounds: readBounds(face),
        ...(direction ? { direction, directionMode: "oriented" as const } : {}),
        boundaryCount: new Set(edges.map((edge) => edge.hashCode)).size,
      },
    }
  } finally {
    for (const edge of edges) edge.delete()
    properties.delete()
  }
}

function readEdgeSample(edge: Edge, index: number): TopologySample {
  const properties = measureShapeLinearProperties(edge)
  try {
    const direction = normalizedDirection(edge.tangentAt(0.5))
    return {
      candidateId: `edge:${index}`,
      kind: "edge",
      ownKey: edge.hashCode,
      boundaryKeys: [],
      signature: {
        kind: "edge",
        geometryClass: edge.geomType,
        measure: properties.length,
        centroid: properties.centerOfMass,
        bounds: readBounds(edge),
        ...(direction ? { direction, directionMode: "axis" as const } : {}),
        boundaryCount: edge.isClosed ? 0 : 2,
      },
    }
  } finally {
    properties.delete()
  }
}

function adjacentClasses(sample: TopologySample, samples: TopologySample[]) {
  if (sample.kind === "face") {
    const boundaries = new Set(sample.boundaryKeys)
    return samples
      .filter(
        (candidate) =>
          candidate.kind === "face" &&
          candidate.candidateId !== sample.candidateId &&
          candidate.boundaryKeys.some((key) => boundaries.has(key)),
      )
      .map((candidate) => candidate.signature.geometryClass)
      .sort()
  }
  return samples
    .filter(
      (candidate) => candidate.kind === "face" && candidate.boundaryKeys.includes(sample.ownKey),
    )
    .map((candidate) => candidate.signature.geometryClass)
    .sort()
}

export function createTopologyCandidates(
  samples: TopologySample[],
  annotations: TopologyCandidateAnnotations = {},
): TopologyCandidate[] {
  return samples.map((sample) => {
    const signature: TopologySignature = {
      ...sample.signature,
      adjacentGeometryClasses: adjacentClasses(sample, samples),
    }
    const context: TopologyCandidateContext = {
      candidateId: sample.candidateId,
      kind: sample.kind,
      signature,
    }
    return {
      candidateId: sample.candidateId,
      kind: sample.kind,
      ...(sample.kind === "face" ? { meshFaceId: sample.ownKey } : {}),
      signature,
      lineageTokens: annotations.lineageTokens?.(context) ?? [],
      ...(annotations.semanticRole?.(context)
        ? { semanticRole: annotations.semanticRole(context) }
        : {}),
    }
  })
}

export function captureReplicadTopologyCandidates(
  shape: Shape3D,
  annotations: TopologyCandidateAnnotations = {},
) {
  return captureReplicadTopologySnapshot(shape, annotations).candidates
}

export function captureReplicadTopologySnapshot(
  shape: Shape3D,
  annotations: TopologyCandidateAnnotations = {},
): TopologyCaptureSnapshot {
  const faces = shape.faces
  const edges = shape.edges
  try {
    const samples = [
      ...faces.map((face, index) => readFaceSample(face, index)),
      ...edges.map((edge, index) => readEdgeSample(edge, index)),
    ]
    return {
      candidates: createTopologyCandidates(samples, annotations),
      transientShapeKeys: new Map(samples.map((sample) => [sample.candidateId, sample.ownKey])),
    }
  } finally {
    for (const face of faces) face.delete()
    for (const edge of edges) edge.delete()
  }
}
