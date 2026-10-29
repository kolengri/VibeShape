import { describe, expect, it } from "bun:test"
import { printOptimizationSettingsSchema } from "@vibeshape/automation-api/print-optimization-tools"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  lightweightingId,
  lightweightingIdentity,
} from "../../../../../packages/automation-api/src/lightweighting.test-fixtures"
import { printOptimizationFace } from "../../../../../packages/automation-api/src/print-optimization.test-fixtures"
import type { LightweightingSource } from "./lightweighting-model"
import { prepareAutomatedPrintOptimization } from "./prepare-automated-print-optimization"
import {
  defaultPrintOptimizationParameters,
  initialPrintOptimizationFields,
} from "./print-optimization-model"

function fixture() {
  const bottom = printOptimizationFace()
  const top = bodyFaceRefSchema.parse({ ...printOptimizationFace(8), semanticRole: "top" })
  const vertices = [0, 0, 0, 16, 0, 0, 16, 8, 0, 0, 8, 0, 0, 0, 8, 16, 0, 8, 16, 8, 8, 0, 8, 8]
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]
  const source: LightweightingSource = {
    ...lightweightingIdentity,
    partName: "Print beam",
    context: {
      documentId: lightweightingId(3),
      revision: 4,
      authorityVersion: 4,
      historyAfter: null,
    },
    body: {
      featureId: lightweightingIdentity.featureId,
      contentHash: lightweightingIdentity.contentHash,
      outputRole: "result",
      representation: "exact-solid",
      shape: {
        valid: true,
        volume: 1024,
        surfaceArea: 640,
        solidCount: 1,
        faceCount: 6,
        edgeCount: 12,
        bounds: { min: [0, 0, 0], max: [16, 8, 8] },
      },
      mesh: {
        positions: Float32Array.from(vertices),
        precisePositions: Float64Array.from(vertices),
        normals: new Float32Array(vertices.length),
        indices: Uint32Array.from(indices),
        triangleFaceIds: Uint32Array.from([17, 17, 42, 42, 3, 3, 4, 4, 5, 5, 6, 6]),
      },
      topologyCandidates: [bottom, top].map((face, index) => ({
        candidateId: `disposable:${index}`,
        kind: "face",
        semanticRole: face.semanticRole,
        lineageTokens: [],
        signature: face.signature,
        meshFaceId: index === 0 ? 17 : 42,
      })),
    },
  }
  const settings = printOptimizationSettingsSchema.parse({
    bedFace: bottom,
    preserveFaces: [top],
    material: { kind: "preset", presetId: "pla" },
  })
  return { source, settings }
}

describe("paired print optimization source preparation", () => {
  it("resolves a hollow part's initial grid from its wall scale instead of only its envelope", () => {
    const { source } = fixture()
    source.body.shape.bounds = { min: [0, 0, 0], max: [200, 120, 80] }
    source.body.shape.volume = 40_000
    source.body.shape.surfaceArea = 40_000
    expect(defaultPrintOptimizationParameters(source)).toEqual({
      cellSizeMm: 0.5,
      minFeatureSizeMm: 0.8,
      layerHeightMm: 0.2,
    })
    source.body.shape.volume = 1_920_000
    source.body.shape.surfaceArea = 99_200
    expect(defaultPrintOptimizationParameters(source).cellSizeMm).toBe(8)
  })

  it("retains explicit numerical settings and the selected faces when deriving finer defaults", () => {
    const { source, settings } = fixture()
    const prepared = prepareAutomatedPrintOptimization(source, {
      ...settings,
      cellSizeMm: 1,
      minFeatureSizeMm: 1,
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
    })
    expect(prepared.configuration.cellSizeMm).toBe(1)
    expect(prepared.configuration.minFeatureSizeMm).toBe(1)
    expect(prepared.preserveFaceIds).toEqual([42])
    expect(prepared.input.voxelGridOriginMm).toEqual([0, 0, 0])
    expect(prepared.input.relativePerformance).toEqual({
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
    })
  })

  it("resolves native face bindings and shares editor defaults and simultaneous scenarios", () => {
    const { source, settings } = fixture()
    const prepared = prepareAutomatedPrintOptimization(source, settings)
    const defaults = initialPrintOptimizationFields(source)
    expect(prepared.configuration.cellSizeMm).toBe(Number(defaults.cellSizeMm))
    expect(prepared.configuration.material.youngModulusMpa).toBe(2300)
    expect(prepared.preserveFaceIds).toEqual([42])
    expect(prepared.input.preserveRegions).toEqual([
      { kind: "surface", triangleIndices: [2, 3], depthMm: 2 },
    ])
    expect(prepared.input.relativePerformance).toEqual({
      minStiffnessFraction: 0.9,
      minStrengthFraction: 0.9,
    })
    expect(prepared.input.loadCases.map(({ name }) => name)).toEqual([
      "Axial tension",
      "Bending 1",
      "Bending 2",
      "Torsion",
    ])
    expect(prepared.input.loadCases[3]?.additionalLoads).toHaveLength(1)
  })
  it("supports custom material and exact preservation of the bed face itself", () => {
    const { source, settings } = fixture()
    const properties = {
      youngModulusMpa: 1800,
      poissonRatio: 0.3,
      yieldStrengthMpa: 40,
      densityKgM3: 1100,
    }
    const prepared = prepareAutomatedPrintOptimization(source, {
      ...settings,
      preserveFaces: [settings.bedFace],
      material: { kind: "custom", properties },
      cellSizeMm: 0.5,
    })
    expect(prepared.configuration.material).toEqual(properties)
    expect(prepared.configuration.minFeatureSizeMm).toBe(0.8)
    expect(prepared.preserveFaceIds).toEqual([17])
  })
  it("rejects a changed face signature even when a semantic role still matches", () => {
    const { source, settings } = fixture()
    settings.bedFace.signature.measure += 1
    expect(() => prepareAutomatedPrintOptimization(source, settings)).toThrow("changed")
  })
  it("rejects another output, ambiguous faces and missing native bindings", () => {
    const { source, settings } = fixture()
    expect(() =>
      prepareAutomatedPrintOptimization(source, {
        ...settings,
        bedFace: { ...settings.bedFace, outputRole: "other" },
      }),
    ).toThrow("another body")
    const candidate = source.body.topologyCandidates[0]
    if (!candidate) throw new Error("Missing face fixture.")
    const duplicated = {
      ...source,
      body: {
        ...source.body,
        topologyCandidates: [
          ...source.body.topologyCandidates,
          { ...candidate, candidateId: "duplicate", meshFaceId: 99 },
        ],
      },
    }
    expect(() => prepareAutomatedPrintOptimization(duplicated, settings)).toThrow("ambiguous")
    const missing = {
      ...source,
      body: {
        ...source.body,
        topologyCandidates: source.body.topologyCandidates.map((face) => ({
          ...face,
          meshFaceId: undefined,
        })),
      },
    }
    expect(() => prepareAutomatedPrintOptimization(missing, settings)).toThrow(
      "native tessellation",
    )
  })
  it("rejects multiple references to one preserved native face", () => {
    const { source, settings } = fixture()
    const face = settings.preserveFaces[0]
    if (!face) throw new Error("Missing preserved face fixture.")
    expect(() =>
      prepareAutomatedPrintOptimization(source, {
        ...settings,
        preserveFaces: [face, { ...face, intent: { nearPoint: [0, 0, 8] } }],
      }),
    ).toThrow("same native face")
  })
})
