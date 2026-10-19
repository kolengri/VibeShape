import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import {
  extrusionFeatureContentParametersV8Schema,
  featureEvaluationInputSchema,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "multi-sketch-extrusion-invariants"
const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const xy = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
const yz = { origin: [10, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] }
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))

function rectangle(n: number, width = 2) {
  const points = [
    [0, 0],
    [width, 0],
    [width, width],
    [0, width],
  ] as const
  return {
    outer: {
      sourceEntityIds: [0, 1, 2, 3].map((i) => id(n + i)),
      segments: points.map((start, i) => ({
        entityId: id(n + i),
        type: "line",
        startPointId: id(n + 4 + i),
        endPointId: id(n + 4 + ((i + 1) % 4)),
        start: [...start],
        end: [...(points[(i + 1) % 4] ?? points[0])],
      })),
    },
    holes: [],
  }
}
function request(
  changes: FeatureEvaluationInput["content"]["feature"]["parameters"] = {},
  target = false,
) {
  const parameters = {
    sketchId: id(1),
    sketchIds: [id(1), id(2)],
    supportFeatureIds: [],
    frame: xy,
    distance: 3,
    symmetric: false,
    reversed: false,
    secondDistance: null,
    operation: "new",
    startOffset: 0,
    draftAngle: 0,
    endCondition: { kind: "distance" },
    ...changes,
  }
  const profiles = [xy, yz].map((frame, i) => ({
    ...rectangle(20 + i * 10),
    frame,
    distance: parameters.distance,
    endCondition: parameters.endCondition,
  }))
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId: id(3),
    contentHash: "b".repeat(64),
    dependencies: target
      ? [{ featureId: id(4), contentHash: "a".repeat(64), outputRole: "result" }]
      : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: target ? 1 : 0,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.extrusion",
          schemaVersion: 8,
        },
        parameters: { profiles, ...parameters },
        inputs: target ? ["a".repeat(64)] : [],
        ...(target ? { inputRoles: ["result"] } : {}),
        references: [],
      },
      environment: engine.getFeatureContentEnvironment(),
    },
  })
}
async function evaluate(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}
async function targetBox() {
  const input = request()
  return evaluate(
    featureEvaluationInputSchema.parse({
      ...input,
      featureId: id(4),
      contentHash: "a".repeat(64),
      content: {
        ...input.content,
        feature: {
          ...input.content.feature,
          type: {
            ...input.content.feature.type,
            typeId: "org.vibeshape.feature.part-design.box",
            schemaVersion: 1,
          },
          parameters: { width: 6, depth: 6, height: 6, centered: false, origin: [3, 3, 0] },
        },
      },
    }),
  )
}

