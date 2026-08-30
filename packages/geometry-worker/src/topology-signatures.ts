import type { TopologyCandidate, TopologySignature } from "@vibeshape/protocol"
import {
  type Edge,
  type Face,
  getOC,
  measureShapeLinearProperties,
  measureShapeSurfaceProperties,
  type Shape3D,
  type Vector,
} from "replicad"

type Vector3 = [number, number, number]
type ReferenceGeometry =
  | { kind: "vertex"; position: Vector3 }
  | { kind: "line-edge"; start: Vector3; end: Vector3 }
  | {
      kind: "circle-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      radius: number
    }
  | {
      kind: "arc-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      radius: number
      start: Vector3
      middle: Vector3
      end: Vector3
    }
  | {
      kind: "ellipse-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      majorRadius: number
      minorRadius: number
    }
  | {
      kind: "elliptical-arc-edge"
      center: Vector3
      xAxis: Vector3
      yAxis: Vector3
      normal: Vector3
      majorRadius: number
      minorRadius: number
      start: Vector3
      middle: Vector3
      end: Vector3
    }

interface TopologySample {
  candidateId: string
  kind: "vertex" | "edge" | "face"
  ownKey?: number
  boundaryKeys: number[]
  signature: Omit<TopologySignature, "adjacentGeometryClasses">
  referenceGeometry?: ReferenceGeometry
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

type OcctCoordinate = Readonly<{
  X(): number
  Y(): number
  Z(): number
  delete(): void
}>

function readOcctCoordinate(coordinate: OcctCoordinate): Vector3 {
  try {
    return [coordinate.X(), coordinate.Y(), coordinate.Z()]
  } finally {
    coordinate.delete()
  }
}

function readCircularReferenceGeometry(edge: Edge): ReferenceGeometry | undefined {
  if (edge.geomType !== "CIRCLE") return undefined
  const opencascade = getOC()
  const adaptor = new opencascade.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const circle = adaptor.Circle()
    try {
      const position = circle.Position()
      try {
        const geometry = {
          center: readOcctCoordinate(position.Location()),
          xAxis: readOcctCoordinate(position.XDirection()),
          yAxis: readOcctCoordinate(position.YDirection()),
          normal: readOcctCoordinate(position.Direction()),
          radius: circle.Radius(),
        }
        if (adaptor.IsClosed()) return { kind: "circle-edge", ...geometry }
        const first = adaptor.FirstParameter()
        const last = adaptor.LastParameter()
        return {
          kind: "arc-edge",
          ...geometry,
          start: readOcctCoordinate(adaptor.Value(first)),
          middle: readOcctCoordinate(adaptor.Value((first + last) / 2)),
          end: readOcctCoordinate(adaptor.Value(last)),
        }
      } finally {
        position.delete()
      }
    } finally {
      circle.delete()
    }
  } finally {
    adaptor.delete()
  }
}

function readEllipticalReferenceGeometry(edge: Edge): ReferenceGeometry | undefined {
  if (edge.geomType !== "ELLIPSE") return undefined
  const opencascade = getOC()
  const adaptor = new opencascade.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const ellipse = adaptor.Ellipse()
    try {
      const position = ellipse.Position()
      try {
        const geometry = {
          center: readOcctCoordinate(position.Location()),
          xAxis: readOcctCoordinate(position.XDirection()),
          yAxis: readOcctCoordinate(position.YDirection()),
          normal: readOcctCoordinate(position.Direction()),
          majorRadius: ellipse.MajorRadius(),
          minorRadius: ellipse.MinorRadius(),
        }
        if (adaptor.IsClosed()) return { kind: "ellipse-edge", ...geometry }
        const first = adaptor.FirstParameter()
        const last = adaptor.LastParameter()
        return {
          kind: "elliptical-arc-edge",
          ...geometry,
          start: readOcctCoordinate(adaptor.Value(first)),
          middle: readOcctCoordinate(adaptor.Value((first + last) / 2)),
          end: readOcctCoordinate(adaptor.Value(last)),
        }
      } finally {
        position.delete()
      }
    } finally {
      ellipse.delete()
    }
  } finally {
    adaptor.delete()
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

function readEdgeSample(edge: Edge, index: number) {
  const properties = measureShapeLinearProperties(edge)
  try {
    const direction = normalizedDirection(edge.tangentAt(0.5))
    const start = readVector(edge.startPoint)
    const end = readVector(edge.endPoint)
    const referenceGeometry =
      edge.geomType === "LINE"
        ? {
            kind: "line-edge" as const,
            start,
            end,
          }
        : edge.geomType === "ELLIPSE"
          ? readEllipticalReferenceGeometry(edge)
          : readCircularReferenceGeometry(edge)
    return {
      endpoints: [start, end] as const,
      sample: {
        candidateId: `edge:${index}`,
        kind: "edge" as const,
        ownKey: edge.hashCode,
        boundaryKeys: [],
        signature: {
          kind: "edge" as const,
          geometryClass: edge.geomType,
          measure: properties.length,
          centroid: properties.centerOfMass,
          bounds: readBounds(edge),
          ...(direction ? { direction, directionMode: "axis" as const } : {}),
          boundaryCount: edge.isClosed ? 0 : 2,
        },
        ...(referenceGeometry ? { referenceGeometry } : {}),
      },
    }
  } finally {
    properties.delete()
  }
}

function readVertexSample(position: Vector3, index: number): TopologySample {
  return {
    candidateId: `vertex:${index}`,
    kind: "vertex",
    boundaryKeys: [],
    signature: {
      kind: "vertex",
      geometryClass: "POINT",
      measure: 0,
      centroid: position,
      bounds: { min: position, max: position },
      boundaryCount: 0,
    },
    referenceGeometry: { kind: "vertex", position },
  }
}

function vertexSamples(edgeSamples: readonly ReturnType<typeof readEdgeSample>[]) {
  const positions = new Map<string, Vector3>()
  for (const { endpoints } of edgeSamples) {
    for (const position of endpoints) {
      const key = position.map((coordinate) => Math.round(coordinate * 1e9)).join(":")
      if (!positions.has(key)) positions.set(key, position)
    }
  }
  return [...positions.values()].map(readVertexSample)
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
  if (sample.ownKey === undefined) return []
  const ownKey = sample.ownKey
  return samples
    .filter((candidate) => candidate.kind === "face" && candidate.boundaryKeys.includes(ownKey))
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
    const semanticRole = annotations.semanticRole?.(context)
    return {
      candidateId: sample.candidateId,
      kind: sample.kind,
      ...(sample.kind === "face" ? { meshFaceId: sample.ownKey } : {}),
      signature,
      ...(sample.referenceGeometry ? { referenceGeometry: sample.referenceGeometry } : {}),
      lineageTokens: annotations.lineageTokens?.(context) ?? [],
      ...(semanticRole ? { semanticRole } : {}),
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
  const faces: Face[] = []
  const edges: Edge[] = []
  try {
    faces.push(...shape.faces)
    edges.push(...shape.edges)
    const capturedEdges = edges.map((edge, index) => readEdgeSample(edge, index))
    const samples = [
      ...vertexSamples(capturedEdges),
      ...faces.map((face, index) => readFaceSample(face, index)),
      ...capturedEdges.map(({ sample }) => sample),
    ]
    return {
      candidates: createTopologyCandidates(samples, annotations),
      transientShapeKeys: new Map(
        samples.flatMap((sample) =>
          sample.ownKey === undefined ? [] : [[sample.candidateId, sample.ownKey]],
        ),
      ),
    }
  } finally {
    for (const face of faces) face.delete()
    for (const edge of edges) edge.delete()
  }
}
