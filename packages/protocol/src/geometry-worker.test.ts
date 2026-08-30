import { describe, expect, it } from "vitest"
import {
  boxFeatureContentParametersSchema,
  extrusionFeatureContentParametersSchema,
  featureContentIdentitySchema,
  GEOMETRY_MEMORY_STAGES,
  GEOMETRY_PROTOCOL_VERSION,
  geometryWorkerRequestSchema,
  geometryWorkerResponseSchema,
  kernelSpikeParametersSchema,
  revolveFeatureContentParametersSchema,
  topologyCandidateSchema,
  topologySignatureSchema,
  topologySpikeParametersSchema,
} from "./geometry-worker"

const validEnvelope = {
  protocolVersion: GEOMETRY_PROTOCOL_VERSION,
  requestId: "request-1",
  documentId: "document-1",
  revision: 0,
  generation: 1,
} as const

const featureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "spike-2",
    kernelId: "org.opencascade.occt",
    kernelVersion: "0.23.0",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
} as const

const boxFeatureType = {
  moduleId: "org.vibeshape.core.part-design",
  moduleVersion: "0.1.0",
  typeId: "org.vibeshape.feature.part-design.box",
  schemaVersion: 1,
} as const

const boxContent = {
  schemaVersion: 0,
  feature: {
    schemaVersion: 0,
    type: boxFeatureType,
    parameters: { width: 20, depth: 30, height: 25.4, centered: true },
    inputs: [],
    references: [],
  },
  environment: featureContentEnvironment,
} as const

const validParameters = {
  boxSize: [60, 40, 20],
  cylinderRadius: 8,
  cylinderHeight: 30,
  cylinderOrigin: [0, 0, -5],
  filletRadius: 1.5,
  meshTolerance: 0.05,
  angularTolerance: 0.1,
  lifecycleIterations: 3,
  lifecycleOperation: "boolean-cut",
  purgeAfterLifecycle: false,
} as const

const historyStats = {
  sourceCount: 1,
  modifiedSourceCount: 0,
  modifiedRelationCount: 0,
  generatedSourceCount: 0,
  generatedRelationCount: 0,
  deletedSourceCount: 0,
}