describe("multi-sketch Extrude exact geometry", () => {
  it("builds XY and YZ tools in their own frames, reuses the complete result, and releases it", async () => {
    try {
      const input = request()
      const result = await evaluate(input)
      expect(result.shape).toMatchObject({ valid: true, solidCount: 2 })
      expect(result.shape.volume).toBeCloseTo(24, 6)
      result.shape.bounds.min.forEach((value) => {
        expect(value).toBeCloseTo(0, 6)
      })
      result.shape.bounds.max.forEach((value, axis) => {
        expect(value).toBeCloseTo([13, 2, 3][axis] ?? 0, 6)
      })
      expect(
        result.topologyCandidates.every((candidate) => candidate.semanticRole === undefined),
      ).toBe(true)
      expect((await evaluate(input)).cache.brepHit).toBe(true)
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  })
  it.each([
    { reversed: true, startOffset: 1, symmetric: false, minimum: [-2, 0, -2], maximum: [2, 12, 2] },
    {
      reversed: false,
      startOffset: 1,
      symmetric: true,
      minimum: [-0.5, 0, -0.5],
      maximum: [2.5, 12, 2.5],
    },
  ])(
    "applies shared directions and offset relative to each normal: %j",
    async ({ minimum, maximum, ...parameters }) => {
      try {
        const input = request(parameters)
        const value = extrusionFeatureContentParametersV8Schema.parse(
          input.content.feature.parameters,
        )
        const second = value.profiles[1]
        if (!second) throw new Error("Expected the second profile.")
        second.frame.origin = [0, 10, 0]
        const result = await evaluate(
          featureEvaluationInputSchema.parse({
            ...input,
            content: { ...input.content, feature: { ...input.content.feature, parameters: value } },
          }),
        )
        expect(result.shape.volume).toBeCloseTo(24, 6)
        expect(result.shape.bounds.min[0]).toBeCloseTo(minimum[0] ?? 0, 6)
        expect(result.shape.bounds.min[2]).toBeCloseTo(minimum[2] ?? 0, 6)
        expect(result.shape.bounds.max[1]).toBeCloseTo(12, 6)
        expect(result.shape.bounds.max[2]).toBeCloseTo(maximum[2] ?? 0, 6)
      } finally {
        engine.disposeDocument(documentId)
      }
    },
  )
  it("preserves parallel offset and reflected support normals without flattening profiles", async () => {
    try {
      const input = request({
        profiles: [
          { ...rectangle(20), frame: xy, distance: 3, endCondition: { kind: "distance" } },
          {
            ...rectangle(30),
            frame: { origin: [10, 4, 6], xAxis: [0, 1, 0], yAxis: [1, 0, 0], normal: [0, 0, -1] },
            distance: 3,
            endCondition: { kind: "distance" },
          },
        ],
      })
      const result = await evaluate(input)
      expect(result.shape.volume).toBeCloseTo(24, 6)
      expect(result.shape.solidCount).toBe(2)
      result.shape.bounds.min.forEach((value) => {
        expect(value).toBeCloseTo(0, 6)
      })
      result.shape.bounds.max.forEach((value, axis) => {
        expect(value).toBeCloseTo([12, 6, 6][axis] ?? 0, 6)
      })
    } finally {
      engine.disposeDocument(documentId)
    }
  })
  it.each([
    ["add", 280],
    ["remove", 88],
    ["intersect", 128],
  ] as const)(
    "combines perpendicular tools before one scoped %s and retains the target",
    async (operation, volume) => {
      try {
        const target = await targetBox()
        const profiles = [xy, { ...yz, origin: [0, 0, 0] }].map((frame, i) => ({
          ...rectangle(20 + i * 10, 4),
          frame,
          distance: 8,
          endCondition: { kind: "distance" },
        }))
        const result = await evaluate(request({ operation, distance: 8, profiles }, true))
        expect(result.shape).toMatchObject({ valid: true, solidCount: 1 })
        expect(result.shape.volume).toBeCloseTo(volume, 5)
        expect(target.shape.volume).toBeCloseTo(216, 6)
        expect(engine.getHealth().ownedShapeCount).toBe(2)
      } finally {
        engine.disposeDocument(documentId)
      }
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    },
  )
  it("uses independently resolved through-all distances for perpendicular planes", async () => {
    try {
      await targetBox()
      const endCondition = {
        kind: "through-all",
        inputIndex: 0,
        sourceContentHash: "a".repeat(64),
        outputRole: "result",
      }
      const profiles = [
        { ...rectangle(20), frame: xy, distance: 6.01, endCondition },
        { ...rectangle(30), frame: { ...yz, origin: [0, 0, 0] }, distance: 8.01, endCondition },
      ]
      const input = request({ distance: 6.01, profiles, endCondition }, true)
      const result = await evaluate(input)
      expect(result.shape.valid).toBe(true)
      expect(result.shape.volume).toBeCloseTo(48.08, 5)
      expect(result.shape.bounds.max[0]).toBeCloseTo(8.01, 6)
      expect(result.shape.bounds.max[2]).toBeCloseTo(6.01, 6)
    } finally {
      engine.disposeDocument(documentId)
    }
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  })
  it("rejects a disjoint modifying result without evicting valid geometry or leaking tools", async () => {
    try {
      await targetBox()
      const validInput = request({ operation: "remove" }, true)
      const valid = await evaluate(validInput)
      const invalid = request({ operation: "add" }, true)
      invalid.contentHash = "c".repeat(64)
      const result = await engine.evaluateFeature(invalid, vi.fn())
      expect(result.ok).toBe(false)
      expect(engine.getHealth().ownedShapeCount).toBe(2)
      const retained = await evaluate(validInput)
      expect(retained.cache.brepHit).toBe(true)
      expect(retained.shape.volume).toBeCloseTo(valid.shape.volume, 6)
    } finally {
      engine.disposeDocument(documentId)
    }
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  })
})
