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

const boxInput = ({ origin = [50, 0, 0] }: { origin?: number[] } = {}) =>
  featureInput({
    id: boxId,
    typeId: "box",
    schemaVersion: 1,
    contentHash: boxHash,
    parameters: { width: 4, depth: 4, height: 4, centered: true, origin },
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

const datumId = "0195b5ac-b220-7a2c-8c33-67a36a7f3404"
const datumHash = "d".repeat(64)
// The datum is the XZ plane lifted 8 mm in Z; local +Y runs along world +Z.
const datumFrame = { origin: [0, 0, 8], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] }

function datumInput(): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId: datumId,
    contentHash: datumHash,
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.reference-geometry",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.reference-geometry.datum-plane",
          schemaVersion: 2,
        },
        parameters: { size: 64, frame: datumFrame },
        inputs: [],
        references: [],
      },
    },
  })
}

/** The path sketch lies on the datum, so the datum producer follows the target as input two. */
function supportedPathPattern(): FeatureEvaluationInput {
  const base = pathPattern({ mode: "equal" })
  if (base.content.schemaVersion !== 1) throw new Error("Expected a body-bound input.")
  const parameters = base.content.feature.parameters as Record<string, unknown> & {
    path: Record<string, unknown>
  }
  return featureEvaluationInputSchema.parse({
    ...base,
    dependencies: [...base.dependencies, { featureId: datumId, contentHash: datumHash }],
    content: {
      ...base.content,
      feature: {
        ...base.content.feature,
        parameters: {
          ...parameters,
          count: 4,
          orientation: "translate",
          path: { ...parameters.path, supportFeatureId: datumId, frame: datumFrame },
        },
        inputs: [boxHash, datumHash],
        inputRoles: ["result", null],
      },
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

  it("evaluates a path sketched on a Datum Plane listed as the second dependency", async () => {
    try {
      await evaluate(datumInput())
      await evaluate(boxInput({ origin: [50, 0, 8] }))
      const result = await evaluate(supportedPathPattern())
      expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
        "pattern.instance.0",
        "pattern.instance.1",
        "pattern.instance.2",
        "pattern.instance.3",
      ])
      // A quarter turn along the datum circle moves the seed from +X to +Z in world space.
      const second = result.bodies?.[1]?.shape.bounds
      const center = [0, 1, 2].map(
        (axis) => ((second?.min[axis] ?? 0) + (second?.max[axis] ?? 0)) / 2,
      )
      expect(center[0]).toBeCloseTo(0, 6)
      expect(center[1]).toBeCloseTo(0, 6)
      expect(center[2]).toBeCloseTo(58, 6)
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