describe("geometry worker protocol", () => {
  it("accepts finite rebuild-local vertex and line-edge reference geometry", () => {
    const signature = {
      kind: "vertex" as const,
      geometryClass: "POINT",
      measure: 0,
      centroid: [1, 2, 3],
      bounds: { min: [1, 2, 3], max: [1, 2, 3] },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    }
    expect(
      topologyCandidateSchema.safeParse({
        candidateId: "vertex:0",
        kind: "vertex",
        lineageTokens: [],
        signature,
        referenceGeometry: { kind: "vertex", position: [1, 2, 3] },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        candidateId: "edge:0",
        kind: "edge",
        lineageTokens: [],
        signature: { ...signature, kind: "edge", geometryClass: "LINE" },
        referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [1, 0, 0] },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        candidateId: "vertex:far",
        kind: "vertex",
        lineageTokens: [],
        signature: {
          ...signature,
          centroid: [150_000, 0, 0],
          bounds: { min: [150_000, 0, 0], max: [150_000, 0, 0] },
        },
        referenceGeometry: { kind: "vertex", position: [150_000, 0, 0] },
      }).success,
    ).toBe(true)
  })

  it("accepts exact circular edges and rejects malformed analytical frames", () => {
    const base = {
      candidateId: "edge:circle",
      kind: "edge" as const,
      lineageTokens: [],
      signature: {
        kind: "edge" as const,
        geometryClass: "CIRCLE",
        measure: Math.PI * 10,
        centroid: [0, 0, 0],
        bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
        boundaryCount: 0,
        adjacentGeometryClasses: [],
      },
    }
    const frame = {
      center: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      radius: 5,
    }

    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: { kind: "circle-edge", ...frame },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "arc-edge",
          ...frame,
          start: [5, 0, 0],
          middle: [0, 5, 0],
          end: [-5, 0, 0],
        },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "circle-edge",
          ...frame,
          yAxis: [1, 0, 0],
        },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "arc-edge",
          ...frame,
          start: [5, 0, 0],
          middle: [0, 4, 0],
          end: [5, 0, 0],
        },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "arc-edge",
          ...frame,
          start: [5, 0, 0],
          middle: [4, 0, 3],
          end: [0, 5, 0],
        },
      }).success,
    ).toBe(false)
  })

  it("accepts exact full and bounded elliptical edges and rejects off-locus points", () => {
    const base = {
      candidateId: "edge:ellipse",
      kind: "edge" as const,
      lineageTokens: [],
      signature: {
        kind: "edge" as const,
        geometryClass: "ELLIPSE",
        measure: 24,
        centroid: [0, 0, 0],
        bounds: { min: [-5, -3, 0], max: [5, 3, 0] },
        boundaryCount: 0,
        adjacentGeometryClasses: [],
      },
    }
    const frame = {
      center: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      majorRadius: 5,
      minorRadius: 3,
    }
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: { kind: "ellipse-edge", ...frame },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "elliptical-arc-edge",
          ...frame,
          start: [5, 0, 0],
          middle: [0, 3, 0],
          end: [-5, 0, 0],
        },
      }).success,
    ).toBe(true)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: {
          kind: "elliptical-arc-edge",
          ...frame,
          start: [5, 0, 0],
          middle: [0, 3.2, 0],
          end: [-5, 0, 0],
        },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: { kind: "ellipse-edge", ...frame, majorRadius: 2 },
      }).success,
    ).toBe(false)
  })

  it("rejects mismatched, non-finite, and degenerate reference geometry", () => {
    const base = {
      candidateId: "vertex:0",
      kind: "vertex" as const,
      lineageTokens: [],
      signature: {
        kind: "vertex" as const,
        geometryClass: "POINT",
        measure: 0,
        centroid: [0, 0, 0],
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
        boundaryCount: 0,
        adjacentGeometryClasses: [],
      },
    }
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [1, 0, 0] },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        kind: "edge",
        signature: { ...base.signature, kind: "edge", geometryClass: "CIRCLE" },
        referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [1, 0, 0] },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        referenceGeometry: { kind: "vertex", position: [Number.NaN, 0, 0] },
      }).success,
    ).toBe(false)
    expect(
      topologyCandidateSchema.safeParse({
        ...base,
        kind: "edge",
        signature: { ...base.signature, kind: "edge", geometryClass: "LINE" },
        referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [0, 0, 0] },
      }).success,
    ).toBe(false)
  })

  it("accepts a finite versioned kernel spike request", () => {
    const parsed = geometryWorkerRequestSchema.parse({
      ...validEnvelope,
      type: "runKernelSpike",
      parameters: validParameters,
    })

    expect(parsed.type).toBe("runKernelSpike")
  })

  it("accepts bounded canonical feature evaluation requests", () => {
    const request = {
      ...validEnvelope,
      type: "evaluateFeature",
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
      content: boxContent,
      contentHash: "a".repeat(64),
      dependencies: [],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }

    expect(geometryWorkerRequestSchema.safeParse(request).success).toBe(true)
    expect(boxFeatureContentParametersSchema.parse(request.content.feature.parameters)).toEqual({
      ...request.content.feature.parameters,
      origin: [0, 0, 0],
    })
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: {
            ...request.content.feature,
            parameters: { ...request.content.feature.parameters, origin: [12, -8, 7] },
          },
        },
      }).success,
    ).toBe(true)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        mesh: { ...request.mesh, chordTolerance: 0.000_1 },
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({ ...request, contentHash: "invalid" }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: { ...request.content.feature, inputs: ["a".repeat(64)] },
        },
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: {
            ...request.content.feature,
            parameters: Object.fromEntries(
              Array.from({ length: 33 }, (_, index) => [`parameter-${index}`, index]),
            ),
          },
        },
      }).success,
    ).toBe(false)
  })

  it("accepts a stable topology reference to a dependency input", () => {
    expect(
      featureContentIdentitySchema.safeParse({
        ...boxContent,
        feature: {
          ...boxContent.feature,
          inputs: ["b".repeat(64)],
          references: [
            {
              schemaVersion: 0,
              kind: "face",
              semanticRole: "primitive.box.cap.end",
              signature: {
                kind: "face",
                geometryClass: "PLANE",
                measure: 600,
                centroid: [0, 0, 20],
                bounds: { min: [-10, -15, 20], max: [10, 15, 20] },
                direction: [0, 0, 1],
                directionMode: "oriented",
                boundaryCount: 4,
                adjacentGeometryClasses: ["PLANE"],
              },
              inputIndex: 0,
            },
          ],
        },
      }).success,
    ).toBe(true)
  })

  it("accepts exact selector-resolved extrusion profiles and rejects mismatched sources", () => {
    const parameters = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      plane: "xy",
      outer: {
        sourceEntityIds: [
          "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
        ],
        segments: [
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
            type: "line",
            startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3221",
            endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3222",
            start: [0, 0],
            end: [20, 0],
          },
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
            type: "arc",
            startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3222",
            endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3223",
            start: [20, 0],
            middle: [25, 5],
            end: [20, 10],
          },
        ],
      },
      holes: [],
      distance: 12,
      symmetric: false,
      operation: "new",
    } as const

    expect(extrusionFeatureContentParametersSchema.safeParse(parameters).success).toBe(true)
    const { plane: _plane, ...profile } = parameters
    const framed = {
      ...profile,
      frame: {
        origin: [0, 0, 10],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
    }
    expect(extrusionFeatureContentParametersSchema.safeParse(framed).success).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({ ...framed, plane: "xy" }).success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...framed,
        frame: { ...framed.frame, yAxis: [0, -1, 0] },
      }).success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({ ...parameters, operation: "intersect" })
        .success,
    ).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...parameters,
        outer: { ...parameters.outer, sourceEntityIds: parameters.outer.sourceEntityIds.slice(1) },
      }).success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({ ...parameters, distance: Number.NaN })
        .success,
    ).toBe(false)
  })

  it("accepts bounded revolve content with a world axis", () => {
    const profile = {
      sourceEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
      segments: [
        {
          entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          type: "line" as const,
          startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3221",
          endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3222",
          start: [0, 0] as [number, number],
          end: [20, 0] as [number, number],
        },
      ],
    }
    const content = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      frame: {
        origin: [0, 0, 0] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
      },
      outer: profile,
      holes: [],
      axis: "x" as const,
      axisOrigin: [0, 0, 0] as [number, number, number],
      axisDirection: [1, 0, 0] as [number, number, number],
      angleRadians: Math.PI,
      operation: "new" as const,
    }
    expect(revolveFeatureContentParametersSchema.safeParse(content).success).toBe(true)
    expect(
      revolveFeatureContentParametersSchema.safeParse({ ...content, angleRadians: 0 }).success,
    ).toBe(false)
    expect(
      revolveFeatureContentParametersSchema.safeParse({
        ...content,
        axisDirection: [2, 0, 0],
      }).success,
    ).toBe(false)
    expect(
      revolveFeatureContentParametersSchema.safeParse({
        ...content,
        axisOrigin: [1, 0, 0],
      }).success,
    ).toBe(false)
    expect(
      revolveFeatureContentParametersSchema.safeParse({
        ...content,
        axisDirection: [0, 1, 0],
      }).success,
    ).toBe(false)
  })

  it("accepts exact ellipse extrusion geometry and rejects invalid axes", () => {
    const parameters = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      plane: "xy",
      outer: {
        sourceEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
        segments: [
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
            type: "ellipse",
            center: [2, 3],
            primaryAxisPoint: [12, 3],
            secondaryAxisPoint: [2, 8],
          },
        ],
      },
      holes: [],
      distance: 12,
      symmetric: false,
      operation: "new",
    } as const

    expect(extrusionFeatureContentParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...parameters,
        outer: {
          ...parameters.outer,
          segments: [{ ...parameters.outer.segments[0], secondaryAxisPoint: [7, 8] }],
        },
      }).success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...parameters,
        outer: {
          ...parameters.outer,
          segments: [{ ...parameters.outer.segments[0], primaryAxisPoint: [2, 3] }],
        },
      }).success,
    ).toBe(false)
  })

  it("accepts exact elliptical-arc extrusion geometry and rejects off-ellipse endpoints", () => {
    const parameters = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      plane: "xy",
      outer: {
        sourceEntityIds: [
          "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
          "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
        ],
        segments: [
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3211",
            type: "elliptical-arc",
            startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3221",
            endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3222",
            center: [0, 0],
            primaryAxisPoint: [10, 0],
            secondaryAxisPoint: [0, 5],
            start: [10, 0],
            end: [-10, 0],
          },
          {
            entityId: "0195b5ac-b220-7a2c-8c33-67a36a7f3212",
            type: "line",
            startPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3222",
            endPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3221",
            start: [-10, 0],
            end: [10, 0],
          },
        ],
      },
      holes: [],
      distance: 12,
      symmetric: false,
      operation: "new",
    } as const

    expect(extrusionFeatureContentParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      extrusionFeatureContentParametersSchema.safeParse({
        ...parameters,
        outer: {
          ...parameters.outer,
          segments: [
            { ...parameters.outer.segments[0], end: [-9, 0] },
            parameters.outer.segments[1],
          ],
        },
      }).success,
    ).toBe(false)
  })

  it("binds dependent evaluation slots to ordered feature hashes", () => {
    const inputHashes = ["a".repeat(64), "b".repeat(64)]
    const request = {
      ...validEnvelope,
      type: "evaluateFeature",
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
      content: {
        ...boxContent,
        feature: {
          ...boxContent.feature,
          type: { ...boxContent.feature.type, typeId: "org.vibeshape.feature.part-design.boolean" },
          parameters: { operation: "subtract" },
          inputs: inputHashes,
        },
      },
      contentHash: "c".repeat(64),
      dependencies: [
        {
          featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          contentHash: inputHashes[0],
        },
        {
          featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
          contentHash: inputHashes[1],
        },
      ],
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    }

    expect(geometryWorkerRequestSchema.safeParse(request).success).toBe(true)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [...request.dependencies].reverse(),
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [request.dependencies[0]],
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [
          request.dependencies[0],
          {
            ...request.dependencies[1],
            featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...request,
        dependencies: [
          { ...request.dependencies[0], featureId: request.featureId },
          request.dependencies[1],
        ],
      }).success,
    ).toBe(false)
  })

  it("accepts bounded topology parameters and rejects invalid pattern geometry", () => {
    const parameters = {
      boxSize: [60, 40, 20],
      holeCount: 2,
      holeRadius: 6,
      holeSpacing: 10,
      holeCenter: [0, 0],
      filletRadius: 1.5,
    }

    expect(topologySpikeParametersSchema.safeParse(parameters).success).toBe(true)
    expect(
      topologySpikeParametersSchema.safeParse({ ...parameters, holeCenter: [25, 0] }).success,
    ).toBe(false)
    expect(
      topologySpikeParametersSchema.safeParse({
        ...parameters,
        holeCount: 3,
        holeSpacing: 10,
      }).success,
    ).toBe(false)
  })

  it("rejects unordered topology signature bounds at the worker boundary", () => {
    expect(
      topologySignatureSchema.safeParse({
        kind: "face",
        geometryClass: "PLANE",
        measure: 1,
        centroid: [0, 0, 0],
        bounds: { min: [1, 0, 0], max: [0, 1, 1] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      }).success,
    ).toBe(false)
  })

  it("defaults an omitted lifecycle operation to the existing boolean-cut fixture", () => {
    const {
      lifecycleOperation: _operation,
      purgeAfterLifecycle: _purge,
      ...legacyParameters
    } = validParameters
    const parsed = kernelSpikeParametersSchema.parse(legacyParameters)

    expect(parsed.lifecycleOperation).toBe("boolean-cut")
    expect(parsed.purgeAfterLifecycle).toBe(false)
  })

  it("rejects an unsupported lifecycle operation", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        lifecycleOperation: "fillet",
      }).success,
    ).toBe(false)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite CAD parameters: %s",
    (invalidRadius) => {
      expect(
        kernelSpikeParametersSchema.safeParse({
          ...validParameters,
          cylinderRadius: invalidRadius,
        }).success,
      ).toBe(false)
    },
  )

  it("rejects an unsupported protocol version", () => {
    expect(
      geometryWorkerRequestSchema.safeParse({
        ...validEnvelope,
        protocolVersion: GEOMETRY_PROTOCOL_VERSION + 1,
        type: "healthCheck",
      }).success,
    ).toBe(false)
  })

  it("rejects a fillet that cannot fit inside the box", () => {
    const result = kernelSpikeParametersSchema.safeParse({
      ...validParameters,
      filletRadius: 10,
    })

    expect(result.success).toBe(false)
  })

  it("rejects dimensions outside the bounded spike workspace", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        cylinderRadius: 100_001,
      }).success,
    ).toBe(false)
  })

  it("rejects a mesh tolerance that can cause runaway tessellation", () => {
    expect(
      kernelSpikeParametersSchema.safeParse({
        ...validParameters,
        meshTolerance: 0.000_1,
      }).success,
    ).toBe(false)
  })

  it("accepts structured-clone mesh payloads", () => {
    const response = geometryWorkerResponseSchema.parse({
      ...validEnvelope,
      type: "kernelSpikeCompleted",
      engine: {
        adapter: "replicad",
        adapterVersion: "spike-2",
        replicadVersion: "0.23.1",
        opencascadePackageVersion: "0.23.0",
        opencascadeSourceRevision: null,
        wasmBytes: 1,
        initializedInMs: 1,
        featureContentEnvironment,
      },
      shape: {
        valid: true,
        volume: 1,
        surfaceArea: 6,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        faceCount: 6,
        edgeCount: 12,
        solidCount: 1,
      },
      history: {
        booleanCut: {
          vertices: historyStats,
          edges: historyStats,
          faces: historyStats,
          solids: historyStats,
        },
        fillet: {
          vertices: historyStats,
          edges: historyStats,
          faces: historyStats,
        },
      },
      topologyCandidates: [
        {
          candidateId: "face:0",
          kind: "face",
          semanticRole: "base-extrude.cap.end",
          lineageTokens: [],
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 1,
            centroid: [0.5, 0.5, 1],
            bounds: { min: [0, 0, 1], max: [1, 1, 1] },
            direction: [0, 0, 1],
            directionMode: "oriented",
            boundaryCount: 4,
            adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
          },
        },
      ],
      mesh: {
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 0, 1]),
        indices: new Uint32Array([0, 0, 0]),
        triangleFaceIds: new Uint32Array([1]),
      },
      exchange: {
        stepBytes: 1,
        stepFile: new Uint8Array([1]),
        stlBytes: 84,
        importedShape: {
          valid: true,
          volume: 1,
          surfaceArea: 6,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          faceCount: 6,
          edgeCount: 12,
          solidCount: 1,
        },
        relativeVolumeError: 0,
      },
      lifecycle: {
        operation: "boolean-cut",
        iterations: 1,
        ownedShapesBefore: 0,
        ownedShapesAfter: 0,
        wasmHeapBytesBefore: 1,
        wasmHeapBytesAfter: 1,
        wasmHeapGrowthBytes: 0,
        allocatorPurge: { requested: false, releasedBlocks: 0 },
      },
      memory: {
        source: "heap-capacity-only",
        snapshots: GEOMETRY_MEMORY_STAGES.map((stage) => ({
          stage,
          heapCapacityBytes: 1,
          allocator: null,
        })),
      },
      timings: {
        createPrimitivesMs: 1,
        booleanCutMs: 1,
        filletMs: 1,
        validationMs: 1,
        tessellationMs: 1,
        stepExportMs: 1,
        stepImportMs: 1,
        stlExportMs: 1,
        lifecycleCheckMs: 1,
        totalMs: 9,
      },
    })

    expect(response.type).toBe("kernelSpikeCompleted")

    if (response.type !== "kernelSpikeCompleted") {
      throw new Error("Expected the kernel spike response fixture.")
    }

    expect(response.exchange.stepFile).toBeInstanceOf(Uint8Array)
    expect(response.exchange.stepBytes).toBe(response.exchange.stepFile.byteLength)

    expect(
      geometryWorkerResponseSchema.safeParse({
        ...response,
        exchange: { ...response.exchange, stepBytes: response.exchange.stepBytes + 1 },
      }).success,
    ).toBe(false)
  })
})
