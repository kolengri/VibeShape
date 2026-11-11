import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine(undefined, (references, candidates) => {
  const ids = references.map((reference) =>
    candidates.filter(
      (candidate) => JSON.stringify(candidate.signature) === JSON.stringify(reference.signature),
    ),
  )
  return ids.every((matches) => matches.length === 1)
    ? {
        ok: true,
        candidateIds: ids.flatMap((matches) => matches.map(({ candidateId }) => candidateId)),
      }
    : { ok: false, reason: "missing" }
})
const documentId = "draft-scale-engine"
const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f3303"
const boxHash = "a".repeat(64)
const patternHash = "c".repeat(64)
const SIZE = 20
const HEIGHT = 10

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

function featureInput(
  input: Readonly<{
    id: string
    typeId: string
    parameters: unknown
    dependency?: { featureId: string; contentHash: string; outputRole: string }
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
          schemaVersion: 1,
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

async function box() {
  return evaluate(
    featureInput({
      id: boxId,
      typeId: "box",
      contentHash: boxHash,
      parameters: { width: SIZE, depth: SIZE, height: HEIGHT, centered: false, origin: [0, 0, 0] },
    }),
  )
}

type Evaluated = Awaited<ReturnType<typeof box>>
function faces(source: Evaluated, matches: (direction: readonly number[]) => boolean) {
  const candidates = source.bodies?.[0]?.topologyCandidates ?? []
  return candidates
    .filter(({ kind, signature }) => kind === "face" && matches(signature.direction ?? []))
    .map(({ signature }) => ({ schemaVersion: 1, kind: "face", outputRole: "result", signature }))
}
const isSide = (direction: readonly number[]) => Math.abs(direction[2] ?? 1) < 1e-9
const isTop = (direction: readonly number[]) => (direction[2] ?? 0) > 0.999

function draftInput(source: Evaluated, selection: unknown[], pullDirection = [0, 0, 1]) {
  const base = source.shape.bounds.min[2]
  return featureInput({
    id: featureId,
    typeId: "draft",
    dependency: { featureId: boxId, contentHash: boxHash, outputRole: "result" },
    parameters: {
      faces: selection,
      planeOrigin: [0, 0, base],
      planeNormal: [0, 0, -1],
      pullDirection,
      angle: (5 * Math.PI) / 180,
      supportInputIndex: 0,
    },
  })
}

function frustumVolume(top: number) {
  const bottom = SIZE * SIZE
  return (HEIGHT / 3) * (bottom + top * top + Math.sqrt(bottom * top * top))
}

describe("Draft engine evaluation", () => {
  it("drafts resolved body faces and reports the exact frustum", async () => {
    try {
      const source = await box()
      const result = await evaluate(draftInput(source, faces(source, isSide)))
      const top = SIZE - 2 * HEIGHT * Math.tan((5 * Math.PI) / 180)
      expect(result.shape.volume).toBeCloseTo(frustumVolume(top), 4)
      expect(result.shape.solidCount).toBe(1)
      expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("fails an undraftable face with an actionable diagnostic and keeps ownership balanced", async () => {
    try {
      const source = await box()
      const owned = engine.getHealth().ownedShapeCount
      const result = await engine.evaluateFeature(
        draftInput(source, [...faces(source, isSide), ...faces(source, isTop)]),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      if (result.ok) throw new Error("Expected Draft to fail.")
      expect(result.diagnostic.message).toContain("Draft cannot tilt selected face 5")
      expect(engine.getHealth().ownedShapeCount).toBe(owned)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("rejects faces that the body no longer contains", async () => {
    try {
      const source = await box()
      const [face] = faces(source, isSide)
      const moved = {
        ...face,
        signature: { ...face?.signature, centroid: [999, 999, 999] },
      }
      const result = await engine.evaluateFeature(draftInput(source, [moved]), vi.fn())
      expect(result).toMatchObject({ ok: false })
      if (result.ok) throw new Error("Expected Draft to fail.")
      expect(result.diagnostic.message).toContain("Draft face 1 is missing")
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})

describe("Scale engine evaluation", () => {
  it("scales one named Pattern output about its bounding-box center", async () => {
    try {
      const source = await box()
      await evaluate(
        featureInput({
          id: patternId,
          typeId: "pattern",
          contentHash: patternHash,
          dependency: { featureId: boxId, contentHash: boxHash, outputRole: "result" },
          parameters: { kind: "linear", count: 2, axis: "X", spacing: 30 },
        }),
      )
      const result = await evaluate(
        featureInput({
          id: featureId,
          typeId: "scale",
          dependency: {
            featureId: patternId,
            contentHash: patternHash,
            outputRole: "pattern.instance.1",
          },
          parameters: { factor: 2, center: { kind: "bounding-box-center" } },
        }),
      )
      expect(result.shape.volume).toBeCloseTo(8 * source.shape.volume, 6)
      const center = (bounds: Evaluated["shape"]["bounds"], axis: 0 | 1 | 2) =>
        (bounds.min[axis] + bounds.max[axis]) / 2
      // The second instance is the source shifted 30 mm along X; its own center stays fixed.
      expect(center(result.shape.bounds, 0)).toBeCloseTo(center(source.shape.bounds, 0) + 30, 6)
      for (const axis of [1, 2] as const)
        expect(center(result.shape.bounds, axis)).toBeCloseTo(center(source.shape.bounds, axis), 6)
      expect(result.shape.bounds.max[2] - result.shape.bounds.min[2]).toBeCloseTo(2 * HEIGHT, 6)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("rejects an out-of-range factor at the worker boundary", async () => {
    try {
      await box()
      const result = await engine.evaluateFeature(
        featureInput({
          id: featureId,
          typeId: "scale",
          dependency: { featureId: boxId, contentHash: boxHash, outputRole: "result" },
          parameters: { factor: 5000, center: { kind: "origin" } },
        }),
        vi.fn(),
      )
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      })
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})
