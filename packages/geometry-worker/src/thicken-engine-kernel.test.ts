import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema, featureForwardsDiagnosticMessage } from "@vibeshape/protocol"
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
const documentId = "thicken-engine"
const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f4401"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f4402"
const patternId = "0195b5ac-b220-7a2c-8c33-67a36a7f4403"
const sourceHash = "a".repeat(64)
const patternHash = "c".repeat(64)
const RADIUS = 5
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
    schemaVersion?: number
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
          schemaVersion: input.schemaVersion ?? 1,
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

async function cylinder() {
  return evaluate(
    featureInput({
      id: sourceId,
      typeId: "cylinder",
      contentHash: sourceHash,
      parameters: { radius: RADIUS, height: HEIGHT, centered: false, origin: [0, 0, 0] },
    }),
  )
}

type Evaluated = Awaited<ReturnType<typeof cylinder>>
function cylindricalFaces(source: Evaluated, outputRole = "result") {
  const body = source.bodies?.find((candidate) => candidate.outputRole === outputRole)
  return (body?.topologyCandidates ?? [])
    .filter(({ kind, signature }) => kind === "face" && signature.geometryClass === "CYLINDRE")
    .map(({ signature }) => ({ schemaVersion: 1, kind: "face", outputRole, signature }))
}
const annulus = (inner: number, outer: number) => Math.PI * (outer ** 2 - inner ** 2) * HEIGHT
const dependency = { featureId: sourceId, contentHash: sourceHash, outputRole: "result" }

function thickenInput(faces: unknown[], parameters: Record<string, unknown> = {}) {
  return featureInput({
    id: featureId,
    typeId: "thicken",
    dependency,
    parameters: { faces, thickness: 2, side: "outward", operation: "new", ...parameters },
  })
}

describe("Thicken engine evaluation", () => {
  it("thickens a resolved cylindrical face into the analytic annulus", async () => {
    try {
      const source = await cylinder()
      const result = await evaluate(thickenInput(cylindricalFaces(source)))
      expect(result.shape.volume).toBeCloseTo(annulus(RADIUS, RADIUS + 2), 4)
      expect(result.shape.solidCount).toBe(1)
      expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("thickens a face of one named Pattern output", async () => {
    try {
      await cylinder()
      const pattern = await evaluate(
        featureInput({
          id: patternId,
          typeId: "pattern",
          contentHash: patternHash,
          dependency,
          parameters: { kind: "linear", count: 2, axis: "X", spacing: 30 },
        }),
      )
      const outputRole = "pattern.instance.1"
      const result = await evaluate(
        featureInput({
          id: featureId,
          typeId: "thicken",
          dependency: { featureId: patternId, contentHash: patternHash, outputRole },
          parameters: {
            faces: cylindricalFaces(pattern, outputRole),
            thickness: 1,
            side: "symmetric",
            operation: "new",
          },
        }),
      )
      expect(result.shape.volume).toBeCloseTo(annulus(RADIUS - 0.5, RADIUS + 0.5), 4)
      expect((result.shape.bounds.min[0] + result.shape.bounds.max[0]) / 2).toBeCloseTo(30, 4)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("fails a too-thick concave offset clearly and keeps ownership balanced", async () => {
    try {
      const source = await cylinder()
      const owned = engine.getHealth().ownedShapeCount
      const result = await engine.evaluateFeature(
        thickenInput(cylindricalFaces(source), { thickness: 6, side: "inward" }),
        vi.fn(),
      )
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      if (result.ok) throw new Error("Expected Thicken to fail.")
      expect(result.diagnostic.message).toContain("curvature radius of selected face 1")
      expect(engine.getHealth().ownedShapeCount).toBe(owned)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("names a face that the body no longer contains", async () => {
    try {
      const source = await cylinder()
      const [face] = cylindricalFaces(source)
      const moved = { ...face, signature: { ...face?.signature, centroid: [999, 999, 999] } }
      const result = await engine.evaluateFeature(thickenInput([moved]), vi.fn())
      if (result.ok) throw new Error("Expected Thicken to fail.")
      expect(result.diagnostic.message).toContain("Thicken face 1 is missing")
    } finally {
      engine.disposeDocument(documentId)
    }
  })
})

describe("Press Pull v2 engine evaluation", () => {
  it("fails a planar Press Pull authored as version 1 with a typed message and catalog advice", async () => {
    try {
      const source = await cylinder()
      const top = (source.bodies?.[0]?.topologyCandidates ?? []).find(
        ({ kind, signature }) =>
          kind === "face" &&
          signature.geometryClass === "PLANE" &&
          Math.abs(signature.centroid[2] - HEIGHT) < 1e-6,
      )
      if (!top) throw new Error("The cylinder top face is missing.")
      const face = {
        schemaVersion: 1,
        kind: "face",
        outputRole: "result",
        signature: top.signature,
      }
      const owned = engine.getHealth().ownedShapeCount
      // Planar faces are authored as version 1; cutting through the whole height collapses it.
      const input = featureInput({
        id: featureId,
        typeId: "press-pull",
        schemaVersion: 1,
        dependency,
        parameters: { distance: -HEIGHT, sourceContentHash: sourceHash, face },
      })
      const result = await engine.evaluateFeature(input, vi.fn())
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-geometry" } })
      if (result.ok) throw new Error("Expected Press Pull to fail.")
      expect(result.diagnostic.message).toContain("collapses, splits, or misses the body")
      // Version 1 keeps catalog advice: the document worker does not forward this message.
      expect(featureForwardsDiagnosticMessage(input.content.feature.type)).toBe(false)
      expect(engine.getHealth().ownedShapeCount).toBe(owned)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })

  it("offsets a curved face only in version 2", async () => {
    try {
      const source = await cylinder()
      const [face] = cylindricalFaces(source)
      const pressPull = (schemaVersion: number) =>
        featureInput({
          id: featureId,
          typeId: "press-pull",
          schemaVersion,
          dependency,
          parameters: { distance: 1, sourceContentHash: sourceHash, face },
        })
      const v1 = await engine.evaluateFeature(pressPull(1), vi.fn())
      expect(v1).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
      const v2 = await evaluate(pressPull(2))
      expect(v2.shape.volume).toBeCloseTo(source.shape.volume + annulus(RADIUS, RADIUS + 1), 4)
    } finally {
      engine.disposeDocument(documentId)
      expect(engine.getHealth().ownedShapeCount).toBe(0)
    }
  })
})
