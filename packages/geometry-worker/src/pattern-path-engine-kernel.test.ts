import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "path-pattern-engine"
const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f3401"
const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f3402"
const scaleId = "0195b5ac-b220-7a2c-8c33-67a36a7f3403"
const boxHash = "a".repeat(64)
const patternHash = "c".repeat(64)
const entity = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`

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

type Dependency = { featureId: string; contentHash: string; outputRole: string }
function featureInput(
  input: Readonly<{
    id: string
    typeId: string
    schemaVersion: number
    parameters: unknown
    dependency?: Dependency
    contentHash?: string
  }>,
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  const dependency = input.dependency
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId: input.id,
    contentHash: input.contentHash ?? "b".repeat(64),
    dependencies: dependency ? [dependency] : [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: dependency ? 1 : 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: `org.vibeshape.feature.part-design.${input.typeId}`,
          schemaVersion: input.schemaVersion,
        },
        parameters: input.parameters,
        inputs: dependency ? [dependency.contentHash] : [],
        ...(dependency ? { inputRoles: [dependency.outputRole] } : {}),
        references: [],
      },
    },
  })
}

async function evaluate(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}

const boxInput = () =>
  featureInput({
    id: boxId,
    typeId: "box",
    schemaVersion: 1,
    contentHash: boxHash,
    parameters: { width: 4, depth: 4, height: 4, centered: true, origin: [50, 0, 0] },
  })

function pathPattern(spacing: unknown) {
  return featureInput({
    id: patternId,
    typeId: "pattern",
    schemaVersion: 3,
    contentHash: patternHash,
    dependency: { featureId: boxId, contentHash: boxHash, outputRole: "result" },
    parameters: {
      kind: "path",
      count: 3,
      path: {
        sketchId: entity(900),
        frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
        sourceEntityIds: [entity(1)],
        startPointId: entity(2),
        geometry: {
          kind: "circle",
          circle: { entityId: entity(1), type: "circle", center: [0, 0], radius: 50 },
          startAngle: 0,
        },
      },
      spacing,
      startOffset: 0,
      orientation: "follow",
      reverse: false,
    },
  })
}

describe("path Pattern engine evaluation", () => {
  it("names every instance as an independent pattern output usable downstream", async () => {
    try {
      await evaluate(boxInput())
      const result = await evaluate(pathPattern({ mode: "equal" }))
      expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
        "pattern.instance.0",
        "pattern.instance.1",
        "pattern.instance.2",
      ])
      expect(result.shape.solidCount).toBe(3)
      expect(result.shape.volume).toBeCloseTo(3 * 64, 6)
      // The third instance follows the circle to 240 degrees.
      const third = result.bodies?.[2]?.shape.bounds
      const center = [0, 1].map((axis) => ((third?.min[axis] ?? 0) + (third?.max[axis] ?? 0)) / 2)
      expect(center[0]).toBeCloseTo(50 * Math.cos((4 * Math.PI) / 3), 6)
      expect(center[1]).toBeCloseTo(50 * Math.sin((4 * Math.PI) / 3), 6)
      const scaled = await evaluate(
        featureInput({
          id: scaleId,
          typeId: "scale",
          schemaVersion: 1,
          dependency: {
            featureId: patternId,
            contentHash: patternHash,
            outputRole: "pattern.instance.2",
          },
          parameters: { factor: 2, center: { kind: "bounding-box-center" } },
        }),
      )
      expect(scaled.shape.volume).toBeCloseTo(8 * 64, 6)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("reports an overrun as a geometry failure without leaking owned shapes", async () => {
    try {
      await evaluate(boxInput())
      const owned = engine.getHealth().ownedShapeCount
      const result = await engine.evaluateFeature(
        pathPattern({ mode: "fixed", distance: 50 * Math.PI }),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false })
      if (result.ok) throw new Error("Expected the path pattern to fail.")
      expect(result.diagnostic.message).toContain("wraps a closed path")
      expect(engine.getHealth().ownedShapeCount).toBe(owned)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("rejects malformed path content at the worker boundary", async () => {
    try {
      await evaluate(boxInput())
      const result = await engine.evaluateFeature(pathPattern({ mode: "fixed" }), vi.fn())
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
