import { describe, expect, it } from "bun:test"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import {
  initialLightweightingFields,
  type LightweightingSource,
  lightweightingInput,
} from "./lightweighting-model"
import {
  faceForce,
  faceTriangleIndices,
  lightweightingOverlays,
} from "./lightweighting-surface-selection"

const body: ModelBodyGeometry = {
  featureId: featureIdSchema.parse("10000000-0000-7000-8000-000000000001"),
  contentHash: "captured-hash",
  outputRole: "result",
  shape: {
    valid: true,
    volume: 1000 / 6,
    surfaceArea: 200,
    solidCount: 1,
    faceCount: 4,
    edgeCount: 6,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  },
  topologyCandidates: [],
  mesh: {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
    normals: new Float32Array(12),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]),
    triangleFaceIds: new Uint32Array([17, 42, 17, 99]),
  },
}
const source: LightweightingSource = {
  context: {
    documentId: "captured-document",
    revision: 7,
    authorityVersion: 4,
    historyAfter: null,
  },
  partId: "source-part",
  partName: "Source",
  featureId: body.featureId,
  outputRole: "result",
  contentHash: body.contentHash,
  body,
}

describe("captured Lightweighting surface targets", () => {
  it("maps display face identity to exact source triangle indices rather than face ordinals", () => {
    expect(faceTriangleIndices(source, [17])).toEqual([0, 2])
    expect(faceTriangleIndices(source, [42, 99])).toEqual([1, 3])
    expect(faceTriangleIndices(source, [0, 1])).toEqual([])
  })

  it("makes normal and reversed axis forces explicit and omits an unspecified force arrow", () => {
    expect(
      faceForce(source, [42], { magnitudeN: "10", direction: "normal", flipped: false }),
    ).toEqual([0, 10, 0])
    expect(faceForce(source, [42], { magnitudeN: "10", direction: "z", flipped: true })).toEqual([
      -0, -0, -10,
    ])
    const fields = initialLightweightingFields(source, "Load", true)
    if (!fields.surfaceSelection) throw new Error("Graphical fields require surface selection.")
    fields.surfaceSelection.loadFaces[0] = [42]
    expect(
      lightweightingOverlays(source, fields).some((overlay) => overlay.kind === "force-arrow"),
    ).toBe(false)
    const load = fields.loadCases[0]
    if (!load?.surfaceForce) throw new Error("Graphical loads require explicit force settings.")
    load.surfaceForce.magnitudeN = "10"
    const arrow = lightweightingOverlays(source, fields).find(
      (overlay) => overlay.kind === "force-arrow",
    )
    expect(arrow).toMatchObject({ kind: "force-arrow", vector: [0, 10, 0] })
    if (arrow?.kind !== "force-arrow") throw new Error("The specified load requires a force arrow.")
    expect(arrow.origin[0]).toBeCloseTo(10 / 3, 10)
    expect(arrow.origin[1]).toBe(0)
    expect(arrow.origin[2]).toBeCloseTo(10 / 3, 10)
  })

  it("sends selected faces and depth to the solver while retaining legacy box input behavior", () => {
    const graphical = initialLightweightingFields(source, "Load", true)
    if (!graphical.surfaceSelection) throw new Error("Graphical fields require surface selection.")
    graphical.surfaceSelection.supportFaces = [17]
    graphical.surfaceSelection.loadFaces[0] = [42]
    graphical.surfaceSelection.preserveFaces = [99]
    graphical.surfaceSelection.depthMm = "2.5"
    const input = lightweightingInput(source, graphical)
    expect(input.supports).toEqual([{ kind: "surface", triangleIndices: [0, 2], depthMm: 2.5 }])
    expect(input.loadCases[0]?.region).toEqual({
      kind: "surface",
      triangleIndices: [1],
      depthMm: 2.5,
    })
    expect(input.preserveRegions).toEqual([{ kind: "surface", triangleIndices: [3], depthMm: 2.5 }])
    const legacy = lightweightingInput(source, initialLightweightingFields(source, "Legacy load"))
    expect(legacy.supports).toEqual([{ min: [0, 0, 0], max: [0.5, 10, 10] }])
    expect(legacy.loadCases[0]?.region).toEqual({ min: [9.5, 0, 0], max: [10, 10, 10] })
  })
})
